import type { AddonGroup, APIClass, APIMember, APIType } from "../API/addon";
import type { AddonAPI } from "./AddonAPI";
import { Grant } from "./Grant";
import { HandleTable, TooManyHandlesError, type HandleEntry } from "./HandleTable";
import type { AddonBudget } from "./AddonBudget";
import { Observable } from "../../util/Observable";
import { minorError } from "../../util/error";
import { removeControlCharacters } from "../../util/util";
import { sanitizeHTMLWithoutLoading } from "../../util/convertHTML";
import { ArrayColl, Collection, SetColl } from "svelte-collections";

type FieldMember = Extract<APIMember, { kind: "field" | "getter" }>;

/** A part of the `mustang` API that is not an app object, e.g. `mustang.storage` */
export interface AddonService {
  /**
   * @param args Unchecked data from the addon
   * @returns Plain data for the addon: JSON types, Date, Uint8Array
   */
  call(bridge: AddonBridge, method: string, args: unknown[]): unknown;
}

/** Connects the app with the code of one addon in one sandboxed frame or worker, via a `MessagePort`.
 *
 * The addon gets app objects only as handles (numbers) and snapshots of the fields that it may read.
 * Every message from the addon is untrusted: it is checked against the `@addon` allowlist (`AddonAPI`)
 * and the grant under which the addon got the object.
 *
 * Both directions send arrays of operations. Everything of one microtask goes in one message. */
export class AddonBridge {
  readonly port: MessagePort;
  readonly api: AddonAPI;
  /** The `@addon` groups that the user granted to the addon */
  readonly groups: SetColl<AddonGroup>;
  readonly handles: HandleTable;
  /** Shared by all frames of the addon */
  readonly budget: AddonBudget;
  protected services = new Map<string, AddonService>();
  protected fieldLists = new WeakMap<Grant, Map<APIClass, FieldMember[]>>();
  protected roots = new Map<string, { collection: Collection<any>, grant: Grant }>();
  protected outbox: any[] = [];
  /** Handles whose fields are already in the outbox */
  protected inOutbox = new Set<number>();
  protected isFlushScheduled = false;
  /** Handle entry -> its changed fields. null = all fields. */
  protected changedObjects = new Map<HandleEntry, Set<string> | null>();
  protected changedCollections = new Set<HandleEntry>();
  /** Collections whose items go to the addon in chunks */
  protected loadingCollections = new Set<HandleEntry>();
  /** Collections that the addon wants, or that changed too much. With the field that the addon read. */
  protected pendingLoads = new Map<HandleEntry, { of?: number, m?: string }>();
  protected isLoadingScheduled = false;
  /** Operations from the addon that wait for their turn */
  protected backlog: unknown[] = [];
  protected backlogIndex = 0;
  protected isBacklogScheduled = false;
  protected requests = new Map<number, { resolve: (data: unknown) => void, reject: (ex: Error) => void }>();
  protected nextRequestID = 1;
  isClosed = false;
  /** Resolves when the addon code runs. Rejects when it failed to start. */
  readonly ready: Promise<void>;
  protected readyCallbacks: { resolve: () => void, reject: (ex: Error) => void } | null;

  constructor(port: MessagePort, api: AddonAPI, groups: Iterable<AddonGroup>, budget: AddonBudget) {
    this.port = port;
    this.api = api;
    this.groups = new SetColl([...groups]);
    this.budget = budget;
    this.handles = new HandleTable(budget);
    this.ready = new Promise((resolve, reject) => {
      this.readyCallbacks = { resolve, reject };
    });
    this.ready.catch(() => {});
  }

  registerService(name: string, service: AddonService): void {
    this.services.set(name, service);
  }

  /** Makes `collection` available as `mustang.<name>.accounts`, if `grant` has `group`.
   * Call before `start()`. */
  setRoot(name: string, group: AddonGroup, collection: Collection<any>, grant: Grant): void {
    if (!grant.groups.contains(group)) {
      return;
    }
    this.roots.set(name, { collection, grant });
  }

  /** @param groups The groups that this situation allows. The grant gets only those that the addon has, too. */
  newGrant(groups: Iterable<AddonGroup>): Grant {
    return new Grant(this.handles, new ArrayColl([...groups].filter(group => this.groups.contains(group))));
  }

