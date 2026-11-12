import { ExchangeMailAccount } from "../EWS/ExchangeMailAccount";
import { AuthMethod } from "../../Abstract/Account";
import { TLSSocketType } from "../../Abstract/TCPAccount";
import type { EMail } from "../EMail";
import type { Folder } from "../Folder";
import { kMaxCount, ActiveSyncFolder, FolderType } from "./ActiveSyncFolder";
import { ActiveSyncError } from "./ActiveSyncError";
import { CreateMIME } from "../SMTP/CreateMIME";
import { newAddressbookForProtocol } from "../../Contacts/AccountsList/Addressbooks";
import { ActiveSyncGAL } from "../../Contacts/ActiveSync/ActiveSyncGAL";
import type { ActiveSyncAddressbook } from "../../Contacts/ActiveSync/ActiveSyncAddressbook";
import { newCalendarForProtocol} from "../../Calendar/AccountsList/Calendars";
import type { ActiveSyncCalendar } from "../../Calendar/ActiveSync/ActiveSyncCalendar";
import { getOAuth2BuiltIn } from "../../Auth/OAuth2Util";
import { request2WBXML, WBXML2JSON } from "./WBXML";
import { ConnectError, LoginError } from "../../Abstract/Account";
import { ensureLicensed } from "../../util/LicenseClient";
import { appGlobal } from "../../app";
import { Throttle } from "../../util/flow/Throttle";
import { Semaphore } from "../../util/flow/Semaphore";
import { RunOnce } from "../../util/flow/RunOnce";
import { isTransientError } from "../../util/netUtil";
import { ensureArray, assert, NotSupported } from "../../util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { ArrayColl } from "svelte-collections";
import { gt } from "../../../l10n/l10n";

export class ActiveSyncAccount extends ExchangeMailAccount {
  readonly protocol: string = "activesync";
  protocolVersion: string;
  protected readonly pingsMRU = new ArrayColl<ActiveSyncPingable>();
  protected maxPings = kMaxCount;
  protected heartbeat = 60;
  protected retries = 0;
  protected listening = false;
  protected policyKey: Promise<string> | string;
  protected syncKeyBusy: Promise<any> | null;
  protected throttle = new Throttle(50, 1);
  protected semaphore = new Semaphore(20);
  protected loginRunOnce = new RunOnce();
  protected startupRunOnce = new RunOnce();

  constructor() {
    super();
    this.policyKey = this.getStorageItem("policy_key");
  }

  newFolder(): ActiveSyncFolder {
    return new ActiveSyncFolder(this);
  }

  /** ActiveSync `Search` identifies each hit only with a `LongId` that is valid
   * for that one result set, never with the `ServerId` that we store. So we could
   * not tell which of the emails that we already have it found, and list them twice. */
  newSearch(): null {
    return null;
  }

  /**
   * Currently storing the folder sync key, protocol version and policy key
   * (if any) in local storage. Should this migrate to configJSON?
   */
  getStorageItem(key: string) {
    return localStorage.getItem(`mail.${this.id}.${key}`);
  }

  setStorageItem(key: string, value: string) {
    localStorage.setItem(`mail.${this.id}.${key}`, value);
  }

  get isLoggedIn(): boolean {
    return this.authMethod != AuthMethod.OAuth2 || this.oAuth2?.isLoggedIn;
  }

  async login(interactive: boolean): Promise<void> {
    await this.loginRunOnce.runOnce(async () => {
      await ensureLicensed();
      await super.login(interactive);
      if (this.authMethod == AuthMethod.OAuth2) {
        this.oAuth2 ??= getOAuth2BuiltIn(this);
        assert(this.oAuth2, gt`Could not find OAuth2 config for ${this.hostname}`);
        this.oAuth2.subscribe(() => {
          this.notifyObservers();
          this.notifyObserversOfSubaccounts();
        });
        await this.oAuth2.login(interactive);
      }
      this.protocolVersion = this.getStorageItem("protocolVersion");
      if (!this.protocolVersion) {
        await this.checkProtocolVersion();
      }
      if (this.protocolVersion == "14.0") {
        let request = {
          DeviceInformation: {
            Set: {
              Model: "Computer",
            },
          },
        };
        let response = await this.callEAS("Settings", request);
        if (response.DeviceInformation.Status != "1") {
          throw new ActiveSyncError("Settings", response.DeviceInformation.Status, this);
        }
      }
    });
  }

