import { AuthMethod, type Account } from "../Abstract/Account";
import { findOrCreatePersonUID, type PersonUID } from "../Abstract/PersonUID";
import { AddonState, type Addon } from "./Addon";
import { addonProtocols, AddonProtocol, type AddonAccountSetup, type AddonProtocolAccount } from "./AddonProtocols";
import type { AccountData, JSONValue } from "./Sandbox/MustangAPI";
import { appGlobal } from "../app";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { RunOnce } from "../util/flow/RunOnce";
import { LoopGuard } from "../util/flow/LoopGuard";
import { UserError, removeControlCharacters } from "../util/util";
import { gt } from "../../l10n/l10n";
import type { Collection } from "svelte-collections";

/** Connects an account of an addon protocol to the addon, and checks what the addon returns.
 * Each such account has one, whatever app it's for. */
export class AddonConnection {
  readonly account: Account & AddonProtocolAccount;
  /** The app's list of accounts of this type. Only the accounts in it connect when their addon starts. */
  protected readonly appAccounts: Collection<Account>;
  /** The protocol of the running addon, while logged in */
  protocol: AddonProtocol | null = null;
  /** For the error message, when the addon is not installed */
  addonName = "";
  /** What the `setup` UI of the protocol gave for this account */
  extra: JSONValue | null = null;
  protected loginRunOnce = new RunOnce<void>();
  /** Collections hold their observers weakly */
  protected protocolsObserver = {
    added: (protocols: AddonProtocol[]) => this.protocolsAdded(protocols),
    removed: (protocols: AddonProtocol[]) => this.protocolsRemoved(protocols),
  };

  constructor(account: Account & AddonProtocolAccount, appAccounts: Collection<Account>) {
    this.account = account;
    this.appAccounts = appAccounts;
    addonProtocols.registerObserver(this.protocolsObserver);
  }

  /** The protocol, while its addon runs */
  get registeredProtocol(): AddonProtocol | undefined {
    return addonProtocols.find(protocol => protocol.protocol == this.account.protocol);
  }

  /** The installed addon with this protocol, running or not */
  get addon(): Addon | undefined {
    return appGlobal.addons.installed.find(addon => addon.manifest.protocols.some(contribution =>
      AddonProtocol.accountProtocol(addon.id, contribution.id) == this.account.protocol));
  }

  get isLoggedIn(): boolean {
    return !!this.protocol;
  }

  /** Gives the account and its password to the `login()` of the addon */
  async login(): Promise<void> {
    await this.loginRunOnce.runOnce(async () => {
      let protocol = await this.waitForProtocol();
      this.addonName = protocol.addon.name;
      await protocol.call("login", [this.accountData(), this.account.password]);
      if (!addonProtocols.includes(protocol)) {
        throw this.account.fatalError = this.notAvailableError();
      }
      this.account.fatalError = null;
      protocol.accounts.set(this.account.id, this.account);
      this.protocol = protocol;
      this.account.notifyObservers();
    });
  }

  /** For setup: Checks the login, without storing anything */
  async verifyLogin(): Promise<void> {
    let protocol = await this.waitForProtocol();
    await protocol.call("login", [this.accountData(), this.account.password]);
  }

  /** @throws UserError, if the addon is not installed, not enabled, or didn't register the protocol */
  protected async waitForProtocol(): Promise<AddonProtocol> {
    const kStartTimeoutMS = 30000;
    let protocol = this.registeredProtocol;
    let addon = this.addon;
    if (!protocol && addon?.isEnabled && addon.state != AddonState.Error) {
      // It's starting, e.g. at app start
      protocol = await this.protocolRegistered(kStartTimeoutMS);
    }
    if (!protocol) {
      throw this.account.fatalError = this.notAvailableError();
    }
    return protocol;
  }

  protected async protocolRegistered(timeoutMS: number): Promise<AddonProtocol | undefined> {
    let observer: { added(protocols: AddonProtocol[]): void, removed(): void };
    let timeout: ReturnType<typeof setTimeout>;
    try {
      return await new Promise(resolve => {
        observer = {
          added: protocols => {
            let protocol = protocols.find(protocol => protocol.protocol == this.account.protocol);
            if (protocol) {
              resolve(protocol);
            }
          },
          removed() {},
        };
        addonProtocols.registerObserver(observer);
        timeout = setTimeout(() => resolve(undefined), timeoutMS);
      });
    } finally {
      clearTimeout(timeout);
      addonProtocols.unregisterObserver(observer);
    }
  }

  notAvailableError(): UserError {
    return new UserError(gt`The addon ${this.addon?.name ?? this.addonName} is not available`);
  }

  /** The addon was enabled or installed: Connect, like at app start */
  protected protocolsAdded(protocols: AddonProtocol[]): void {
    let account = this.account;
    if (protocols.some(protocol => protocol.protocol == account.protocol) &&
        !this.isLoggedIn && account.loginOnStartup && this.appAccounts.contains(account)) {
      account.loginAndStartup(false)
        .catch(account.errorCallback);
    }
  }

  /** The addon was disabled or removed: Offline, with the local data */
  protected protocolsRemoved(protocols: AddonProtocol[]): void {
    if (protocols.includes(this.protocol)) {
      this.protocol = null;
      this.account.fatalError = this.notAvailableError();
      this.account.notifyObservers();
    }
  }