  start(addon: { name: string, version: string }): void {
    let roots = {};
    for (let [name, root] of this.roots) {
      roots[name] = this.toAddon(root.collection, null, root.grant, 0);
    }
    this.queue({ op: "init", addon, classes: this.api.describe(), roots });
    this.port.onmessage = event => this.receive(event.data);
  }

  /** Stops the connection. The addon can no longer use any app object. */
  close(): void {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    this.port.onmessage = null;
    this.port.close();
    this.changedObjects.clear();
    this.changedCollections.clear();
    this.loadingCollections.clear();
    this.pendingLoads.clear();
    this.budget.backlog -= this.backlog.length - this.backlogIndex;
    this.backlog = [];
    this.outbox = [];
    this.handles.clear();
    for (let request of this.requests.values()) {
      request.reject(new Error("The addon stopped"));
    }
    this.requests.clear();
    this.readyCallbacks?.reject(new Error("The addon stopped"));
    this.readyCallbacks = null;
  }

  /**
   * Calls a function that the addon registered, e.g. a hook.
   * @param args Each value may be an app object or an array of app objects. They go to the addon under `grant`.
   * @param data Plain data
   * @returns The plain data that the addon returned. Untrusted.
   */
  async request(service: string, method: string, args: Record<string, unknown>, grant: Grant | null, data?: unknown): Promise<unknown> {
    const kMaxRequests = 1000;
    if (this.isClosed) {
      throw new Error("The addon stopped");
    }
    if (this.requests.size >= kMaxRequests) {
      throw new Error("The addon has too many unanswered requests");
    }
    let id = this.nextRequestID++;
    let a = this.argsToAddon(args, grant);
    return await new Promise((resolve, reject) => {
      this.requests.set(id, { resolve, reject });
      this.queue({ op: "request", id, s: service, m: method, a, d: data });
    });
  }

  /** Like `request()`, but without answer */
  notify(service: string, method: string, args: Record<string, unknown>, grant: Grant | null, data?: unknown): void {
    if (this.isClosed) {
      return;
    }
    this.queue({ op: "request", s: service, m: method, a: this.argsToAddon(args, grant), d: data });
  }

  protected argsToAddon(args: Record<string, unknown>, grant: Grant | null): Record<string, unknown> {
    let a = {};
    try {
      for (let [name, value] of Object.entries(args)) {
        a[name] = Array.isArray(value)
          ? value.map(item => this.toAddon(item, null, grant, 1))
          : this.toAddon(value, null, grant, 0);
      }
    } catch (ex) {
      // Fields of some objects might be marked as sent, but these args won't go out
      this.inOutbox.clear();
      throw ex;
    }
    return a;
  }

  // Messages from the addon

  protected receive(ops: unknown): void {
    const kMaxOpsPerMessage = 10000;
    const kMaxBacklog = 100000;
    if (!Array.isArray(ops) || this.isClosed || this.budget.backlog > kMaxBacklog) {
      return;
    }
    let count = Math.min(ops.length, kMaxOpsPerMessage);
    for (let i = 0; i < count; i++) {
      this.backlog.push(ops[i]);
    }
    this.budget.backlog += count;
    this.workOnBacklog();
  }

  /** Works on the operations of the addon for at most a few ms per task, so that the app stays responsive */
  protected workOnBacklog(): void {
    const kTimeSliceMS = 20;
    let end = performance.now() + kTimeSliceMS;
    while (this.backlogIndex < this.backlog.length && !this.isClosed && performance.now() < end) {
      this.budget.backlog--;
      this.receiveOp(this.backlog[this.backlogIndex++]);
    }
    if (this.backlogIndex >= this.backlog.length || this.isClosed) {
      this.backlog = [];
      this.backlogIndex = 0;
      return;
    }
    if (!this.isBacklogScheduled) {
      this.isBacklogScheduled = true;
      setTimeout(() => {
        this.isBacklogScheduled = false;
        this.workOnBacklog();
      }, 0);
    }
  }

