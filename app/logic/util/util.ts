import { sanitize } from "../../../lib/util/sanitizeDatatypes";

export function assert(test: boolean | object | string | number | null | undefined, errorMessage: string): asserts test {
  if (!test) {
    throw new Error(errorMessage);
  }
}

/**
 * Waits for a given number of seconds, then continues.
 */
export async function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, seconds * 1000);
  });
}

export const waitTime = { factor: 1 }; // tests lower it, to not wait the real time for network timeouts, retries and throttling, see `kRealtimeWait`

export function arrayRemove<T>(array: T[], item: T) {
  let pos = array.indexOf(item);
  if (pos > -1) {
    array.splice(pos, 1);
  }
}

export function arrayRemoveAll<T>(array: T[], item: T) {
  let pos = -1;
  while ((pos = array.indexOf(item, pos)) != -1) {
    array.splice(pos, 1);
  }
}

export function ensureArray<Type>(val: Type[] | Type): Type[] {
  return val ? Array.isArray(val) ? val : [val] : [];
}

export function booleanHasValue(value: boolean | null | undefined): value is boolean {
  return value === true || value === false;
}

// <copied from="../../frontend/Util/LocalStorage.ts">
/** HACK: Assumes that `getLocalStorage()` in the frontend saves the value there, in this format. */
export function getUserPreference<T>(key: string, defaultValue?: T): T {
  return JSON.parse(sanitize.nonemptystring(localStorage.getItem(key), null)) ?? defaultValue;
}
export function setUserPreference<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}
// </copied>

export function randomID(): string {
  return Date.now() + "-" + Math.ceil(Math.random() * 900000);
}

export function capitalizeStart(str: string): string {
  return str.charAt(0).toLocaleUpperCase() + str.substring(1);
}
export function capitalizeWords(str: string): string {
  return str.split(" ").map(word => capitalizeStart(word)).join(" ");
}

/** TODO Implement this correctly */
export function fileExtensionForMIMEType(mimetype: string) {
  if (typeof (mimetype) == "string" && mimetype != "application/octet-stream") {
    let type = mimetype.split("/")[1];
    if (type) {
      return type;
    }
  }
  return ".ext";
}

/** Abstract class as base class for allowing more specific error classes */
export class SpecificError extends Error {
  constructor(ex: Error, message: string) {
    if (!message) {
      message = ex?.message ?? ex + "";
    }
    super(message);
    if (ex) {
      Object.assign(this, ex);
    }
    this.message = message;
  }
}

/** Replace the error message.
 * Some network exceptions are read-only and setting `ex.message` will throw. */
export function exMessage(ex: Error, message: string): Error {
  try {
    ex.message = message;
    return ex;
  } catch (exDummy) {
    let exNew = new Error(message);
    Object.assign(exNew, ex);
    exNew.name = ex.name;
    exNew.stack = ex.stack;
    exNew.cause = ex;
    exNew.message = message;
    return exNew;
  }
}

/** Used for if/else and switch statements
 * when they run into a case that should not happen */
export class NotReached extends Error {
  constructor(msg?: string) {
    super(msg ?? "Not reached: Unhandled case in code");
  }
}

export class NotImplemented extends Error {
  constructor(msg?: string) {
    super(msg ?? "Not yet implemented");
  }
}

export class NotSupported extends Error {
  constructor(msg?: string) {
    super(msg ?? "Operation not supported");
  }
}

export class UserError extends Error {
  isUserError = true;
}

export class UserCancelled extends UserError {
  doNotShow = true;
  constructor(msg?: string) {
    super(msg ?? "Cancelled");
  }
}

export class AbstractFunction extends Error {
  constructor() {
    super("Not yet implemented");
  }
}

export type URLString = string;
export type Json = { [key: string]: JsonValue } | JsonValue[];
type JsonValue = string | number | boolean | null | Json;
