import { TCPAccount } from "../Abstract/TCPAccount";
import { unusedAccountColor } from "../Abstract/Account";
import { MailIdentity } from "./MailIdentity";
import { Folder, SpecialFolder, type MailShareCombinedPermissions, type MailShareIndividualPermissions } from "./Folder";
import type { EMail } from "./EMail";
import type { SMTPAccount } from "./SMTP/SMTPAccount";
import { ContactEntry } from "../Abstract/Person";
import type { PersonUID } from "../Abstract/PersonUID";
import { FilterRuleAction } from "./FilterRules/FilterRuleAction";
import type { ServerFilterRule } from "./FilterRules/ServerFilterRule";
import { OAuth2 } from "../Auth/OAuth2";
import { getProvider } from "../Auth/OAuth2Util";
import type { Provider } from "../Auth/OAuth2URLs";
import type { AttachmentStorage } from "../Abstract/Attachment";
import type { Calendar } from "../Calendar/Calendar";
import type { Addressbook } from "../Contacts/Addressbook";
import type { SetupInfo } from "./AutoConfig/SetupInfo";
import type { SearchEMail } from "./Store/SearchEMail";
import { appGlobal } from "../app";
import { appName } from "../build";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { AbstractFunction, assert, NotSupported } from "../util/util";
import { notifyChangedProperty } from "../util/Observable";
import { RunOnce } from "../util/flow/RunOnce";
import { Collection, ArrayColl } from 'svelte-collections';
import { gt } from "../../l10n/l10n";

export class MailAccount extends TCPAccount {
  readonly protocol: string = "mail";
  /** SMTP server
   * Only set for IMAP and POP3, but null for JMAP, Exchange etc. */
  @notifyChangedProperty
  _outgoing: SMTPAccount = null;
  spamStrategy: DeleteStrategy = DeleteStrategy.MoveToTrash;
  protected _inbox: Folder;
  readonly canSendOutgoingInvitations: boolean = true;
  /** @see `calendar` */
  protected calendarID: string;
  /** Where we got the config from, during setup */
  source: ConfigSource = null;
  storage: MailAccountStorage;
  /** Ways to store email content in RFC822 format. First storage will be used for reading. */
  contentStorage = new ArrayColl<MailContentStorage>();

  @notifyChangedProperty
  emailAddress: string;
  @notifyChangedProperty
  readonly identities = new ArrayColl<MailIdentity>();
  @notifyChangedProperty
  readonly filterRuleActions = new ArrayColl<FilterRuleAction>();
  /** To find the server rules that the user removed */
  protected knownServerFilterRuleIDs = new Set<string>();
  /** Why the user cannot change the rules on the server. null, if they can. */
  @notifyChangedProperty
  serverFilterRulesReadOnlyReason: string | null = null;
  setup: SetupInfo;

  readonly rootFolders: Collection<Folder> = new ArrayColl<Folder>();
  readDBRunOnce = new RunOnce();

  async syncOnStartup() {
    await super.syncOnStartup();
    await this.listFolders();
    assert(this.inbox, gt`Inbox not found`);
    await this.inbox.getNewMessages();
  }

  async readFromDB(): Promise<void> {
    await this.readDBRunOnce.runOnce(async () => {
      await this.storage.readFolderHierarchy(this);
    });
  }

  async listFolders(): Promise<void> {
    throw new AbstractFunction();
  }

  getAllFolders(): ArrayColl<Folder> {
    let allFolders = new ArrayColl<Folder>();
    function iterateFolders(folders: Collection<Folder>) {
      allFolders.addAll(folders);
      for (let folder of folders) {
        iterateFolders(folder.subFolders);
      }
    }
    iterateFolders(this.rootFolders);
    return allFolders;
  }
  findFolder(findFunc: (folder: Folder) => boolean): Folder | null {
    return findSubFolderFromList(this.rootFolders, findFunc);
  }

  get inbox(): Folder | null {
    // Cache only the real inbox: While we are still reading the folders,
    // the first folder that we get is often not the inbox.
    this._inbox ??= this.findFolder(folder => folder.specialFolder == SpecialFolder.Inbox);
    return this._inbox ?? this.rootFolders.first;
  }

  get outgoing(): SMTPAccount {
    return this._outgoing;
  }
  set outgoing(smtp: SMTPAccount) {
    this._outgoing = smtp;
    if (smtp && smtp.mainAccount != this) {
      smtp.mainAccount = this;
    }
  }

