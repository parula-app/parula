import type { Entity } from "../api";
import type { ReporterError } from "../base/reporter";
import { berToDER } from "../ber";
import { DecoderBuffer } from "../base/buffer";
import { assert, Node } from "../base/node";
import * as der from "../constants/der";

export class DERDecoder {
  enc = 'der';
  name: string;
  entity: Entity;
  tree = new DERNode();

  constructor(entity: Entity) {
    this.name = entity.name;
    this.entity = entity;
    this.tree._init(entity.body);
  }

  decode(data: Uint8Array | DecoderBuffer, options?: Record<string, any>): any {
    if (!DecoderBuffer.isDecoderBuffer(data)) {
      if (options?.berToDER) {
        data = berToDER(data);
      }
      data = new DecoderBuffer(data, options);
    }

    return this.tree._decode(data, options);
  }
}

// Tree methods

class DERNode extends Node {
  constructor(parent?: DERNode) {
    super("der", parent);
  }

  _decode(input: DecoderBuffer, options?: Record<string, any>): any {
    const state = this._baseState;

    // Decode root node
    if (!state.parent) {
      return input.wrapResult((state.children[0] as DERNode)._decode(input, options));
    }

    let result = state.default;
    let present: boolean | ReporterError = true;

    let prevKey;
    if (state.key) {
      prevKey = input.enterKey(state.key);
    }
    // Check if tag is there
    if (state.optional) {
      let tag = null;
      if (state.explicit !== undefined) {
        tag = state.explicit;
      } else if (state.implicit !== undefined) {
        tag = state.implicit;
      } else if (state.tag) {
        tag = state.tag;
      }
      if (tag === null && !state.any) {
        // Trial and Error
        const save = input.save();
        try {
          if (!state.choice) {
            this._decodeGeneric(state.tag, input, options);
          } else {
            this._decodeChoice(input, options);
          }
          present = true;
        } catch (e) {
          present = false;
        }
        input.restore(save);
      } else {
        present = this._peekTag(input, tag, state.any);

        if (input.isError(present)) {
          return present;
        }
      }
    }

    // Push object on stack
    let prevObj;
    if (state.obj && present) {
      prevObj = input.enterObject();
    }

    if (present) {
      // Unwrap explicit values
      if (state.explicit !== undefined) {
        const explicit = this._decodeTag(input, state.explicit);
        if (input.isError(explicit)) {
          return explicit;
        }
        input = explicit;
      }

      const start = input.offset;

      // Unwrap implicit and normal values
      if (!state.use && !state.choice) {
        let save;
        if (state.any) {
          save = input.save();
        }
        const body = this._decodeTag(
          input,
          state.implicit !== undefined ? state.implicit : state.tag,
          state.any
        );
        if (input.isError(body)) {
          return body;
        }
        if (state.any) {
          result = input.raw(save);
        } else {
          input = body;
        }
      }

      if (options && options.track && state.tag) {
        options.track(input.path(), start, input.length, "tagged");
      }
      if (options && options.track && state.tag) {
        options.track(input.path(), input.offset, input.length, "content");
      }
      // Select proper method for tag
      if (state.any) {
        // no-op
      } else if (!state.choice) {
        result = this._decodeGeneric(state.tag, input, options);
      } else {
        result = this._decodeChoice(input, options);
      }

      if (input.isError(result)) {
        return result;
      }
      // Decode children
      if (!state.any && !state.choice && state.children) {
        for (let child of state.children as DERNode[]) {
          // NOTE: We are ignoring errors here, to let parser continue with other
          // parts of encoded data
          child._decode(input, options);
        }
      }

      // Decode contained/encoded by schema, only in bit or octet strings
      if (state.contains && (state.tag === "octstr" || state.tag === "bitstr")) {
        if (state.tag === "bitstr") {
          result = result.data;
        }
        const data = new DecoderBuffer(result);
        result = this._getUse(state.contains, input._reporterState.obj)
          ._decode(data, options);
      }
    }

    // Pop object
    if (state.obj && present) {
      result = input.leaveObject(prevObj);
    }

    // Set key
    if (state.key && (result !== null || present === true)) {
      input.leaveKey(prevKey, state.key, result);
    } else if (prevKey) {
      input.exitKey(prevKey);
    }
    return result;
  };

