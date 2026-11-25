import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import PostalMIME, { type HeaderLine } from "postal-mime";

/**
 * Parse parameters from MIME header values
 * E.g. `Content-Type: text/plain; name=value; name2="value2"`
 *
 * - Quotes and backslash escapes are removed. `;` and `=` within quotes belong to the value.
 * - Comments in `()` are removed
 * - RFC 2231 continuations and encodings are joined and decoded,
 *   e.g. `name*0*=utf-8''a%20; name*1="b"` becomes `name: "a b"`
 * - Newlines and indentions are removed without spaces
 * - Spaces within the same line are preserved, but not at the start and end of a value
 * - The type and the parameter names are lowercased, the values are not
 *
 * Generic function, unrelated to encryption.
 * postal-mime unfortunately doesn't return the parameters, but it parses them
 * internally to show the mail. This parses them the same way, also broken headers,
 * so that both find the same multipart boundary. Otherwise, a signature check
 * would verify other content than what the mail shows.
 *
 * @param headerValue e.g. `text/plain; name=value; name2="value2"`
 * @returns e.g. { $main: `text/plain`, name: `value``, name2: `value2` }
 */
export function parseHeaderParameters(headerValue: string | null | undefined): Record<string, string> {
  let params: Record<string, string> = {};
  let text = stripComments(sanitize.string(headerValue, ""));
  let main = "";
  let name: string | null = null; // null for the type, before the first `;`
  let value = "";
  let isQuoted = false;
  let isEscaped = false;
  for (let i = 0; i <= text.length; i++) {
    let char = text[i]; // undefined after the end
    if (isEscaped && char !== undefined) { // RFC 5322 section 3.2.1
      value += char;
      isEscaped = false;
    } else if (char == "\\") {
      isEscaped = true;
    } else if (char == `"`) {
      isQuoted = !isQuoted;
    } else if (char == ";" && !isQuoted || char === undefined) {
      value = value.trim().replace(/\r?\n[ \t]*/g, ""); // Remove newlines and indention (entirely, without space)
      if (name == null) {
        main = value;
      } else if (name) {
        params[name] = value;
      }
      if (char === undefined) {
        break;
      }
      // Like postal-mime, the name ends only with `=`, not with `;` or quotes
      let pos = text.indexOf("=", i);
      name = text.slice(i + 1, pos < 0 ? text.length : pos).trim().toLowerCase();
      value = "";
      i = pos < 0 ? text.length - 1 : pos;
    } else {
      value += char;
    }
  }

  // RFC 2231: Continuations `name*0`, `name*1` etc., and `name*` with charset and `%` encoding.
  // Like postal-mime, they replace a plain `name`, and `%` is decoded in all of them.
  let continuations = new Map<string, { charset: string, values: { nr: number, value: string }[] }>();
  for (let key of Object.keys(params)) {
    let isEncoded = key.endsWith("*");
    let star = key.lastIndexOf("*", isEncoded ? key.length - 2 : key.length);
    let nr = key.slice(star + 1, isEncoded ? -1 : undefined);
    if (star < 0 || !/^\d+$/.test(nr)) {
      if (!isEncoded) {
        continue;
      }
      star = key.length - 1; // `name*`
      nr = "0";
    }
    let continuation = continuations.get(key.slice(0, star)) ?? { charset: "", values: [] };
    continuations.set(key.slice(0, star), continuation);
    let value = params[key];
    let charsetEnd = value.indexOf("'");
    let languageEnd = value.indexOf("'", charsetEnd + 1);
    if (isEncoded && Number(nr) == 0 && charsetEnd >= 0 && languageEnd >= 0) { // `charset'language'value`
      continuation.charset = value.slice(0, charsetEnd) || "utf-8";
      value = value.slice(languageEnd + 1);
    }
    continuation.values.push({ nr: Number(nr), value });
    delete params[key];
  }
  for (let [key, continuation] of continuations) {
    let encoded = continuation.values.sort((a, b) => a.nr - b.nr).map(part => part.value).join("");
    let bytes: number[] = [];
    for (let i = 0; i < encoded.length; i++) {
      if (encoded[i] == "%" && /^[0-9a-f]{2}$/i.test(encoded.slice(i + 1, i + 3))) {
        bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        bytes.push(...new TextEncoder().encode(encoded[i]));
      }
    }
    let decoder: TextDecoder;
    try {
      decoder = new TextDecoder((continuation.charset || "utf-8").trim().toLowerCase());
    } catch (ex) { // unknown charset, like postal-mime
      decoder = new TextDecoder("windows-1252");
    }
    params[key] = decoder.decode(new Uint8Array(bytes));
  }

  // The type and the parameter names are case-insensitive, the values are not,
  // e.g. the multipart boundary. RFC 2045 section 5.1
  // AutoCrypt headers have no type, but start with `addr=`.
  let pos = main.indexOf("=");
  if (pos >= 0) {
    params[main.slice(0, pos).trim().toLowerCase()] ??= main.slice(pos + 1).trim();
  }
  params.$main = pos >= 0 ? "" : main.toLowerCase();
  return params;
}

/** Removes comments in `()`, which may be nested, but not within quotes.
 * RFC 5322 section 3.2.2 */
