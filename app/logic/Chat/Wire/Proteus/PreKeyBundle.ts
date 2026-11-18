/** The prekey bundle: the only Proteus structure the Wire REST API hands us
 * directly, base64-encoded, as `{ "id": 4711, "key": "pQABAQcCoQBYID..." }`.
 *
 * ```
 * PreKeyBundle = CBOR map(5) {
 *   0: uint  version    -- always 1
 *   1: uint  prekey_id  -- u16
 *   2: map(1){ 0: bytes(32) }               -- prekey public key (Ed25519)
 *   3: map(1){ 0: map(1){ 0: bytes(32) } }  -- identity key (one level deeper!)
 *   4: null | map(1){ 0: bytes(64) }        -- optional Ed25519 signature over key 2
 * }
 * ```
 *
 * The nesting asymmetry between keys 2 and 3 is real. `wire-server`'s
 * `Prekey.hs` labels the two fields the other way round, but its *decoders*
 * agree with the layout above; the names are simply wrong. */
import { ProteusIdentity, ProteusKeyPair } from "./ProteusIdentity";
import { base64Encode, base64Decode, bytesEqual } from "../../Signal/Crypto/primitives";

export class PreKeyBundle {
  /** Format version; the only one that exists is 1. */
  version = 1;
  /** u16. `kLastResortPreKeyID` for the never-consumed last-resort key. */
  preKeyID: number;
  /** 32-byte Ed25519 */
  preKeyPublic: Uint8Array;
  /** 32-byte Ed25519, the owner's long-term identity */
  identityKey: Uint8Array;
  /** 64-byte Ed25519 signature over `preKeyPublic`, if the peer signs its
   * prekeys. Wire's own clients do not. */
  signature: Uint8Array | null = null;

  constructor(preKeyID: number, preKeyPublic: Uint8Array, identityKey: Uint8Array, signature: Uint8Array | null = null) {
    this.preKeyID = preKeyID;
    this.preKeyPublic = preKeyPublic;
    this.identityKey = identityKey;
    this.signature = signature;
  }

  encode(): Uint8Array {
    let cbor = new CBORWriter();
    cbor.map(5);
    cbor.uint(0).uint(this.version);
    cbor.uint(1).uint(this.preKeyID);
    cbor.uint(2).map(1).uint(0).bytes(this.preKeyPublic);
    cbor.uint(3).map(1).uint(0).map(1).uint(0).bytes(this.identityKey);
    cbor.uint(4);
    if (this.signature) {
      cbor.map(1).uint(0).bytes(this.signature);
    } else {
      cbor.null();
    }
    return cbor.finish();
  }

  toBase64(): string {
    return base64Encode(this.encode());
  }

  static decode(bytes: Uint8Array): PreKeyBundle {
    let cbor = new CBORReader(bytes);
    let bundle = new PreKeyBundle(0, null, null);
    for (let key of cbor.mapKeys()) {
      switch (key) {
      case 0: bundle.version = cbor.uint(); break;
      case 1: bundle.preKeyID = cbor.uint(); break;
      case 2: bundle.preKeyPublic = cbor.wrapped(1); break;
      case 3: bundle.identityKey = cbor.wrapped(2); break;
      case 4: bundle.signature = cbor.takeNull() ? null : cbor.wrapped(1); break;
      default: cbor.skip(); break;
      }
    }
    if (!cbor.atEnd) {
      throw new Error("Trailing bytes after the prekey bundle");
    }
    if (bundle.version != 1) {
      throw new Error(`Unsupported prekey bundle version ${bundle.version}`);
    }
    if (bundle.preKeyPublic?.length != 32 || bundle.identityKey?.length != 32) {
      throw new Error("Prekey bundle is missing a key");
    }
    return bundle;
  }

  static fromBase64(text: string): PreKeyBundle {
    return PreKeyBundle.decode(base64Decode(text));
  }

  /** @returns true if there is no signature (the normal case) or it verifies. */
  verify(): boolean {
    return !this.signature ||
      ProteusKeyPair.verify(this.identityKey, this.preKeyPublic, this.signature);
  }

  get isLastResort(): boolean {
    return this.preKeyID == kLastResortPreKeyID;
  }

