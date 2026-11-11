/* The runtime of the addon in its sandbox: the `mustang` global, app objects as proxies, and the messages to the app.
 * Runs in the addon's worker and in its UI frames, in the same realm as the addon code. Not a security boundary:
 * the app checks everything in `AddonBridge`. */
import type { MustangAPI, UIContext, CommandEvent, HookCancel, Protocol, AccountSetup, JSONValue, Subscribable } from "./MustangAPI";
import type { AppFonts } from "./SandboxFrame";
import { ArrayColl } from "svelte-collections";

type MemberKind = "field" | "getter" | "method";
type ClassInfo = { name: string, members: [string, MemberKind, boolean][] };

const kState = Symbol("state");

/** An app object, as the addon sees it. Behaves like a Svelte store. */
class AppObject {
  [kState]: ObjectState;

  subscribe(run: (value: this) => void): () => void {
    let state = this[kState];
    state.subscribers ??= new Set();
    let subscribers = state.subscribers;
    subscribers.add(run);
    run(this);
    return () => subscribers.delete(run);
  }

  /** Lets the app forget this object. Reading it afterwards fails. */
  release(): void {
    this[kState].client.release(this);
  }
}

class ObjectState {
  readonly client: SandboxClient;
  readonly h: number;
  readonly cls: ClassInfo;
  readonly fields = new Map<string, unknown>();
  subscribers: Set<(value: any) => void> | null = null;
  isReleased = false;

  constructor(client: SandboxClient, h: number, cls: ClassInfo) {
    this.client = client;
    this.h = h;
    this.cls = cls;
  }

  notify(object: AppObject): void {
    for (let run of this.subscribers ?? []) {
      try {
        run(object);
      } catch (ex) {
        reportError(ex);
      }
    }
  }
}

/** A collection of app objects, as the addon sees it. Fills in the background. */
class CollectionMirror<T> extends ArrayColl<T> {
  [kState]: CollectionState;
}

class CollectionState {
  /** undefined, until the items load */
  h: number | undefined;
  /** The app object and field that it belongs to, for loading */
  readonly owner: { h: number, m: string } | null;
  isLoading = false;
  readonly loaded: Promise<void>;
  resolveLoaded: () => void;

  constructor(h: number | undefined, owner: { h: number, m: string } | null) {
    this.h = h;
    this.owner = owner;
    this.loaded = new Promise(resolve => {
      this.resolveLoaded = resolve;
    });
  }
}

/** A collection field that the app sent without items. Becomes a `CollectionMirror` when the addon reads it. */
class LazyCollection {
  readonly ownerH: number;
  readonly name: string;

  constructor(ownerH: number, name: string) {
    this.ownerH = ownerH;
    this.name = name;
  }
}

/** What the addon got from the app, by handle */
class Remote {
  /** How often the app sent it. The app forgets it when the addon releases it with this count. */
  count = 0;
  ref: WeakRef<AppObject | CollectionMirror<any>> | null = null;
}

class Store<T> implements Subscribable<T> {
  value: T;
  protected subscribers = new Set<(value: T) => void>();

  constructor(value: T) {
    this.value = value;
  }

  subscribe(run: (value: T) => void): () => void {
    this.subscribers.add(run);
    run(this.value);
    return () => this.subscribers.delete(run);
  }

  set(value: T): void {
    this.value = value;
    for (let run of this.subscribers) {
      try {
        run(value);
      } catch (ex) {
        reportError(ex);
      }
    }
  }
}

export class SandboxClient {
  protected port: MessagePort | null = null;
  protected outbox: any[] = [];
  protected isFlushScheduled = false;
  protected nextID = 1;
  protected pending = new Map<number, { resolve: (value: any) => void, reject: (ex: Error) => void }>();
  protected inFlight = 0;
  protected waiting: any[] = [];
  protected waitingIndex = 0;
  protected remotes = new Map<number, Remote>();
  protected classes: ClassInfo[] = [];
  protected prototypes = new Map<number, object>();
  protected roots = new Map<string, CollectionMirror<any>>();
  protected handlers = new Map<string, (args: any, data: any) => unknown>();
  protected commands = new Map<string, (event: CommandEvent) => void | Promise<void>>();
  protected hooks = new Map<string, ((...args: any[]) => any)[]>();
  protected protocols = new Map<string, Protocol>();
  protected context = new Store<UIContext>({ theme: { dark: false } });
  protected collected = new FinalizationRegistry<number>(h => this.forget(h));
  protected initialized: Promise<void>;
  protected resolveInitialized: () => void;
  readonly mustang: MustangAPI;

