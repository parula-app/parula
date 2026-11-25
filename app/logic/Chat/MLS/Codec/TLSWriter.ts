/** Serializes the TLS presentation language that MLS uses, RFC 9420 § 2.1.
 *
 * Beyond plain TLS (RFC 8446), MLS adds:
 * - `optional<T>`: a presence octet 0 or 1, then the value.
 * - `<V>` vectors: a variable-size length header, the QUIC varint of RFC 9000 § 16,
 *   restricted to the shortest encoding. @see `variableLength()`
 *
 * Writers are cheap. Nested structures build their own writer and hand the
 * result to `opaque()` or `struct()` of the outer one. */
export class TLSWriter {
  protected chunks: Uint8Array[] = [];
  protected length = 0;

  uint8(value: number): this {
    return this.add(new Uint8Array([value & 0xFF]));
  }

  uint16(value: number): this {
    return this.add(new Uint8Array([value >> 8 & 0xFF, value & 0xFF]));
  }

  uint32(value: number): this {
    return this.add(new Uint8Array([value >> 24 & 0xFF, value >> 16 & 0xFF, value >> 8 & 0xFF, value & 0xFF]));
  }

  uint64(value: bigint | number): this {
    let out = new Uint8Array(8);
    let v = BigInt(value);
    for (let i = 7; i >= 0; i--) {
      out[i] = Number(v & 0xFFn);
      v >>= 8n;
    }
    return this.add(out);
  }

  /** `opaque foo[n]`: the bytes without any length header. */
  bytes(value: Uint8Array): this {
    return this.add(value);
  }

  /** `opaque foo<V>`: variable-length header, then the bytes. */
  opaque(value: Uint8Array): this {
    return this.variableLength(value.length).add(value);
  }

  /** `T foo<V>`: variable-length header, then each element in order. */
  vector<T>(items: readonly T[], writeItem: (writer: TLSWriter, item: T) => void): this {
    let inner = new TLSWriter();
    for (let item of items) {
      writeItem(inner, item);
    }
    return this.opaque(inner.finish());
  }

  /** `optional<T>`: presence octet, then the value if present. */
  optional<T>(value: T | null | undefined, writeValue: (writer: TLSWriter, value: T) => void): this {
    if (value == null) {
      return this.uint8(0);
    }
    this.uint8(1);
    writeValue(this, value);
    return this;
  }

  /** Serializes a nested struct inline, i.e. without a length header. */
  struct(write: (writer: TLSWriter) => void): this {
    write(this);
    return this;
  }

  /**
   * The variable-size length header of RFC 9420 § 2.1.2: the two most
   * significant bits hold log2 of the header size in bytes, the value fills
   * the remaining 6, 14 or 30 bits, in network byte order.
   * MLS requires the shortest encoding, so the ranges do not overlap.
   */
  variableLength(value: number): this {
    if (value < 0x40) {
      return this.uint8(value);
    } else if (value < 0x4000) {
      return this.uint16(0x4000 | value);
    } else if (value < 0x40000000) {
      return this.uint32(0x80000000 | value);
    }
    throw new Error(`TLS vector of ${value} bytes exceeds the 2^30 limit`);
  }

  finish(): Uint8Array {
    let out = new Uint8Array(this.length);
    let offset = 0;
    for (let chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  protected add(chunk: Uint8Array): this {
    this.chunks.push(chunk);
    this.length += chunk.length;
    return this;
  }
}

/** Convenience for the common `struct.serialize(writer)` / `Struct.toBytes()` pair. */
export function tlsSerialize(write: (writer: TLSWriter) => void): Uint8Array {
  let writer = new TLSWriter();
  write(writer);
  return writer.finish();
}