  equals(other: PreKeyBundle): boolean {
    return this.preKeyID == other.preKeyID &&
      bytesEqual(this.preKeyPublic, other.preKeyPublic) &&
      bytesEqual(this.identityKey, other.identityKey) &&
      !this.signature == !other.signature &&
      (!this.signature || bytesEqual(this.signature, other.signature));
  }
}

/** One of our own prekeys: the private half stays here, the public half goes to
 * the server as a `PreKeyBundle`. */
export class ProteusPreKey {
  /** u16 */
  keyID: number;
  keyPair: ProteusKeyPair;

  constructor(keyID: number, keyPair: ProteusKeyPair) {
    this.keyID = keyID;
    this.keyPair = keyPair;
  }

  /** Mints `count` prekeys with consecutive ids, wrapping before the reserved
   * last-resort id. */
  static generate(startID: number, count: number): ProteusPreKey[] {
    let keys: ProteusPreKey[] = [];
    for (let i = 0; i < count; i++) {
      keys.push(new ProteusPreKey((startID + i) % kLastResortPreKeyID, ProteusKeyPair.generate()));
    }
    return keys;
  }

  /** The prekey the server hands out once the one-time ones are exhausted. It is
   * never consumed, by us or by the server. */
  static lastResort(): ProteusPreKey {
    return new ProteusPreKey(kLastResortPreKeyID, ProteusKeyPair.generate());
  }

  get isLastResort(): boolean {
    return this.keyID == kLastResortPreKeyID;
  }

  bundleFor(identity: ProteusIdentity): PreKeyBundle {
    return new PreKeyBundle(this.keyID, this.keyPair.publicKey, identity.publicKey);
  }

  /** The `{id, key}` object every prekey endpoint of the REST API takes. */
  toJSONForServer(identity: ProteusIdentity): any {
    return { id: this.keyID, key: this.bundleFor(identity).toBase64() };
  }

  toJSON(): any {
    return { id: this.keyID, key: this.keyPair.toJSON() };
  }

  static fromJSON(json: any): ProteusPreKey {
    return new ProteusPreKey(json.id, ProteusKeyPair.fromJSON(json.key));
  }
}

/** Just enough CBOR (RFC 7049) for what Proteus puts on the wire: definite-length
 * maps and arrays, unsigned integers, byte strings and `null`. Deliberately not a
 * general CBOR library — anything else in a document is skipped, not decoded. */
export class CBORWriter {
  private parts: Uint8Array[] = [];

  /** major type 5 */
  map(pairs: number): this {
    return this.head(5, pairs);
  }

  /** major type 4 */
  array(items: number): this {
    return this.head(4, items);
  }

  /** major type 0 */
  uint(value: number): this {
    return this.head(0, value);
  }

  /** major type 2 */
  bytes(value: Uint8Array): this {
    this.head(2, value.length);
    this.parts.push(value);
    return this;
  }

  null(): this {
    this.parts.push(new Uint8Array([0xF6]));
    return this;
  }

