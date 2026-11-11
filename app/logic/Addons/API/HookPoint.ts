import type { Addon } from "../Addon";
import type { APIConstructor, APIHook, AddonGroup } from "./addon";
import { apiClasses, apiHooks } from "./apiTypes";
import { addonPermissions } from "../Permissions";
import { minorError } from "../../util/error";
import { assert } from "../../util/util";
import { ArrayColl, MapColl, type Collection } from "svelte-collections";

/** What runs at a hook point, e.g. the before-hook of one addon */
export interface Hook {
  readonly addon: Addon;
  readonly when: "before" | "after";
  /** Before: awaited, and throws to stop the app method. After: not awaited. */
  run(args: Record<string, unknown>, result?: unknown): Promise<void>;
}

/** An app method marked with `@addonHook()`.
 * While a hook is added, the method on the prototype runs the hooks around the original method.
 * While none is, the prototype has the original method, untouched. */
export class HookPoint {
  readonly api: APIHook;
  /** For the arguments of before-hooks, which may change them */
  readonly groups: ArrayColl<AddonGroup>;
  /** For the arguments of after-hooks, which can only read them */
  readonly readGroups: Collection<AddonGroup>;
  readonly hooks = new ArrayColl<Hook>();
  /** The class of the method, and subclasses that override it */
  protected classes = new ArrayColl<APIConstructor>();
  /** prototype -> its original method */
  protected originals = new MapColl<object, PropertyDescriptor>();

  constructor(api: APIHook) {
    this.api = api;
    this.classes.add(api.class);
    this.groups = new ArrayColl(addonPermissions.get(api.group)?.apiGroups.contents ?? [api.group]);
    let writeGroups = apiClasses.flatMap(cls => cls.members.flatMap(member => member.kind == "method" ? [] : member.write ?? []));
    this.readGroups = this.groups.filterOnce(group => !writeGroups.includes(group));
  }

  get id(): string {
    return this.api.point;
  }

  add(hook: Hook): void {
    this.hooks.add(hook);
    if (this.originals.hasItems) {
      return;
    }
    for (let cls of this.classes) {
      this.wrap(cls);
    }
  }

  remove(hook: Hook): void {
    this.hooks.remove(hook);
    if (this.hooks.hasItems) {
      return;
    }
    for (let [prototype, original] of this.originals.entries()) {
      Object.defineProperty(prototype, this.api.method, original);
    }
    this.originals.clear();
  }

  /** For a subclass that overrides the method without calling it, so that the hooks run for it as well */
  addSubclass(subclass: APIConstructor): void {
    assert(subclass.prototype instanceof this.api.class, `Not a subclass of the class with the hook ${this.id}`);
    this.classes.add(subclass);
    if (this.originals.hasItems) {
      this.wrap(subclass);
    }
  }

  protected wrap(cls: APIConstructor): void {
    let prototype = cls.prototype;
    let original = Object.getOwnPropertyDescriptor(prototype, this.api.method);
    assert(typeof original?.value == "function", `The class has no method for the hook ${this.id}`);
    let method = original.value;
    let point = this;
    this.originals.set(prototype, original);
    Object.defineProperty(prototype, this.api.method, {
      ...original,
      value: async function (this: object, ...params: unknown[]) {
        return await point.run(this, method, params);
      },
    });
  }

  protected async run(self: object, method: (...params: unknown[]) => Promise<unknown>, params: unknown[]): Promise<unknown> {
    let args: Record<string, unknown> = {};
    for (let [i, arg] of this.api.args.entries()) {
      args[arg.name] = arg.member ? self[arg.member] : params[i];
    }
    let installed = this.hooks.first?.addon.addons.installed;
    let hooks = [...this.hooks].sort((a, b) => installed.indexOf(a.addon) - installed.indexOf(b.addon));
    for (let hook of hooks) {
      if (hook.when == "before") {
        await hook.run(args);
      }
    }
    let result = await method.apply(self, params);
    for (let hook of hooks) {
      if (hook.when == "after") {
        hook.run(args, result)
          .catch(minorError);
      }
    }
    return result;
  }
}

/** Hook point ID -> hook point, for all `@addonHook()` methods */
export const hookPoints = new MapColl<string, HookPoint>();
for (let api of apiHooks) {
  hookPoints.set(api.point, new HookPoint(api));
}
