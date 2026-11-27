export const addonGroups = ["message", "mail", "mail.compose", "mail.all", "chat", "chat.all"] as const;
export type AddonGroup = typeof addonGroups[number];

/** Exposes a class or member to addons. `read` groups allow reading or calling, `write` groups allow setting.
 * No-op at runtime: `generate.ts` reads the annotations and writes `apiTypes.ts` and `addon-api.d.ts`. */
export function addon(read: AddonGroup | AddonGroup[], write?: AddonGroup | AddonGroup[]) {
  return function (target: object, member?: string | symbol, descriptor?: PropertyDescriptor): void {
  };
}

/** Lets addons run hooks before and after this async method.
 * `args` gives the hook arguments as members of `this`, e.g. `(actions: ComposeActions) => ({ email: actions.email })`.
 * Without it, they are the method parameters by name.
 * No-op at runtime: `HookPoint` replaces the method only while an addon hooks it. */
export function addonHook<T>(point: string, group: AddonGroup, args?: (self: T) => object) {
  return function (target: T, method: string, descriptor: PropertyDescriptor): void {
  };
}

export type APIConstructor = abstract new (...args: any[]) => any;

/** One alternative of a union. A class stands for a handle of it.
 * "HTML" is a string that the bridge sanitizes when it comes from an addon. */
export type APIType =
  "string" | "HTML" | "number" | "boolean" | "Date" | "Uint8Array" | "null" | "undefined" | "void" |
  APIConstructor |
  { enum: string } |
  { collection: APIType[] };

export type APIMember =
  { name: string, kind: "field" | "getter", read: AddonGroup[], write?: AddonGroup[], type: APIType[] } |
  { name: string, kind: "method", read: AddonGroup[], params: APIParam[], returns: APIType[] };

export interface APIParam {
  name: string;
  type: APIType[];
  optional?: boolean;
}

export interface APIClass {
  name: string;
  class: APIConstructor;
  /** Objects cross to addons only as a class with groups. A class without groups only gives its members to subclasses. */
  groups?: AddonGroup[];
  extends?: string;
  members: APIMember[];
}

export interface APIEnum {
  name: string;
  groups: AddonGroup[];
  values: (string | number)[];
}

export interface APIHook {
  point: string;
  class: APIConstructor;
  method: string;
  group: AddonGroup;
  args: APIHookArg[];
  result: APIType[];
}

export interface APIHookArg extends APIParam {
  /** The argument is this member of the object whose method runs. Without it, the method parameter at this position. */
  member?: string;
}