  protected receiveOp(op: unknown): void {
    if (!this.isPlainObject(op)) {
      return;
    }
    let id = op.id;
    if (id !== undefined && !(Number.isSafeInteger(id) && (id as number) > 0)) {
      return;
    }
    try {
      switch (op.op) {
      case "call":
      case "get":
      case "set":
      case "service":
        if (id === undefined && op.op != "service") {
          return;
        }
        this.runRequest(id as number | undefined, op)
          .catch(minorError);
        return;
      case "load":
        this.loadField(this.handles.get(op.h), op.m);
        return;
      case "release":
        if (typeof op.h == "number" && Number.isSafeInteger(op.n) && (op.n as number) > 0) {
          this.handles.release(op.h, op.n as number);
        }
        return;
      case "reply":
        this.receiveReply(id as number, op);
        return;
      case "ready":
        this.readyCallbacks?.resolve();
        this.readyCallbacks = null;
        return;
      case "failed":
        this.readyCallbacks?.reject(this.errorFromAddon(op.e));
        this.readyCallbacks = null;
        return;
      default:
        throw new Error("Unknown operation");
      }
    } catch (ex) {
      if (id !== undefined) {
        this.queueError(id as number, ex);
      }
    }
  }

  /** @param id undefined = the addon wants no answer */
  protected async runRequest(id: number | undefined, op: Record<string, unknown>): Promise<void> {
    const kMaxInFlight = 1000;
    if (this.budget.inFlight >= kMaxInFlight) {
      this.queueError(id, new Error(`The addon has more than ${kMaxInFlight} calls running`));
      return;
    }
    this.budget.inFlight++;
    try {
      let reply = await this.run(op);
      if (id !== undefined) {
        this.queue({ op: "reply", id, ...reply });
      }
    } catch (ex) {
      this.queueError(id, ex);
    } finally {
      this.budget.inFlight--;
    }
  }

  protected async run(op: Record<string, unknown>): Promise<{ v?: unknown, d?: unknown }> {
    if (op.op == "service") {
      return { d: await this.callService(op.s, op.m, op.a) };
    }
    let entry = this.handles.get(op.h);
    if (!entry.apiClass) {
      throw new Error("A collection has no members");
    }
    let member = typeof op.m == "string" ? this.api.member(entry.apiClass, op.m) : undefined;
    if (!member) {
      throw new Error(`${entry.apiClass.name} has no member ${this.shortString(op.m)} for addons`);
    }
    let what = `${entry.apiClass.name}.${member.name}`;
    let grant = entry.grant;
    if (op.op == "set") {
      if (member.kind == "method" || !grant.allows(member.write)) {
        throw new Error(`The addon may not change ${what}`);
      }
      let value = this.fromAddon(op.v, member.type, grant, what);
      entry.object[member.name] = value;
      return {};
    }
    if (!grant.allows(member.read)) {
      throw new Error(`The addon may not use ${what}`);
    }
    if (op.op == "get") {
      if (member.kind == "method") {
        throw new Error(`${what} is a function`);
      }
      return { v: this.toAddon(entry.object[member.name], member.type, grant, 0) };
    }
    if (member.kind != "method") {
      throw new Error(`${what} is not a function`);
    }
    let args = this.argsFromAddon(op.a, member, grant, what);
    let result = await entry.object[member.name](...args);
    return { v: this.toAddon(result, member.returns, grant, 0) };
  }

  protected async callService(name: unknown, method: unknown, args: unknown): Promise<unknown> {
    const kMaxNameLength = 100;
    const kMaxArgs = 100;
    let service = typeof name == "string" ? this.services.get(name) : undefined;
    if (!service) {
      throw new Error(`Unknown service ${this.shortString(name)}`);
    }
    if (typeof method != "string" || method.length > kMaxNameLength) {
      throw new Error("Invalid method name");
    }
    if (!Array.isArray(args) || args.length > kMaxArgs) {
      throw new Error("Invalid arguments");
    }
    let result = await service.call(this, method, args);
    this.checkPlainData(result, 0);
    return result;
  }

  protected receiveReply(id: number, op: Record<string, unknown>): void {
    let request = this.requests.get(id);
    if (!request) {
      return;
    }
    this.requests.delete(id);
    if (op.e !== undefined) {
      request.reject(this.errorFromAddon(op.e));
    } else {
      request.resolve(op.d);
    }
  }

