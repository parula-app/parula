/** Parses the TLS presentation language that MLS uses, RFC 9420 § 2.1.
 * The counterpart of `TLSWriter`.
 *
 * Every read advances the cursor. Malformed input throws `TLSParseError`;
 * callers treat that as "drop this message", never as a fatal error. */
export class TLSReader {
  protected readonly data: Uint8Array;
  protected offset = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }

  get atEnd(): boolean {
    return this.offset >= this.data.length;
  }

  uint8(): number {
    this.need(1);
    return this.data[this.offset++];
  }

  uint16(): number {
    this.need(2);
    let value = this.data[this.offset] << 8 | this.data[this.offset + 1];
    this.offset += 2;
    return value;
  }

  uint32(): number {
    this.need(4);
    let d = this.data;
    let i = this.offset;
    // `>>> 0` because the top bit would otherwise make it negative
    let value = (d[i] << 24 | d[i + 1] << 16 | d[i + 2] << 8 | d[i + 3]) >>> 0;
    this.offset += 4;
    return value;
  }

  uint64(): bigint {
    this.need(8);
    let value = 0n;
    for (let i = 0; i < 8; i++) {
      value = value << 8n | BigInt(this.data[this.offset + i]);
    }
    this.offset += 8;
    return value;
  }

  /** `opaque foo[n]`: exactly `length` bytes, no length header. */
  bytes(length: number): Uint8Array {
    this.need(length);
    let value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  /** `opaque foo<V>`: variable-length header, then the bytes. */
  opaque(): Uint8Array {
    return this.bytes(this.variableLength());
  }

  /** `T foo<V>`: reads elements until the vector's byte length is used up. */
  vector<T>(readItem: (reader: TLSReader) => T): T[] {
    let inner = this.subReader(this.variableLength());
    let items: T[] = [];
    while (!inner.atEnd) {
      items.push(readItem(inner));
    }
    return items;
  }

  /** `optional<T>`: presence octet, then the value if present. */
  optional<T>(readValue: (reader: TLSReader) => T): T | null {
    let present = this.uint8();
    if (present == 0) {
      return null;
    }
    if (present != 1) {
      throw new TLSParseError(`optional<T> presence octet is ${present}, must be 0 or 1`);
    }
    return readValue(this);
  }

  /** The rest of the input, e.g. for a trailing signature-covered blob. */
  rest(): Uint8Array {
    return this.bytes(this.remaining);
  }

  /** A reader over the next `length` bytes, which this reader skips over. */
  subReader(length: number): TLSReader {
    return new TLSReader(this.bytes(length));
  }

  /**
   * The variable-size length header of RFC 9420 § 2.1.2.
   * Rejects the reserved `11` prefix and any non-shortest encoding, both of
   * which the RFC requires to be treated as malformed.
   */
  variableLength(): number {
    let first = this.uint8();
    let prefix = first >> 6;
    if (prefix == 3) {
      throw new TLSParseError("Invalid variable-length integer prefix 0b11");
    }
    let byteCount = 1 << prefix;
    let value = first & 0x3F;
    for (let i = 1; i < byteCount; i++) {
      value = value * 0x100 + this.uint8();
    }
    if (prefix >= 1 && value < 1 << (8 * (byteCount / 2) - 2)) {
      throw new TLSParseError(`Variable-length integer ${value} is not minimally encoded`);
    }
    return value;
  }

  /** Nothing may follow the structure we just parsed. */
  expectEnd(): void {
    if (!this.atEnd) {
      throw new TLSParseError(`${this.remaining} trailing bytes after the structure`);
    }
  }

  protected need(count: number): void {
    if (this.offset + count > this.data.length) {
      throw new TLSParseError(`Need ${count} bytes at offset ${this.offset}, but only ${this.remaining} are left`);
    }
  }
}

/** The input is not a valid MLS structure. Recoverable: drop the message. */
export class TLSParseError extends Error {
}

/** Convenience for the common `Struct.fromBytes()` pair of `tlsSerialize()`. */
export function tlsParse<T>(data: Uint8Array, read: (reader: TLSReader) => T): T {
  let reader = new TLSReader(data);
  let value = read(reader);
  reader.expectEnd();
  return value;
}
