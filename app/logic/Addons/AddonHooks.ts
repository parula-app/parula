import type { Addon, AddonRegistration } from "./Addon";
import type { AddonSandbox } from "./AddonSandbox";
import type { AddonBridge, AddonService } from "./Bridge/AddonBridge";
import { hookPoints, type Hook, type HookPoint } from "./API/HookPoint";
import { AddonCancelError } from "./AddonCancelError";
import { minorError } from "../util/error";

/** `mustang.hooks` of one running addon */
export class AddonHooks implements AddonService {
  readonly sandbox: AddonSandbox;

  constructor(sandbox: AddonSandbox) {
    this.sandbox = sandbox;
  }

  get addon(): Addon {
    return this.sandbox.addon;
  }

  /** `mustang.hooks.before()` and `after()` */
  call(bridge: AddonBridge, method: string, args: unknown[]): void {
    let [point, when] = args;
    if (method != "register") {
      throw new Error("Unknown method");
    }
    if (bridge != this.sandbox.logicFrame?.bridge) {
      throw new Error("Only the main code of the addon can add hooks");
    }
    if (when !== "before" && when !== "after") {
      throw new Error("A hook runs before or after");
    }
    let hookPoint = typeof point == "string" && this.addon.manifest.hooks.includes(point) ? hookPoints.get(point) : undefined;
    if (!hookPoint) {
      throw new Error("The manifest of the addon has no such hook");
    }
    if (!this.addon.apiGroups.contains(hookPoint.api.group)) {
      throw new Error(`The hook needs the permission ${hookPoint.api.group}`);
    }
    if (hookPoint.hooks.some(hook => hook instanceof AddonHook && hook.hooks == this && hook.when == when)) {
      return;
    }
    let hook = new AddonHook(this, hookPoint, when);
    this.sandbox.register(hook);
    hookPoint.add(hook);
  }
}

/** A before- or after-hook of one addon at one hook point */
export class AddonHook implements Hook, AddonRegistration {
  readonly hooks: AddonHooks;
  readonly point: HookPoint;
  readonly when: "before" | "after";

  constructor(hooks: AddonHooks, point: HookPoint, when: "before" | "after") {
    this.hooks = hooks;
    this.point = point;
    this.when = when;
  }

  get addon(): Addon {
    return this.hooks.addon;
  }

  unregister(): void {
    this.point.remove(this);
  }

  /** Lets the addon's main code run its hooks. The arguments are valid only during the hook.
   * @throws AddonCancelError, if a before-hook cancels */
  async run(args: Record<string, unknown>, result?: unknown): Promise<void> {
    let bridge = this.hooks.sandbox.logicFrame?.bridge;
    if (!bridge) {
      return;
    }
    if (this.when == "after") {
      this.runAfter(bridge, args, result);
      return;
    }
    await this.runBefore(bridge, args);
  }

  protected async runBefore(bridge: AddonBridge, args: Record<string, unknown>): Promise<void> {
    const kTimeoutMS = 10000;
    let grant = bridge.newGrant(this.point.groups);
    let timeout: ReturnType<typeof setTimeout>;
    let answer: any;
    try {
      answer = await Promise.race([
        bridge.request("hooks", "run", args, grant, { point: this.point.id, when: "before" }),
        new Promise((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(`The addon ${this.addon.name} took more than ${kTimeoutMS / 1000} s for its hook ${this.point.id}`)), kTimeoutMS);
        }),
      ]);
    } catch (ex) {
      minorError(ex);
      return;
    } finally {
      clearTimeout(timeout);
      grant.revoke();
    }
    if (typeof answer?.cancel == "string") {
      throw new AddonCancelError(this.addon, answer.cancel);
    }
  }

  /** Not awaited, so the addon can't delay the app */
  protected runAfter(bridge: AddonBridge, args: Record<string, unknown>, result: unknown): void {
    const kGrantMS = 30000;
    let grant = bridge.newGrant(this.point.readGroups);
    setTimeout(() => grant.revoke(), kGrantMS);
    bridge.notify("hooks", "run", args, grant, { point: this.point.id, when: "after", result });
  }
}
