import { Workspace, getWorkspaceByID, accountColors, randomAccountColor } from "./Workspace";
import type { WebBasedAuth } from "../Auth/WebBasedAuth";
import { appGlobal } from "../app";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { Observable, notifyChangedProperty } from "../util/Observable";
import { addon } from "../Addons/API/addon";
import { RunOnce } from "../util/flow/RunOnce";
import { logErrorToServer, internalError } from "../util/error";
import { SpecificError, assert } from "../util/util";
import { ArrayColl, Collection } from "svelte-collections";

export class Account extends Observable {
  id: string;
  /** The primary ID in the type-specific database (not in accounts DB) */
  dbID: number | string | null = null;
  @addon(["mail.all", "chat.all"])
  @notifyChangedProperty
  name: string;
  /** A `data:` URL to an image that represents this account.
   * E.g. the company logo. */
  @notifyChangedProperty
  icon: string | any | null = null;
  @notifyChangedProperty
  color: string = "#FFFFFF";
  /** Class ID. Must be overwritten by subclasses. Written to account prefs. */
  readonly protocol: string = null;
  /** Protocol-specific address for the sync server. Only only for some types of accounts. */
  @notifyChangedProperty
  url: string | null = null;
  @notifyChangedProperty
  username: string | null = null;
  @notifyChangedProperty
  authMethod = AuthMethod.Unknown;
  @notifyChangedProperty
  oAuth2: WebBasedAuth = null;
  @notifyChangedProperty
  password: string | null = null;
  @notifyChangedProperty
  workspace: Workspace | null = null;
  @notifyChangedProperty
  realname: string = appGlobal.me?.name;
  /** @see `mainAccount` */
  @notifyChangedProperty
  _mainAccount: Account | null = null;
  /** Internal. Used only during load. */
  _mainAccountID: string | null = null;
  @notifyChangedProperty
  acceptBrokenTLSCerts = false;
  @notifyChangedProperty
  loginOnStartup = true;
  /** Error that broke the server connection, unrecoverable, including login failures. */
  fatalError: Error | null = null;
  /** Non-fatal errors that are not about a single email or data item. */
  readonly errors = new ArrayColl<Error>();
  /** The data of a single email or item is bad @see `dataError()` */
  readonly dataErrors = new ArrayColl<Error>();
  /** Will be called, when there are errors on the connection
   * which cannot be attributed directly to an API function called,
   * e.g. errors while processing server messages. */
  errorCallback = (ex) => console.error(ex);
  protected dependentStartupOnce = new RunOnce();

  constructor() {
    super();
    this.id = findFreeAccountID();
    this.color = unusedAccountColor();
  }

  /** The data of one item of this account is bad, e.g. one email that we could not read.
   * Call it in the `catch` within a loop, so that the loop continues with the other items. */
  dataError(ex: Error) {
    this.dataErrors.add(ex);
    logErrorToServer(ex);
  }

  /**
   * The initial sync after the login: lists the folders, events or contacts,
   * fetches the new mail, subscribes to changes on the server, and starts the
   * dependent accounts. The UI could make these calls at any time, so `login()`
   * must not call this: it would run twice. @see `loginAndStartup()`
   *
   * Runs after the app start, after a manual login, and after the computer
   * slept. The caller may skip it and issue a single call instead.
   */
  async syncOnStartup() {
  }

  /**
   * Load all the data that we stored locally in our database,
   * e.g. the mail folders, the calendar events, or the contacts.
   * Called at app start, before the login, so that the user sees the data
   * even when the login fails, e.g. when we're offline.
   * May be called again later, and must then not add the data a second time.
   */
  async readFromDB(): Promise<void> {
  }

  /**
   * Convenience method for accounts to use to start up dependent accounts.
   * This should be called after the account has finished its own startup.
   */
  protected async startupDependentAccounts() {
    for (let dependent of this.dependentAccounts()) {
      dependent.dependentStartupOnce.runOnce(() => dependent.syncOnStartup())
        .catch(dependent.errorCallback);
    }
  }

  /** Tell the UI that the dependent accounts are logged in etc as well. */
  notifyObserversOfSubaccounts() {
    for (let dependent of this.dependentAccounts()) {
      dependent.notifyObservers();
    }
  }

  get isLoggedIn(): boolean {
    return false;
  }

