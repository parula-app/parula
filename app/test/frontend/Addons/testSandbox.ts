// app first, to resolve the import cycle around Addons
import { appGlobal } from "../../../logic/app";
import { Addons } from "../../../logic/Addons/Addons";
import { Addon } from "../../../logic/Addons/Addon";
import { AddonManifest } from "../../../logic/Addons/AddonManifest";
import { AddonUI } from "../../../logic/Addons/AddonUI";
import { AddonBridge } from "../../../logic/Addons/Bridge/AddonBridge";
import { AddonAPI } from "../../../logic/Addons/Bridge/AddonAPI";
import { AddonBudget } from "../../../logic/Addons/Bridge/AddonBudget";
import { SandboxFrame } from "../../../logic/Addons/Sandbox/SandboxFrame";
import { apiClasses, apiEnums } from "../../../logic/Addons/API/apiTypes";
import { MailAccount } from "../../../logic/Mail/MailAccount";
import { Folder, SpecialFolder } from "../../../logic/Mail/Folder";
import type { EMail } from "../../../logic/Mail/EMail";
import { DummyMailStorage } from "../../../logic/Mail/Store/DummyMailStorage";
import { findOrCreatePersonUID } from "../../../logic/Abstract/PersonUID";
import { TestClient } from "../../logic/Addons/Bridge/fixtures";

const api = new AddonAPI(apiClasses, apiEnums);

/** Stands in for `AddonSandbox`: the real bridges, `AddonUI` and sandbox runtime (`TestClient`),
 * connected by `MessageChannel`s instead of frames, which happy-dom can't run */
export class TestSandbox {
  readonly addon: Addon;
  readonly ui: AddonUI;
  readonly budget = new AddonBudget();
  logicFrame: { bridge: AddonBridge } | null = null;
  /** The addon's main code */
  logic: TestClient;
  readonly uiFrames: { frame: SandboxFrame, client: TestClient, entry: string }[] = [];

  constructor(addon: Addon) {
    this.addon = addon;
    this.ui = new AddonUI(this as any);
  }

  /** Like the app: the main code runs, then the UI shows */
  async start(): Promise<void> {
    let { bridge, client } = await this.connect();
    this.logicFrame = { bridge };
    this.logic = client;
    this.ui.show();
    this.addon.sandbox = this as any;
  }

  stop(): void {
    this.ui.unregister();
    this.logicFrame?.bridge.close();
    this.logicFrame = null;
    for (let { frame } of this.uiFrames) {
      frame.remove();
    }
    this.addon.sandbox = null;
  }

  async openUIFrame(_container: HTMLElement, entry: string, beforeLoad?: (frame: SandboxFrame) => void): Promise<SandboxFrame> {
    let frame = new SandboxFrame(this.addon.name);
    let { bridge, client } = await this.connect();
    frame.bridge = bridge;
    beforeLoad?.(frame);
    this.uiFrames.push({ frame, client, entry });
    return frame;
  }

  closeUIFrame(frame: SandboxFrame): void {
    frame.remove();
  }

  protected async connect(): Promise<{ bridge: AddonBridge, client: TestClient }> {
    let channel = new MessageChannel();
    let bridge = new AddonBridge(channel.port1, api, this.addon.apiGroups, this.budget);
    bridge.registerService("ui", this.ui);
    let client = new TestClient();
    client.start(channel.port2);
    bridge.start({ name: this.addon.name, version: "1.0.0" });
    await client.whenInitialized();
    return { bridge, client };
  }
}

/** A running addon with these UI contributions (`mustang.ui` of the manifest) */
export async function newTestAddon(ui: any, permissions = ["mail"]): Promise<TestSandbox> {
  let manifest = AddonManifest.fromJSON({
    name: "@test/places",
    version: "1.0.0",
    mustang: { name: "Test addon", permissions, main: "dist/main.js", ui },
  }, null);
  let addon = new Addon(new Addons(), manifest, {} as any);
  addon.grantedPermissions.addAll(manifest.permissions);
  let sandbox = new TestSandbox(addon);
  await sandbox.start();
  return sandbox;
}

export function newTestMails(count = 2): EMail[] {
  appGlobal.remoteApp = {} as any;
  let account = new MailAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.storage = new DummyMailStorage();
  account.contentStorage.clear();
  let folder = new Folder(account);
  folder.name = "INBOX";
  folder.id = "INBOX";
  folder.specialFolder = SpecialFolder.Inbox;
  account.rootFolders.add(folder);
  for (let i = 0; i < count; i++) {
    let email = folder.newEMail();
    email.id = `msg${i}@example.com`;
    email.pID = email.id;
    email.subject = "Test " + i;
    email.sent = new Date(2026, 8, 1, 12, -i);
    email.received = email.sent;
    email.from = findOrCreatePersonUID("alice@example.com", "Alice");
    email.contact = email.from;
    email.text = "Message number " + i;
    folder.messages.add(email);
  }
  return folder.messages.contents as EMail[];
}

/** Waits until `condition` is true, while the bridge messages go back and forth */
export async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  if (!condition()) {
    throw new Error("Timeout");
  }
}

/** The value of `mustang.ui.context` in the addon */
export function contextOf(client: TestClient): any {
  let value: any;
  client.mustang.ui.context.subscribe(context => value = context)();
  return value;
}
