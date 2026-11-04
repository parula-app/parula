import { MapColl } from "svelte-collections";

/**
 * Reads a `.tar` archive in memory, e.g. from `npm pack`.
 * Only plain files and directories are allowed. Links, device files,
 * absolute paths and `..` are rejected, so that nothing can point outside the archive.
 *
 * @returns path -> file contents. Without directories.
 * @throws if the archive is malformed or exceeds the limits
 */
export function readTar(tar: Uint8Array, maxEntries: number, maxSize: number): MapColl<string, Uint8Array> {
  const kBlock = 512;
  let files = new MapColl<string, Uint8Array>();
  let decoder = new TextDecoder();
  let totalSize = 0;
  let longName: string | null = null;
  let offset = 0;
  for (let entries = 0; offset + kBlock <= tar.length; entries++) {
    let header = tar.subarray(offset, offset + kBlock);
    if (header.every(byte => byte == 0)) {
      return files;
    }
    if (entries >= maxEntries) {
      throw new Error(`The archive has more than ${maxEntries} entries`);
    }
    checkTarHeaderChecksum(header);
    let size = parseTarNumber(header.subarray(124, 136));
    let type = String.fromCharCode(header[156]);
    let dataStart = offset + kBlock;
    let dataEnd = dataStart + size;
    if (dataEnd > tar.length) {
      throw new Error("The archive is truncated");
    }
    totalSize += size;
    if (totalSize > maxSize) {
      throw new Error(`The archive contents are larger than ${maxSize} bytes`);
    }
    let data = tar.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / kBlock) * kBlock;

    if (type == "x") {
      longName = parsePAXPath(decoder.decode(data)) ?? longName;
      continue;
    } else if (type == "L") {
      longName = decoder.decode(data).replace(/\0+$/, "");
      continue;
    } else if (type == "g") {
      continue;
    }
    let path = longName ?? tarHeaderPath(header, decoder);
    longName = null;
    if (type == "5") {
      let isRoot = path.split("/").every(part => !part || part == ".");
      if (!isRoot) {
        normalizeRelativePath(path);
      }
      continue;
    } else if (type != "0" && type != "\0" && type != "7") {
      throw new Error(`The archive contains a link or special file, which is not allowed: ${path}`);
    }
    let filePath = normalizeRelativePath(path);
    if (files.has(filePath)) {
      throw new Error(`The archive contains the file ${filePath} twice`);
    }
    files.set(filePath, data.slice());
  }
  throw new Error("The archive has no end marker");
}

/** For a path within a directory, e.g. in an archive
 * @returns The path in a normalized form: no "./", no "//", no trailing "/"
 * @throws if the path could point outside the directory */
export function normalizeRelativePath(path: string): string {
  let parts = path.split("/").filter(part => part && part != ".");
  if (!parts.length || parts.includes("..") || path.startsWith("/") || path.includes("\\") ||
      /^[a-zA-Z]:/.test(path) || /[\x00-\x1F\x7F]/.test(path)) {
    throw new Error(`Disallowed file path: ${path}`);
  }
  return parts.join("/");
}

function tarHeaderPath(header: Uint8Array, decoder: TextDecoder): string {
  let name = tarString(header.subarray(0, 100), decoder);
  let isUStar = tarString(header.subarray(257, 262), decoder) == "ustar";
  let prefix = isUStar ? tarString(header.subarray(345, 500), decoder) : "";
  return prefix ? prefix + "/" + name : name;
}

function tarString(field: Uint8Array, decoder: TextDecoder): string {
  let end = field.indexOf(0);
  return decoder.decode(end < 0 ? field : field.subarray(0, end));
}

function parseTarNumber(field: Uint8Array): number {
  if (field[0] & 0x80) {
    throw new Error("The archive has a file that is too large");
  }
  let text = new TextDecoder().decode(field).replace(/[\0 ]+$/, "").trim();
  if (!/^[0-7]*$/.test(text)) {
    throw new Error("The archive is malformed");
  }
  return text ? parseInt(text, 8) : 0;
}

function checkTarHeaderChecksum(header: Uint8Array) {
  let expected = parseTarNumber(header.subarray(148, 156));
  let sum = 0;
  for (let i = 0; i < header.length; i++) {
    sum += i >= 148 && i < 156 ? 0x20 : header[i];
  }
  if (sum != expected) {
    throw new Error("The archive is malformed (checksum)");
  }
}

/** POSIX extended header: lines of `<length> <key>=<value>\n` */
function parsePAXPath(records: string): string | null {
  for (let line of records.split("\n")) {
    let match = /^\d+ path=(.*)$/s.exec(line);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/** Decompresses gzip data, e.g. a `.tgz` file
 * @throws if the result would be larger than `maxSize` */
export async function gunzip(compressed: Uint8Array, maxSize: number): Promise<Uint8Array> {
  let stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await readStreamBounded(stream, maxSize);
}

/** Reads the whole stream
 * @throws if it is longer than `maxSize`, and stops reading it */
export async function readStreamBounded(stream: ReadableStream<Uint8Array>, maxSize: number): Promise<Uint8Array> {
  let reader = stream.getReader();
  let chunks: Uint8Array[] = [];
  let size = 0;
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    size += chunk.value.length;
    if (size > maxSize) {
      await reader.cancel();
      throw new Error(`The data is larger than ${maxSize} bytes`);
    }
    chunks.push(chunk.value);
  }
  let result = new Uint8Array(size);
  let pos = 0;
  for (let chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}
