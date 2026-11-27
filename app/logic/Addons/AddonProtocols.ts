import type { Addon, AddonRegistration } from "./Addon";
import type { AddonSandbox } from "./AddonSandbox";
import type { AddonProtocolContribution } from "./AddonManifest";
import type { AddonBridge, AddonService } from "./Bridge/AddonBridge";
import type { JSONValue } from "./Sandbox/MustangAPI";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { UserError, removeControlCharacters } from "../util/util";
import { gt } from "../../l10n/l10n";
import { ArrayColl, MapColl } from "svelte-collections";

/** The protocols of all running addons */
export const addonProtocols = new ArrayColl<AddonProtocol>();

/** An account of an addon protocol, while it's logged in */
export interface AddonProtocolAccount {
  /** The addon says that the server has new messages in this folder or chat room */
  onNewMessages?(folderID: string): void;
}

/** What the user entered in the `setup` UI of a protocol. Checked. */
export interface AddonAccountSetup {
  name: string;
  username: string;
  password: string | null;
  serverURL: string | null;
  extra: JSONValue | null;
}

/** `mustang.protocols` of one running addon */
export class AddonProtocols implements AddonService {
  readonly sandbox: AddonSandbox;
  /** What each `setup` UI frame sent last */
  protected setups = new WeakMap<AddonBridge, AddonAccountSetup>();

  constructor(sandbox: AddonSandbox) {
    this.sandbox = sandbox;
  }

  get addon(): Addon {
    return this.sandbox.addon;
  }

  call(bridge: AddonBridge, method: string, args: unknown[]): void {
    switch (method) {
    case "register":
      this.register(bridge, args[0]);
      return;
    case "newMessages":
      this.newMessages(bridge, args[0], args[1]);
      return;
    case "setupAccount":
      this.setups.set(bridge, this.checkSetup(args[0]));
      return;
    }
    throw new Error("Unknown method");
  }

  /** `mustang.protocols.register()` */
  protected register(bridge: AddonBridge, id: unknown): void {
    if (bridge != this.sandbox.logicFrame?.bridge) {
      throw new Error("Only the main code of the addon can add protocols");
    }
    let contribution = typeof id == "string" ? this.addon.manifest.protocols.find(protocol => protocol.id == id) : undefined;
    if (!contribution) {
      throw new Error("The manifest of the addon has no such protocol");
    }
    if (addonProtocols.some(protocol => protocol.protocols == this && protocol.contribution == contribution)) {
      return;
    }
    let protocol = new AddonProtocol(this, contribution);
    this.sandbox.register(protocol);
    addonProtocols.add(protocol);
  }

  /** `mustang.protocols.newMessages()`. Reaches only the accounts of this addon. */
  protected newMessages(bridge: AddonBridge, accountID: unknown, folderID: unknown): void {
    if (bridge != this.sandbox.logicFrame?.bridge) {
      throw new Error("Only the main code of the addon can report new messages");
    }
    if (typeof accountID != "string" || typeof folderID != "string") {
      throw new TypeError("The account ID and folder ID must be strings");
    }
    for (let protocol of addonProtocols) {
      if (protocol.protocols == this) {
        protocol.accounts.get(accountID)?.onNewMessages?.(folderID);
      }
    }
  }

  /** What the `setup` UI in this frame sent last, if it sent anything */
  setupOf(bridge: AddonBridge): AddonAccountSetup | undefined {
    return this.setups.get(bridge);
  }

  protected checkSetup(value: unknown): AddonAccountSetup {
    const kMaxSize = 10 * 1024;
    const kMaxLength = 1000;
    if (!value || typeof value != "object" || Array.isArray(value)) {
      throw new TypeError("The account must be an object");
    }
    // Also fails for cycles and BigInts
    let json = JSON.parse(JSON.stringify(value));
    if (JSON.stringify(json).length > kMaxSize) {
      throw new Error(`The account is larger than ${kMaxSize / 1024} KB`);
    }
    let serverURL = this.checkText(json.serverURL, "serverURL", 2 * kMaxLength, true);
    if (serverURL != null && !(URL.canParse(serverURL) && sanitize.url(serverURL, null, ["https"]))) {
      throw new Error("serverURL must be an https URL");
    }
    return {
      name: this.checkText(json.name, "name", 100),
      username: this.checkText(json.username, "username", kMaxLength),
      password: this.checkText(json.password, "password", kMaxLength, true),
      serverURL,
      extra: json.extra ?? null,
    };
  }

  /** @returns The text, without control characters */
  protected checkText(value: unknown, field: string, maxLength: number, isOptional = false): string | null {
    if (value == null && isOptional) {
      return null;
    }
    if (typeof value != "string" || value.length > maxLength) {
      throw new TypeError(`${field} must be a string of at most ${maxLength} characters`);
    }
    let text = removeControlCharacters(value).trim();
    if (!text) {
      throw new Error(`${field} is missing`);
    }
    return text;
  }
}

/** A protocol that a running addon implements, e.g. a mail protocol */
export class AddonProtocol implements AddonRegistration {
  readonly protocols: AddonProtocols;
  readonly contribution: AddonProtocolContribution;
  /** The logged in accounts, by account ID */
  readonly accounts = new MapColl<string, AddonProtocolAccount>();

  constructor(protocols: AddonProtocols, contribution: AddonProtocolContribution) {
    this.protocols = protocols;
    this.contribution = contribution;
  }

  get addon(): Addon {
    return this.protocols.addon;
  }

  /** e.g. "mail" */
  get type(): string {
    return this.contribution.type;
  }

  /** Plain text, sanitized */
  get label(): string {
    return this.contribution.label;
  }

  /** `Account.protocol` of the accounts of this protocol */
  get protocol(): string {
    return AddonProtocol.accountProtocol(this.addon.id, this.contribution.id);
  }

  /**
   * Runs an operation of the protocol in the addon's main code
   * @param args Plain data
   * @returns Untrusted data from the addon
   */
  async call(operation: string, args: unknown[]): Promise<unknown> {
    const kTimeoutMS = 5 * 60 * 1000;
    let bridge = this.protocols.sandbox.logicFrame?.bridge;
    if (!bridge || !addonProtocols.includes(this)) {
      throw new UserError(gt`The addon ${this.addon.name} is not available`);
    }
    let timeout: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        bridge.request("protocols", "call", {}, null, { protocol: this.contribution.id, operation, args }),
        new Promise((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(`The addon ${this.addon.name} took more than ${kTimeoutMS / 60000} minutes for ${operation}`)), kTimeoutMS);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  unregister(): void {
    addonProtocols.remove(this);
    this.accounts.clear();
  }

  /** The `protocol` of accounts of the protocol `protocolID` of the addon `addonID`.
   * Only letters, digits, - and _, like the protocols of the app, and different for every addon and protocol. */
  static accountProtocol(addonID: string, protocolID: string): string {
    // <copied from="AddonFiles.ts">
    return "addon-" + (addonID + ":" + protocolID).replace(/[^a-z0-9-]/gu, char =>
      [...new TextEncoder().encode(char)].map(byte => "_" + byte.toString(16).padStart(2, "0")).join(""));
    // </copied>
  }
}