  /** When accepting an incoming invitation, put the meeting in this calendar, by default.
   * The user can still change it in the dropdown. */
  get calendar(): Calendar | null {
    // Don't store the fallback: a calendar picked while the account's own
    // calendars were not known yet would stay the default forever.
    let available = this.calendarsAvailable;
    return available.find(cal => cal.id == this.calendarID) ?? available.first;
  }
  set calendar(cal: Calendar | null) {
    this.calendarID = cal?.id;
    this.save()
      .catch(this.errorCallback);
  }
  get calendarsAvailable(): Collection<Calendar> {
    let dependentCalendars = this.dependentAccounts().filterObservable(acc => !!(acc as Calendar).events) as ArrayColl<Calendar>;
    return dependentCalendars?.hasItems
      ? dependentCalendars
      : appGlobal.calendars.filterObservable(cal => cal.canAcceptAnyInvitation);
  }

  /**
   * Send the email purely on the protocol level,
   * and save it in the Sent folder. Nothing else.
   * All higher-level send preparations (signature, encryption etc.)
   * are done in `ComposeActions.send()`.
   */
  async send(email: EMail): Promise<void> {
    throw new AbstractFunction();
  }

  /** Create a folder on the top level, sibling of Inbox.
   * @see Folder.createSubFolder() */
  async createToplevelFolder(name: string): Promise<Folder> {
    let folder = this.newFolder();
    folder.name = name;
    folder.parent = null;
    this.rootFolders.add(folder);
    return folder;
  }

  newFolder(): Folder {
    return new Folder(this);
  }

  newIdentity(): MailIdentity {
    return new MailIdentity(this);
  }

  /** Lets the server search this account, also emails that we did not download.
   * @returns null, if this protocol has no server-side search */
  newSearch(): SearchEMail | null {
    return null;
  }

  newEMailFrom(): EMail {
    let folder = this.getSpecialFolder(SpecialFolder.Sent);
    let email = folder.newEMail();
    email.compose.generateMessageID();
    email.loadedBody = true;
    email.from.emailAddress = this.emailAddress;
    email.from.name = this.realname;
    return email;
  }

  async save(): Promise<void> {
    await super.save();
    console.log("mail account save", this.protocol, this.name, this, "outgoing", this.outgoing, "mainaccount", this.mainAccount, "storage", this.storage);
    await this.storage?.saveAccount(this);
  }

  async deleteIt(): Promise<void> {
    await super.deleteIt();
    await this.storage?.deleteAccount(this);
    appGlobal.emailAccounts.remove(this);
  }

  isMyEMailAddress(emailAddress: string): boolean {
    return this.emailAddress?.toLowerCase() == emailAddress.toLowerCase() ||
      this.identities.some(id => id.isEMailAddress(emailAddress));
  }

  /**
   * @returns `MailIdentity` of *this* account, for the given email address.
   * @see also global function `findIdentityForEMailAddress()`, which searches all accounts. */
  findIdentityForEMailAddress(emailAddress: string): MailIdentity | null {
    for (let identity of this.identities) {
      if (identity.isEMailAddress(emailAddress)) {
        return identity;
      }
    }
    return null;
  }

  /** Get the `specialFolder` in this account. */
  getSpecialFolder(specialFolder: SpecialFolder): Folder {
    let folder = this.getAllFolders().find(folder => folder.specialFolder == specialFolder);
    if (folder) {
      return folder;
    }
    if (specialFolder == SpecialFolder.Sent) {
      return this.getSpecialFolder(SpecialFolder.Inbox);
    }
    if (specialFolder == SpecialFolder.Drafts) {
      return this.getSpecialFolder(SpecialFolder.Sent);
    }
    return this.rootFolders.first;
  }

  provider(): Provider | null {
    return getProvider(this);
  }

  canShareWithPersons(): boolean {
    return false;
  }

  /** The access levels that this server can grant to other users.
   * Ordered from least to most permission. Used by @see `addSharedPerson()` */
  get sharePermissionLevels(): MailShareCombinedPermissions[] {
    return [];
  }

  /** The accounts of other users that the server lists for us, set up here or not.
   * Only where the server lists them, e.g. JMAP.
   * Otherwise, the user manually enters the colleague's email address, and we use `findSharedFolders()`. */
  async availableSharedAccounts(): Promise<ArrayColl<PersonUID>> {
    return new ArrayColl<PersonUID>();
  }

  /** Which of the `distinguishedIDs` of `person`'s account we may access. */
  async findSharedFolders(person: PersonUID, distinguishedIDs: string[]): Promise<string[]> {
    return [];
  }