function stripComments(text: string): string {
  let result = "";
  let depth = 0;
  let isQuoted = false;
  for (let i = 0; i < text.length; i++) {
    let char = text[i];
    if (char == "\\") {
      result += depth ? "" : char + (text[i + 1] ?? "");
      i++;
    } else if (char == `"` && !depth) {
      isQuoted = !isQuoted;
      result += char;
    } else if (char == "(" && !isQuoted) {
      depth++;
    } else if (char == ")" && !isQuoted && depth) {
      depth--;
    } else if (!depth) {
      result += char;
    }
  }
  return result;
}

/**
 * Returns the direct child contents of a MIME multipart,
 * verbatim, as text. Subparts are intentionally not parsed.
 *
 * Generic function, unrelated to encryption.
 * postal-mime unfortunately doesn't parse parameters.
 *
 * Lines may end with CRLF or LF.
 *
 * @param mime The entire MIME message. May contain other multipart structures.
 * @param contentType Value of the Content-Type header for this particular part
 * @returns The multipart direct children. Each part as a single UTF8-string.
 *   You still need to split lines.
 */
export function parseMIMEDirectSubparts(mime: Uint8Array, contentType: string): string[] {
  return parseMIMEDirectSubpartsBytes(mime, contentType).map(part => new TextDecoder().decode(part));
}

/**
 * Same as `parseMIMEDirectSubparts()`, but returns the raw bytes of each part.
 * Needed wherever the exact bytes matter, e.g. for digesting signed content:
 * a UTF-8 decode/encode round-trip mangles 8-bit content like ISO-8859-1.
 *
 * Finds the boundaries like postal-mime, which shows the mail, so that
 * a signature check verifies exactly the parts that the mail shows.
 */
export function parseMIMEDirectSubpartsBytes(mime: Uint8Array, contentType: string): Uint8Array[] {
  assert(mime && mime instanceof Uint8Array, "Need MIME");
  let parameters = parseHeaderParameters(contentType);
  assert(parameters.$main.startsWith("multipart/"), "Need multipart/* Content-Type, but got " + contentType);
  assert(parameters.boundary, "No boundary found in Content-Type header " + contentType);
  let dashBoundary = new TextEncoder().encode("--" + parameters.boundary);
  let parts: Uint8Array[] = [];
  let partStart = -1; // Content before the first part is skipped
  let isBody = false;
  for (let lineStart = 0; lineStart < mime.length;) {
    // Like postal-mime, a line ends with LF, and CRs before it don't count
    let lineBreak = mime.indexOf(0x0A, lineStart);
    let lineEnd = lineBreak < 0 ? mime.length : lineBreak;
    while (lineEnd > lineStart && mime[lineEnd - 1] == 0x0D) {
      lineEnd--;
    }
    let line = mime.subarray(lineStart, lineEnd);
    // A delimiter is a whole line `--boundary`, for the last one followed by `--`,
    // then optionally spaces or tabs. RFC 2046 section 5.1.1
    let isClose = line[dashBoundary.length] == 0x2D && line[dashBoundary.length + 1] == 0x2D;
    let isDelimiter = isBody &&
      line.length >= dashBoundary.length &&
      dashBoundary.every((byte, i) => line[i] == byte) &&
      line.subarray(dashBoundary.length + (isClose ? 2 : 0)).every(byte => byte == 0x20 || byte == 0x09);
    if (isDelimiter && partStart >= 0) {
      // The line break before the delimiter belongs to the delimiter
      parts.push(mime.subarray(partStart, mime[lineStart - 2] == 0x0D ? lineStart - 2 : lineStart - 1));
    }
    if (isDelimiter && isClose) {
      return parts;
    }
    lineStart = lineBreak < 0 ? mime.length : lineBreak + 1;
    if (isDelimiter) {
      partStart = lineStart;
    }
    isBody ||= !line.length; // The headers end with an empty line
  }
  throw new Error(partStart < 0 ? "Start boundary not found" : "End boundary not found");
}

export async function splitMIMEHeaders(mime: string): Promise<{ headers: HeaderLine[], body: string }> {
  let pos = mime.indexOf(kLineBreak + kLineBreak);
  let headerBlock = pos >= 0 ? mime.slice(0, pos) : mime;
  let body = pos >= 0 ? mime.slice(pos + 4) : "";
  let { headerLines } = await PostalMIME.parse(headerBlock);
  let headers = headerLines.map(header => ({ key: header.key, line: header.line.replaceAll("\n", kLineBreak) }));
  return { headers, body };
}

export function toCRLF(content: string): string {
  if (/[^\r]\n|\r[^\n]/.test(content)) { // bare \n or \r
    return content
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\n/g, "\r\n");
  } else { // already \r\n
    return content;
  }
}

/** Like `toCRLF()`, but byte-wise, so that 8-bit content in UTF-8 or any other charset survives */
export function toCRLFBytes(content: Uint8Array): Uint8Array {
  let bareLineBreaks = 0;
  for (let i = 0; i < content.length; i++) {
    if ((content[i] == 0x0A && content[i - 1] != 0x0D) ||
        (content[i] == 0x0D && content[i + 1] != 0x0A)) {
      bareLineBreaks++;
    }
  }
  if (!bareLineBreaks) {
    return content;
  }
  let result = new Uint8Array(content.length + bareLineBreaks);
  let pos = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] == 0x0A && content[i - 1] != 0x0D) {
      result[pos++] = 0x0D;
    }
    result[pos++] = content[i];
    if (content[i] == 0x0D && content[i + 1] != 0x0A) {
      result[pos++] = 0x0A;
    }
  }
  return result;
}

export function newBoundary(): string {
  return "----" + crypto.randomUUID().replace(/-/g, "");
}

export const kLineBreak = "\r\n";