  protected argsFromAddon(args: unknown, member: APIMember & { kind: "method" }, grant: Grant, what: string): unknown[] {
    if (args === undefined) {
      args = [];
    }
    if (!Array.isArray(args) || args.length > member.params.length) {
      throw new TypeError(`${what} takes at most ${member.params.length} arguments`);
    }
    return member.params.map((param, i) =>
      this.fromAddon(args[i], param.optional ? [...param.type, "undefined"] : param.type, grant, `Argument ${param.name} of ${what}`));
  }

  /** Checks a value from the addon against the declared types, and turns handles into app objects
   * @param grant of the object whose member the addon uses. Handles must be from it. */
  protected fromAddon(value: unknown, types: APIType[], grant: Grant, what: string): unknown {
    const kMaxStringLength = 1024 * 1024;
    const kMaxBytes = 50 * 1024 * 1024;
    for (let type of types) {
      switch (type) {
      case "string":
        if (typeof value == "string" && value.length <= kMaxStringLength) {
          return value;
        }
        break;
      case "HTML":
        if (typeof value == "string" && value.length <= kMaxStringLength) {
          return sanitizeHTMLWithoutLoading(value);
        }
        break;
      case "number":
        if (typeof value == "number" && Number.isFinite(value)) {
          return value;
        }
        break;
      case "boolean":
        if (typeof value == "boolean") {
          return value;
        }
        break;
      case "Date":
        if (value instanceof Date && Number.isFinite(value.getTime())) {
          return value;
        }
        break;
      case "Uint8Array":
        if (value instanceof Uint8Array && value.buffer instanceof ArrayBuffer && value.buffer.byteLength <= kMaxBytes) {
          return value;
        }
        break;
      case "null":
        if (value === null) {
          return value;
        }
        break;
      case "undefined":
      case "void":
        if (value === undefined) {
          return value;
        }
        break;
      default:
        if (typeof type == "function") {
          if (this.isPlainObject(value) && typeof value.h == "number") {
            let entry = this.handles.get(value.h);
            if (entry.grant == grant && !grant.isRevoked && entry.object instanceof type) {
              return entry.object;
            }
          }
        } else if ("enum" in type) {
          if (this.api.isEnumValue(type.enum, value)) {
            return value;
          }
        }
      }
    }
    throw new TypeError(`${what} has the wrong type`);
  }

  // App values to the addon

  /** Converts an app value for the addon. App objects become handles under `grant`.
   * @param types The declared types. null = any app object that the grant allows.
   * @param depth Collections at depth 0 and 1 come with their items. Deeper ones come without handle, and load when the addon reads them. */
  protected toAddon(value: unknown, types: APIType[] | null, grant: Grant | null, depth: number): unknown {
    if (value === null || value === undefined ||
        typeof value == "string" || typeof value == "number" || typeof value == "boolean" ||
        value instanceof Date || value instanceof Uint8Array) {
      return value;
    }
    if (typeof value != "object") {
      throw new TypeError("This value cannot go to addons");
    }
    if (!grant || grant.isRevoked || this.isClosed) {
      throw new Error("The addon may no longer use these app objects");
    }
    if (value instanceof Collection) {
      return this.collectionToAddon(value, types, grant, depth);
    }
    return this.objectToAddon(value, types, grant, depth);
  }

  protected objectToAddon(object: object, types: APIType[] | null, grant: Grant, depth: number): unknown {
    const kMaxDepth = 10;
    let apiClass = this.api.classOf(object);
    if (!apiClass || !grant.allows(apiClass.groups)) {
      throw new TypeError("The addon may not get this object");
    }
    if (types && !types.some(type => typeof type == "function" && object instanceof type)) {
      throw new TypeError(`${apiClass.name} is not the declared type`);
    }
    if (depth > kMaxDepth) {
      throw new Error("Too deeply nested");
    }
    let entry = grant.handles.get(object);
    if (!entry) {
      entry = this.handles.add(object, grant, apiClass);
      this.observeObject(entry);
    }
    entry.sent++;
    let c = this.api.numberOf(apiClass);
    if (this.inOutbox.has(entry.h)) {
      return { h: entry.h, c };
    }
    this.inOutbox.add(entry.h);
    let p = {};
    for (let member of this.fieldsOf(entry)) {
      let fieldValue = entry.object[member.name];
      try {
        p[member.name] = this.toAddon(fieldValue, member.type, grant, depth + 1);
        entry.fields.set(member.name, fieldValue);
      } catch (ex) {
        if (ex instanceof TooManyHandlesError) {
          throw ex;
        }
        // The addon doesn't get this field
      }
    }
    return { h: entry.h, c, p };
  }

