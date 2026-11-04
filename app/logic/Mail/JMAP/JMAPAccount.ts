import { MailAccount, DeleteStrategy } from "../MailAccount";
import { JMAPFolder } from "./JMAPFolder";
import { JMAPIdentity } from "./JMAPIdentity";
import { JMAPSearchEMail } from "./JMAPSearchEMail";
import type { EMail } from "../EMail";
import { newAccountForProtocol } from "../AccountsList/MailAccounts";
import { PersonUID } from "../../Abstract/PersonUID";
import { JMAPAddressbook } from "../../Contacts/JMAP/JMAPAddressbook";
import { JMAPCalendar } from "../../Calendar/JMAP/JMAPCalendar";
import { newAddressbookForProtocol } from "../../Contacts/AccountsList/Addressbooks";
import { newCalendarForProtocol } from "../../Calendar/AccountsList/Calendars";
import { TJMAPObjectTypes, type TJMAPAPIErrorResponse, type TJMAPAPIRequest, type TJMAPAPIResponse, type TJMAPChangeResponse, type TJMAPGetResponse, type TJMAPMethodResponse, type TJMAPObjectType, type TJMAPPrincipal, type TJMAPSession, type TJMAPSessionAccount, type TJMAPShareNotification, type TJMAPUpload } from "./TJMAPGeneric";
import type { TJMAPFolder, TJMAPIdentity } from "./TJMAPMail";
import type { TJMAPCalendar } from "../../Calendar/JMAP/TJMAPCalendar";
import type { TJMAPAddressbook } from "../../Contacts/JMAP/TJMAPAddressbook";
import { checkChangeError, JMAPCommandError } from "./JMAPError";
import { AuthMethod } from "../../Abstract/Account";
import { ConnectError, LoginError } from "../../Abstract/Account";
import { minorError } from "../../util/error";
import { SpecialFolder, MailShareCombinedPermissions, MailShareIndividualPermissions, type Folder } from "../Folder";
import { appGlobal } from "../../app";
import { appName, appVersion } from "../../build";
import { basicAuth } from "../../Auth/httpAuth";
import { EventDecoder } from "../../util/eventSource";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { notifyChangedProperty } from "../../util/Observable";
import { Lock } from "../../util/flow/Lock";
import { Semaphore } from "../../util/flow/Semaphore";
import { RunOnce } from "../../util/flow/RunOnce";
import { Throttle } from "../../util/flow/Throttle";
import { Timeout } from "../../util/flow/Timeout";
import { waitUntilOnline, isNetworkError, isTransientError, HTTPError } from "../../util/netUtil";
import { assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { ArrayColl, Collection, MapColl, SetColl } from "svelte-collections";

export class JMAPAccount extends MailAccount {
  readonly protocol: string = "jmap";
  /** ID in JMAP (`.id` is the ID our database) */
  accountID: string;
  @notifyChangedProperty
  session: TJMAPSession;
  declare readonly identities: ArrayColl<JMAPIdentity>;
  deleteStrategy: DeleteStrategy = DeleteStrategy.MoveToTrash;
  /** if polling is enabled, how often to poll.
   * In minutes. 0 or null = polling disabled */
  pollIntervalMinutes = 10;
  syncState = new MapColl<TJMAPObjectType, string>(); /** JMAP state is account-global. Use stateLock. */
  readonly stateLock = new Lock(); /** Protects syncState */
  protected loginRunOnce = new RunOnce();
  protected startupRunOnce = new RunOnce();
  protected readonly requestSemaphore = new Semaphore(4);
  protected pushAbort: AbortController | null = null;
  protected isDisconnected = false;
  protected throttle = new Throttle(50, 1);
  logging = true;

  constructor() {
    super();
    assert(appGlobal.remoteApp.kyCreate, "JMAP: Need backend");
  }

  get isLoggedIn(): boolean {
    return this.session &&
      (this.isDependentAccount
       ? this.mainAccount.isLoggedIn
       : this.authMethod != AuthMethod.OAuth2 || this.oAuth2?.isLoggedIn);
  }

  async login(interactive: boolean): Promise<void> {
    await this.loginRunOnce.runOnce(async () => {
      this.isDisconnected = false;
      await super.login(interactive);
      if (this.isDependentAccount) {
        return; // `super.login()` logged in the main account, which starts us up
      }
      if (!this.dbID) {
        await this.storage.saveAccount(this);
      }
      await this.storage.readFolderHierarchy(this);

      await this.loginOAuth2(interactive);
      await this.getSession();
    });
  }

  /** After `disconnect()`, e.g. a logout, only an explicit `login()` logs in again,
   * not the work that is still running.
   * @throws LoginError after `disconnect()` */
  async ensureLoggedIn(): Promise<void> {
    if (this.isDisconnected) {
      throw new LoginError(null, gt`Please login`);
    }
    if (this.isDependentAccount) {
      await (this.mainAccount as JMAPAccount).ensureLoggedIn();
      return;
    }
    if (this.isLoggedIn) {
      return;
    }
    if (this.session) {
      await this.oAuth2.login(false);
    }
    if (!this.isLoggedIn) {
      await this.login(false);
    }
  }

  async syncOnStartup() {
    await this.startupRunOnce.runOnce(async () => {
      if (this.isDependentAccount) {
        this.session = (this.mainAccount as JMAPAccount).session;
      }
      let firstSync = this.rootFolders.isEmpty;
      try {
        if (this.haveSubmission) {
          await this.listIdentities();
        }
        if (this.haveMail) {
          await super.syncOnStartup();
          let inbox = this.inbox as JMAPFolder;
          assert(inbox, "Inbox not found");
          inbox.startPolling();
        }
        if (!this.isDependentAccount) { // One stream covers all accounts shared with us
          this.startPushListener()
            .catch(this.errorCallback);
        }
        if (this.haveContacts) {
          await this.listAddressbooks();
        }
        if (this.haveCalendar) {
          await this.listCalendars();
        }
        if (!this.isDependentAccount && this.haveSharing) {
          await this.addNewlySharedAccounts(); // Shared while we were not running
        }
      } finally { // Even when the mail folders failed, so that calendar and addressbook still work
        await this.startupDependentAccounts();
      }
      if (firstSync && !this.isDependentAccount) {
        await this.addSharedAccounts(); // after `startupDependentAccounts()`: they start up on their own
      }
    });
  }

  async verifyLogin(): Promise<void> {
    await this.loginOAuth2(true);
    await this.getSession();
    this.stopPolling(); // Don't log out, because we want to keep the OAuth2 refresh token
  }

  protected async loginOAuth2(interactive: boolean): Promise<void> {
    let useOAuth2 = [AuthMethod.OAuth2].includes(this.authMethod);
    if (useOAuth2) {
      assert(this.oAuth2, this.name + `: ` + gt`Need OAuth2 configuration`);
      if (!this.oAuth2.isLoggedIn) {
        await this.oAuth2.login(interactive);
        assert(this.oAuth2.isLoggedIn, this.name + `: ` + gt`OAuth2: Login failed`);
      }
    }
  }

  async getSession(): Promise<void> {
    let session: TJMAPSession = await this.httpGet(this.url);
    if (this.logging) {
      console.log("JMAP session", session);
    }
    assert(session.capabilities, "Need capabilities in session");
    assert(session.accounts, "Need accounts list in session");
    assert(session.primaryAccounts, "Need primaryAccount ID in session");
    assert(sanitize.url(session.apiUrl), "Need apiUrl in session");
    assert(sanitize.url(session.downloadUrl), "Need downloadUrl in session");
    assert(sanitize.url(session.uploadUrl), "Need uploadUrl in session");
    assert(sanitize.url(session.eventSourceUrl), "Need eventSourceUrl in session");
    this.accountID = session.primaryAccounts["urn:ietf:params:jmap:mail"];
    assert(this.accountID, "JMAP Session: No primary mail account");
    let mailAccount = session.accounts[this.accountID];
    assert(mailAccount, "JMAP Session: Account not found");

    this.session = session;
    let maxConcurrentRequests = sanitize.integer(session.capabilities["urn:ietf:params:jmap:core"]?.maxConcurrentRequests, null);
    if (maxConcurrentRequests > 0) {
      this.requestSemaphore.maxParallel = maxConcurrentRequests;
    }
  }

  /** An account shared with us may offer less than our own, e.g. a calendar, but no mail.
   * Assumes that our own mail, contacts and calendars are all in the same account, like
   * Stalwart and Cyrus do it. The RFC allows `primaryAccounts` to name a different account
   * per capability, which would be a second personal account, and we don't add those. */
  get accountCapabilities(): Record<string, Record<string, any>> {
    return this.session?.accounts[this.accountID]?.accountCapabilities ?? {};
  }
  get haveMail(): boolean {
    return !!this.accountCapabilities["urn:ietf:params:jmap:mail"];
  }
  get haveSubmission(): boolean {
    return !!this.accountCapabilities["urn:ietf:params:jmap:submission"];
  }
  get haveContacts(): boolean {
    return !!this.accountCapabilities["urn:ietf:params:jmap:contacts"];
  }
  get haveCalendar(): boolean {
    return !!this.accountCapabilities["urn:ietf:params:jmap:calendars"];
  }
  get haveSharing(): boolean {
    return this.hasCapability("urn:ietf:params:jmap:principals");
  }
  /** One below what the server allows, so that the mail the user clicks on still gets through.
   * @see <https://www.rfc-editor.org/rfc/rfc8620#section-2> `maxConcurrentRequests` */
  get maxParallelRequests(): number {
    let serverMax = sanitize.integer(this.session?.capabilities?.["urn:ietf:params:jmap:core"]?.maxConcurrentRequests, null);
    return serverMax ? Math.max(1, Math.min(serverMax - 1, 30)) : 5;
  }
  /** @see <https://www.rfc-editor.org/rfc/rfc8620#section-2> `maxObjectsInSet` */
  get maxObjectsInSet(): number {
    let serverMax = sanitize.integer(this.session?.capabilities?.["urn:ietf:params:jmap:core"]?.maxObjectsInSet, null);
    return serverMax > 0 ? serverMax : 500;
  }
  // <compat for="Cyrus">
  // Cyrus announces its core extension always, even when its non-standard extensions are off.
  get isCyrus(): boolean {
    return this.hasCapability("https://cyrusimap.org/ns/jmap/core");
  }
  // </compat>

  /** A single API call, with a single result */
  async makeSingleCall(method: string, argumentsJSON: Record<string, any>): Promise<Record<string, any>> {
    let responses = await this.makeCalls([[ method, argumentsJSON ]]);
    let response = responses[0];
    assert(response[0] == method, "Method in response does not match");
    return response[1];
  }

  /** Like `makeSingleCall()`, but might be either for our account or for a shared account.
   * Calls to shared accounts might fail due to lacking permissions.
   * Unfortunately, the session object from Stalwart doesn't tell us the actual permissions
   * we have, so all we can do is try and error. This function mostly handles the error.
   * In this specific error condition, it returns `null` instead of throwing.
   * @returns null, if they did not share this part of their account with us */
  async makeSingleCallForSharedAccount(method: string, argumentsJSON: Record<string, any>): Promise<Record<string, any> | null> {
    try {
      return await this.makeSingleCall(method, argumentsJSON);
    } catch (ex) {
      if (this.isDependentAccount && (ex as any).code == "forbidden") {
        return null;
      }
      throw ex;
    }
  }

  /** Make multiple calls in one request, and return only the last result.
   * @calls Array of calls.
   *   Each call is an array with 3 entries:
   *   0: Method name
   *   1: Aguments
   *   2: Call name
   *   E.g. `[ "Email/get", { arg1: "value1", arg2: true, arg3: 45 }, "list" ]`
   * @returns Object with the last result for each call. The key is the "Call name" from the input.
   *   E.g. {
   *     list: [ { id: "", subject: "" }, ... ]
   *   }
   *   If a call returns multiple results, only the last result of that call is returned. */
  async makeCombinedCall(calls: [ string, Record<string, any>, string? ][]): Promise<Record<string, any>> {
    let responses = await this.makeCalls(calls);
    let results: Record<string, any> = {};
    for (let response of responses) {
      results[response[2]] = response[1];
    }
    return results;
  }

  /** Make multiple calls in one request
   * @calls Array of calls.
   *   Each call is an array with 3 entries:
   *   0: Method name
   *   1: Aguments
   *   2: Call number (Optional)
   *   E.g. `[ "methodName", { arg1: "value1", arg2: true, arg3: 45 }, "firstCall" ]`
   * @returns Results from the calls.
   *   One call may return multiple results, so the results array may be longer than the number of calls.
   *   The results will in the same order as the calls, though. */
  async makeCalls(calls: [string, Record<string, any>, string?][]): Promise<TJMAPMethodResponse[]> {
    await this.ensureLoggedIn();
    const kOurCapabilities = ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail", "urn:ietf:params:jmap:submission",
      "urn:ietf:params:jmap:contacts", "urn:ietf:params:jmap:calendars", "urn:ietf:params:jmap:principals"];
    let using = kOurCapabilities.filter(capability => this.hasCapability(capability));
    let requestJSON: TJMAPAPIRequest = {
      using: using,
      methodCalls: [],
    };
    let callCounter = 0;
    for (let call of calls) {
      call[2] ??= `c${++callCounter}`;
      requestJSON.methodCalls.push([call[0], call[1], call[2]]);
    }
    let log: any[] = [ "Calling" ];
    for (let method of requestJSON?.methodCalls) {
      log.push(method[2], method[0], method[1]);
    }

    let responsesJSON: TJMAPAPIResponse | TJMAPAPIErrorResponse;
    try {
      responsesJSON = await this.httpPost(this.session.apiUrl, requestJSON) as TJMAPAPIResponse;
    } catch (ex) {
      if ((ex as any).httpCode) { // HTTPFetchError from backend.ts
        console.error("POST", this.session.apiUrl, "with payload\n" + JSON.stringify(requestJSON, null, 2), "\nfailed with", ex?.message ?? ex, "while", ...log);
        throw ex;
      }
      console.error("Error", ex?.message ?? ex, ...log);
      throw ex;
    }
    log.push("Response");
    for (let method of responsesJSON?.methodResponses) {
      log.push(method[2], method[0], method[1]);
    }
    if (this.logging) {
      console.log(...log);
    }
    let errorResult = responsesJSON?.methodResponses.find(method => method[0] == "error");
    if (errorResult) {
      let method = requestJSON.methodCalls.find(call => call[2] == errorResult[2])?.[0];
      let ex = new JMAPCommandError(method, errorResult[1] as any) as any;
      ex.call = requestJSON;
      ex.response = responsesJSON?.methodResponses;
      ex.debug = log.join(" ");
      throw ex;
    }
    responsesJSON = responsesJSON as TJMAPAPIResponse;

    let callNumbers = requestJSON.methodCalls.map(call => call[2]);
    for (let resp of responsesJSON.methodResponses) {
      assert(callNumbers.includes(resp[2]), "Method in response does not match");
    }
    return responsesJSON.methodResponses;
  }

  protected authorizationHeader(): string {
    if (this.isDependentAccount) {
      return (this.mainAccount as JMAPAccount).authorizationHeader();
    }
    // Auth method
    let usePassword = [AuthMethod.Password].includes(this.authMethod);
    let useOAuth2 = [AuthMethod.OAuth2].includes(this.authMethod);
    if (usePassword) {
      return basicAuth(this.username, this.password);
    } else if (useOAuth2) {
      assert(this.oAuth2?.isLoggedIn, this.name + `: ` + gt`OAuth: Need login`);
      return this.oAuth2.authorizationHeader;
    }
    return undefined;
  }

  protected async ky(options: Record<string, any> = {}) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": `${appName}/${appVersion}`,
    };
    for (let name in options.headers) {
      headers[name] = options.headers[name];
    }
    headers.Authorization = this.authorizationHeader();
    // console.log("JMAP headers", headers);

    return appGlobal.remoteApp.kyCreate({
      headers: headers,
      timeout: 60000,
      result: options.result ?? "json",
    });
  }

  async httpGet(url: string, options?: any): Promise<any> {
    if (this.isDependentAccount) {
      return await (this.mainAccount as JMAPAccount).httpGet(url, options);
    }
    let ky = await this.ky(options);
    await this.throttle.throttle();
    let lock = await this.requestSemaphore.lock();
    try {
      return await ky.get(url);
    } catch (ex) {
      await this.httpError(ex);
    } finally {
      lock.release();
    }
  }

  async httpPost(url: string, sendJSON: any): Promise<any> {
    if (this.isDependentAccount) {
      return await (this.mainAccount as JMAPAccount).httpPost(url, sendJSON);
    }
    let ky = await this.ky();
    await this.throttle.throttle();
    let lock = await this.requestSemaphore.lock();
    try {
      return await ky.post(url, { json: sendJSON });
    } catch (ex) {
      await this.httpError(ex);
    } finally {
      lock.release();
    }
  }

  async httpPostBinary(url: string, body: any, options?: any): Promise<any> {
    if (this.isDependentAccount) {
      return await (this.mainAccount as JMAPAccount).httpPostBinary(url, body, options);
    }
    let ky = await this.ky(options);
    await this.throttle.throttle();
    let lock = await this.requestSemaphore.lock();
    try {
      return await ky.post(url, { body: body });
    } catch (ex) {
      await this.httpError(ex);
    } finally {
      lock.release();
    }
  }

  /** @throws an appropriate exception (always throws) */
  protected async httpError(ex: Error) {
    if (ex.name == "HTTPError") {
      // HTTPFetchError from backend.ts, which has only scalar properties, not the HTTP response body
      let ext = ex as any;
      if (ext.httpCode == 401) {
        throw new LoginError(ex, null);
      } else {
        if (isTransientError(ext)) {
          const kDefaultBackoffSec = 5;
          const kMaxBackoffSec = 20; // Sensible upper limit
          this.throttle.waitForSecond(Math.min(ext.retryAfterSeconds ?? kDefaultBackoffSec, kMaxBackoffSec));
        }
        throw new ConnectError(ex, null);
      }
    }
    throw ex;
  }

  async uploadBlob(blob: Buffer, mimeType: string, filename: string): Promise<TJMAPUpload> {
    let url = this.session.uploadUrl;
    url = url
      .replace("{accountId}", this.accountID)
      .replace("{name}", filename)
      .replace("{type}", mimeType);
    let uploadResponse = await this.httpPostBinary(url, blob, {
      headers: {
        "Content-Type": mimeType,
      },
    }) as TJMAPUpload;
    let blobId = uploadResponse.blobId;
    console.log("Uploaded message to", url, "and got blobID", blobId);
    return uploadResponse;
  }

  /** Updates the folders that changed on the server, e.g. their counts.
   * A change of the folder tree lists all folders again.
   * <https://www.rfc-editor.org/rfc/rfc8621.html#section-2.2> */
  async fetchChangedFolders(): Promise<void> {
    const kMaxRounds = 1000;
    for (let round = 1; round <= kMaxRounds; round++) {
      let sinceState = this.syncState.get("Mailbox");
      if (!sinceState) {
        await this.listFolders();
        return;
      }
      let response: Record<string, any>;
      try {
        response = await this.makeCombinedCall([
          [
            "Mailbox/changes", {
              accountId: this.accountID,
              sinceState: sinceState,
            },
            "changes",
          ], [
            "Mailbox/get", {
              accountId: this.accountID,
              "#ids": {
                resultOf: "changes",
                name: "Mailbox/changes",
                path: "/updated",
              },
              properties: ["totalEmails", "unreadEmails"],
            },
            "updated",
          ],
        ]);
      } catch (ex) {
        if (ex.code == "cannotCalculateChanges") {
          await this.listFolders();
          return;
        }
        throw ex;
      }
      let changes = response["changes"];
      if (changes.created?.length || changes.destroyed?.length || !changes.updatedProperties) {
        await this.listFolders();
        return;
      }
      let updatedFolders = response["updated"] as TJMAPGetResponse<TJMAPFolder>;
      for (let json of updatedFolders.list) {
        let folder = this.findFolder(folder => folder.id == json.id);
        if (!folder) {
          await this.listFolders();
          return;
        }
        folder.countTotal = sanitize.integer(json.totalEmails, folder.countTotal);
        folder.countUnread = sanitize.integer(json.unreadEmails, folder.countUnread);
        await this.storage.saveFolderProperties(folder);
      }
      // With `hasMoreChanges`, an intermediate state, for the changes that we applied so far: An interrupted sync continues here
      this.syncState.set("Mailbox", changes.newState);
      await this.save();
      if (!changes.hasMoreChanges) {
        return;
      }
      if (changes.newState == sinceState) {
        break;
      }
    }
    this.errorCallback(new Error(`${this.name}: Folder changes: The server keeps reporting more changes. Stopped.`));
  }

  async listFolders(): Promise<void> {
    await this.storage.readFolderHierarchy(this);
    let currentFolders = new Map<string, JMAPFolder>();
    let oldFolders = this.getAllFolders();

    let serverFoldersResponse = await this.makeSingleCall("Mailbox/get", {
      "accountId": this.accountID,
      "ids": null,
    }) as TJMAPGetResponse<TJMAPFolder>;
    for (let folderJSON of serverFoldersResponse.list) {
      // We may already have the folder from our database
      let folder = this.findFolder(folder => folder.id == folderJSON.id) as JMAPFolder ?? this.newFolder();
      folder.fromJMAP(folderJSON);
      currentFolders.set(folder.id, folder);
    }
    let parentIDs = new Map(serverFoldersResponse.list.map(folderJSON => [folderJSON.id, folderJSON.parentId]));
    // Only now, because the server may list a folder before its parent
    for (let folderJSON of serverFoldersResponse.list) {
      let folder = currentFolders.get(folderJSON.id);
      let parent = currentFolders.get(folderJSON.parentId) ?? null;
      let ancestorID = folderJSON.parentId;
      for (let i = 0; ancestorID && ancestorID != folder.id && i < parentIDs.size; i++) {
        ancestorID = parentIDs.get(ancestorID);
      }
      if (ancestorID == folder.id) {
        this.dataError(new Error(`Folder ${folder.name}: The server made the folder its own parent or a subfolder of itself. Showing it at the top level.`));
        parent = null;
      }
      let parentFolders = parent ? parent.subFolders : this.rootFolders;
      if (parentFolders.contains(folder)) {
        continue;
      }
      let oldParentFolders = folder.parent?.subFolders ?? this.rootFolders;
      oldParentFolders.remove(folder);
      folder.parent = parent;
      parentFolders.add(folder);
    }

    for (let folder of oldFolders) {
      if (!currentFolders.has(folder.id)) {
        await folder.deleteItLocally();
      }
    }
    for (let folder of currentFolders.values()) {
      if (folder.dbID) {
        await this.storage.saveFolderProperties(folder);
      } else {
        await this.storage.saveFolder(folder);
      }
    }
    this.syncState.set("Mailbox", serverFoldersResponse.state);
  }

  async createToplevelFolder(name: string): Promise<JMAPFolder> {
    let newFolder = await super.createToplevelFolder(name) as JMAPFolder;
    let response = await this.makeSingleCall("Mailbox/set", {
      accountId: this.accountID,
      create: {
        "newFolder": {
          name: name,
          isSubscribed: true,
        },
      },
    }) as TJMAPChangeResponse<TJMAPFolder>;
    checkChangeError(response);
    newFolder.id = response.created["newFolder"].id;
    console.log("JMAP folder created", name);
    await this.listFolders();
    await newFolder.listMessages();
    return newFolder;
  }

  protected stopPolling() {
    for (let folder of this.getAllFolders()) {
      (folder as JMAPFolder).stopPolling();
    }
  }

  async disconnect(): Promise<void> {
    this.isDisconnected = true;
    this.stopPolling();
    this.pushAbort?.abort();
    this.session = null;
  }

  async send(email: EMail): Promise<void> {
    let outboxFolder = this.getSpecialFolder(SpecialFolder.Outbox) ??
      this.getSpecialFolder(SpecialFolder.Drafts);
    let sentFolder = email.folder ??
      this.getSpecialFolder(SpecialFolder.Sent);

    email.isRead = true;
    await outboxFolder.addMessage(email);

    let recipients = new ArrayColl<PersonUID>();
    recipients.addAll(email.to);
    recipients.addAll(email.cc);
    recipients.addAll(email.bcc);
    let recipientsAddrs = recipients.map(p => ({ email: p.emailAddress })).contents;
    let identityID = await this.findIdentityOnServer(email);

    let responses = await this.makeCalls([["EmailSubmission/set", {
      accountId: this.accountID,
      create: {
        "sendMessage": {
          emailId: email.pID,
          identityId: identityID,
          envelope: {
            mailFrom: { email: email.from.emailAddress },
            rcptTo: recipientsAddrs,
          }
        },
      },
      onSuccessUpdateEmail: {
        "#sendMessage": {
          // Intentionally delete all other folders
          mailboxIds: {
            [sentFolder.id]: true,
          },
          ["keywords/$draft"]: null,
        }
      }
    }]]);
    let sendResponse = responses[0][1];
    let moveToSentResponse = responses.find(response => response[0] == "Email/set")?.[1];
    let error = sendResponse["notCreated"] as any;
    if (error) {
      error = error["sendMessage"];
      throw new Error("Upload of message to server failed: " + (error?.description ?? "") + " " + (error?.properties?.join(", ") ?? ""));
    }
    if (moveToSentResponse) {
      try {
        checkChangeError(moveToSentResponse as TJMAPChangeResponse<any>);
      } catch (ex) {
        this.errorCallback(ex); // Not thrown: The email was sent, and the user should not send it again
      }
    }
  }

  protected async findIdentityOnServer(email: EMail): Promise<string | null> {
    assert(email.identity, `${this.name}: Please set the email identity before sending`);
    if (!email.identity.pID) {
      await this.listIdentities();
    }
    if (email.identity.pID) {
      return email.identity.pID as string;
    }
    // Our identity is local-only, e.g. a catch-all
    let identity = this.identities.find(identity =>
      identity.pID && identity.isEMailAddress(email.from.emailAddress));
    // <compat for="Cyrus" reason="Offers a single identity, for the login user, and takes the `From` address from the mail itself">
    if (this.isCyrus) {
      identity ??= this.identities.find(identity => !!identity.pID);
    }
    // </compat>
    assert(identity, gt`The server does not allow sending from this email address`);
    return identity.pID;
  }

  /** Creates, updates or removes our local identities, to match the server.
   * Also for the accounts of other users: We are a member of some of them,
   * e.g. functional accounts, and may then send as them. */
  async listIdentities(): Promise<void> {
    let response = await this.makeSingleCallForSharedAccount("Identity/get", {
      accountId: this.accountID,
      ids: null,
    }) as TJMAPGetResponse<TJMAPIdentity>;
    if (!response) {
      return; // Another user's account, and we are not a member of it
    }

    let obsolete = new ArrayColl(this.identities.contents.filter(identity => identity.pID));
    for (let json of response.list) {
      try {
        let identity = this.identities.find(identity => identity.isSameAs(json));
        if (identity) {
          obsolete.remove(identity);
        } else {
          identity = this.newIdentity();
          this.identities.add(identity);
        }
        identity.fromJMAP(json);
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
    // Identities that were never saved to the server have no `pID` and stay
    this.identities.removeAll(obsolete);

    this.syncState.set("Identity", response.state);
    await this.save();
  }

  /**
   * Triggers an update, as needed.
   *
   * @param type What object type the sync state is for.
   *  The state is account-global (i.e. across folders), but specific to an
   *  object type.
   * @param toState (Optional) The sync state that the server returned after a server call.
   * @param fromState (Optional)
   *  If this was a `set` operation, this is the state that the server
   *  returned as the old state before the operation.
   */
  async sync(type: TJMAPObjectType, toState?: string, fromState?: string) {
    fromState ??= this.syncState.get(type);
    if (toState && toState == fromState) {
      return;
    }

    if (type == "Mailbox") {
      await this.fetchChangedFolders();
    }
    if (type == "Email") {
      await (this.inbox as JMAPFolder).fetchChangedMessagesForAllFolders();
    }
    if (type == "Identity") {
      await this.listIdentities();
    }
    if (type == "ContactCard") {
      let addressbooks = this.dependentAccounts().filterOnce(a => a instanceof JMAPAddressbook) as Collection<JMAPAddressbook>;
      await addressbooks.first?.fetchChangedPersonsForAllAddressbooks();
    }
    if (type == "Calendar") {
      await this.listCalendars();
    }
    if (type == "CalendarEvent") {
      let calendars = this.dependentAccounts().filterOnce(a => a instanceof JMAPCalendar) as Collection<JMAPCalendar>;
      await calendars.first?.fetchChangedEventsForAllCalendars();
    }
    if (type == "ShareNotification") {
      await this.addNewlySharedAccounts();
    }
  }

  /** Starts push mail
   * Runs as long as we're logged in, so don't `await` it */
  async startPushListener(): Promise<void> {
    let url = this.session.eventSourceUrl;
    assert(url, "Need event source URL");
    let types = ["Mailbox", "Email", "Identity"];
    if (this.haveContacts) {
      types.push("ContactCard");
    }
    if (this.haveCalendar) {
      types.push("Calendar", "CalendarEvent");
    }
    if (this.haveSharing) {
      types.push("ShareNotification");
    }
    const kPingSeconds = 60;
    url = url
      .replace("{accountId}", this.accountID)
      .replace("{types}", types.join(","))
      .replace("{ping}", String(kPingSeconds))
      .replace("{closeafter}", "no");
    this.pushAbort?.abort(); // e.g. after a new login, while the old listener still waits on a connection that died
    let listener = this.pushAbort = new AbortController();
    let reconnectThrottle = new Throttle(1, 10);
    let isReconnect = false;
    while (this.isLoggedIn) {
      await reconnectThrottle.throttle();
      let connection = new AbortController();
      let pingSeconds = kPingSeconds;
      // A dead connection, e.g. after sleep or a network change, doesn't always end the stream,
      // and a half-open VPN tunnel may accept a new connection, but never answer
      let watchdog = new Timeout(2 * pingSeconds, () => {
        // A `DOMException` named "TimeoutError", like `fetch()` throws for its own timeouts, so that the `catch`
        // below takes it as transient (`isTransientError()`), and the `while` loop reconnects
        connection.abort(new DOMException("Push connection: The server stopped answering", "TimeoutError"));
      });
      try {
        let stream = await fetch(url, {
          headers: {
            Authorization: this.authorizationHeader(),
          },
          signal: AbortSignal.any([listener.signal, connection.signal]),
        });
        if (!stream.ok) {
          reconnectThrottle.waitForSecond(parseInt(stream.headers.get("Retry-After")) || 5);
          throw new HTTPError(stream);
        }
        let eventStream = stream.body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream(new EventDecoder()));
        if (isReconnect) {
          await this.fetchChangesMissedByPush(types as TJMAPObjectType[]);
        }
        isReconnect = true;
        for await (let event of eventStream) {
          watchdog.fulfilled();
          if (event.name == "ping") {
            try {
              pingSeconds = sanitize.integerRange(JSON.parse(event.data).interval, 1, 1500, pingSeconds);
            } catch (ex) {
              this.dataError(new Error("JMAP push: The server sent an invalid ping: " + ex.message));
            }
          }
          if (event.name == "state") {
            try {
              let json = JSON.parse(event.data);
              assert(json.changed, "Need state changes");
              for (let accountID in json.changed) {
                let account = this.accountForID(accountID); // Incl. accounts shared with us
                if (!account) {
                  continue;
                }
                for (let typename in json.changed[accountID]) {
                  let newState = json.changed[accountID][typename];
                  let type = typename as TJMAPObjectType;
                  if (newState == account.syncState.get(type)) {
                    continue;
                  }
                  await account.sync(type, newState);
                }
              }
            } catch (ex) {
              console.error(ex);
            }
          }
          watchdog.restart(2 * pingSeconds);
        }
      } catch (ex) {
        if (ex.name == "AbortError") { // disconnect(), or a newer listener took over
          return;
        }
        if (isTransientError(ex)) {
          // A connection that stays open for hours drops all the time: computer
          // sleep, Wi-Fi change, server restart. Reconnecting is normal, not an error.
          console.log(this.name + ": Push connection dropped, reconnecting:", ex?.message);
          if (isNetworkError(ex)) {
            await waitUntilOnline(); // Computer sleep drops the network
          }
        } else {
          throw ex;
        }
      } finally {
        watchdog.fulfilled();
      }
    }
  }

  /** The server doesn't tell us what changed while the push connection was down.
   * <https://www.rfc-editor.org/rfc/rfc8620#section-7.3> */
  protected async fetchChangesMissedByPush(types: TJMAPObjectType[]): Promise<void> {
    let sharedAccounts = this.dependentAccounts().filterOnce(acc => acc instanceof JMAPAccount) as Collection<JMAPAccount>;
    for (let account of [this, ...sharedAccounts]) {
      for (let type of types) {
        if (!this.isLoggedIn) {
          return; // disconnect()
        }
        if (!account.syncState.has(type)) {
          continue; // Not read yet, so nothing to update
        }
        try {
          await account.sync(type);
        } catch (ex) {
          minorError(ex);
        }
      }
    }
  }

  async listAddressbooks() {
    let response = await this.makeSingleCallForSharedAccount("AddressBook/get", {
      accountId: this.accountID,
    });
    if (!response) {
      return; // Another user's account, and they did not share their contacts with us
    }
    let listResponse = response as TJMAPGetResponse<TJMAPAddressbook>;
    for (let jmap of listResponse.list) {
      if (!jmap.isSubscribed && !jmap.isDefault ||
          this.dependentAccounts().filterOnce(a => a instanceof JMAPAddressbook && a.jmapID == jmap.id).hasItems) {
        continue;
      }
      let ab = newAddressbookForProtocol("addressbook-jmap") as JMAPAddressbook;
      ab.initFromMainAccount(this);
      ab.fromJMAP(jmap)
      appGlobal.addressbooks.add(ab);
      await ab.save();
    }
  }

  async listCalendars() {
    let response = await this.makeSingleCallForSharedAccount("Calendar/get", {
      accountId: this.accountID,
    });
    if (!response) {
      return; // Another user's account, and they did not share their calendars with us
    }
    let listResponse = response as TJMAPGetResponse<TJMAPCalendar>;
    await this.updateCalendars(listResponse.list);
    this.syncState.set("Calendar", listResponse.state);
    for (let jmap of listResponse.list) {
      if (!jmap.isSubscribed && !jmap.isDefault ||
        this.dependentAccounts().filterOnce(a => a instanceof JMAPCalendar && a.jmapID == jmap.id).hasItems) {
        continue;
      }
      let cal = newCalendarForProtocol("calendar-jmap") as JMAPCalendar;
      cal.initFromMainAccount(this);
      cal.fromJMAP(jmap)
      appGlobal.calendars.add(cal);
      await cal.save();
    }
  }

  /** Takes over changes of our calendars, e.g. a new name, and removes
   * those that were deleted on the server or are no longer shared with us. */
  protected async updateCalendars(serverCalendars: TJMAPCalendar[]) {
    let ourCalendars = this.dependentAccounts().filterOnce(account => account instanceof JMAPCalendar) as Collection<JMAPCalendar>;
    for (let ourCalendar of ourCalendars) {
      let jmap = serverCalendars.find(json => json.id == ourCalendar.jmapID);
      if (jmap) {
        ourCalendar.fromJMAP(jmap);
        await ourCalendar.save();
      } else {
        await ourCalendar.deleteIt();
      }
    }
  }

  /** Us, or our sub-account for a JMAP account that another user shared with us. */
  accountForID(accountID: string): JMAPAccount | null {
    return accountID == this.accountID
      ? this
      : this.dependentAccounts().find(acc => acc instanceof JMAPAccount && acc.accountID == accountID) as JMAPAccount;
  }

  /** Incoming delegation: We add the whole account.
   * The session lists accounts, not folders. `Mailbox/get` then returns exactly
   * the folders that they shared with us.
   * <https://www.rfc-editor.org/rfc/rfc9670.html#section-1.4> */
  async availableSharedAccounts(): Promise<ArrayColl<PersonUID>> {
    let persons = new ArrayColl<PersonUID>();
    if (!this.haveSharing) {
      return persons;
    }
    for (let accountID in this.session?.accounts) {
      let shared = this.session.accounts[accountID];
      let ownerEMail = this.sharedAccountOwner(shared);
      if (shared.isPersonal || !ownerEMail || this.accountForID(accountID)) {
        continue; // Our own account, one that we cannot address, or one that we already have
      }
      persons.add(new PersonUID(ownerEMail, sanitize.nonemptystring(shared.name)));
    }
    return persons;
  }

  /** The JMAP session names an account after its owner, normally by email address,
   * but that is not guaranteed, and then we cannot match the account to a person. */
  protected sharedAccountOwner(shared: TJMAPSessionAccount): string | null {
    return sanitize.emailAddress(shared.name, null);
  }

  async addSharedAccounts(): Promise<void> {
    for (let person of await this.availableSharedAccounts()) {
      await this.addSharedFolders(person, "msgfolderroot");
    }
  }

  /** Another user just gave us access to their account, so add it.
   * Accounts that the user deleted stay deleted, because we look only at new notifications.
   * @see <https://www.rfc-editor.org/rfc/rfc9670.html#section-3> */
  async addNewlySharedAccounts(): Promise<void> {
    let sinceState = this.syncState.get("ShareNotification");
    if (!sinceState) {
      let current = await this.makeSingleCall("ShareNotification/get", {
        accountId: this.principalsAccountID,
        ids: [], // Start from now: Older notifications may be for accounts that the user deleted
      }) as TJMAPGetResponse<TJMAPShareNotification>;
      this.syncState.set("ShareNotification", current.state);
      await this.save();
      return;
    }
    let response = await this.makeCombinedCall([
      [
        "ShareNotification/changes", {
          accountId: this.principalsAccountID,
          sinceState: sinceState,
        },
        "changes",
      ], [
        "ShareNotification/get", {
          accountId: this.principalsAccountID,
          "#ids": {
            resultOf: "changes",
            name: "ShareNotification/changes",
            path: "/created",
          },
        },
        "new",
      ],
    ]);
    let changes = response["changes"] as TJMAPChangeResponse<TJMAPShareNotification>;
    let notifications = (response["new"] as TJMAPGetResponse<TJMAPShareNotification>).list;
    this.syncState.set("ShareNotification", changes.newState);
    await this.save();
    if (!notifications.length) {
      return;
    }

    await this.getSession(); // The new account appears in the session only now
    for (let notification of notifications) {
      let granted = Object.values(notification.newRights ?? {}).some(right => right);
      let shared = this.session.accounts[notification.objectAccountId];
      let ownerEMail = shared && this.sharedAccountOwner(shared);
      if (!granted || !ownerEMail || shared.isPersonal || this.accountForID(notification.objectAccountId)) {
        continue; // Access revoked, our own account, one that we cannot address, or already set up
      }
      await this.addSharedFolders(new PersonUID(ownerEMail, sanitize.nonemptystring(shared.name)), "msgfolderroot");
    }
  }

  async findSharedFolders(person: PersonUID, distinguishedIDs: string[]): Promise<string[]> {
    return this.sharedAccountID(person) && distinguishedIDs.includes("msgfolderroot")
      ? ["msgfolderroot"]
      : [];
  }

  /** Its folders, calendars and addressbooks are added by its `syncOnStartup()`. */
  async addSharedFolders(person: PersonUID, sharedFolderRoot: "msgfolderroot" | "inbox"): Promise<JMAPAccount> {
    let sharedAccountID = this.sharedAccountID(person);
    assert(sharedAccountID, gt`You have no access to the account of ${person.emailAddress}`);
    let account = newAccountForProtocol("jmap") as JMAPAccount;
    account.initFromMainAccount(this);
    account.color = this.colorForSharedAccount(person);
    account.name = person.name ?? person.emailAddress;
    account.username = sanitize.nonemptystring(this.session.accounts[sharedAccountID].name);
    account.emailAddress = sanitize.emailAddress(person.emailAddress);
    account.accountID = sharedAccountID;
    let identity = account.newIdentity();
    identity.realname = person.name;
    identity.emailAddress = account.emailAddress;
    account.identities.add(identity);
    await account.save();
    appGlobal.emailAccounts.add(account);
    await account.syncOnStartup();
    return account;
  }

  protected sharedAccountID(person: PersonUID): string | null {
    let wanted = sanitize.emailAddress(person.emailAddress, null);
    for (let accountID in this.session?.accounts) {
      let shared = this.session.accounts[accountID];
      let ownerEMail = this.sharedAccountOwner(shared);
      if (!shared.isPersonal && ownerEMail && ownerEMail == wanted) {
        return accountID;
      }
    }
    return null;
  }

  // Outgoing: Our account, shared with other users

  canShareWithPersons(): boolean {
    return this.haveSharing || // Outgoing
      Object.values(this.session?.accounts ?? {}).some(account => !account.isPersonal); // Incoming
  }

  get sharePermissionLevels(): MailShareCombinedPermissions[] {
    // <compat for="Cyrus" reason="Knows only 3 coarse rights, so it cannot express flags-only or custom access">
    if (this.isCyrus) {
      return [
        MailShareCombinedPermissions.Read,
        MailShareCombinedPermissions.Modify,
      ];
    }
    // </compat>
    return [
      MailShareCombinedPermissions.Read,
      MailShareCombinedPermissions.FlagChange,
      MailShareCombinedPermissions.Modify,
      MailShareCombinedPermissions.Custom,
    ];
  }

  async getSharedPersons(): Promise<ArrayColl<PersonUID>> {
    let response = await this.makeSingleCall("Mailbox/get", {
      accountId: this.accountID,
      properties: ["shareWith"],
    }) as TJMAPGetResponse<TJMAPFolder>;
    let principalIDs = new SetColl<string>();
    for (let folder of response.list) {
      if (folder.shareWith) {
        principalIDs.addAll(Object.keys(folder.shareWith));
      }
    }
    return await this.getPrincipals(principalIDs.contents);
  }

  async deleteSharedPerson(otherPerson: PersonUID) {
    await this.setSharedPerson(otherPerson, null, null, true);
  }

  async addSharedPerson(otherPerson: PersonUID, mailFolder: JMAPFolder | null, includeSubfolders: boolean, access: MailShareCombinedPermissions, ...permissions: MailShareIndividualPermissions[]) {
    await this.setSharedPerson(otherPerson, this.mailShareRights(access, permissions), mailFolder, includeSubfolders);
  }

  /** `rights` null removes their access. */
  protected async setSharedPerson(otherPerson: PersonUID, rights: Record<string, boolean> | null, mailFolder: JMAPFolder | null, includeSubfolders: boolean) {
    let principalID = (await this.findPrincipal(otherPerson))?.id;
    assert(principalID, gt`You have no access to the account of ${otherPerson.emailAddress}`);
    let folders = !mailFolder
      ? this.getAllFolders()
      : includeSubfolders
        ? mailFolder.getInclusiveDescendants()
        : new ArrayColl<Folder>([mailFolder]);
    let update: Record<string, any> = {};
    for (let folder of folders) {
      update[folder.id] = { [`shareWith/${principalID}`]: rights };
    }
    let response = await this.makeSingleCall("Mailbox/set", {
      accountId: this.accountID,
      update: update,
    }) as TJMAPChangeResponse<TJMAPFolder>;
    checkChangeError(response);
  }

  /** RFC 8621 doesn't define mailbox sharing, so the servers invented their own rights:
   * Stalwart re-uses the `myRights` names, Cyrus knows only read, write and admin. */
  protected mailShareRights(access: MailShareCombinedPermissions, permissions: MailShareIndividualPermissions[]): Record<string, boolean> {
    let mayRead = access != MailShareCombinedPermissions.Custom || permissions.includes(MailShareIndividualPermissions.Read);
    let mayFlag = access == MailShareCombinedPermissions.FlagChange || access == MailShareCombinedPermissions.Modify ||
      permissions.includes(MailShareIndividualPermissions.FlagChange);
    let mayAdd = access == MailShareCombinedPermissions.Modify || permissions.includes(MailShareIndividualPermissions.Create);
    let mayRemove = access == MailShareCombinedPermissions.Modify || permissions.includes(MailShareIndividualPermissions.Delete);
    let mayDeleteFolder = access == MailShareCombinedPermissions.Modify || permissions.includes(MailShareIndividualPermissions.DeleteFolder);
    let mayCreateChild = access == MailShareCombinedPermissions.Modify || permissions.includes(MailShareIndividualPermissions.CreateSubfolders);
    // <compat for="Cyrus" reason="Knows only 3 coarse rights, so this over-grants">
    if (this.isCyrus) {
      return {
        mayRead: mayRead,
        mayWrite: mayFlag || mayAdd || mayRemove, // `mayWrite` also covers adding and deleting mails
        mayAdmin: mayDeleteFolder || mayCreateChild,
      };
    }
    // </compat>
    return {
      mayReadItems: mayRead,
      maySetSeen: mayFlag,
      maySetKeywords: mayFlag,
      mayAddItems: mayAdd,
      mayRemoveItems: mayRemove,
      mayCreateChild: mayCreateChild,
      mayRename: mayDeleteFolder,
      mayDelete: mayDeleteFolder,
      maySubmit: false,
      mayShare: false,
    };
  }

  /** The account that holds the `Principal` objects, i.e. the other users.
   * @see <https://www.rfc-editor.org/rfc/rfc9670.html#section-1.5.2> */
  protected get principalsAccountID(): string {
    let accountID = this.accountCapabilities["urn:ietf:params:jmap:principals:owner"]?.accountIdForPrincipal;
    // <compat for="Stalwart, Cyrus" reason="Neither sends `principals:owner` in the session: Stalwart has it only inside `Principal.accounts`, and Cyrus implements the older draft, which has no such capability">
    accountID ??= this.session.primaryAccounts["urn:ietf:params:jmap:principals"];
    // </compat>
    return sanitize.nonemptystring(accountID);
  }

  /** The principal ID is the key in `shareWith`. */
  async findPrincipal(person: PersonUID): Promise<TJMAPPrincipal | null> {
    let response = await this.makeCombinedCall([
      [
        "Principal/query", {
          accountId: this.principalsAccountID,
          filter: { email: person.emailAddress },
        },
        "query",
      ], [
        "Principal/get", {
          accountId: this.principalsAccountID,
          "#ids": {
            resultOf: "query",
            name: "Principal/query",
            path: "/ids",
          },
        },
        "principals",
      ],
    ]);
    let principals = (response["principals"] as TJMAPGetResponse<TJMAPPrincipal>).list;
    let matching = principals.find(principal => principal.email?.toLowerCase() == person.emailAddress.toLowerCase());
    // <compat for="Cyrus" reason="`Principal.email` comes from the calendar scheduling addresses, and may be unset">
    if (this.isCyrus) {
      matching ??= principals[0];
    }
    // </compat>
    return matching ?? null;
  }

  async getPrincipals(principalIDs: string[]): Promise<ArrayColl<PersonUID>> {
    if (!principalIDs.length) {
      return new ArrayColl<PersonUID>();
    }
    let response = await this.makeSingleCall("Principal/get", {
      accountId: this.principalsAccountID,
      ids: principalIDs,
    }) as TJMAPGetResponse<TJMAPPrincipal>;
    return new ArrayColl(response.list.map(principal => {
      let emailAddress = sanitize.emailAddress(principal.email, null);
      return new PersonUID(emailAddress, sanitize.label(principal.description ?? principal.name, emailAddress));
    }));
  }

  hasCapability(capa: string): boolean {
    if (!this.session) {
      return false;
    }
    return !!this.session.capabilities[capa];
  }

  getCapability(capa: string): Record<string, any> | null {
    if (!this.session) {
      return null;
    }
    return this.session.capabilities[capa];
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.accountID = sanitize.alphanumdash(json.accountID, null);
    this.pollIntervalMinutes = sanitize.integer(json.pollIntervalMinutes, this.pollIntervalMinutes);

    if (json.syncState && json.syncState instanceof Object) {
      for (let typeName in json.syncState) {
        try {
          let type = sanitize.enum(typeName, TJMAPObjectTypes) as TJMAPObjectType;
          this.syncState.set(type, sanitize.string(json.syncState[type]));
        } catch (ex) {
          this.errorCallback(ex);
        }
      }
    }
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.accountID = this.accountID;
    json.pollIntervalMinutes = this.pollIntervalMinutes;
    json.syncState = this.syncState.contentKeyValues();
    return json;
  }

  newFolder(): JMAPFolder {
    return new JMAPFolder(this);
  }

  newIdentity(): JMAPIdentity {
    return new JMAPIdentity(this);
  }

  newSearch(): JMAPSearchEMail {
    return new JMAPSearchEMail();
  }
}