  /** Adds the mails that `person` shared with us as an account of their own. */
  async addSharedFolders(person: PersonUID, sharedFolderRoot: "msgfolderroot" | "inbox"): Promise<MailAccount> {
    throw new AbstractFunction();
  }

  async addSharedAddressbook(person: PersonUID): Promise<Addressbook> {
    throw new AbstractFunction();
  }

  async addSharedCalendar(person: PersonUID): Promise<Calendar> {
    throw new AbstractFunction();
  }

  /** So that the user does not mistake another person's mails for ours */
  colorForSharedAccount(person: PersonUID): string {
    return this.dependentAccounts().find(acc => acc.username == person.emailAddress)?.color ??
      unusedAccountColor();
  }

  async getSharedPersons(): Promise<ArrayColl<PersonUID>> {
    return new ArrayColl<PersonUID>();
  }

  async deleteSharedPerson(Person: PersonUID) {
  }

  async addSharedPerson(person: PersonUID, mailFolder: Folder | null, includeSubfolders: boolean, access: MailShareCombinedPermissions, ...permissions: MailShareIndividualPermissions[]) {
  }

  /** Whether the server can run filter rules. @see `FilterRuleAction.server` */
  get canServerFilterRules(): boolean {
    return false;
  }

  /** @param json As the server sent the rule. null for a new rule. */
  newServerFilterRule(json: any): ServerFilterRule {
    throw new AbstractFunction();
  }

  /** Fetches the rules from the server, puts them into `filterRuleActions`
   * in place of the server rules that we knew, and saves them locally. */
  async refreshServerFilterRules(): Promise<void> {
    if (!this.canServerFilterRules) {
      return;
    }
    // Update our server rules with any changes from the server.
    // Collect them in the server's new order, but include any new server rules too.
    let fetched: FilterRuleAction[] = [];
    for (let serverRule of await this.fetchServerFilterRules()) {
      let known = this.filterRuleActions.find(rule => rule.server && rule.serverID == serverRule.serverID);
      if (known) {
        known.fromJSON(serverRule.toJSON());
      }
      fetched.push(known ?? serverRule);
    }
    this.knownServerFilterRuleIDs = new Set(fetched.map(rule => rule.serverID));
    // Insert the updated rules back into the full list in the same places as the server rules were before.
    let rules: FilterRuleAction[] = [];
    for (let rule of this.filterRuleActions) {
      if (rule.server && rule.serverID) {
        let next = fetched.shift();
        if (next) {
          rules.push(next);
        }
        continue;
      }
      rules.push(rule);
    }
    rules.push(...fetched);
    this.filterRuleActions.replaceAll(rules);
    await this.save();
  }

  /** Creates, changes and deletes the rules on the server,
   * as the server rules in `filterRuleActions` say. */
  async saveServerFilterRules(): Promise<void> {
    if (!this.canServerFilterRules) {
      return;
    }
    let rules = this.filterRuleActions.contents.filter(rule => rule.server);
    let movedHere = this.filterRuleActions.find(rule => !rule.server && rule.serverRule?.unknownParts.length > 0);
    if (movedHere) {
      throw new NotSupported(gt`${appName} cannot run all parts of the rule ${movedHere.name}`);
    }
    let deletedIDs = [...this.knownServerFilterRuleIDs].filter(id => !rules.some(rule => rule.serverID == id));
    for (let rule of this.filterRuleActions) {
      if (rule.serverID && !rule.server) {
        rule.serverID = null;
        rule.serverJSON = null;
      }
    }
    try {
      await this.uploadServerFilterRules(rules, deletedIDs);
    } finally {
      await this.save(); // the IDs of the created rules
    }
    await this.refreshServerFilterRules();
  }

  /** @returns The rules on the server, in the order in which the server runs them */
  protected async fetchServerFilterRules(): Promise<FilterRuleAction[]> {
    throw new AbstractFunction();
  }