  _decodeGeneric(tag: string, input: DecoderBuffer, options?: Record<string, any>): any {
    const state = this._baseState;

    if (tag === "seq" || tag === "set") {
      return null;
    }
    if (tag === "seqof" || tag === "setof") {
      return this._decodeList(input, tag, state.args[0], options);
    } else if (/str$/.test(tag)) {
      return this._decodeStr(input, tag);
    } else if (tag === "objid" && state.args) {
      return this._decodeObjid(input, state.args[0], state.args[1]);
    } else if (tag === "objid") {
      return this._decodeObjid(input, null, null);
    } else if (tag === "gentime" || tag === "utctime") {
      return this._decodeTime(input, tag);
    } else if (tag === "null") {
      return this._decodeNull();
    } else if (tag === "bool") {
      return this._decodeBool(input);
    } else if (tag === "objDesc") {
      return this._decodeStr(input, tag);
    } else if (tag === "int" || tag === "enum") {
      return this._decodeInt(input, state.args && state.args[0]);
    }
    if (state.use) {
      return this._getUse(state.use, input._reporterState.obj)._decode(input, options);
    } else {
      return input.error("unknown tag: " + tag);
    }
  };

  _decodeChoice(input: DecoderBuffer, options?: Record<string, any>): any {
    const state = this._baseState;
    let result = null;
    let match = false;

    for (let type in state.choice) {
      const save = input.save();
      const node = state.choice[type] as DERNode;
      try {
        const value = node._decode(input, options);
        if (!input.isError(value)) {
          return { type, value };
        }
      } catch (e) {
      }
      input.restore(save);
    }

    return input.error("Choice not matched");
  }

  _peekTag(buffer: DecoderBuffer, tag: number | string, any = false): boolean | ReporterError {
    if (buffer.isEmpty()) {
      return false;
    }
    const state = buffer.save();
    const decodedTag = derDecodeTag(buffer, 'Failed to peek tag: "' + tag + '"');
    if (buffer.isError(decodedTag)) {
      return decodedTag;
    }

    buffer.restore(state);

    return decodedTag.tag === tag || decodedTag.tagStr === tag ||
      (decodedTag.tagStr + 'of') === tag || any;
  }

  _decodeTag(buffer: DecoderBuffer, tag: number | string, any = false): ReporterError | DecoderBuffer {
    const decodedTag = derDecodeTag(buffer,
      'Failed to decode tag of "' + tag + '"');
    if (buffer.isError(decodedTag)) {
      return decodedTag;
    }

    let len = derDecodeLen(buffer,
      decodedTag.primitive,
      'Failed to get length of "' + tag + '"');

    // Failure
    if (buffer.isError(len)) {
      return len;
    }

    if (!any &&
        decodedTag.tag !== tag &&
        decodedTag.tagStr !== tag &&
        decodedTag.tagStr + 'of' !== tag) {
      return buffer.error('Failed to match tag: "' + tag + '", got ' + JSON.stringify(decodedTag));
    }

    if (decodedTag.primitive || len !== null) {
      return buffer.skip(len, 'Failed to match body of: "' + tag + '"');
    }

    // Indefinite length... find END tag
    const state = buffer.save();
    let skip = this._skipUntilEnd(
      buffer,
      'Failed to skip indefinite length body: "' + tag + '"');
    if (buffer.isError(skip)) {
      return skip;
    }

    len = buffer.offset - state.offset;
    buffer.restore(state);
    let res = buffer.skip(len - 2, 'Failed to match body of: "' + tag + '"');
    buffer.skip(2);
    return res;
  }