  /** The fields that the grant allows to read */
  protected fieldsOf(entry: HandleEntry): FieldMember[] {
    let cache = this.fieldLists.get(entry.grant);
    if (!cache) {
      cache = new Map();
      this.fieldLists.set(entry.grant, cache);
    }
    let fields = cache.get(entry.apiClass);
    if (!fields) {
      fields = [...this.api.membersOf(entry.apiClass)].filter(member =>
        member.kind == "field" && entry.grant.allows(member.read)) as FieldMember[];
      cache.set(entry.apiClass, fields);
    }
    return fields;
  }

  protected collectionToAddon(collection: Collection<any>, types: APIType[] | null, grant: Grant, depth: number): unknown {
    let itemTypes = this.itemTypesOf(types);
    if (depth > 1) {
      return { coll: 1 };
    }
    let entry = grant.handles.get(collection) ?? this.handles.add(collection, grant, null, itemTypes);
    entry.sent++;
    let reference: any = { h: entry.h, coll: 1 };
    if (depth <= 1 && !this.inOutbox.has(entry.h)) {
      const kMaxInlineItems = 100;
      this.inOutbox.add(entry.h);
      if (collection.length > kMaxInlineItems) {
        reference.items = [];
        reference.done = false;
        this.reload(entry);
        return reference;
      }
      this.startLoading(entry);
      reference.items = this.nextItems(entry, kMaxInlineItems);
      reference.done = !entry.unsentItems;
    }
    return reference;
  }

  // Collections

  /** @returns The allowed types of the items, or null, if `types` is null
   * @throws if `types` has no collection */
  protected itemTypesOf(types: APIType[] | null): APIType[] | null {
    if (!types) {
      return null;
    }
    let collectionType = types.find(type => typeof type == "object" && "collection" in type) as { collection: APIType[] };
    if (!collectionType) {
      throw new TypeError("A collection is not the declared type");
    }
    return collectionType.collection;
  }

  /** The addon reads a collection field that came without its items */
  protected loadField(parent: HandleEntry, name: unknown): void {
    let member = parent.apiClass && typeof name == "string" ? this.api.member(parent.apiClass, name) : undefined;
    if (member?.kind != "field" || !parent.grant.allows(member.read) || parent.grant.isRevoked) {
      throw new Error("The addon may not read this collection");
    }
    let collection = parent.object[member.name];
    if (!(collection instanceof Collection)) {
      throw new TypeError("Not a collection");
    }
    let entry = parent.grant.handles.get(collection) ?? this.handles.add(collection, parent.grant, null, this.itemTypesOf(member.type));
    if (this.pendingLoads.has(entry) || entry.unsentItems) {
      return;
    }
    this.pendingLoads.set(entry, { of: parent.h, m: member.name });
    this.scheduleLoading();
  }

  /** Sends all items again */
  protected reload(entry: HandleEntry): void {
    entry.addedItems = [];
    entry.removedItems = [];
    this.changedCollections.delete(entry);
    this.pendingLoads.set(entry, this.pendingLoads.get(entry) ?? {});
    this.scheduleLoading();
  }

  protected startLoading(entry: HandleEntry): void {
    let collection = entry.object as Collection<any>;
    entry.unsentItems = new Set(collection.contents);
    entry.addedItems = [];
    entry.removedItems = [];
    this.changedCollections.delete(entry);
    if (!entry.unobserve) {
      let observer = {
        added: (items: any[]) => this.itemsAdded(entry, items),
        removed: (items: any[]) => this.itemsRemoved(entry, items),
      };
      collection.registerObserver(observer);
      entry.unobserve = () => collection.unregisterObserver(observer);
    }
  }

  /** @returns the next chunk of items for the addon. Schedules the rest. */
  protected nextItems(entry: HandleEntry, max = 1000): unknown[] {
    let chunk = [];
    let taken = 0;
    for (let item of entry.unsentItems ?? []) {
      if (taken++ >= max) {
        break;
      }
      entry.unsentItems.delete(item);
      try {
        chunk.push(this.itemToAddon(item, entry));
      } catch (ex) {
        // The addon doesn't get this item
      }
    }
    if (entry.unsentItems?.size) {
      this.loadingCollections.add(entry);
      this.scheduleLoading();
    } else {
      entry.unsentItems = null;
      this.loadingCollections.delete(entry);
    }
    return chunk;
  }