  /**
   * The preparation which allows us to issue any normal call to the server,
   * including sending the password. There are no calls to the server before it.
   *
   * Depending on the protocol:
   * - IMAP: opening the the TCP connection, CAPABILITY, login
   * - JMAP: the session
   * …
   *
   * Initial sync is done in `syncOnStartup()`, not here.
   * `loginAndStartup()` does both.
   *
   * @param interactive
   *   true: If needed, open UI to ask user to log in manually,
   *     e.g. using password, MFA, or passkey
   *   false: Log in with stored credentials, e.g. stored
   *     password, stored OAuth2 refreshToken or similar.
   * @throws
   *   NeedInteraction We don't have stored credentials,
   *     or they expired normally.
   *   LoginFailed We have stored credentials, and we tried them,
   *     but the server refused to accept them.
   *     (Typically for reasons other than expiry.)
   */
  async login(interactive: boolean): Promise<void> {
    this.errors.clear();

    if (this.isDependentAccount && !this.isLoggedIn) {
      await this.mainAccount.login(interactive);
    }
  }

  /** Logs in and runs the initial sync, like the app start does.
   * For the Login and Get Mail buttons and the account setup. */
  async loginAndStartup(interactive: boolean): Promise<void> {
    if (this.isDependentAccount) {
      await this.mainAccount.loginAndStartup(interactive); // it starts us up
      return;
    }
    await this.login(interactive);
    await this.syncOnStartup();
  }

  /** For setup only. Test that the login works. */
  async verifyLogin(): Promise<void> {
    await this.login(true);
  }

  async logout(): Promise<void> {
    await this.disconnect();
    await this.oAuth2?.logout();
  }

  /**
   * Used to request that any long-lived connections be disconnected,
   * e.g. due to app shutdown.
   */
  async disconnect(): Promise<void> {
  }

  /**
   * If the main account is loaded, this child account should be loaded automatically after.
   * If the main account is deleted, then this account should be deleted as well.
   * Child accounts share the OAuth2 login with their main accounts.
   * If this is e.g. a calendar that belongs to an email account,
   * this property references the email account.
   * Also used for SMTP accounts to reference the IMAP or POP3 account.
   */
  get mainAccount(): Account {
    return this._mainAccount;
  }
  set mainAccount(val: Account) {
    this._mainAccount = val;
  }
  get isDependentAccount(): boolean {
    return !!this._mainAccount;
  }
  dependsOn(main: Account): boolean {
    return this.mainAccount == main ||
      // e.g. when `main` fails to load once
      !this.mainAccount && this._mainAccountID == main.id;
  }
  dependentAccounts(): Collection<Account> {
    return getAllAccounts().filter(acc => acc.dependsOn(this));
  }
  initFromMainAccount(main: Account) {
    this.mainAccount = main;
    this.name = main.name;
    this.url = main.url;
    this.color = main.color;
    this.icon = main.icon;
    this.workspace = main.workspace;
    this.username = main.username;
  }
  /** Checks the available server resources and lists all possible sub-accounts that
   * a) could be found automatically and
   * b) are not yet `dependentAccounts()`. */
  async listPossibleSubAccounts(): Promise<ArrayColl<Account>> {
    return new ArrayColl<Account>();
  }
  get mayHaveSubAccounts(): boolean {
    return false;
  }

  /** The cookie store to use when loading this account. For `<webview partition="persist:...">` */
  get webSessionID(): string | null {
    return this.id;
  }

  /** User needs a software license to use this account */
  needsLicense(): boolean {
    return false;
  }

  /** Saves the config in this account to disk.
   * Does not save the contents, e.g. messages. */
  async save(): Promise<void> {
  }

  /** Saves the config in this account and its dependent accounts to disk. */
  async saveAll(): Promise<void> {
    await this.save(); // must be first, because of foreign key constraint
    for (let dependent of this.dependentAccounts()) {
      await dependent.save();
    }
  }

  /** Deletes this account from the configuration,
   * and likely deletes all local information from this account.
   * Does not delete the account on the server. */
  async deleteIt(): Promise<void> {
    try {
      await this.logout();
    } catch (ex) {
      logErrorToServer(ex); // e.g. server unreachable
    }
    for (let dependent of this.dependentAccounts()) {
      await dependent.deleteIt();
    }
  }