  async syncOnStartup() {
    await this.startupRunOnce.runOnce(async () => {
      try {
        await super.syncOnStartup();

        // `listFolders()` will subscribe to new user-added addressbooks and calendars

        if (!this.isDependentAccount &&
            !appGlobal.searchOnlyAddressbooks.some(ab => ab.mainAccount == this)) {
          appGlobal.searchOnlyAddressbooks.add(new ActiveSyncGAL(this));
        }

        // ActiveSync doesn't have streaming notifications, instead it
        // provides the Ping operation which will tell us when a pingable
        // has gone out of sync. This only makes sense once the pingable
        // is in sync, so each pingable registers with the account when
        // it's ready to be specified in the Ping operation.
      } finally { // Even when the mail folders failed, so that calendar and addressbook still work
        await this.startupDependentAccounts();
      }
    });
  }

  async disconnect() {
    // Ends the Ping loop after the current long poll returns
    this.pingsMRU.clear();
    let galAB = appGlobal.searchOnlyAddressbooks.find(ab => ab.mainAccount == this);
    if (galAB) {
      appGlobal.searchOnlyAddressbooks.remove(galAB);
    }
  }

  needsLicense(): boolean {
    return true;
  }

  async send(email: EMail): Promise<void> {
    if (email.bcc.hasItems) {
      throw new NotSupported("ActiveSync does not support BCC");
    }
    let request = {
      ClientId: await this.nextClientID(),
      SaveInSentItems: {},
      Mime: await CreateMIME.getMIME(email),
    };
    await this.callEAS("SendMail", request);
  }

  /**
   * As per ActiveSync documentation, the ClientID can be a simple counter
   * incremented for each new message. (Except that everything is a string in
   * ActiveSync of course.)
   */
  nextClientID(): string {
    let clientID = String(1 + Number(localStorage.getItem("active_sync.client_id")));
    localStorage.setItem("active_sync.client_id", clientID);
    return clientID;
  }

  /** For setup only. Test that the login works, and get the protocol version. */
  async verifyLogin(): Promise<void> {
    await this.checkProtocolVersion();
  }