  constructor() {
    this.initialized = new Promise(resolve => {
      this.resolveInitialized = resolve;
    });
    this.handlers.set("ui.command", (args, data) => this.runCommand(args, data));
    this.handlers.set("ui.context", args => this.context.set({ ...args, theme: this.context.value.theme }));
    this.handlers.set("hooks.run", (args, data) => this.runHooks(args, data));
    this.handlers.set("protocols.call", (_args, data) => this.callProtocol(data));
    this.mustang = this.newMustangAPI();
  }

  protected newMustangAPI(): MustangAPI {
    let client = this;
    return {
      addon: { name: "", version: "" },
      ui: {
        onCommand(command: string, handler: (event: CommandEvent) => void | Promise<void>) {
          client.commands.set(command, handler);
          client.callService("ui", "onCommand", [command])
            .catch(reportError);
        },
        context: this.context,
      },
      mail: {
        get accounts() {
          return client.root("mail", "mail.all");
        },
      },
      chat: {
        get accounts() {
          return client.root("chat", "chat.all");
        },
      },
      hooks: {
        before(point: string, hook: (args: any) => any) {
          client.addHook("before", point, hook);
        },
        after(point: string, hook: (args: any, result: any) => void) {
          client.addHook("after", point, hook);
        },
      },
      protocols: {
        register(id: string, implementation: Protocol) {
          client.protocols.set(id, implementation);
          client.callService("protocols", "register", [id])
            .catch(reportError);
        },
        newMessages(accountID: string, folderID: string) {
          client.callService("protocols", "newMessages", [accountID, folderID])
            .catch(reportError);
        },
        setupAccount(account: AccountSetup) {
          client.callService("protocols", "setupAccount", [account])
            .catch(reportError);
        },
      },
      storage: {
        async get(key: string) {
          return await client.callService("storage", "get", [key]) as JSONValue | undefined;
        },
        async set(key: string, value: JSONValue) {
          await client.callService("storage", "set", [key, value]);
        },
        async remove(key: string) {
          await client.callService("storage", "remove", [key]);
        },
      },
      async loaded(collection) {
        await client.loaded(collection as CollectionMirror<any>);
      },
    };
  }

  // Start

  /** In the addon's worker: Waits for the port and the addon code from the boot script of the frame */
  startWorker(): void {
    self.onmessage = async (event: MessageEvent) => {
      if (this.port || !event.ports[0]) {
        return;
      }
      self.onmessage = null;
      (globalThis as any).mustang = this.mustang;
      this.connect(event.ports[0]);
      await this.initialized;
      try {
        (self as any).importScripts(event.data.scriptURL);
        this.send({ op: "ready" });
      } catch (ex) {
        this.send({ op: "failed", e: this.errorForApp(ex) });
      }
    };
  }

  /** In a UI frame: Loads the addon's UI module and lets it mount itself */
  async startFrame(port: MessagePort, moduleURL: string): Promise<void> {
    (globalThis as any).mustang = this.mustang;
    this.connect(port);
    window.addEventListener("keydown", event => {
      if (event.key == "Escape") {
        this.sendService("frame", "escape", []);
      }
    }, { capture: true });
    // Not the root element: its size is at least the size of the frame, so the frame could not shrink
    new ResizeObserver(() => {
      this.sendService("frame", "size", [document.body.scrollWidth, document.body.scrollHeight]);
    }).observe(document.body);
    this.handlers.set("ui.theme", (_args, data) => this.applyTheme(data));
    await this.initialized;
    try {
      let module = await import(/* @vite-ignore */ moduleURL);
      module.default(document.body, this.context);
      this.send({ op: "ready" });
    } catch (ex) {
      this.send({ op: "failed", e: this.errorForApp(ex) });
    }
  }

  protected connect(port: MessagePort): void {
    this.port = port;
    port.onmessage = event => this.receive(event.data);
    this.flush();
  }

  protected applyTheme(theme: { properties: [string, string][], colorScheme: string, dark: boolean, fonts?: AppFonts }): void {
    let style = document.documentElement.style;
    for (let [name, value] of theme.properties) {
      style.setProperty(name, value);
    }
    style.setProperty("color-scheme", theme.colorScheme);
    if (theme.fonts) {
      this.addFonts(theme.fonts);
    }
    this.context.set({ ...this.context.value, theme: { dark: theme.dark } });
  }

