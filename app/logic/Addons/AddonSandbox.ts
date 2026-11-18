import type { Addon, AddonRegistration } from "./Addon";
import type { AddonStorage } from "./AddonFiles";
import { addonPermissions, AddonObjectScope } from "./Permissions";
import { AddonUI } from "./AddonUI";
import { AddonApp } from "./AddonApp";
import { AddonHooks } from "./AddonHooks";
import { AddonProtocols } from "./AddonProtocols";
import { AddonBridge, type AddonService } from "./Bridge/AddonBridge";
import { AddonAPI } from "./Bridge/AddonAPI";
import { AddonBudget } from "./Bridge/AddonBudget";
import { SandboxFrame } from "./Sandbox/SandboxFrame";
import { apiClasses, apiEnums } from "./API/apiTypes";
import type { AddonGroup } from "./API/addon";
import { appGlobal } from "../app";
import { isMobile } from "../build";
import { UserError } from "../util/util";
import { gt } from "../../l10n/l10n";
import { ArrayColl } from "svelte-collections";

/** Runs the code of one addon: its logic worker in a hidden frame, and its UI frames.
 * Stopping it removes all frames, which ends the addon code, and revokes all app objects that the addon got. */
export class AddonSandbox implements AddonRegistration {
  readonly addon: Addon;
  /** For all frames of the addon together: app objects, running calls, waiting operations */
  readonly budget = new AddonBudget();
  logicFrame: SandboxFrame | null = null;
  readonly uiFrames = new ArrayColl<SandboxFrame>();
  /** Its buttons, menu items and panels in the app */
  readonly ui: AddonUI;
  readonly hooks: AddonHooks;
  readonly protocols: AddonProtocols;
  isStopped = false;
  protected static api = new AddonAPI(apiClasses, apiEnums);

  constructor(addon: Addon) {
    this.addon = addon;
    this.ui = new AddonUI(this);
    this.hooks = new AddonHooks(this);
    this.protocols = new AddonProtocols(this);
  }

  /** Starts the addon's logic worker, if it has one, and then shows its UI */
  async start(): Promise<void> {
    if (isMobile) {
      throw new UserError(gt`Addons are not available on mobile yet`);
    }
    let main = this.addon.manifest.main;
    if (main) {
      let frame = new SandboxFrame(this.addon.name);
      frame.iframe.hidden = true;
      this.logicFrame = frame;
      // Outside of the app's UI, so that the worker survives when the user switches apps
      await this.startFrame(frame, document.body, "logic", main);
    }
    this.register(this.ui);
    this.ui.show();
    for (let contribution of this.addon.manifest.apps) {
      let app = new AddonApp(this.addon, contribution);
      this.register(app);
      app.show();
    }
  }

  /** Shows a UI module of the addon in `container`
   * @param entry Path of the module in the addon package
   * @param beforeLoad For what the UI module should have when it starts, e.g. `frame.setContext()` */
  async openUIFrame(container: HTMLElement, entry: string, beforeLoad?: (frame: SandboxFrame) => void): Promise<SandboxFrame> {
    const kMaxFrames = 50;
    this.checkRunning();
    if (this.uiFrames.length >= kMaxFrames) {
      throw new Error(`The addon ${this.addon.name} has more than ${kMaxFrames} frames open`);
    }
    let frame = new SandboxFrame(this.addon.name);
    this.uiFrames.add(frame);
    try {
      await this.startFrame(frame, container, "ui", entry, beforeLoad);
    } catch (ex) {
      this.closeUIFrame(frame);
      throw ex;
    }
    return frame;
  }

  closeUIFrame(frame: SandboxFrame): void {
    frame.remove();
    this.uiFrames.remove(frame);
  }

  /** For everything that the addon adds to the app while it runs.
   * @throws if the addon stopped */
  register(registration: AddonRegistration): void {
    this.checkRunning();
    this.addon.registrations.add(registration);
  }

  protected checkRunning(): void {
    if (this.isStopped) {
      throw new Error(`The addon ${this.addon.name} stopped`);
    }
  }

  protected async startFrame(frame: SandboxFrame, container: HTMLElement, kind: "logic" | "ui", path: string, beforeLoad?: (frame: SandboxFrame) => void): Promise<void> {
    const kTimeout = 10000;
    let code = new TextDecoder().decode(await this.addon.readFile(path));
    this.checkRunning();
    let bridge = new AddonBridge(frame.port, AddonSandbox.api, this.addon.apiGroups, this.budget);
    frame.bridge = bridge;
    bridge.registerService("storage", new AddonStorageService(this.addon.storage));
    bridge.registerService("ui", this.ui);
    bridge.registerService("hooks", this.hooks);
    bridge.registerService("protocols", this.protocols);
    if (kind == "ui") {
      bridge.registerService("frame", frame);
    }
    let rootsGrant = bridge.newGrant(this.rootGroups());
    bridge.setRoot("mail", "mail.all", appGlobal.emailAccounts, rootsGrant);
    bridge.setRoot("chat", "chat.all", appGlobal.chatAccounts, rootsGrant);
    bridge.start({ name: this.addon.name, version: this.addon.manifest.version });
    beforeLoad?.(frame);
    await frame.start(container, kind, code, this.addon.manifest.connectSrc);
    let timeout: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        bridge.ready,
        new Promise((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(`The addon ${this.addon.name} did not start`)), kTimeout);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    this.checkRunning();
  }

  /** The groups of the permissions that give the addon root collections, e.g. `mustang.mail.accounts` */
  protected rootGroups(): AddonGroup[] {
    let groups: AddonGroup[] = [];
    for (let id of this.addon.manifest.permissions) {
      let permission = addonPermissions.get(id);
      if (permission?.scope == AddonObjectScope.Roots && this.addon.grantedPermissions.includes(id)) {
        groups.push(...permission.apiGroups);
      }
    }
    return groups;
  }

  unregister(): void {
    this.isStopped = true;
    this.logicFrame?.remove();
    this.logicFrame = null;
    for (let frame of this.uiFrames) {
      frame.remove();
    }
    this.uiFrames.clear();
    if (this.addon.sandbox == this) {
      this.addon.sandbox = null;
    }
  }
}

/** `mustang.storage` */
class AddonStorageService implements AddonService {
  protected storage: AddonStorage;

  constructor(storage: AddonStorage) {
    this.storage = storage;
  }

  async call(_bridge: AddonBridge, method: string, args: unknown[]): Promise<unknown> {
    let key = args[0];
    if (typeof key != "string") {
      throw new TypeError("The key must be a string");
    }
    switch (method) {
    case "get":
      return await this.storage.get(key);
    case "set":
      await this.storage.set(key, args[1]);
      return undefined;
    case "remove":
      await this.storage.remove(key);
      return undefined;
    }
    throw new Error("Unknown method");
  }
}