  _skipUntilEnd(buffer: DecoderBuffer, fail: string): ReporterError | undefined {
    for (;;) {
      const tag = derDecodeTag(buffer, fail);
      if (buffer.isError(tag)) {
        return tag;
      }
      const len = derDecodeLen(buffer, tag.primitive, fail);
      if (buffer.isError(len)) {
        return len;
      }
      let res;
      if (tag.primitive || len !== null) {
        res = buffer.skip(len);
      } else {
        res = this._skipUntilEnd(buffer, fail);
      }
      // Failure
      if (buffer.isError(res)) {
        return res;
      }
      if (tag.tagStr === 'end' && len === 0) {
        return undefined;
      }
    }
  }

  _decodeList(buffer: DecoderBuffer, tag: string, decoder: Entity, options?: Record<string, any>): ReporterError | any[] {
    const result = [];
    while (!buffer.isEmpty()) {
      const possibleEnd = this._peekTag(buffer, 'end');
      if (buffer.isError(possibleEnd)) {
        return possibleEnd;
      }
      const res = decoder.decode(buffer, options);
      if (buffer.isError(res) && possibleEnd) {
        break;
      }
      result.push(res);
    }
    return result;
  }

  _decodeStr(buffer: DecoderBuffer, tag: string): ReporterError | Uint8Array | string | { unused: number, data: Uint8Array } {
    if (tag === 'bitstr') {
      const unused = buffer.readUInt8();
      if (buffer.isError(unused)) {
        return unused;
      }
      return { unused: unused, data: buffer.raw() };
    } else if (tag === 'bmpstr') {
      const raw = buffer.raw();
      if (raw.length % 2 === 1) {
        return buffer.error('Decoding of string type: bmpstr length mismatch');
      }
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      let str = '';
      for (let i = 0; i < raw.length; i += 2) {
        str += String.fromCharCode(view.getUint16(i));
      }
      return str;
    } else if (tag === 'numstr') {
      const numstr = new TextDecoder().decode(buffer.raw());
      if (!this._isNumstr(numstr)) {
        return buffer.error('Decoding of string type: ' +
                            'numstr unsupported characters');
      }
      return numstr;
    } else if (tag === 'octstr') {
      return buffer.raw();
    } else if (tag === 'objDesc') {
      return buffer.raw();
    } else if (tag === 'printstr') {
      const printstr = new TextDecoder().decode(buffer.raw());
      if (!this._isPrintstr(printstr)) {
        return buffer.error('Decoding of string type: ' +
                            'printstr unsupported characters');
      }
      return printstr;
    } else if (/str$/.test(tag)) {
      return new TextDecoder().decode(buffer.raw());
    } else {
      return buffer.error('Decoding of string type: ' + tag + ' unsupported');
    }
  }

  _decodeObjid(buffer: DecoderBuffer, values?: Record<string, string>, relative?: boolean) {
    let result;
    const identifiers = [];
    let ident = 0;
    let subident = 0;
    while (!buffer.isEmpty()) {
      subident = buffer.readUInt8();
      ident <<= 7;
      ident |= subident & 0x7f;
      if ((subident & 0x80) === 0) {
        identifiers.push(ident);
        ident = 0;
      }
    }
    if (subident & 0x80) {
      identifiers.push(ident);
    }
    const first = (identifiers[0] / 40) | 0;
    const second = identifiers[0] % 40;

    if (relative) {
      result = identifiers;
    } else {
      result = [first, second].concat(identifiers.slice(1));
    }
    if (values) {
      let tmp = values[result.join(' ')];
      if (tmp === undefined) {
        tmp = values[result.join('.')];
      }
      if (tmp !== undefined) {
        result = tmp;
      }
    }

    return result;
  }