  /**
   * Asks the server, with an OPTIONS request, which ActiveSync versions it
   * speaks, and uses the newest one that we both support. Every request states
   * the version, so we need it before any other call, i.e. during the login.
   */
  async checkProtocolVersion(): Promise<void> {
    let options: any = {
      headers: {
        "Cookie-Bypass": `DefaultAnchorMailbox=${encodeURI(this.emailAddress)}`, // required for Hotmail
      },
      method: "OPTIONS",
    };
    if (this.authMethod == AuthMethod.OAuth2) {
      this.oAuth2 ??= getOAuth2BuiltIn(this);
      assert(this.oAuth2, gt`Could not find OAuth2 config for ${this.hostname}`);
      await this.oAuth2.login(true);
      options.headers.Authorization = this.oAuth2.authorizationHeader;
    } else {
      options.headers.Authorization = `Basic ${btoa(unescape(encodeURIComponent(`${this.username}:${this.password}`)))}`;
    }
    let response = await fetch(this.url, options);
    if (response.ok) {
      let supported = response.headers.get("MS-ASProtocolVersions");
      assert(supported, gt`The server did not answer with the ActiveSync versions that it supports. Please check the server URL.`);
      let versions = supported.split(",");
      if (versions.includes("16.1")) {
        this.protocolVersion = "16.1";
        this.setStorageItem("protocolVersion", this.protocolVersion);
        return;
      } else if (versions.includes("14.1")) {
        this.protocolVersion = "14.1";
        this.setStorageItem("protocolVersion", this.protocolVersion);
        return;
      } else if (versions.includes("14.0")) {
        this.protocolVersion = "14.0";
        this.setStorageItem("protocolVersion", this.protocolVersion);
        return;
      }
      throw new Error(`ActiveSync version(s) ${supported} not supported`);
    }
    if (response.status == 401) {
      const repeat = async () => {
        this.retries++;
        await this.checkProtocolVersion(); // repeat the call
        this.retries = 0;
      }
      if (this.retries) {
        let ex = Error(`HTTP ${response.status} ${response.statusText}`);
        throw new LoginError(ex, gt`Login failed`);
      } else if (this.oAuth2) {
        await this.oAuth2.reset();
        await this.oAuth2.login(false); // will throw error, if interactive login is needed
        await repeat();
        return;
      } else if (!/\bBasic\b/.test(response.headers.get("WWW-Authenticate"))) {
        throw this.fatalError = new ConnectError(null,
          "Unsupported authentication protocol(s): " + response.headers.get("WWW-Authenticate"));
      } else {
        throw this.fatalError = new LoginError(null,
          "Password incorrect");
      }
    }
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  /**
   * The device ID only needs to be unique per device,
   * so we only have to generate it once.
   */
  getDeviceID(): string {
    let deviceID = localStorage.getItem("active_sync.device_id");
    if (deviceID) {
      return deviceID;
    }
    let array = new Uint32Array(4);
    crypto.getRandomValues(array);
    deviceID = Array.from(array, value => value.toString(16).padStart(8, "0")).join("");
    localStorage.setItem("active_sync.device_id", deviceID);
    return deviceID;
  }

  /**
   * Make HTTP call to server
   * @returns JSON returned from the server
   */
  async callEAS(aCommand: string, aRequest: any, aOptions: any = {}): Promise<any> {
    let url = new URL(this.url);
    url.searchParams.append("Cmd", aCommand);
    url.searchParams.append("User", this.username);
    url.searchParams.append("DeviceID", this.getDeviceID());
    url.searchParams.append("DeviceType", "UniversalOutlook");
    let heartbeat = aOptions.heartbeat ?? 0;
    let wbxml = await request2WBXML({ [aCommand]: aRequest });
    let options: any = {
      body: wbxml,
      headers: {
        "Content-Type": "application/vnd.ms-sync.wbxml",
        "MS-ASProtocolVersion": this.protocolVersion,
        "Cookie-Bypass": `DefaultAnchorMailbox=${encodeURI(this.emailAddress)}`, // required for Hotmail
      },
      method: "POST",
      signal: AbortSignal.timeout(heartbeat * 1000 + 25000), // extra timeout for Ping commands
    };
    if (this.oAuth2) {
      if (!this.oAuth2.isLoggedIn) {
        await this.oAuth2.login(false);
      }
      options.headers.Authorization = this.oAuth2.authorizationHeader;
    } else {
      options.headers.Authorization = `Basic ${btoa(unescape(encodeURIComponent(`${this.username}:${this.password}`)))}`;
    }
    if (await this.policyKey) {
      options.headers["X-MS-PolicyKey"] = await this.policyKey;
    }
    await this.throttle.throttle();
    let lock = await this.semaphore.lock();
    let response: any;
    try {
      response = await fetch(url, options);
    } finally {
      lock.release();
    }
    this.fatalError = null;
    if (response.ok) {
      // response.bytes() not supported yet. This ctor does not copy, but creates another view.
      let bytes = new Uint8Array(await response.arrayBuffer());
      // ActiveSync short cut for when there are no changes to sync
      if (!bytes.length) {
        return null;
      }
      let wbxmljs = WBXML2JSON(bytes);
      if (wbxmljs.Status > 140 && wbxmljs.Status < 145 && aCommand != "Provision") {
        // We need to provision (or re-provision). Use a Promise so that
        // parallel calls wait for it too.
        this.policyKey = this.provision();
        options.headers["X-MS-PolicyKey"] = await this.policyKey;
        response = await fetch(url, options);
        bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length) {
          return null;
        }
        wbxmljs = WBXML2JSON(bytes);
      }
      // The Ping command has its own status codes for some reason.
      if (!wbxmljs.Status || wbxmljs.Status == "1" || aCommand == "Ping") {
        this.retries = 0;
        return wbxmljs;
      }
      if (this.isThrottleError(wbxmljs.Status)) {
        aOptions.heartbeat = heartbeat;
        return await this.callEAS(aCommand, aRequest, aOptions);
      }
      this.throttle.waitForSecond(1);
      throw new ActiveSyncError(aCommand, wbxmljs.Status, this);
    }
    if (response.status == 401) {
      const repeat = async () => {
        aOptions.isRepeating = true;
        return await this.callEAS(aCommand, aRequest, aOptions); // repeat the call
      }
      if (aOptions.isRepeating) {
        let ex = Error(`HTTP ${response.status} ${response.statusText}`);
        throw new LoginError(ex, gt`Login failed`);
      } else if (this.oAuth2) {
        await this.oAuth2.reset();
        await this.oAuth2.login(false); // will throw error, if interactive login is needed
        return repeat();
      } else if (!/\bBasic\b/.test(response.headers.get("WWW-Authenticate"))) {
        throw this.fatalError = new ConnectError(null,
          "Unsupported authentication protocol(s): " + response.headers.get("WWW-Authenticate"));
      } else {
        throw this.fatalError = new LoginError(null,
          "Password incorrect");
      }
    }
    this.throttle.waitForSecond(1);
    if (response.headers.get("Retry-After")) {
      throw new Error(`The server is overloaded. Please try again after ${response.headers.get("Retry-After")} seconds.`);
    }
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  isThrottleError(status: string): boolean {
    if (status == "111") { // Retryable server error
      if (++this.retries > 5) {
        return false;
      }
      this.throttle.waitForSecond(5);
      return true;
    }
    this.retries = 0;
    return false;
  }

  /**
   * Obtain a new policy key.
   */
  async provision(): Promise<string> {
    let request: any = {
      DeviceInformation: {
        Set: {
          Model: "Computer",
        },
      },
      Policies: {
        Policy: {
          PolicyType: "MS-EAS-Provisioning-WBXML",
        },
      },
    };
    if (this.protocolVersion == "14.0") {
      delete request.DeviceInformation;
    }
    let policy = await this.callEAS("Provision", request);
    if (policy.Policies.Policy.Status != "1") {
      throw new ActiveSyncError("Provision", policy.Policies.Policy.Status, this);
    }
    delete request.DeviceInformation;
    request.Policies.Policy.PolicyKey = policy.Policies.Policy.PolicyKey;
    request.Policies.Policy.Status = "1";
    policy = await this.callEAS("Provision", request);
    if (policy.Policies.Policy.Status != "1") {
      throw new ActiveSyncError("Provision", policy.Policies.Policy.Status, this);
    }
    let policyKey = policy.Policies.Policy.PolicyKey;
    this.setStorageItem("policy_key", policyKey);
    return policyKey;
  }

  /**
   * Perform a folder request (discovery or modification).
   * Each request changes the global sync key, so they must be queued in turn.
   */
  async queuedRequest(command: string, request: any, callback?: (response: any) => Promise<void>): Promise<any> {
    while (this.syncKeyBusy) try {
      await this.syncKeyBusy;
    } catch (ex) {
      // If the function currently holding the sync key throws, we don't care.
    }
    try {
      this.syncKeyBusy = this.makeRequest(command, request, callback);
      return await this.syncKeyBusy;
    } finally {
      this.syncKeyBusy = null;
    }
  }

  protected async makeRequest(command: string, request: any, callback?: (response: any) => Promise<void>): Promise<any> {
    try {
      // The SyncKey must be the first element of the request.
      request = Object.assign({ SyncKey: this.getStorageItem("sync_key") || "0" }, request);
      let response = await this.callEAS(command, request);
      if (response) { // null means an empty response body: nothing changed
        await callback?.(response);
        this.setStorageItem("sync_key", response.SyncKey);
      }
      return response;
    } catch (ex) {
      if (callback && ex.code == kFolderSyncKeyError) {
        // Try to resync from start.
        let response = await this.callEAS(command, { SyncKey: "0" });
        response.errorCode = ex.code;
        await callback(response);
        this.setStorageItem("sync_key", response.SyncKey);
        return response;
      }
      throw ex;
    }
  }

  async listFolders(): Promise<void> {
    await this.storage.readFolderHierarchy(this);
    if (this.rootFolders.isEmpty) {
      this.setStorageItem("sync_key", "0");
    }

    let missingFolders = new ArrayColl<Folder>();
    await this.queuedRequest("FolderSync", {}, async response => {
      if (response.errorCode == kFolderSyncKeyError) {
        // We're syncing from scratch, so we may have stale folders.
        missingFolders = this.getAllFolders();
      }
      for (let change of ensureArray(response.Changes?.Add).concat(ensureArray(response.Changes?.Update))) {
        try {
          switch (change.Type) {
          case FolderType.Inbox:
          case FolderType.Drafts:
          case FolderType.Trash:
          case FolderType.Sent:
          case FolderType.Outbox:
          case FolderType.OtherSpecialFolder:
          case FolderType.UserFolder:
            let folder = this.findFolderById(sanitize.nonemptystring(change.ServerId)) || this.newFolder();
            folder.fromWBXML(change);
            let parent = this.findFolderById(sanitize.nonemptystring(change.ParentId));
            if (parent != folder.parent) {
              folder.removeFromParent();
              folder.parent = parent;
            }
            folder.addToParent();
            await folder.save();
            missingFolders.remove(folder);
            break;
          case FolderType.Contacts:
          case FolderType.UserContacts:
            let isMainAddressbook = change.Type == FolderType.Contacts;
            let addressbook = appGlobal.addressbooks.find((addressbook: ActiveSyncAddressbook) => addressbook.mainAccount == this && addressbook.serverID == change.ServerId) as ActiveSyncAddressbook | null;
            if (!addressbook) {
              addressbook = newAddressbookForProtocol("addressbook-activesync") as ActiveSyncAddressbook;
              addressbook.initFromMainAccount(this);
              addressbook.serverID = sanitize.nonemptystring(change.ServerId);
              appGlobal.addressbooks.add(addressbook);
            }
            if (!isMainAddressbook) {
              // Rename and new address books
              addressbook.name = sanitize.nonemptylabel(change.DisplayName, addressbook.name);
            }
            // ActiveSync doesn't list all folders, only the changed ones.
            // So, if we're here, then the address book changed.
            await addressbook.save();
            break;
          case FolderType.Calendar:
          case FolderType.UserCalendar:
            let isMainCalendar = change.Type == FolderType.Calendar;
            let calendar = appGlobal.calendars.find((calendar: ActiveSyncCalendar) => calendar.mainAccount == this && calendar.serverID == change.ServerId) as ActiveSyncCalendar | null;
            if (!calendar) {
              calendar = newCalendarForProtocol("calendar-activesync") as ActiveSyncCalendar;
              calendar.initFromMainAccount(this);
              calendar.serverID = sanitize.nonemptystring(change.ServerId);
              appGlobal.calendars.add(calendar);
            }
            if (isMainCalendar) {
              calendar.useForInvitations = true;
            } else {
              calendar.name = sanitize.nonemptylabel(change.DisplayName, calendar.name);
            }
            await calendar.save();
            break;
          case FolderType.Tasks:
          case FolderType.UserTasks:
            // Mustang doesn't support tasks yet, fortunately.
            break;
          }
        } catch (ex) {
          this.errorCallback(ex);
        }
      }
      for (let deletion of ensureArray(response.Changes?.Delete)) {
        try {
          let folder = this.findFolderById(sanitize.nonemptystring(deletion.ServerId));
          if (folder) {
            this.removePingable(folder);
            await this.storage.deleteFolder(folder);
            folder.removeFromParent();
          }
          let addressbook = appGlobal.addressbooks.find((addressbook: ActiveSyncAddressbook) => addressbook.mainAccount == this && addressbook.serverID == deletion.ServerId) as ActiveSyncAddressbook | undefined;
          if (addressbook) {
            this.removePingable(addressbook);
            await addressbook.deleteIt();
          }
          let calendar = appGlobal.calendars.find((calendar: ActiveSyncCalendar) => calendar.mainAccount == this && calendar.serverID == deletion.ServerId) as ActiveSyncCalendar | undefined;
          if (calendar) {
            this.removePingable(calendar);
            await calendar.deleteIt();
          }
        } catch (ex) {
          this.errorCallback(ex);
        }
      }
    });
    // Iterate from deepest to shallowest
    for (let folder of missingFolders.reverse()) {
      this.removePingable(folder as ActiveSyncFolder);
      await folder.deleteItLocally();
    }
  }

  findFolderById(id: string): ActiveSyncFolder | null {
    return this.findFolder(folder => folder.id == id) as ActiveSyncFolder | null;
  }

  addPingable(pingable: ActiveSyncPingable) {
    // Make this the most recent pingable.
    this.pingsMRU.remove(pingable);
    this.pingsMRU.add(pingable);
    if (!this.listening) {
      this.listenForPings()
        .catch(this.errorCallback);
    }
  }

  removePingable(pingable: ActiveSyncPingable) {
    this.pingsMRU.remove(pingable);
  }

  trimPings() {
    while (this.pingsMRU.length > this.maxPings) {
      this.removePingable(this.pingsMRU.find(pingable => pingable.folderClass == "Email"));
    }
  }

  async listenForPings() {
    try {
      this.listening = true;
      let lastAttempt = 0;
      let reconnectThrottle = new Throttle(1, 10);
      while (this.pingsMRU.hasItems) {
        try {
          lastAttempt = Date.now();
          let request = {
            HeartbeatInterval: String(this.heartbeat),
            Folders: {
              Folder: this.pingsMRU.contents.map(pingable => ({ Id: pingable.serverID, Class: pingable.folderClass })),
            },
          };
          let response = await this.callEAS("Ping", request, { heartbeat: this.heartbeat });
          if (!response) { // empty response body, nothing changed
            continue;
          }
          switch (response.Status) {
          case "1":
            continue;
          case "2":
            for (let serverID of ensureArray(response.Folders.Folder)) {
              let pingable = this.pingsMRU.find(pingable => pingable.serverID == serverID);
              await pingable?.ping();
            }
            continue;
          case "5":
            this.heartbeat = sanitize.integer(response.HeartbeatInterval);
            continue;
          case "6":
            this.maxPings = sanitize.integer(response.MaxFolders);
            this.trimPings();
            continue;
          case "7":
            await this.listFolders();
            continue;
          case "8": // Temporary server error
            this.throttle.waitForSecond(5);
            continue;
          default:
            throw new ActiveSyncError("Ping", response.Status, this);
          }
        } catch (ex) {
          if (Date.now() - lastAttempt < 10 * 1000 && !isTransientError(ex)) {
            // Failed right away: give up, to avoid hammering the server
            throw ex;
          }
          // The connection was up for a while, e.g. a network interruption
          // after a long poll, or the network isn't back yet, e.g. a late VPN: retry
          await reconnectThrottle.throttle();
        }
      }
    } catch (ex) {
      this.errorCallback(ex);
    } finally {
      this.listening = false;
    }
  }

  async createToplevelFolder(name: string): Promise<ActiveSyncFolder> {
    let request = {
      ParentId: "0",
      DisplayName: name,
      Type: "1",
    };
    let result = await this.queuedRequest("FolderCreate", request);
    // We're required to sync the folder hierarchy after creating a folder.
    // This would normally perform the folder creation steps for us,
    // but unfortunately the API wants us to return the new folder,
    // even though nobody ever uses it, so we have to jump through hoops.
    let folder = await super.createToplevelFolder(name) as ActiveSyncFolder;
    folder.id = sanitize.nonemptystring(result.ServerId);
    await this.listFolders();
    return folder;
  }
}

export interface ActiveSyncPingable {
  // (async) Callback for when the ActiveSync mentions this in a Ping response.
  ping(): Promise<void>;
  // The pingable's ActiveSync ID.
  readonly serverID: string;
  // The pingable's ActiveSync class name.
  readonly folderClass: "Email" | "Calendar" | "Contacts" | "Tasks";
}

const kFolderSyncKeyError = "9";
