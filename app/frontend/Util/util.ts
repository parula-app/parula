import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import type { URLString } from "../../logic/util/util";
import { blobToDataURL } from "../../logic/util/blob";

/** Returns what `onEnter` returns, so that an async `onEnter` can be awaited,
 * e.g. by the `catchErrors()` around the call. */
export function onKeyEnter(event: KeyboardEvent, onEnter: () => void | Promise<void>) {
  if (event.key != "Enter") {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  return onEnter();
}

/** Whether the user types text into this element, so keys keep their meaning there */
export function isTextField(target: EventTarget | null): boolean {
  let element = target as HTMLElement;
  return !!element?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
}

/** The digit key in the top row or on the number pad,
 * also with keyboard layouts whose top row types other characters, e.g. French */
export function getKeyDigit(event: KeyboardEvent): number | null {
  let digit = /^(Digit|Numpad)(\d)$/.exec(event.code)?.[2];
  return digit ? parseInt(digit) : null;
}

export async function saveBlobAsFile(blob: Blob, filename?: string) {
  const showSaveFilePicker = (window as any).showSaveFilePicker;
  if (typeof(showSaveFilePicker) != "function") { // Fallback
    saveBlobAsFileViaA(blob, filename);
    return;
  }
  if (blob instanceof File) {
    filename = blob.name;
  }
  let handle: any;
  try {
    handle = await showSaveFilePicker({
      suggestedName: filename,
    });
  } catch (ex) {
    if (ex.name == "AbortError") {
      return;
    }
    throw ex;
  }
  let writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

/** Doesn't work anymore */
export function saveBlobAsFileViaA(blob: Blob, filename?: string) {
  if (blob instanceof File) {
    filename = blob.name;
  }
  let url = URL.createObjectURL(blob);
  saveURLAsFile(url, filename);
  URL.revokeObjectURL(url); // otherwise we leak the entire blob
}

export async function saveBlobAsDataAsFile(blob: Blob, filename?: string) {
  if (blob instanceof File) {
    filename = blob.name;
  }
  let url = await blobToDataURL(blob);
  saveURLAsFile(url, filename);
}

/** Opens a "Save as..." file picker dialog, with the `filename` prefilled,
 * allowing the user to select where to save the file.
 * The content of `url` will be saved in the file.
 *
 * TODO doesn't work anymore
 */
export function saveURLAsFile(url: URLString, filename: string) {
  let a = document.createElement("a");
  a.href = url;
  a.setAttribute("filename", sanitize.filename(filename, "file"));
  a.setAttribute("target", "_blank");
  a.click();
  a.href = '';
}

/** Attention: You must call `URL.revokeObjectURL(), or we'll leak the entire blob. */
export function stringToBlobURL(mimetype: string, content: string): URLString {
  let blob = new Blob([content], { type: mimetype + ";charset=utf-8" });
  return URL.createObjectURL(blob);
}

/** Attention: Chrome doesn't support `data:` URLs larger than 2 MB.
 * @see <https://groups.google.com/a/chromium.org/g/chromium-dev/c/zYYSVvn6a5M/m/WyZUweM4BAAJ> */
export async function stringToDataURL(mimetype: string, content: string): Promise<URLString> {
  const bytes = new TextEncoder().encode(content);
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes], { type: mimetype + ";charset=utf-8" }));
  });
}

/**
 * Gets the OS using the userAgent string.
 * @returns os name
 */
export function getOSName() {
  let userAgent = navigator.userAgent.toLocaleLowerCase();
  if (userAgent.includes("windows")) {
    return "windows";
  }
  if (userAgent.includes("macintosh")) {
    return "macintosh";
  }
  if (userAgent.includes("linux")) {
    return "linux";
  }
  return "unknown";
}

/**
 * Fetches and decompresses gzip files that are compressed
 */
export async function fetchGzip(url: string) {
  let stream = (await fetch(url)).body;
  let decompressedStream = stream.pipeThrough(
    new DecompressionStream('gzip')
  );
  let blob = await new Response(decompressedStream).blob();
  return URL.createObjectURL(blob);
}

/**
 * Validates user input in an `<input>` text field.
 * @param checkFunc Throws, if the input is invalid. Otherwise just returns.
 * @param inputField will be marked invalid, with the exception message.
 */
export function checkInputField(checkFunc: () => void, inputField: HTMLInputElement) {
  try {
    checkFunc();
    inputField?.setCustomValidity("");
  } catch (ex) {
    inputField?.setCustomValidity(ex.message);
  }
}

/** @returns a new
 * `function isSame(check: T): boolean`
 * which returns
 * - true, if `check` is the same object or value as last time
 * - false, if it's different from the last call
 * - false, if `check` was null/undefined last time
 * - false, for the first call
 *
 * Usage:
 * ```
 * const isSamePerson = createIsSame<Person>();
 * function onInit(person: Person) {
 *   if (isSamePerson(person)) {
 *     return;
 *   }
 *   // do init...
 * }
 * ```
 */
export function createIsSame<T>() {
  let last: T;
  return (check: T) => {
    if (last === check && last !== null && last !== undefined) {
      return true;
    }
    last = check;
    return false;
  };
}
