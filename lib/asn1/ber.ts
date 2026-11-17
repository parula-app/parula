/**
 * Converts BER-encoded ASN.1 data to DER, as far as our decoder needs it:
 * - Indefinite lengths (X.690 section 8.1.3.6) become definite lengths.
 * - Constructed, i.e. chunked, strings (section 8.1.4) become primitive strings.
 *
 * Outlook and OpenSSL emit S/MIME CMS structures this way ("streaming" BER),
 * but our decoder reads only definite-length primitive strings.
 */

/**
 * @returns the input unchanged, if it needs no conversion (e.g. proper DER)
 * @throws on malformed data
 */
export function berToDER(data: Uint8Array): Uint8Array {
  let element = convert(data, 0, 0);
  return element.changed ? element.bytes : data;
}

interface Element {
  /** The converted TLV */
  bytes: Uint8Array;
  /** The offset in the input directly after this TLV */
  end: number;
  changed: boolean;
}

function convert(data: Uint8Array, start: number, depth: number): Element {
  const kMaxDepth = 30;
  if (depth > kMaxDepth) {
    throw new Error("ASN.1 nesting is too deep");
  }
  let pos = start;
  let tag = data[pos++];
  if ((tag & 0x1f) == 0x1f) { // multi-octet tag number
    while (data[pos] & 0x80) {
      pos++;
    }
    pos++;
  }
  let tagEnd = pos;
  let constructed = !!(tag & 0x20);
  let lengthByte = data[pos++];
  if (pos > data.length) {
    throw new Error("Truncated ASN.1 element");
  }
  let length: number | null; // null = indefinite
  if (lengthByte == 0x80) {
    if (!constructed) {
      throw new Error("Primitive ASN.1 element cannot have indefinite length");
    }
    length = null;
  } else if (lengthByte & 0x80) {
    let count = lengthByte & 0x7f;
    if (count > 4) {
      throw new Error("ASN.1 length is too long");
    }
    if (pos + count > data.length) {
      throw new Error("Truncated ASN.1 element");
    }
    length = 0;
    for (let i = 0; i < count; i++) {
      length = length * 0x100 + data[pos++];
    }
  } else {
    length = lengthByte;
  }

  if (!constructed) {
    let end = pos + length;
    if (end > data.length) {
      throw new Error("Truncated ASN.1 element");
    }
    return { bytes: data.subarray(start, end), end, changed: false };
  }

  let children: Element[] = [];
  let childTags: number[] = [];
  let changed = length === null;
  let end: number;
  if (length === null) {
    while (!(data[pos] == 0 && data[pos + 1] == 0)) {
      if (pos + 1 >= data.length) {
        throw new Error("Missing ASN.1 end-of-contents octets");
      }
      childTags.push(data[pos]);
      let child = convert(data, pos, depth + 1);
      children.push(child);
      changed ||= child.changed;
      pos = child.end;
    }
    end = pos + 2; // skip the end-of-contents octets
  } else {
    let contentEnd = pos + length;
    if (contentEnd > data.length) {
      throw new Error("Truncated ASN.1 element");
    }
    while (pos < contentEnd) {
      childTags.push(data[pos]);
      let child = convert(data, pos, depth + 1);
      children.push(child);
      changed ||= child.changed;
      pos = child.end;
    }
    end = contentEnd;
  }

  let tagClass = tag & 0xc0;
  if (tagClass == 0 && (tag & 0x1f) == 4) {
    // Chunked OCTET STRING: concatenate the chunks.
    // (After conversion, each child is a primitive OCTET STRING.)
    return { bytes: buildTLV(0x04, concat(children.map(child => contents(child.bytes)))), end, changed: true };
  }
  if (tagClass == 0 && (tag & 0x1f) == 3) {
    // Chunked BIT STRING: each chunk starts with its unused bits count,
    // which must be 0 in all chunks but the last (section 8.6.4).
    let chunks = children.map(child => contents(child.bytes));
    let unused = chunks.length ? chunks[chunks.length - 1][0] : 0;
    return { bytes: buildTLV(0x03, concat([Uint8Array.of(unused), ...chunks.map(chunk => chunk.subarray(1))])), end, changed: true };
  }
  if (tagClass != 0 && (tag & 0x1f) != 0x1f && length === null &&
      children.length && childTags.every(childTag => childTag == 0x04)) {
    // A tagged element holding OCTET STRING chunks directly is an
    // IMPLICITly tagged chunked string, e.g. the encryptedContent of CMS
    // EnvelopedData. An EXPLICIT tag around a chunked string holds a single
    // *constructed* OCTET STRING instead, so it does not match here.
    // Only streaming encoders chunk strings, and they always use indefinite
    // lengths, so a definite-length EXPLICIT tag around a primitive
    // OCTET STRING (e.g. the eContent of DER SignedData) does not match either.
    return { bytes: buildTLV(tag & ~0x20, concat(children.map(child => contents(child.bytes)))), end, changed: true };
  }
  if (!changed) {
    return { bytes: data.subarray(start, end), end, changed: false };
  }
  return { bytes: buildTLV(data.subarray(start, tagEnd), concat(children.map(child => child.bytes))), end, changed: true };
}

function buildTLV(tag: number | Uint8Array, content: Uint8Array): Uint8Array {
  let head = typeof tag == "number" ? [tag] : Array.from(tag);
  let length = content.length;
  if (length < 0x80) {
    head.push(length);
  } else {
    let lengthBytes: number[] = [];
    for (; length > 0; length = Math.floor(length / 0x100)) {
      lengthBytes.unshift(length & 0xff);
    }
    head.push(0x80 | lengthBytes.length, ...lengthBytes);
  }
  let bytes = new Uint8Array(head.length + content.length);
  bytes.set(head);
  bytes.set(content, head.length);
  return bytes;
}

/** @returns the value bytes of a definite-length TLV */
function contents(tlv: Uint8Array): Uint8Array {
  let pos = 1;
  if ((tlv[0] & 0x1f) == 0x1f) { // multi-octet tag number
    while (tlv[pos] & 0x80) {
      pos++;
    }
    pos++;
  }
  let lengthByte = tlv[pos++];
  if (lengthByte & 0x80) {
    pos += lengthByte & 0x7f;
  }
  return tlv.subarray(pos);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let pos = 0;
  for (let chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}
