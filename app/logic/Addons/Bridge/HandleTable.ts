import type { APIClass, APIType } from "../API/addon";
import type { AddonBudget } from "./AddonBudget";
import type { Grant } from "./Grant";

export class TooManyHandlesError extends Error {
}

/** An app object or collection that the addon got. The addon sees only the number `h`. */
export class HandleEntry {
  readonly h: number;
  readonly object: any;
  readonly grant: Grant;
  /** The class as which the object crosses. null for collections. */
  readonly apiClass: APIClass | null;
  /** For collections: which items the addon may get */
  readonly itemTypes: APIType[] | null;
  /** How often it was sent to the addon. The addon releases it with this count. */
  sent = 0;
  /** Field name -> the value that the addon has */
  readonly fields = new Map<string, any>();
  unobserve: (() => void) | null = null;
  /** Collections: The items that the addon gets next, in this order. null, when the addon has all items. */
  unsentItems: Set<any> | null = null;
  /** Collections: Changes for the addon */
  addedItems: any[] | null = null;
  removedItems: any[] | null = null;

  constructor(h: number, object: any, grant: Grant, apiClass: APIClass | null, itemTypes: APIType[] | null) {
    this.h = h;
    this.object = object;
    this.grant = grant;
    this.apiClass = apiClass;
    this.itemTypes = itemTypes;
  }
}

/** The app objects that the code in one sandboxed frame or worker holds */
export class HandleTable {
  readonly budget: AddonBudget;
  protected entries = new Map<number, HandleEntry>();
  protected nextHandle = 1;

  constructor(budget: AddonBudget) {
    this.budget = budget;
  }

  get size(): number {
    return this.entries.size;
  }

  add(object: object, grant: Grant, apiClass: APIClass | null, itemTypes: APIType[] | null = null): HandleEntry {
    if (grant.isRevoked) {
      throw new Error("The addon may no longer use these app objects");
    }
    if (this.budget.handles >= this.budget.maxHandles) {
      throw new TooManyHandlesError(`The addon holds more than ${this.budget.maxHandles} app objects. Release some.`);
    }
    let entry = new HandleEntry(this.nextHandle++, object, grant, apiClass, itemTypes);
    this.entries.set(entry.h, entry);
    grant.handles.set(object, entry);
    this.budget.handles++;
    return entry;
  }

  /** @param h from the addon
   * @throws if the handle is unknown, released or revoked */
  get(h: unknown): HandleEntry {
    let entry = typeof h == "number" ? this.entries.get(h) : undefined;
    if (!entry) {
      throw new Error("This app object is not available to the addon");
    }
    return entry;
  }

  has(entry: HandleEntry): boolean {
    return this.entries.get(entry.h) === entry;
  }

  /** The addon no longer needs it.
   * @param count How often the addon got it. If the app sent it more often since, the entry stays. */
  release(h: number, count: number): void {
    let entry = this.entries.get(h);
    if (!entry) {
      return;
    }
    entry.sent -= count;
    if (entry.sent <= 0) {
      this.drop(entry);
    }
  }

  dropGrant(grant: Grant): void {
    for (let entry of [...grant.handles.values()]) {
      this.drop(entry);
    }
  }

  clear(): void {
    for (let entry of [...this.entries.values()]) {
      this.drop(entry);
    }
  }

  protected drop(entry: HandleEntry): void {
    if (!this.has(entry)) {
      return;
    }
    this.entries.delete(entry.h);
    entry.grant.handles.delete(entry.object);
    this.budget.handles--;
    entry.unsentItems = null;
    try {
      entry.unobserve?.();
    } finally {
      entry.unobserve = null;
    }
  }
}