  /** The frame can't load the font files of the app, so they come as data */
  protected addFonts(fonts: AppFonts): void {
    let css = fonts.css;
    for (let [path, dataURL] of Object.entries(fonts.files)) {
      let bytes = Uint8Array.from(atob(dataURL.substring(dataURL.indexOf(",") + 1)), char => char.charCodeAt(0));
      let url = URL.createObjectURL(new Blob([bytes], { type: "font/woff2" }));
      css = css.replaceAll(`url(${path})`, `url(${url})`);
    }
    let element = document.createElement("style");
    element.textContent = css;
    document.head.append(element);
  }

  // Messages from the app

  protected receive(ops: any[]): void {
    for (let op of ops) {
      try {
        this.receiveOp(op);
      } catch (ex) {
        reportError(ex);
      }
    }
  }

  protected receiveOp(op: any): void {
    switch (op.op) {
    case "init":
      this.classes = op.classes;
      Object.assign(this.mustang.addon, op.addon);
      for (let [name, value] of Object.entries(op.roots)) {
        this.roots.set(name, this.decode(value));
      }
      this.resolveInitialized();
      return;
    case "reply":
      this.receiveReply(op);
      return;
    case "change":
      this.receiveChange(op);
      return;
    case "coll":
      this.receiveCollectionChange(op);
      return;
    case "request":
      this.receiveRequest(op)
        .catch(reportError);
      return;
    }
  }

  protected receiveReply(op: any): void {
    let request = this.pending.get(op.id);
    if (!request) {
      return;
    }
    this.pending.delete(op.id);
    this.inFlight--;
    this.sendWaiting();
    if (op.e) {
      let error = new Error(op.e.message);
      error.name = op.e.name;
      request.reject(error);
    } else if ("v" in op) {
      request.resolve(this.decode(op.v));
    } else {
      request.resolve(op.d);
    }
  }

  protected receiveChange(op: any): void {
    let value = this.decodeField(op.v, op.h, op.m);
    let object = this.remotes.get(op.h)?.ref?.deref();
    if (!(object instanceof AppObject)) {
      return;
    }
    object[kState].fields.set(op.m, value);
    object[kState].notify(object);
  }

  protected receiveCollectionChange(op: any): void {
    let added = (op.add ?? []).map(value => this.decode(value));
    if (op.of !== undefined) {
      this.bindMirror(op.h, op.of, op.m);
    }
    let mirror = this.remotes.get(op.h)?.ref?.deref();
    if (!(mirror instanceof CollectionMirror)) {
      return;
    }
    if (op.reset) {
      mirror.replaceAll(added);
    } else if (added.length) {
      mirror.addAll(added);
    }
    if (op.remove?.length) {
      let removedHandles = new Set(op.remove.filter(item => typeof item == "object" && item).map(item => item.h));
      let removedValues = new Set(op.remove.filter(item => typeof item != "object" || !item));
      mirror.removeAll(mirror.contents.filter(item => item instanceof AppObject
        ? removedHandles.has(item[kState].h)
        : removedValues.has(item)));
    }
    if (op.done) {
      mirror[kState].isLoading = false;
      mirror[kState].resolveLoaded();
    }
  }

  protected async receiveRequest(op: any): Promise<void> {
    let args = {};
    for (let [name, value] of Object.entries(op.a ?? {})) {
      args[name] = this.decode(value);
    }
    try {
      let handler = this.handlers.get(op.s + "." + op.m);
      if (!handler) {
        throw new Error(`The addon has no handler for ${op.s}.${op.m}`);
      }
      let result = await handler(args, op.d);
      if (op.id) {
        this.send({ op: "reply", id: op.id, d: result });
      }
    } catch (ex) {
      if (op.id) {
        this.send({ op: "reply", id: op.id, e: this.errorForApp(ex) });
      }
      throw ex;
    }
  }

  // App values

  protected decode(value: any): any {
    if (value === null || typeof value != "object" || value instanceof Date || value instanceof Uint8Array) {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(item => this.decode(item));
    }
    let remote = this.remotes.get(value.h);
    if (!remote) {
      remote = new Remote();
      this.remotes.set(value.h, remote);
    }
    remote.count++;
    if (value.coll) {
      return this.decodeCollection(value, remote);
    }
    let object = remote.ref?.deref() as AppObject;
    if (!object) {
      object = Object.create(this.prototypeFor(value.c));
      object[kState] = new ObjectState(this, value.h, this.classes[value.c]);
      this.track(object, remote, value.h);
    }
    if (value.p) {
      let fields = object[kState].fields;
      let isRefresh = fields.size > 0;
      let previous = isRefresh ? new Map(fields) : null;
      fields.clear();
      for (let [name, fieldValue] of Object.entries(value.p)) {
        let decoded = this.decodeField(fieldValue, value.h, name);
        let old = previous?.get(name);
        // Keep a collection that already loads
        fields.set(name, decoded instanceof LazyCollection && old instanceof CollectionMirror ? old : decoded);
      }
      if (isRefresh) {
        object[kState].notify(object);
      }
    }
    return object;
  }