  /** Changes only the rules that changed, and sets the `serverID` of the created rules.
   * @param rules All server rules, in the order in which the server should run them
   * @param deletedIDs The server rules that the user removed */
  protected async uploadServerFilterRules(rules: FilterRuleAction[], deletedIDs: string[]): Promise<void> {
    throw new AbstractFunction();
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.emailAddress = sanitize.emailAddress(json.emailAddress);
    this.identities.clear();
    for (let idJSON of sanitize.array(json.identities, [])) {
      try {
        let identity = this.newIdentity();
        identity.fromConfigJSON(idJSON);
        this.identities.add(identity);
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
    this.filterRuleActions.clear();
    for (let filterJSON of sanitize.array(json.filterRuleActions, [])) {
      try {
        let rule = new FilterRuleAction(this);
        rule.fromJSON(filterJSON);
        this.filterRuleActions.add(rule);
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
    this.knownServerFilterRuleIDs = new Set(this.filterRuleActions.contents
      .filter(rule => rule.server && rule.serverID)
      .map(rule => rule.serverID));
    if (json.oAuth2) {
      this.oAuth2 = OAuth2.fromConfigJSON(json.oAuth2, this);
      this.oAuth2.subscribe(() => this.notifyObservers());
    }
    // On startup, the calendar might not be read yet, so we store the ID and resolve in the getter.
    this.calendarID = sanitize.alphanumdash(json.calendarID, null);

    if (!appGlobal.me.name && this.realname) {
      appGlobal.me.name = this.realname;
    }
    if (!appGlobal.me.emailAddresses.find(c => c.value == this.emailAddress)) {
      appGlobal.me.emailAddresses.add(new ContactEntry(this.emailAddress, "account"));
    }
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.identities = this.identities.contents.map(id => id.toConfigJSON());
    json.filterRuleActions = this.filterRuleActions.contents.map(rule => rule.toJSON());
    json.oAuth2 = this.oAuth2?.toConfigJSON();
    json.emailAddress = this.emailAddress;
    json.calendarID = this.calendarID;
    return json;
  }

  /** Fills this object with the config values from the other config */
  cloneFrom(other: MailAccount) {
    this.name = other.name;
    this.url = other.url;
    this.hostname = other.hostname;
    this.port = other.port;
    this.tls = other.tls;
    this.authMethod = other.authMethod;
    this.username = other.username;
    this.password = other.password;
    this.emailAddress = other.emailAddress;
    this.realname = other.realname;
    this.calendarID = other.calendarID;

    // objects
    this.oAuth2 = other.oAuth2;
    if (this.oAuth2) {
      // It logs in as us now, and its login web session is `webSessionID` = our account ID
      this.oAuth2.account = this;
    }
    this.identities.addAll(other.identities);
  }

  toDebugString() {
    return `${this.protocol.toUpperCase()} account, name ${this.name}, ID ${this.id}, host ${this.hostname}:${this.port}, URL ${this.url}, username ${this.username}, email ${this.emailAddress}`;
  }

  toString(): string {
    return this.toDebugString();
  }
}

function findSubFolderFromList(folders: Collection<Folder>, findFunc: (folder: Folder) => boolean): Folder | null {
  for (let folder of folders) {
    if (findFunc(folder)) {
      return folder;
    }
    let sub = findSubFolderFromList(folder.subFolders, findFunc);
    if (sub) {
      return sub;
    }
  }
  return null;
}

export type ConfigSource = "ispdb" | "autoconfig-isp" | "autodiscover-xml" | "autodiscover-json" | "guess" | "manual" | "harddisk" | "builtin" | null;

export interface MailAccountStorage {
  saveAccount(account: MailAccount): Promise<void>;
  deleteAccount(account: MailAccount): Promise<void>;
  readFolderHierarchy(account: MailAccount): Promise<void>;
  saveFolder(folder: Folder): Promise<void>;
  saveFolderProperties(folder: Folder): Promise<void>;
  deleteFolder(folder: Folder): Promise<void>;
  readMessage(email: EMail): Promise<void>;
  readMessageWritableProps(email: EMail): Promise<void>;
  readMessageBody(email: EMail): Promise<void>;
  saveMessage(email: EMail): Promise<void>;
  saveMessages(emails: Collection<EMail>): Promise<void>;
  saveMessageWritableProps(email: EMail): Promise<void>;
  saveMessageTags(email: EMail): Promise<void>;
  deleteMessage(email: EMail): Promise<void>;
  readAllMessages(folder: Folder, limit?: number, startWith?: number): Promise<void>;
  readAllMessagesMainProperties(folder: Folder, limit?: number, startWith?: number): Promise<void>;
}

export interface MailContentStorage extends AttachmentStorage {
  save(email: EMail): Promise<void>;
  read(email: EMail): Promise<void>;
  deleteIt(email: EMail): Promise<void>;
}

export enum DeleteStrategy {
  DeleteImmediately = 1,
  Flag = 2,
  MoveToTrash = 3,
}