  _decodeTime = function decodeTime(buffer: DecoderBuffer, tag: string): ReporterError | number {
    const str = new TextDecoder().decode(buffer.raw());

    let year;
    let mon;
    let day;
    let hour;
    let min;
    let sec;
    if (tag === 'gentime') {
      year = +str.slice(0, 4) | 0;
      mon = +str.slice(4, 6) | 0;
      day = +str.slice(6, 8) | 0;
      hour = +str.slice(8, 10) | 0;
      min = +str.slice(10, 12) | 0;
      sec = +str.slice(12, 14) | 0;
    } else if (tag === 'utctime') {
      year = +str.slice(0, 2) | 0;
      mon = +str.slice(2, 4) | 0;
      day = +str.slice(4, 6) | 0;
      hour = +str.slice(6, 8) | 0;
      min = +str.slice(8, 10) | 0;
      sec = +str.slice(10, 12) | 0;
      if (year < 50) {
        year = 2000 + year;
      } else {
        year = 1900 + year;
      }
    } else {
      return buffer.error('Decoding ' + tag + ' time is not supported yet');
    }

    return Date.UTC(year, mon - 1, day, hour, min, sec, 0);
  }

  _decodeNull(): null {
    return null;
  }

  _decodeBool(buffer: DecoderBuffer): ReporterError | boolean {
    const res = buffer.readUInt8();
    if (buffer.isError(res)) {
      return res;
    } else {
      return res !== 0;
    }
  }

  _decodeInt(buffer: DecoderBuffer, values?: Record<string, string>): ReporterError | bigint | string {
    // Bigint, return as it is (assume big endian)
    const raw = buffer.raw();
    if (raw.length === 0) {
      return buffer.error('Decoding of integer: zero-length body');
    }
    // Decoding takes quadratic time. RSA keys have at most 16384 bits.
    const kMaxLength = 4096;
    if (raw.length > kMaxLength) {
      return buffer.error('Decoding of integer: too long');
    }
    // Pass byteOffset/byteLength explicitly: raw() copies today, but a future
    // switch to a shared-buffer view would otherwise read the wrong bytes.
    let res = BigInt(new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getInt8(0));
    for (let byte of raw.slice(1)) {
      res = res << 8n | BigInt(byte);
    }

    if (values) {
      return values[res.toString(10)] || res;
    }

    return res;
  }

  _use(entity: Entity | ((obj: any) => Entity), obj: any): DERNode {
    if (typeof entity === 'function') {
      entity = entity(obj);
    }
    return entity._getDecoder().tree;
  }

  _getUse(entity: Entity | ((obj: any) => Entity), obj: any): DERNode {
    return super._getUse(entity, obj) as DERNode;
  }
}

// Utility methods

interface Tag {
  cls: string;
  primitive: boolean;
  tag: number;
  tagStr: string;
}

function derDecodeTag(buf: DecoderBuffer, fail: string): Tag | ReporterError {
  let tag = buf.readUInt8(fail);
  if (buf.isError(tag)) {
    return tag;
  }
  const cls = der.tagClass[tag >> 6];
  const primitive = (tag & 0x20) === 0;

  // Multi-octet tag - load
  if ((tag & 0x1f) === 0x1f) {
    let oct = tag;
    tag = 0;
    while ((oct & 0x80) === 0x80) {
      oct = buf.readUInt8(fail);
      if (buf.isError(oct)) {
        return oct;
      }
      tag <<= 7;
      tag |= oct & 0x7f;
    }
  } else {
    tag &= 0x1f;
  }
  const tagStr = der.tag[tag];

  return {
    cls: cls,
    primitive: primitive,
    tag: tag,
    tagStr: tagStr
  };
}

function derDecodeLen(buf: DecoderBuffer, primitive: boolean, fail: string): number | ReporterError {
  let len = buf.readUInt8(fail);
  if (buf.isError(len)) {
    return len;
  }
  // Indefinite form
  if (!primitive && len === 0x80) {
    return null;
  }
  // Definite form
  if ((len & 0x80) === 0) {
    // Short form
    return len;
  }

  // Long form
  const num = len & 0x7f;
  if (num > 4) {
    return buf.error('length octect is too long');
  }
  len = 0;
  for (let i = 0; i < num; i++) {
    const j = buf.readUInt8(fail);
    if (buf.isError(j)) {
      return j;
    }
    len = len * 0x100 + j;
  }

  return len;
}