  protected decodeField(value: any, ownerH: number, name: string): unknown {
    if (value?.coll && value.h === undefined) {
      return new LazyCollection(ownerH, name);
    }
    return this.decode(value);
  }

  /** The app sends the items of a collection field that the addon read */
  protected bindMirror(h: number, ownerH: number, name: string): void {
    let remote = this.remotes.get(h);
    if (!remote) {
      remote = new Remote();
      this.remotes.set(h, remote);
    }
    remote.count++;
    let owner = this.remotes.get(ownerH)?.ref?.deref();
    let ownerState = owner instanceof AppObject ? owner[kState] : null;
    let mirror = ownerState?.fields.get(name);
    if (!(mirror instanceof CollectionMirror) || mirror[kState].h !== undefined) {
      return;
    }
    let existing = remote.ref?.deref();
    if (existing instanceof CollectionMirror) {
      ownerState.fields.set(name, existing);
      mirror.replaceAll(existing.contents);
      mirror[kState].resolveLoaded();
      return;
    }
    mirror[kState].h = h;
    this.track(mirror, remote, h);
  }

  protected decodeCollection(value: any, remote: Remote): CollectionMirror<any> {
    let mirror = remote.ref?.deref() as CollectionMirror<any>;
    if (!mirror) {
      mirror = new CollectionMirror();
      mirror[kState] = new CollectionState(value.h, null);
      this.track(mirror, remote, value.h);
    }
    if (value.items) {
      mirror.replaceAll(value.items.map(item => this.decode(item)));
      if (value.done) {
        mirror[kState].resolveLoaded();
      } else {
        mirror[kState].isLoading = true;
      }
    }
    return mirror;
  }

  protected track(object: AppObject | CollectionMirror<any>, remote: Remote, h: number): void {
    remote.ref = new WeakRef(object);
    this.collected.register(object, h, object);
  }

  protected prototypeFor(c: number): object {
    let prototype = this.prototypes.get(c);
    if (prototype) {
      return prototype;
    }
    let client = this;
    let cls = this.classes[c];
    prototype = Object.create(AppObject.prototype);
    Object.defineProperty(prototype, Symbol.toStringTag, { value: cls.name });
    for (let [name, kind, isWritable] of cls.members) {
      let set = isWritable
        ? function (this: AppObject, value: unknown) {
          client.call(this, "set", name, value)
            .catch(reportError);
        }
        : undefined;
      if (kind == "method") {
        Object.defineProperty(prototype, name, {
          value: function (this: AppObject, ...args: unknown[]) {
            return client.call(this, "call", name, args);
          },
        });
      } else if (kind == "getter") {
        Object.defineProperty(prototype, name, {
          get(this: AppObject) {
            return client.call(this, "get", name);
          },
          set,
        });
      } else {
        Object.defineProperty(prototype, name, {
          get(this: AppObject) {
            return client.readField(this, name);
          },
          set,
        });
      }
    }
    this.prototypes.set(c, prototype);
    return prototype;
  }

  protected readField(object: AppObject, name: string): unknown {
    let state = this.liveState(object);
    if (!state.fields.has(name)) {
      throw new Error(`The addon may not read ${state.cls.name}.${name}`);
    }
    let value = state.fields.get(name);
    if (value instanceof LazyCollection) {
      let mirror = new CollectionMirror();
      mirror[kState] = new CollectionState(undefined, { h: value.ownerH, m: value.name });
      state.fields.set(name, mirror);
      this.load(mirror);
      return mirror;
    }
    return value;
  }

  protected liveState(object: AppObject): ObjectState {
    let state = object[kState];
    if (state.isReleased) {
      throw new Error(`This ${state.cls.name} was released`);
    }
    return state;
  }

  protected load(mirror: CollectionMirror<any>): void {
    let state = mirror[kState];
    if (state.isLoading || state.h !== undefined) {
      return;
    }
    state.isLoading = true;
    this.send({ op: "load", h: state.owner.h, m: state.owner.m });
  }

  async loaded(mirror: CollectionMirror<any>): Promise<void> {
    if (!(mirror instanceof CollectionMirror)) {
      throw new TypeError("Not a collection of app objects");
    }
    this.load(mirror);
    await mirror[kState].loaded;
  }