  /** Items come without the items of their own collections */
  protected itemToAddon(item: unknown, entry: HandleEntry): unknown {
    const kItemDepth = 2;
    if (entry.itemTypes && typeof item == "object" && item !== null) {
      if (!entry.itemTypes.some(type => typeof type == "function" && item instanceof type)) {
        throw new TypeError("Not an allowed item");
      }
    }
    return this.toAddon(item, null, entry.grant, kItemDepth);
  }

  protected scheduleLoading(): void {
    if (this.isLoadingScheduled) {
      return;
    }
    this.isLoadingScheduled = true;
    setTimeout(() => this.sendLoadingChunks(), 0);
  }

  /** A limited number of items per task, so that the app stays responsive */
  protected sendLoadingChunks(): void {
    const kItemsPerTask = 2000;
    const kChunkSize = 1000;
    this.isLoadingScheduled = false;
    if (this.isClosed) {
      return;
    }
    let budget = kItemsPerTask;
    for (let [entry, field] of [...this.pendingLoads]) {
      if (budget <= 0) {
        break;
      }
      this.pendingLoads.delete(entry);
      if (!this.handles.has(entry)) {
        continue;
      }
      // Copying the list of items costs, too
      budget -= Math.ceil((entry.object as Collection<any>).length / 100);
      this.startLoading(entry);
      let add = this.nextItems(entry, Math.max(1, Math.min(kChunkSize, budget)));
      budget -= add.length;
      if (field.of !== undefined) {
        entry.sent++;
      }
      this.queue({ op: "coll", h: entry.h, ...field, reset: true, add, done: !entry.unsentItems });
    }
    for (let entry of [...this.loadingCollections]) {
      if (budget <= 0) {
        break;
      }
      if (!this.handles.has(entry) || !entry.unsentItems || this.pendingLoads.has(entry)) {
        this.loadingCollections.delete(entry);
        continue;
      }
      let add = this.nextItems(entry, Math.min(kChunkSize, budget));
      budget -= add.length;
      this.queue({ op: "coll", h: entry.h, add, done: !entry.unsentItems });
    }
    if (this.pendingLoads.size || this.loadingCollections.size) {
      this.scheduleLoading();
    }
  }

  protected itemsAdded(entry: HandleEntry, items: any[]): void {
    if (this.pendingLoads.has(entry)) {
      return;
    }
    if (entry.unsentItems) {
      for (let item of items) {
        entry.unsentItems.add(item);
      }
      return;
    }
    entry.addedItems.push(...items);
    this.collectionChanged(entry);
  }

  protected itemsRemoved(entry: HandleEntry, items: any[]): void {
    if (this.pendingLoads.has(entry)) {
      return;
    }
    for (let item of items) {
      if (entry.unsentItems?.has(item)) {
        entry.unsentItems.delete(item);
      } else {
        entry.removedItems.push(item);
      }
    }
    this.collectionChanged(entry);
  }

  protected collectionChanged(entry: HandleEntry): void {
    const kMaxQueuedChanges = 10000;
    if (entry.addedItems.length + entry.removedItems.length > kMaxQueuedChanges) {
      this.reload(entry);
      return;
    }
    this.changedCollections.add(entry);
    this.scheduleFlush();
  }

  protected collectionChangesToAddon(entry: HandleEntry): void {
    let add = [];
    for (let item of entry.addedItems) {
      try {
        add.push(this.itemToAddon(item, entry));
      } catch (ex) {
        // The addon doesn't get this item
      }
    }
    let remove = [];
    for (let item of entry.removedItems) {
      if (typeof item == "object" && item !== null) {
        let itemEntry = entry.grant.handles.get(item);
        if (itemEntry) {
          remove.push({ h: itemEntry.h });
        }
      } else {
        remove.push(item);
      }
    }
    entry.addedItems = [];
    entry.removedItems = [];
    if (add.length || remove.length) {
      this.outbox.push({ op: "coll", h: entry.h, add, remove });
    }
  }

  // Changes of app objects

