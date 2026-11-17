import { Reporter } from "./reporter";

export class DecoderBuffer extends Reporter {
  base: Uint8Array;
  offset = 0;
  length: number;
  constructor(base: any, options?: Record<string, any>) {
    super(options);
    if (!(base instanceof Uint8Array)) {
      this.error('Input not Uint8Array');
      return;
    }
    this.base = base;
    this.length = base.length;
  }

  static isDecoderBuffer(data: any): data is DecoderBuffer {
    return data instanceof DecoderBuffer;
  }

  save(): any {
    return { offset: this.offset, reporter: super.save() };
  }

  restore(save: any) {
    // Return skipped data
    const res = new DecoderBuffer(this.base);
    res.offset = save.offset;
    res.length = this.offset;

    this.offset = save.offset;
    super.restore(save.reporter);

    return res;
  }

  isEmpty(): boolean {
    return this.offset === this.length;
  }

  readUInt8(fail?: string): number {
    if (this.offset < this.length) {
      return this.base[this.offset++];
    } else {
      return this.error(fail || 'DecoderBuffer overrun');
    }
  }

  skip(bytes: number, fail?: string): DecoderBuffer {
    if (this.offset + bytes > this.length) {
      return this.error(fail || 'DecoderBuffer overrun');
    }
    const res = new DecoderBuffer(this.base);

    // Share reporter state
    res._reporterState = this._reporterState;

    res.offset = this.offset;
    res.length = this.offset + bytes;
    this.offset += bytes;
    return res;
  }

  raw(save?: { offset: number }) {
    if (save) {
      return this.base.slice(save.offset, this.offset);
    }
    return this.base.slice(this.offset, this.length);
  }
}

export class EncoderBuffer {
  length = 0;
  value: Array<EncoderBuffer> | number | Uint8Array;
  constructor(value: any, reporter: Reporter) {
    if (value instanceof Uint8Array) {
      this.value = value;
      this.length = value.length;
    } else if (Array.isArray(value)) {
      this.value = value.map(item => {
        if (!EncoderBuffer.isEncoderBuffer(item)) {
          item = new EncoderBuffer(item, reporter);
        }
        this.length += item.length;
        return item;
      });
    } else if (typeof value === 'number') {
      if (!(0 <= value && value <= 0xff)) {
        return reporter.error('non-byte EncoderBuffer value');
      }
      this.value = value;
      this.length = 1;
    } else if (typeof value === 'string') {
      this.value = new TextEncoder().encode(value);
      this.length = this.value.length;
    } else {
      return reporter.error('Unsupported type: ' + typeof value);
    }
  }

  static isEncoderBuffer(data) {
    return data instanceof EncoderBuffer;
  }

  join(out?: Uint8Array, offset?: number): Uint8Array {
    if (!out) {
      out = new Uint8Array(this.length);
    }
    if (!offset) {
      offset = 0;
    }
    if (this.length === 0) {
      return out;
    }
    if (Array.isArray(this.value)) {
      for (let item of this.value) {
        item.join(out, offset);
        offset += item.length;
      }
    } else {
      if (typeof this.value === 'number') {
        out[offset] = this.value;
      } else if (this.value instanceof Uint8Array) {
        out.set(this.value, offset);
      }
      offset += this.length;
    }

    return out;
  }
}