  fromConfigJSON(json: any) {
    assert(typeof (json) == "object", "Config must be a JSON object");
    (this.id as any) = sanitize.alphanumdash(json.id);
    assert(this.protocol == sanitize.alphanumdash(json.protocol), `Account object of wrong type passed in: data ${json.protocol} != class ${this.protocol}`);
    this.username = sanitize.string(json.username, null);
    this.authMethod = sanitize.integerRange(json.authMethod, 0, 20);
    this.url = sanitize.url(json.url, null);
    this.realname = sanitize.label(json.realname, appGlobal.me.name ?? "");
    this.name = sanitize.label(json.name, this.username);
    this.acceptBrokenTLSCerts = sanitize.boolean(json.acceptBrokenTLSCerts, false);
    this.loginOnStartup = sanitize.boolean(json.loginOnStartup, this.loginOnStartup);
    this.color = sanitize.nonemptystring(json.color, this.color);
    this.icon = sanitize.url(json.icon, null, ["data"]);
    this.workspace = getWorkspaceByID(sanitize.string(json.workspaceID, null));
  }
  toConfigJSON(): any {
    assert(this.id, "Need account ID to save");
    let json: any = {};
    json.id = this.id;
    json.protocol = this.protocol;
    json.name = this.name;
    json.realname = this.realname;
    json.username = this.username;
    json.authMethod = this.authMethod;
    json.url = this.url;
    json.workspaceID = this.workspace?.id;
    json.acceptBrokenTLSCerts = this.acceptBrokenTLSCerts;
    json.loginOnStartup = this.loginOnStartup;
    json.color = this.color;
    json.icon = this.icon;
    return json;
  }

  toString(): string {
    return `${this.protocol.toUpperCase()} account: ${this.name}, username ${this.username}, username ${this.username}, URL ${this.url}`;
  }
}

export enum AuthMethod {
  Unknown = 0,
  Password = 1,
  OAuth2 = 2,
  GSSAPI = 3,
  CRAMMD5 = 5,
  NTLM = 6,
  None = 7, // No authentication at all. E.g. SMTP
}

let lastID = 0;
let usedIDs = new Set<string>();
function findFreeAccountID(): string {
  let allAccounts = getAllAccounts();

  for (let i = ++lastID; true; i++) {
    let id = "account" + i + Math.floor(Math.random() * 100);
    if (allAccounts.find(acc => acc.id == id) || usedIDs.has(id)) {
      continue;
    }
    usedIDs.add(id);
    return id;
  }
}

export function getAllAccounts(): Collection<Account> {
  let allAccounts = new ArrayColl<Account>();
  allAccounts.addAll(appGlobal.emailAccounts);
  allAccounts.addAll(appGlobal.emailAccounts.map(acc => acc.outgoing).filterOnce(o => !!o));
  allAccounts.addAll(appGlobal.chatAccounts);
  allAccounts.addAll(appGlobal.addressbooks);
  allAccounts.addAll(appGlobal.calendars);
  allAccounts.addAll(appGlobal.meetAccounts);
  return allAccounts;
}

/**
 * Sets Account.mainAccount, for all accounts.
 * Called after all the account objects have been created.
 */
export function setMainAccounts(): void {
  let accounts = getAllAccounts();
  for (let account of accounts) {
    try {
      let mainID = account._mainAccountID;
      if (mainID && !account.mainAccount) {
        let main = accounts.find(acc => acc.id == mainID);
        if (main) {
          account.mainAccount = main;
        } else {
          internalError(new Error(`Account ${account.name} (${account.protocol}) lost its main account: Account ID ${mainID} did not load`));
        }
      }
    } catch (ex) {
      internalError(ex);
    }
  }
}

export class ConnectError extends SpecificError {
}

export class LoginError extends SpecificError {
  authFail = true;
  isUserError = true;
}

/**
 * Returns a preset account color that is not used by another account yet.
 * Once all preset colors are taken, falls back to any random color.
 */
export function unusedAccountColor(): string {
  let usedColors = getAllAccounts().contents.map(account => account.color);
  let unusedColors = accountColors.filter(color => !usedColors.includes(color));
  return unusedColors.length
    ? unusedColors[Math.floor(Math.random() * unusedColors.length)]
    : randomColor();
}

function randomColor(): string {
  return "#" + Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, "0");
}