  protected observeObject(entry: HandleEntry): void {
    if (!(entry.object instanceof Observable)) {
      return;
    }
    let isSubscribing = true;
    entry.unobserve = entry.object.subscribe((_object, property) => {
      if (!isSubscribing) {
        this.objectChanged(entry, property);
      }
    });
    isSubscribing = false;
  }

  protected objectChanged(entry: HandleEntry, property: string | null): void {
    let fields = this.changedObjects.get(entry);
    if (fields === null) {
      return;
    }
    if (property == null) {
      this.changedObjects.set(entry, null);
    } else {
      let member = this.api.member(entry.apiClass, property);
      if (member?.kind != "field" || !entry.grant.allows(member.read)) {
        return;
      }
      if (!fields) {
        fields = new Set();
        this.changedObjects.set(entry, fields);
      }
      fields.add(property);
    }
    this.scheduleFlush();
  }

  protected changesToAddon(entry: HandleEntry, changedFields: Set<string> | null): void {
    for (let member of this.fieldsOf(entry)) {
      if (changedFields && !changedFields.has(member.name)) {
        continue;
      }
      let value = entry.object[member.name];
      if (entry.fields.has(member.name) && this.isSame(value, entry.fields.get(member.name))) {
        continue;
      }
      try {
        this.outbox.push({ op: "change", h: entry.h, m: member.name, v: this.toAddon(value, member.type, entry.grant, 2) });
        entry.fields.set(member.name, value);
      } catch (ex) {
        // The addon doesn't get this field
      }
    }
  }

  protected isSame(a: unknown, b: unknown): boolean {
    return a === b || (a instanceof Date && b instanceof Date && a.getTime() == b.getTime());
  }

  // Sending

  protected queue(op: object): void {
    this.outbox.push(op);
    this.scheduleFlush();
  }

  protected queueError(id: number | undefined, ex: any): void {
    const kMaxLength = 1000;
    if (id === undefined) {
      return;
    }
    let e = {
      name: this.shortString(ex?.name ?? "Error", kMaxLength),
      message: this.shortString(ex?.message ?? ex, kMaxLength),
    };
    this.queue({ op: "reply", id, e });
  }

  protected scheduleFlush(): void {
    if (this.isFlushScheduled || this.isClosed) {
      return;
    }
    this.isFlushScheduled = true;
    queueMicrotask(() => this.flush());
  }

  protected flush(): void {
    this.isFlushScheduled = false;
    if (this.isClosed) {
      return;
    }
    let changedObjects = [...this.changedObjects];
    this.changedObjects.clear();
    for (let [entry, fields] of changedObjects) {
      if (this.handles.has(entry)) {
        this.changesToAddon(entry, fields);
      }
    }
    let changedCollections = [...this.changedCollections];
    this.changedCollections.clear();
    for (let entry of changedCollections) {
      if (this.handles.has(entry)) {
        this.collectionChangesToAddon(entry);
      }
    }
    if (!this.outbox.length) {
      return;
    }
    let ops = this.outbox;
    this.outbox = [];
    this.inOutbox.clear();
    try {
      this.port.postMessage(ops);
    } catch (ex) {
      minorError(ex);
    }
  }

  // Validation

  protected isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value == "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
  }

  /** @throws if `value` contains anything but JSON types, Date and Uint8Array, e.g. an app object */
  protected checkPlainData(value: unknown, depth: number): void {
    const kMaxDepth = 100;
    if (value === null || value === undefined || typeof value == "string" || typeof value == "boolean" ||
        typeof value == "number" || value instanceof Date || value instanceof Uint8Array) {
      return;
    }
    if (depth > kMaxDepth || !(Array.isArray(value) || this.isPlainObject(value))) {
      throw new TypeError("Only plain data can go to addons");
    }
    for (let item of Object.values(value)) {
      this.checkPlainData(item, depth + 1);
    }
  }

  protected errorFromAddon(e: unknown): Error {
    const kMaxLength = 1000;
    let message = this.isPlainObject(e) ? e.message : e;
    return new Error(removeControlCharacters(this.shortString(message, kMaxLength)));
  }

  protected shortString(value: unknown, maxLength = 100): string {
    return String(typeof value == "string" || typeof value == "number" ? value : typeof value).substring(0, maxLength);
  }
}