  release(object: AppObject): void {
    let state = object[kState];
    if (state.isReleased) {
      return;
    }
    state.isReleased = true;
    let remote = this.remotes.get(state.h);
    if (remote?.ref?.deref() === object) {
      this.remotes.delete(state.h);
      this.collected.unregister(object);
      this.send({ op: "release", h: state.h, n: remote.count });
    }
  }

  /** The garbage collector removed the proxy */
  protected forget(h: number): void {
    let remote = this.remotes.get(h);
    if (!remote || remote.ref?.deref()) {
      return;
    }
    this.remotes.delete(h);
    this.send({ op: "release", h, n: remote.count });
  }

  protected root(name: string, permission: string): CollectionMirror<any> {
    let mirror = this.roots.get(name);
    if (!mirror) {
      throw new Error(`The addon needs the permission ${permission}`);
    }
    return mirror;
  }

  // Calls to the app

  protected async call(object: AppObject, op: "call" | "get" | "set", name: string, value?: unknown): Promise<any> {
    let h = this.liveState(object).h;
    let request: any = { op, h, m: name };
    if (op == "call") {
      request.a = (value as unknown[]).map(arg => this.encode(arg));
    } else if (op == "set") {
      request.v = this.encode(value);
    }
    return await this.request(request);
  }

  protected encode(value: unknown): unknown {
    if (value instanceof AppObject) {
      return { h: this.liveState(value).h };
    }
    if (value instanceof CollectionMirror) {
      return { h: value[kState].h };
    }
    return value;
  }

  protected async callService(service: string, method: string, args: unknown[]): Promise<unknown> {
    return await this.request({ op: "service", s: service, m: method, a: args });
  }

  /** Without answer */
  protected sendService(service: string, method: string, args: unknown[]): void {
    this.send({ op: "service", s: service, m: method, a: args });
  }

  protected request(op: any): Promise<any> {
    return new Promise((resolve, reject) => {
      let id = this.nextID++;
      this.pending.set(id, { resolve, reject });
      this.waiting.push({ ...op, id });
      this.sendWaiting();
    });
  }

  /** The app runs at most 1000 calls of the addon at the same time. More wait here. */
  protected sendWaiting(): void {
    const kMaxInFlight = 1000;
    while (this.inFlight < kMaxInFlight && this.waitingIndex < this.waiting.length) {
      this.inFlight++;
      this.send(this.waiting[this.waitingIndex++]);
    }
    if (this.waitingIndex == this.waiting.length) {
      this.waiting = [];
      this.waitingIndex = 0;
    }
  }

  protected send(op: object): void {
    this.outbox.push(op);
    if (this.isFlushScheduled || !this.port) {
      return;
    }
    this.isFlushScheduled = true;
    queueMicrotask(() => this.flush());
  }

  protected flush(): void {
    const kMaxOpsPerMessage = 10000;
    this.isFlushScheduled = false;
    if (!this.port) {
      return;
    }
    let ops = this.outbox;
    this.outbox = [];
    for (let i = 0; i < ops.length; i += kMaxOpsPerMessage) {
      this.port.postMessage(ops.slice(i, i + kMaxOpsPerMessage));
    }
  }

  protected errorForApp(ex: any): { name: string, message: string } {
    return { name: String(ex?.name ?? "Error"), message: String(ex?.message ?? ex) };
  }

  // Requests from the app

  protected async runCommand(args: CommandEvent, data: { command: string }): Promise<void> {
    let handler = this.commands.get(data.command);
    if (!handler) {
      throw new Error(`The addon has no handler for the command ${data.command}`);
    }
    await handler(args);
  }

  protected addHook(when: "before" | "after", point: string, hook: (...args: any[]) => any): void {
    let key = when + " " + point;
    let hooks = this.hooks.get(key) ?? [];
    hooks.push(hook);
    this.hooks.set(key, hooks);
    this.callService("hooks", "register", [point, when])
      .catch(reportError);
  }

  protected async runHooks(args: any, data: { point: string, when: "before" | "after", result?: unknown }): Promise<HookCancel | void> {
    for (let hook of this.hooks.get(data.when + " " + data.point) ?? []) {
      let result = await hook(args, data.result);
      if (data.when == "before" && typeof result?.cancel == "string") {
        return { cancel: result.cancel };
      }
    }
  }

  protected async callProtocol(data: { protocol: string, operation: string, args: unknown[] }): Promise<unknown> {
    let implementation = this.protocols.get(data.protocol) as unknown as Record<string, unknown> | undefined;
    let operation = implementation?.[data.operation];
    if (typeof operation != "function") {
      throw new Error(`The protocol ${data.protocol} has no operation ${data.operation}`);
    }
    return await operation.apply(implementation, data.args);
  }
}