  disconnect(): void {
    if (this.protocol?.accounts.get(this.account.id) == this.account) {
      this.protocol.accounts.delete(this.account.id);
    }
    this.protocol = null;
    this.account.notifyObservers();
  }

  /**
   * Runs an operation of the protocol in the addon, for this account
   * @param args after the account
   * @returns Untrusted data from the addon
   */
  async call(operation: string, ...args: unknown[]): Promise<unknown> {
    if (!this.protocol) {
      await this.account.login(false);
    }
    let protocol = this.protocol;
    if (!protocol) {
      throw this.notAvailableError();
    }
    return await protocol.call(operation, [this.accountData(), ...args]);
  }

  /**
   * Gets the new, changed and removed items since `syncState` from the addon, in chunks, while it says that it has more.
   * Stops when the sync state doesn't move.
   * @param args before the sync state
   * @param name of the list of new and changed items in the result, e.g. "events"
   * @param applyChunk Checks and stores one chunk, and its sync state
   */
  async listChanges(operation: string, args: unknown[], syncState: string | null, name: string,
      applyChunk: (items: any[], removedIDs: unknown[], syncState: string) => Promise<void>): Promise<void> {
    const kMaxItems = 1000;
    const kMaxRemoved = 10000;
    const kMaxSyncStateLength = 10 * 1024;
    // 10,000,000 items
    const kMaxRounds = 10000;
    let loop = new LoopGuard(kMaxRounds, () =>
      this.account.errorCallback(new Error(`${this.account.name}: The addon keeps reporting more ${name}. Stopped.`)));
    while (loop.nextRound()) {
      if (syncState != null && loop.isSameAsLastRound(syncState)) {
        break;
      }
      let list = this.checkObject(await this.call(operation, ...args, syncState), `list of ${name}`);
      let items = this.checkList(list[name], kMaxItems, name);
      let removed = this.checkList(list.removed ?? [], kMaxRemoved, `removed ${name}`);
      if (typeof list.syncState != "string" || list.syncState.length > kMaxSyncStateLength) {
        throw new Error(`${this.account.name}: The addon gave no sync state, or one larger than 10 KB`);
      }
      await applyChunk(items, removed, list.syncState);
      if (list.hasMore !== true) {
        return;
      }
      syncState = list.syncState;
    }
  }

  /** What the addon gets as `account` */
  protected accountData(): AccountData {
    let account = this.account as Account & { emailAddress?: string };
    return {
      id: account.id,
      name: account.name,
      emailAddress: account.emailAddress ?? null,
      username: account.username,
      serverURL: account.url,
      extra: this.extra,
    };
  }

  /** Takes what the user entered in the `setup` UI of the protocol */
  fromAddonSetup(setup: AddonAccountSetup): void {
    let account = this.account;
    account.name = setup.name;
    account.username = setup.username;
    account.password = setup.password ?? account.password;
    account.url = setup.serverURL;
    account.authMethod = AuthMethod.Password;
    this.extra = setup.extra;
    this.addonName = this.registeredProtocol?.addon.name ?? this.addonName;
  }

  fromConfigJSON(json: any) {
    this.addonName = sanitize.label(json.addonName, "");
    this.extra = json.extra ?? null;
  }
  toConfigJSON(json: any) {
    json.addonName = this.addonName;
    json.extra = this.extra;
  }

  // Checks of the data from the addon

  /** @returns An ID of the server */
  checkID(value: unknown): string {
    const kMaxLength = 1000;
    if (typeof value != "string" || !value || value.length > kMaxLength) {
      throw new Error(`${this.account.name}: The addon gave an invalid ID`);
    }
    return value;
  }

  /** @returns Text for the user, without control characters, cut to `maxLength` */
  checkText(value: unknown, maxLength: number, fallback: string | null): string | null {
    if (typeof value != "string") {
      return fallback;
    }
    let text = removeControlCharacters(value.substring(0, maxLength)).trim();
    return text || fallback;
  }

  /** @returns A number of messages or bytes */
  checkCount(value: unknown, fallback: number | null): number | null {
    const kMax = 1e12;
    return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= kMax ? value as number : fallback;
  }

  checkList(value: unknown, maxLength: number, what: string): any[] {
    if (!Array.isArray(value)) {
      throw new Error(`${this.account.name}: The addon gave no list of ${what}`);
    }
    if (value.length > maxLength) {
      throw new Error(`${this.account.name}: The addon gave more than ${maxLength} ${what}`);
    }
    return value;
  }

  checkObject(value: unknown, what: string): any {
    if (!value || typeof value != "object" || Array.isArray(value)) {
      throw new Error(`${this.account.name}: The addon gave no ${what}`);
    }
    return value;
  }

  checkPerson(value: any): PersonUID {
    const kMaxLength = 1000;
    let emailAddress = typeof value?.emailAddress == "string" && value.emailAddress.length <= kMaxLength
      ? sanitize.emailAddress(value.emailAddress, null)
      : null;
    return findOrCreatePersonUID(emailAddress, this.checkText(value?.name, kMaxLength, null));
  }
}