  finish(): Uint8Array {
    let total = this.parts.reduce((sum, part) => sum + part.length, 0);
    let out = new Uint8Array(total);
    let offset = 0;
    for (let part of this.parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  /** The initial byte plus the shortest length/value encoding, as the reference
   * encoder emits it. Re-encoding a decoded document must be byte-identical, so
   * "shortest" is a requirement, not an optimization. */
  private head(major: number, value: number): this {
    let tag = major << 5;
    if (value <= 23) {
      this.parts.push(new Uint8Array([tag | value]));
    } else if (value <= 0xFF) {
      this.parts.push(new Uint8Array([tag | 24, value]));
    } else if (value <= 0xFFFF) {
      this.parts.push(new Uint8Array([tag | 25, value >> 8, value & 0xFF]));
    } else if (value <= 0xFFFFFFFF) {
      this.parts.push(new Uint8Array([tag | 26, value >>> 24, (value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF]));
    } else {
      throw new Error(`CBOR value ${value} is too large`);
    }
    return this;
  }
}

export class CBORReader {
  readonly data: Uint8Array;
  pos = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  get atEnd(): boolean {
    return this.pos >= this.data.length;
  }

  uint(): number {
    let { major, value } = this.readHead();
    if (major != 0) {
      throw new Error(`Expected a CBOR uint, got major type ${major}`);
    }
    return value;
  }

  bytes(): Uint8Array {
    let { major, value } = this.readHead();
    if (major != 2) {
      throw new Error(`Expected CBOR bytes, got major type ${major}`);
    }
    return this.take(value);
  }

  /** @returns the number of items */
  array(): number {
    let { major, value } = this.readHead();
    if (major != 4) {
      throw new Error(`Expected a CBOR array, got major type ${major}`);
    }
    return value;
  }

  /** @returns the number of key/value pairs */
  map(): number {
    let { major, value } = this.readHead();
    if (major != 5) {
      throw new Error(`Expected a CBOR map, got major type ${major}`);
    }
    return value;
  }

  /** Reads a definite-length map and yields its integer keys. The caller reads
   * the value of every key it knows and calls `skip()` for the rest, which is
   * what makes the format forward-compatible. Duplicate keys are rejected, as
   * the reference decoder does. */
  *mapKeys(): Generator<number> {
    let pairs = this.map();
    let seen = new Set<number>();
    for (let i = 0; i < pairs; i++) {
      let key = this.uint();
      if (seen.has(key)) {
        throw new Error(`Duplicate CBOR map key ${key}`);
      }
      seen.add(key);
      yield key;
    }
  }

  /** Byte string wrapped in `depth` single-entry maps under key 0 — how Proteus
   * encodes a `PublicKey` (depth 1) and an `IdentityKey` (depth 2). */
  wrapped(depth: number): Uint8Array {
    let value: Uint8Array | undefined;
    for (let key of this.mapKeys()) {
      if (key == 0) {
        value = depth > 1 ? this.wrapped(depth - 1) : this.bytes();
      } else {
        this.skip();
      }
    }
    if (!value) {
      throw new Error("Missing key 0 in a wrapped CBOR value");
    }
    return value;
  }

  /** Consumes and returns true if the next item is `null`, else leaves it. */
  takeNull(): boolean {
    if (this.data[this.pos] != 0xF6) {
      return false;
    }
    this.pos++;
    return true;
  }

  /** Skips one item of any type, including nested containers. */
  skip() {
    let { major, value } = this.readHead();
    switch (major) {
    case 0: case 1: case 7: break; // uint, negative int, simple value: head only
    case 2: case 3: this.take(value); break; // byte and text strings
    case 4: // array
      for (let i = 0; i < value; i++) {
        this.skip();
      }
      break;
    case 5: // map
      for (let i = 0; i < value * 2; i++) {
        this.skip();
      }
      break;
    default:
      throw new Error(`Cannot skip CBOR major type ${major}`);
    }
  }

  private readHead(): { major: number, value: number } {
    if (this.atEnd) {
      throw new Error("Truncated CBOR document");
    }
    let initial = this.data[this.pos++];
    let major = initial >> 5;
    let info = initial & 0x1F;
    if (info <= 23) {
      return { major, value: info };
    }
    if (info == 24) {
      return { major, value: this.take(1)[0] };
    }
    if (info == 25) {
      let b = this.take(2);
      return { major, value: (b[0] << 8) | b[1] };
    }
    if (info == 26) {
      let b = this.take(4);
      return { major, value: ((b[0] << 24) >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3] };
    }
    throw new Error(`Unsupported CBOR additional information ${info}`);
  }

  private take(length: number): Uint8Array {
    if (this.pos + length > this.data.length) {
      throw new Error("Truncated CBOR document");
    }
    // A copy, not a view: the bytes outlive the reader, and @noble's ChaCha20
    // needs a 4-byte-aligned byteOffset.
    let slice = this.data.slice(this.pos, this.pos + length);
    this.pos += length;
    return slice;
  }
}

/** `PrekeyId maxBound` on the backend: handed out repeatedly once the one-time
 * prekeys run out, and never deleted by the receiver. */
export const kLastResortPreKeyID = 0xFFFF;
/** How many one-time prekeys we keep published, matching the reference client. */
export const kPreKeyTarget = 100;
