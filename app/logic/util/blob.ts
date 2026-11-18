import type { URLString } from "./util";

export async function blobToBase64(blob: Blob): Promise<string> {
  let dataURL = await blobToDataURL(blob)
  return dataURL.split(",")[1];
}

export async function blobToDataURL(blob: Blob): Promise<URLString> {
  return new Promise((resolve, reject) => {
    let reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    // The file may be gone or changed on disk, since the user picked it
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Decodes base64. */
export function base64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  if (Uint8Array.fromBase64) {
    return Uint8Array.fromBase64(base64);
  }
  // Fallback: node doesn't have it yet, unlike Electron
  // `Uint8Array.from()` with a map is 30x slower = 1.2s for a 20 MB mail
  let binary = atob(base64);
  let bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Encodes as base64. */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (bytes.toBase64) {
    return bytes.toBase64();
  }
  // Fallback: node doesn't have it yet, unlike Electron
  // Chunks, because spreading a large array into `String.fromCharCode()` overflows the call stack
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function uint8ArrayToHex(bytes: Uint8Array): string {
  return bytes.toHex?.() ?? Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function dataURLToBlob(dataURL: URLString): Promise<Blob> {
  let res = await fetch(dataURL);
  return await res.blob();
}

export function stringFromDataURL(dataURL: URLString, mimetype: string): string | null {
  if (!dataURL || typeof (dataURL) != "string" ||
      dataURL.substring(0, "data:".length + mimetype.length).toLowerCase() != "data:text/html") {
    return null;
  }
  // There might be `;charset=utf-8` in-between
  let comma = dataURL.indexOf(",");
  if (comma < 1) {
    return null;
  }
  let htmlEncoded = dataURL.substring(comma + 1);
  if (!htmlEncoded) {
    return null;
  }
  return decodeURIComponent(htmlEncoded);
}

/** Use as tagged template string:
 * let id = "bar/buu";
 * let name = "Fred Flintstone";
 * URLPart`https://foo/?id=${id}&name=${name}`
 * -> "https://foo/?id=bar%2Fbuu&name=Fred%20Flintstone"
 *
 * Warning: Do *not* escape parts that you want to keep literally in the URL.
 * let baseURL = "https://foo/api"; // ":" and "/" would be escaped
 * let pathname = "com/sub"; // "/" would be escaped
 * URLPart`${baseURL}/${pathname}` // Wrong
 * -> "https%3A%2F%2Ffoo%2Fapi/com%2Fsub"
 */
export function URLPart(literals: TemplateStringsArray, ...values: any[]) {
  return literals.map((literal: string, i: number) => {
    let value = values[i] == undefined ? "" : encodeURIComponent(values[i]);
    return literal + value;
  }).join("");
}

declare global {
  interface Uint8Array {
    toHex(): string;
  }
}
