import { ExchangeMailAccount } from "../EWS/ExchangeMailAccount";
import { AuthMethod, type Account } from "../../Abstract/Account";
import { Provider } from "../../Auth/OAuth2URLs";
import type { EMail } from "../EMail";
import { SpecialFolder, MailShareCombinedPermissions, type Folder, type MailShareIndividualPermissions } from "../Folder";
import { OWAFolder } from "./OWAFolder";
import { OWASearchEMail } from "./OWASearchEMail";
import { OWAFilterRule } from "./OWAFilterRule";
import type { FilterRuleAction } from "../FilterRules/FilterRuleAction";
import { OWAError } from "./OWAError";
import type { OWANotifications } from "./Notification/OWANotifications";
import { OWAExchangeNotifications } from "./Notification/OWAExchangeNotifications";
import { OWAOffice365Notifications } from "./Notification/OWAOffice365Notifications";
import { newAccountForProtocol } from "../AccountsList/MailAccounts";
import { newAddressbookForProtocol } from "../../Contacts/AccountsList/Addressbooks";
import { OWAGAL } from "../../Contacts/OWA/OWAGAL";
import type { OWAAddressbook } from "../../Contacts/OWA/OWAAddressbook";
import { newCalendarForProtocol} from "../../Calendar/AccountsList/Calendars";
import type { OWACalendar } from "../../Calendar/OWA/OWACalendar";
import { OWARequest } from "./Request/OWARequest";
import { OWAOptionsRequest } from "./Request/OWAOptionsRequest";
import { OWACreateItemRequest } from "./Request/OWACreateItemRequest";
import { OWAUpdateItemRequest } from "./Request/OWAUpdateItemRequest";
import { OWASubscribeToNotificationRequest } from "./Request/OWASubscribeToNotificationRequest";
import { owaCreateNewTopLevelFolderRequest, owaFindFoldersRequest, owaSharedFolderRequest } from "./Request/OWAFolderRequests";
import { OWACalendarShortcut } from "../../Calendar/OWA/OWACalendarShortcut";
import { OWALoginBackground } from "./Login/OWALoginBackground";
import { deleteExchangePermissions, setExchangePermissions } from "../EWS/ExchangePermission";
import type { PersonUID } from "../../Abstract/PersonUID";
import { OWAAuth } from "../../Auth/OWAAuth";
import { type Attachment, ContentDisposition } from "../../Abstract/Attachment";
import { LoginError } from "../../Abstract/Account";
import { ensureLicensed } from "../../util/LicenseClient";
import { logErrorToServer } from "../../util/error";
import { appGlobal } from "../../app";
import { Throttle } from "../../util/flow/Throttle";
import { Semaphore } from "../../util/flow/Semaphore";
import { RunOnce } from "../../util/flow/RunOnce";
import { notifyChangedProperty } from "../../util/Observable";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert, ensureArray, NotSupported, NotReached, UserError } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { ArrayColl } from "svelte-collections";

export class OWAAccount extends ExchangeMailAccount {
  readonly protocol: string = "owa";
  readonly folderMap = new Map<string, OWAFolder>;
  /**
   * We get notifications for folders we're not interested in.
   * We filter them out by checking that the parent exists.
   * But we have to special-case the root folder,
   * since Mustang doesn't use a dedicated root folder object.
   */
  protected msgFolderRootID: string | undefined;
  /**
   * OAuth2 authorization header for Hotmail or Office 365 environments.
   * In future it might be possible to perform requests from the front end?
   */
  authorizationHeader: string | undefined;
  /** requests only work after the login form has been successfully submitted */
  @notifyChangedProperty
  protected hasLoggedIn = false;
  protected notifications: OWANotifications;
  protected throttle = new Throttle(50, 1);
  protected semaphore = new Semaphore(20);
  protected loginRunOnce = new RunOnce();
  protected startupRunOnce = new RunOnce();
  // null: if this is our account
  // msgfolderroot: if this is an account shared with us
  // inbox: if this is an inbox shared with us
  protected sharedFolderRoot: "msgfolderroot" | "inbox" | null;

  constructor() {
    super();
    assert(appGlobal.remoteApp.OWA, "OWA: Need backend");
  }

  newFolder(): OWAFolder {
    return new OWAFolder(this);
  }

  newSearch(): OWASearchEMail {
    return new OWASearchEMail();
  }

  /**
   * The cookie jar used for OWA requests. This allows you to have
   * multiple OWA accounts for the same host.
   */
  get partition(): string {
    return 'persist:' + this.webSessionID;
  }

  // See below as to why this doesn't use OAuth2.
  get isLoggedIn(): boolean {
    if (this.mainAccount) {
      return this.mainAccount.isLoggedIn;
    }
    return this.hasLoggedIn;
  }

  async testLoggedIn(): Promise<boolean> {
    if (this.mainAccount) {
      throw new NotReached();
    }
    assert(!this.hasLoggedIn, "Only for use during login");
    this.authorizationHeader = await appGlobal.remoteApp.OWA.getAnyScrapedAuth(this.partition);
    let url = this.url + 'service.svc';
    let options = {
      body: JSON.stringify(owaFindFoldersRequest(false)),
      headers: {
        Action: "FindFolder",
        Authorization: this.authorizationHeader,
        "Content-Type": "application/json",
        "x-anchormailbox": this.emailAddress,
        "x-customowascenariodata": "MailboxAccess:SharedMailbox,ExplicitLogon",
        "x-owa-explicitlogonuser": this.emailAddress,
      },
      method: "POST",
    };
    if (this.authorizationHeader) {
      let response = await fetch(url, options);
      if ([401, 440].includes(response.status)) {
        return false;
      }
      try {
        await response.json();
        return true;
      } catch (ex) {
        return false;
      }
    }
    let response = await appGlobal.remoteApp.OWA.fetchJSON(this.partition, url, options);
    if ([401, 440].includes(response.status)) {
      return false;
    }
    if (!response.json && response.url != url && response.contentType?.toLowerCase().split(";")[0].trim() == "text/html") {
      return false;
    }
    return true;
  }

  async verifyLogin(): Promise<void> {
    if (this.mainAccount) {
      throw new NotReached();
    }
    await this.loginCommon(true);
  }

  /**
   * OWA full page login resembles OAuth2, so we label it as such,
   * although it's actually Office 365 itself doing its own OAuth2.
   */
  protected async loginCommon(interactive: boolean): Promise<void> {
    if (this.authMethod == AuthMethod.OAuth2) {
      this.oAuth2 ??= new OWAAuth(this);
      await this.oAuth2.login(interactive);
    } else if (!await this.testLoggedIn()) {
      let elements = await OWALoginBackground.findLoginElements(this.url, this.partition);
      if (!elements) {
        throw new Error(gt`Could not find login form`);
      }
      let response = await OWALoginBackground.submitLoginForm(this.username, this.password, this.partition, elements);
      let formURL = new URL(elements.url);
      let responseURL = new URL(response.url);
      if (response.status == 401 || responseURL.origin == formURL.origin && responseURL.pathname == formURL.pathname && responseURL.searchParams.get("reason") == "2") {
        throw new LoginError(null, gt`Password incorrect`);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      if (!await this.testLoggedIn()) {
        throw new LoginError(null, `Login check failed`);
      }
    }
  }

  async login(interactive: boolean): Promise<void> {
    await this.loginRunOnce.runOnce(async () => {
      if (this.mainAccount) {
        await this.mainAccount.login(interactive);
        return;
      }
      await ensureLicensed();
      await super.login(interactive);
      await this.loginCommon(interactive);
      this.authorizationHeader = await appGlobal.remoteApp.OWA.getAnyScrapedAuth(this.partition);
      this.hasLoggedIn = true;
      this.notifyObserversOfSubaccounts();
    });
  }

  async syncOnStartup() {
    await this.startupRunOnce.runOnce(async () => {
      try {
        // `listFolders()` will subscribe to new user-added calendars
        await super.syncOnStartup();

        // Create primary addressbook automatically
        let haveAddressbook = appGlobal.addressbooks.some(addressbook => addressbook.dependsOn(this));
        if (!haveAddressbook) {
          let response = await this.callOWA(new OWAGetPeopleFiltersRequest());
          let folder = response.find(ab => !ab.IsReadOnly && ab.FolderId?.Id); // first one is main addressbook
          let addressbook = this.createAddressbookAccount(folder, true);
          appGlobal.addressbooks.add(addressbook);
          await addressbook.save();
        }

        if (!this.isDependentAccount &&
            !appGlobal.searchOnlyAddressbooks.some(ab => ab.mainAccount == this)) {
          appGlobal.searchOnlyAddressbooks.add(new OWAGAL(this));
        }

        await this.callOWA(new OWASubscribeToNotificationRequest());

        this.notifications = this.provider() == Provider.Office365
          ? new OWAOffice365Notifications(this)
          : new OWAExchangeNotifications(this);
        this.notifications.start()
          .catch(this.errorCallback);
      } finally { // Even when the mail folders failed, so that calendar and addressbook still work
        await this.startupDependentAccounts();
      }
    });
  }

  /** The server ended our session. Unlike `logout()`, this keeps the cookies,
   * e.g. "Stay signed in", so that the next login can reuse them. */
  protected async sessionExpired(): Promise<void> {
    this.hasLoggedIn = false;
    if (this.oAuth2 instanceof OWAAuth) {
      this.oAuth2.isLoggedIn = false;
    }
    if (!this.authorizationHeader) { // on-prem
      await appGlobal.remoteApp.OWA.clearStorageData(this.partition);
    }
    this.notifyObserversOfSubaccounts();
    await this.disconnect();
  }

  async logout(): Promise<void> {
    this.hasLoggedIn = false;
    this.notifyObserversOfSubaccounts();
    await super.logout();
    if (!this.authorizationHeader) { // on-prem
      await appGlobal.remoteApp.OWA.clearStorageData(this.partition);
    }
  }

  async disconnect() {
    let galAB = appGlobal.searchOnlyAddressbooks.find(ab => ab.mainAccount == this);
    if (galAB) {
      appGlobal.searchOnlyAddressbooks.remove(galAB);
    }
  }

  needsLicense(): boolean {
    return true;
  }

  /**
   * This uses Exchange to construct the message rather than
   * building the MIME ourselves.
   */
  async send(email: EMail): Promise<void> {
    if (email.iCalMethod) {
      throw new NotSupported("Please use Exchange APIs to send iMIP messages");
    }
    let folder = email.folder as OWAFolder;
    assert(folder?.id, "Need folder to save the sent email in");
    assert((folder.account.mainAccount ?? folder.account) == (this.mainAccount ?? this), "Need saved folder to have same master account");
    if (folder.account.mainAccount) {
      let mainAccount = folder.account.mainAccount as OWAAccount;
      if (!await folder.mayCreateItems(mainAccount.emailAddress)) {
        folder = mainAccount.getSpecialFolder(SpecialFolder.Sent) as OWAFolder;
      }
    }
    let request = new OWACreateItemRequest({ SavedItemFolderId: { __type: "TargetFolderId:#Exchange", BaseFolderId: { __type: "FolderId:#Exchange", Id: folder.id } }, MessageDisposition: "SendAndSaveCopy" });
    if (email.sendRawMIME) {
      request.addField("Message", "MimeContent", btoa(email.sendRawMIME), "item:MimeContent");
    } else {
      request.addField("Message", "ItemClass", "IPM.Note", "item:ItemClass");
      request.addField("Message", "Subject", email.subject, "item:Subject");
      request.addField("Message", "Body", {
        __type: "BodyContentType:#Exchange",
        BodyType: email.html ? "HTML" : "Text",
        Value: email.html || email.text,
      }, "item:Body");
      if (email.attachments.hasItems) {
        delete request.Body.SavedItemFolderId;
        request.Body.MessageDisposition = "SaveOnly";
      }
      if (email.headers.hasItems) {
        request.addField("Message", "ExtendedProperty", [...email.headers.entries()].map(([header, value]) => ({
          ExtendedFieldURI: {
            PropertyName: header,
            DistinguishedPropertySetId: "InternetHeaders",
            PropertyType: "String",
          },
          Value: value,
        })), null);
      }
      if (email.inReplyTo) {
        request.addField("Message", "InReplyTo", email.inReplyTo, "item:InReplyTo");
      }
      if (email.replyTo) {
        addRecipients(request, "ReplyTo", [email.replyTo]);
      }
      addRecipients(request, "ToRecipients", email.to.contents);
      addRecipients(request, "CcRecipients", email.cc.contents);
    }
    addRecipients(request, "BccRecipients", email.bcc.contents);
    request.addField("Message", "From", { Mailbox: { Name: email.from.name, EmailAddress: email.from.emailAddress } }, "message:From");
    let response = await this.callOWA(request);
    if (request.Body.MessageDisposition == "SaveOnly") {
      await this.addAttachmentsAndSend(email, folder, response.Items[0].ItemId.Id);
    }
  }

  async addAttachmentsAndSend(email: EMail, folder: OWAFolder, itemID: string): Promise<void> {
    for (let attachment of email.attachments) {
      let request = new OWARequest("CreateAttachment", {
        __type: "CreateAttachmentRequest:#Exchange",
        Attachments: [{
          __type: "FileAttachment:#Exchange",
          Name: attachment.filename,
          ContentType: attachment.mimeType,
          ContentId: attachment.contentID,
          Size: attachment.size,
          IsInline: attachment.disposition == ContentDisposition.inline,
          Content: "",
        }],
        ParentItemId: {
          __type: "ItemId:#Exchange",
          Id: itemID,
        },
      });
      if (this.authorizationHeader) {
        await this.callOWAWithOffice365Attachment(request, attachment);
      } else {
        request.Body.Attachments[0].Content = await attachment.contentAsBase64();
        await this.callOWA(request);
      }
    }
    await this.callOWA(new OWAUpdateItemRequest(itemID, {
      ComposeOperation: "newMail",
      SavedItemFolderId: {
        __type: "TargetFolderId:#Exchange",
        BaseFolderId: {
          __type: "FolderId:#Exchange",
          Id: folder.id,
        }
      },
      MessageDisposition: "SendAndSaveCopy",
      SendCalendarInvitationsOrCancellations: "SendToNone",
      SuppressReadReceipts: false
    }));
  }

  async callOWAWithOffice365Attachment(aRequest: any, attachment: Attachment, mailbox?: string) {
    if (this.mainAccount) {
      let mainAccount = this.mainAccount as OWAAccount;
      return await mainAccount.callOWAWithOffice365Attachment(aRequest, attachment, this.username);
    }
    return await this.callOWAShared(this.url + "service.svc/CreateAttachmentFromLocalFile", {
      // n.b. use `await attachment.content.arrayBuffer` if you want to inspect
      body: attachment.content,
      headers: {
        Action: "CreateAttachmentFromLocalFile",
        Authorization: this.authorizationHeader,
        "x-anchormailbox": mailbox ?? this.emailAddress,
        "x-customowascenariodata": "MailboxAccess:SharedMailbox,ExplicitLogon",
        "x-owa-explicitlogonuser": mailbox ?? this.emailAddress,
        "x-owa-urlpostdata": encodeURIComponent(JSON.stringify(aRequest)),
      },
      method: "POST",
    });
  }

  async callOWA(aRequest: any, mailbox?: string): Promise<any> {
    if (this.mainAccount) {
      let mainAccount = this.mainAccount as OWAAccount;
      return await mainAccount.callOWA(aRequest, this.username);
    }
    return await this.callOWAShared(this.url + "service.svc", {
      body: JSON.stringify(aRequest),
      headers: {
        Action: aRequest.action,
        Authorization: this.authorizationHeader,
        "Content-Type": "application/json",
        "x-anchormailbox": mailbox ?? this.emailAddress,
        "x-customowascenariodata": "MailboxAccess:SharedMailbox,ExplicitLogon",
        "x-owa-explicitlogonuser": mailbox ?? this.emailAddress,
      },
      method: "POST",
    });
  }

  async callOWAShared(url: string, options: RequestInit) {
    if (!this.hasLoggedIn) {
      throw new LoginError(null, gt`Please login`);
    }
    await this.throttle.throttle();
    let lock = await this.semaphore.lock();
    let response: any;
    try {
      if (this.authorizationHeader) {
        let result = await fetch(url, options);
        response = {
          ok: result.ok,
          status: result.status,
          statusText: result.statusText,
          url: result.url,
          contentType: result.headers.get('Content-Type'),
          text: await result.text(),
        };
        try {
          response.json = JSON.parse(response.text);
        } catch (ex) {
          response.ok = false;
          response.statusText = ex.message;
        }
      } else {
        response = await appGlobal.remoteApp.OWA.fetchJSON(this.partition, url, options);
      }
    } finally {
      lock.release();
    }
    if ([401, 440].includes(response.status)) {
      await this.sessionExpired();
      throw new LoginError(null, gt`Please login`);
    }
    if (!response.ok) {
      this.throttle.waitForSecond(1);
      if (!response.json && response.url != url && response.contentType?.toLowerCase().split(";")[0].trim() == "text/html") {
        await this.sessionExpired();
        throw new Error(response.statusText);
      }
      throw new OWAError(response);
    }
    let result = response.json;
    if (result.Body) {
      result = result.Body;
    }
    if (result.ResponseMessages?.Items?.length == 1) {
      result = result.ResponseMessages.Items[0];
    }
    if (this.isThrottleError(result)) {
      return await this.callOWAShared(url, options);
    }
    if (result.MessageText) {
      this.throttle.waitForSecond(1);
      throw new OWAError(response);
    }
    return result;
  }

  /** Skips and reports failed items in a batch response,
   * e.g. broken or inaccessible items,
   * so that one broken item does not abort the entire sync.
   * @param element which array the responses hold, e.g. `Attachments` */
  itemsFromResponses(responses: any[], element: string = "Items"): any[] {
    let items = [];
    for (let response of responses) {
      if (response.ResponseClass == "Error") {
        this.errorCallback(new OWAError({ json: response }));
      } else {
        items.push(response[element][0]);
      }
    }
    return items;
  }

  async listFolders(): Promise<void> {
    await this.storage.readFolderHierarchy(this);

    await this.throttle.throttle();
    let result = await this.callOWA(owaFindFoldersRequest(true, this.sharedFolderRoot, this.username));
    if (this.sharedFolderRoot == "inbox") {
      let response = await this.callOWA(owaSharedFolderRequest(["inbox"], this.username));
      result.RootFolder.Folders.unshift(response.Folders[0]);
      result.RootFolder.ParentFolder = response.Folders[0];
    }
    this.msgFolderRootID = result.RootFolder.ParentFolder.FolderId.Id;
    let haveCalendar = this.sharedFolderRoot != null || appGlobal.calendars.some(calendar => calendar.dependsOn(this));
    this.folderMap.clear();
    for (let folder of result.RootFolder.Folders) {
      if (!folder.FolderClass || folder.FolderClass == "IPF.Note" || folder.FolderClass.startsWith("IPF.Note.")) {
        let parent = this.folderMap.get(folder.ParentFolderId.Id);
        let parentFolders = parent ? parent.subFolders : this.rootFolders;
        let owaFolder = parentFolders.find(owaFolder => owaFolder.id == folder.FolderId.Id) as OWAFolder;
        if (!owaFolder) {
          owaFolder = this.findFolder(owaFolder => owaFolder.id == folder.FolderId.Id) as OWAFolder
            ?? this.newFolder();
          let oldParentFolders = owaFolder.parent?.subFolders || this.rootFolders;
          oldParentFolders.remove(owaFolder);
          owaFolder.parent = parent || null;
          parentFolders.push(owaFolder);
        }
        owaFolder.fromJSON(folder);
        this.folderMap.set(folder.FolderId.Id, owaFolder);
      } else if (folder.DistinguishedFolderId == "calendar" && !haveCalendar) {
        // Create primary calendar automatically
        let calendar = this.createCalendarAccount(folder);
        appGlobal.calendars.add(calendar);
        await calendar.save();
      }
    }
    // Iterate from deepest to shallowest
    for (let folder of this.getAllFolders().reverse()) {
      if (!this.folderMap.has(folder.id)) {
        await folder.deleteItLocally();
      }
    }
    for (let folder of this.getAllFolders()) {
      await folder.save();
    }
  }

  protected isThrottleError(result: any): boolean {
    if (result.MessageText &&
        (result.ResponseCode == "OverBudgetException" ||
         result.ResponseCode == "ErrorTooManyObjectsOpened")) {
      let match = result.MessageText.match(/'MaxConcurrency'.*'(\d+)'.*'Owa'/);
      let maxConcurrency = match ? Number(match[1]) : this.semaphore.countRunning + 1;
      if (maxConcurrency < this.semaphore.maxParallel) {
        const minConcurrency = 3;
        this.semaphore.maxParallel = Math.max(maxConcurrency, minConcurrency);
        console.log(`Server busy, reduced max concurrency to ${this.semaphore.maxParallel}`);
      }
      this.throttle.waitForSecond(5);
      return true;
    }
    return false;
  }

  provider(): Provider | null {
    return this.authorizationHeader != null
      ? Provider.Office365
      : super.provider();
  }

  async createToplevelFolder(name: string): Promise<OWAFolder> {
    if (this.sharedFolderRoot == "inbox") {
      throw new Error(gt`You only have access to the Inbox of this shared account`);
    }
    let result = await this.callOWA(owaCreateNewTopLevelFolderRequest(name, this.sharedFolderRoot && this.username));
    let folder = await super.createToplevelFolder(name) as OWAFolder;
    folder.id = sanitize.nonemptystring(result.Folders[0].FolderId.Id);
    this.folderMap.set(folder.id, folder);
    return folder;
  }

  async onNotificationMessages(messages: any[][]) {
    let newMessageIDs: string[] = [];
    for (let message of messages) {
      for (let notification of message) {
        switch (notification.id) {
        case "HierarchyNotification":
          this.handleHierarchyNotification(notification);
          break;
        case "NewMailNotification":
          newMessageIDs.push(notification.ItemId);
          break;
        default:
          //console.log(notification);
          break;
        }
      }
    }
    if (newMessageIDs.length) {
      let inbox = this.inbox as OWAFolder;
      // A concurrent folder listing may have already picked up the message
      newMessageIDs = newMessageIDs.filter((id, i, ids) => !inbox.getEmailByItemID(id) && ids.indexOf(id) == i);
      let newMessages = await inbox.getNewMessageHeaders(newMessageIDs);
      for (let msg of newMessages) {
        msg.isNewArrived = true;
      }
      inbox.messages.addAll(newMessages);
      inbox.downloadMessages(newMessages)
        .catch(this.errorCallback);
      inbox.dirty = false; // probably
    }
  }

  protected handleHierarchyNotification(notification: any) {
    try {
      let addressbook = appGlobal.addressbooks.find((addressbook: OWAAddressbook) => addressbook.mainAccount == this && addressbook.folderID == notification.folderId) as OWAAddressbook | null;
      if (addressbook) {
        addressbook.listContacts().catch(this.errorCallback);
        return;
      }
      let calendar = appGlobal.calendars.find((calendar: OWACalendar) => calendar.mainAccount == this && calendar.folderID == notification.folderId) as OWACalendar | null;
      if (calendar) {
        calendar.listEvents().catch(this.errorCallback);
        return;
      }
      let parent = this.folderMap.get(notification.parentFolderId);
      if (!parent && notification.parentFolderId != this.msgFolderRootID) {
        return;
      }
      let folder = this.folderMap.get(notification.folderId);
      if (!folder) {
        let parentFolders = parent ? parent.subFolders : this.rootFolders;
        folder = this.newFolder();
        folder.parent = parent || null;
        parentFolders.push(folder);
        this.folderMap.set(notification.folderId, folder);
      }
      folder.fromJSON({
        FolderId: { Id: notification.folderId },
        DisplayName: notification.displayName,
        TotalCount: notification.itemCount,
        UnreadCount: notification.unreadCount,
      });
      // We get hierachy notifications for e.g. flag changes,
      // so we should always refresh a folder after a notification.
      folder.dirty = true;
    } catch (ex) {
      this.errorCallback(ex);
    }
  }

  get mayHaveSubAccounts(): boolean {
    return true;
  }

  async listPossibleSubAccounts(): Promise<ArrayColl<Account>> {
    let accounts = await super.listPossibleSubAccounts();
    if (this.isDependentAccount) {
      return accounts;
    }
    let response = await this.callOWA(new OWAGetPeopleFiltersRequest());
    let addressbooks = response.filter(ab => !ab.IsReadOnly && ab.FolderId?.Id);
    let result = await this.callOWA(owaFindFoldersRequest(true));
    let calendars = result.RootFolder.Folders.filter(folder => folder.FolderClass == "IPF.Appointment");
    for (let dependentAcc of this.dependentAccounts()) {
      if (dependentAcc instanceof OWAAccount) {
        let result = await this.callOWA(owaSharedFolderRequest(["contacts", "calendar"], dependentAcc.username));
        for (let folder of result.ResponseMessages.Items.filter(folder => folder.ResponseClass == "Success").map(folder => folder.Folders[0])) {
          folder.dependentAcc = dependentAcc; // passed to creation functions below
          if (folder.DistinguishedFolderId == "contacts") {
            addressbooks.push(folder);
          }
          if (folder.DistinguishedFolderId == "calendar") {
            calendars.push(folder);
          }
        }
      }
    }
    accounts.addAll(addressbooks.map((ab, i) => this.createAddressbookAccount(ab, i == 0, ab.dependentAcc)).filter(Boolean));
    accounts.addAll(calendars.map(cal => this.createCalendarAccount(cal, cal.dependentAcc)).filter(Boolean));
    try {
      for (let calendar of await OWACalendarShortcut.listCalendars(this)) {
        if (!accounts.find(account => account.protocol == "calendar-owa" &&
              (account as OWACalendar).folderID == calendar.folderID)) {
          accounts.add(calendar);
        }
      }
    } catch (ex) {
      logErrorToServer(ex);
    }
    return accounts;
  }

  private createAddressbookAccount(folder: any, isPrimary: boolean, dependentAcc?: OWAAccount): OWAAddressbook | null {
    assert(!folder.IsReadOnly && folder.FolderId?.Id, "Need writable addressbook");
    if (this.dependentAccounts().find(account => account.protocol == "addressbook-owa" &&
          (account as OWAAddressbook).folderID == folder.FolderId.Id)) {
      return null;
    }
    let addressbook = newAddressbookForProtocol("addressbook-owa") as OWAAddressbook;
    addressbook.initFromMainAccount(this);
    if (!isPrimary && folder.DisplayName) {
      addressbook.name = `${(dependentAcc || this).name} ${sanitize.nonemptylabel(folder.DisplayName)}`;
    }
    if (dependentAcc) {
      addressbook.username = dependentAcc.username;
      addressbook.color = dependentAcc.color;
    }
    addressbook.folderID = sanitize.nonemptystring(folder.FolderId.Id);
    return addressbook;
  }

  createCalendarAccount(folder: any, owner?: OWAAccount | { name: string, username: string, color: string }): OWACalendar | null{
    assert(folder.FolderClass == "IPF.Appointment", "Need calendar");
    if (this.dependentAccounts().find(account => account.protocol == "calendar-owa" &&
          (account as OWACalendar).folderID == folder.FolderId.Id)) {
      return null;
    }
    let calendar = newCalendarForProtocol("calendar-owa") as OWACalendar;
    calendar.initFromMainAccount(this);
    let isPrimary = folder.DistinguishedFolderId == "calendar";
    calendar.useForInvitations = isPrimary;
    if ((owner || !isPrimary) && folder.DisplayName) {
      calendar.name = `${(owner || this).name} ${sanitize.nonemptylabel(folder.DisplayName)}`;
    }
    if (owner) {
      calendar.username = owner.username;
      calendar.color = owner.color;
    }
    calendar.folderID = sanitize.nonemptystring(folder.FolderId.Id);
    return calendar;
  }

  async listSharedAccountsFromOutlook(): Promise<PersonUID[]> {
    let response = await this.callOWA(new OWAGetOtherMailboxConfigurationRequest());
    return ensureArray(response?.OtherMailboxEntries)
      .map(entry => this.newSharedAccountPerson(entry?.PrincipalSMTPAddress, entry?.DisplayName))
      .filter(Boolean);
  }

  /**
   * Used by the sharing UI to identify whether this user has access to any of
   * the specified known folders of another user given their email address,
   * for example, msgfolderroot (entire mailbox), inbox, calendar, contacts.
   */
  async findSharedFolders(person: PersonUID, distinguishedIDs: string[]): Promise<string[]> {
    if (this.mainAccount) {
      throw new NotReached();
    }
    let result = await this.callOWA(owaSharedFolderRequest(distinguishedIDs, person.emailAddress));
    return result.ResponseMessages.Items.filter(folder => folder.ResponseClass == "Success").map(folder => folder.Folders[0].DistinguishedFolderId);
  }

  /**
   * Used by the sharing UI to add another user's mailbox or inbox as an account
   */
  async addSharedFolders(person: PersonUID, sharedFolderRoot: "msgfolderroot" | "inbox"): Promise<OWAAccount> {
    if (this.mainAccount) {
      throw new NotReached();
    }
    let account = newAccountForProtocol("owa") as OWAAccount;
    account.initFromMainAccount(this);
    account.color = this.colorForSharedAccount(person);
    account.name = person.name;
    account.username = person.emailAddress;
    account.emailAddress = person.emailAddress;
    account.sharedFolderRoot = sharedFolderRoot;
    let identity = account.newIdentity();
    identity.realname = person.name;
    identity.emailAddress = person.emailAddress;
    account.identities.add(identity);
    await account.save();
    appGlobal.emailAccounts.add(account);
    await account.listFolders();
    return account;
  }

  /**
   * Used by the sharing UI to add another user's addressbook as an account.
   * Only the default addressbook is supported.
   */
  async addSharedAddressbook(person: PersonUID): Promise<OWAAddressbook> {
    if (this.mainAccount) {
      throw new NotReached();
    }
    let result = await this.callOWA(owaSharedFolderRequest(["contacts"], person.emailAddress));
    let folder = result.Folders[0];
    let folderID = sanitize.nonemptystring(folder.FolderId.Id);
    let existing = this.dependentAccounts().find(account =>
      account.protocol == "addressbook-owa" && (account as OWAAddressbook).folderID == folderID) as OWAAddressbook;
    if (existing) {
      return existing;
    }
    let addressbook = newAddressbookForProtocol("addressbook-owa") as OWAAddressbook;
    addressbook.initFromMainAccount(this);
    addressbook.color = this.colorForSharedAccount(person);
    addressbook.name = `${person.name} ${folder.DisplayName}`;
    addressbook.username = person.emailAddress;
    addressbook.folderID = folderID;
    appGlobal.addressbooks.add(addressbook);
    await addressbook.listContacts();
    return addressbook;
  }

  /**
   * Used by the sharing UI to add another user's calendar as an account.
   * Only the default calendar is supported.
   */
  async addSharedCalendar(person: PersonUID): Promise<OWACalendar> {
    if (this.mainAccount) {
      throw new NotReached();
    }
    let result = await this.callOWA(owaSharedFolderRequest(["calendar"], person.emailAddress));
    let folder = result.Folders[0];
    let folderID = sanitize.nonemptystring(folder.FolderId.Id);
    let existing = this.dependentAccounts().find(account =>
      account.protocol == "calendar-owa" && (account as OWACalendar).folderID == folderID) as OWACalendar;
    if (existing) {
      return existing;
    }
    let calendar = newCalendarForProtocol("calendar-owa") as OWACalendar;
    calendar.initFromMainAccount(this);
    calendar.color = this.colorForSharedAccount(person);
    calendar.name = `${person.name} ${folder.DisplayName}`;
    calendar.username = person.emailAddress;
    calendar.folderID = folderID;
    calendar.useForInvitations = true;
    appGlobal.calendars.add(calendar);
    await calendar.listEvents();
    return calendar;
  }


  get sharePermissionLevels(): MailShareCombinedPermissions[] {
    return [MailShareCombinedPermissions.Read, MailShareCombinedPermissions.FlagChange,
      MailShareCombinedPermissions.Modify, MailShareCombinedPermissions.Custom];
  }

  canShareWithPersons(): boolean {
    return true;
  }

  async getSharedPersons(): Promise<ArrayColl<PersonUID> | null> {
    // well, some of them at least...
    return await (this.inbox as OWAFolder)?.getSharedPersons();
  }

  async deleteSharedPerson(otherPerson: PersonUID) {
    for (let folder of this.getAllFolders()) {
      await deleteExchangePermissions(folder as OWAFolder, otherPerson);
    }
  }

  async addSharedPerson(otherPerson: PersonUID, mailFolder: OWAFolder | null, includeSubfolders: boolean, access: MailShareCombinedPermissions, ...permissions: MailShareIndividualPermissions[]) {
    // XXX Need root folder to share all mail
    let foldersToShare = (!mailFolder ? this.getAllFolders() : includeSubfolders ? mailFolder.getInclusiveDescendants() : new ArrayColl<Folder>([mailFolder]));
    for (let folder of foldersToShare) {
      await setExchangePermissions(folder as OWAFolder, otherPerson, access, ...permissions);
    }
  }

  get canServerFilterRules(): boolean {
    return !this.isDependentAccount;
  }

  newServerFilterRule(json: any): OWAFilterRule {
    return new OWAFilterRule(this, json);
  }

  protected async fetchServerFilterRules(): Promise<FilterRuleAction[]> {
    let response = await this.callOWAOptions(new OWAOptionsRequest("GetInboxRule"));
    return ensureArray(response.InboxRuleCollection?.InboxRules)
      .map(json => this.newServerFilterRule(json))
      .sort((a, b) => a.priority - b.priority)
      .map(serverRule => serverRule.toFilterRule());
  }

  protected async uploadServerFilterRules(rules: FilterRuleAction[], deletedIDs: string[]): Promise<void> {
    const kKeepOutlookRules = { AlwaysDeleteOutlookRulesBlob: false, Force: false };
    for (let id of deletedIDs) {
      await this.callOWAOptions(new OWAOptionsRequest("RemoveInboxRule", { Identity: { RawIdentity: id }, ...kKeepOutlookRules }));
    }
    for (let [i, rule] of rules.entries()) {
      let serverRule = this.newServerFilterRule(rule.serverJSON);
      let changed = serverRule.withChangesFrom(rule, i + 1) as OWAFilterRule;
      if (!rule.serverID) {
        let response = await this.callOWAOptions(new OWAOptionsRequest("NewInboxRule", { InboxRule: changed.newParameters, ...kKeepOutlookRules }));
        rule.serverID = this.newServerFilterRule(response.InboxRule).id;
      } else if (changed.isChangedFrom(serverRule)) {
        await this.callOWAOptions(new OWAOptionsRequest("SetInboxRule", { InboxRule: changed.setParameters(serverRule), ...kKeepOutlookRules }));
      }
    }
  }

  /** The commands of the OWA options report errors in their own way */
  protected async callOWAOptions(request: OWAOptionsRequest): Promise<any> {
    let response = await this.callOWA(request);
    if (response.WasSuccessful === false) {
      const kPromptUser = 4;
      if (response.ErrorCode == kPromptUser || response.ErrorCode == "PromptUser") {
        // The only question of the rule commands: Delete the copy of the rules that Outlook keeps?
        this.setOutlookRulesExist(true);
        throw new UserError(this.serverFilterRulesReadOnlyReason);
      }
      throw new Error(sanitize.label(response.ErrorMessage, null) || sanitize.label(response.UserPrompt, null) || gt`The mail server could not process the rules`);
    }
    return response;
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.sharedFolderRoot = sanitize.enum(json.sharedFolderRoot, ["msgfolderroot", "inbox"], null);
  }

  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.sharedFolderRoot = this.sharedFolderRoot;
    return json;
  }
}

function addRecipients(aRequest: any, aType: string, aRecipients: PersonUID[]): void {
  if (!aRecipients.length) {
    return;
  }
  aRequest.addField("Message", aType, aRecipients.map(recipient => ({
    Name: recipient.name,
    EmailAddress: recipient.emailAddress,
  })), "message:" + aType);
}

class OWAGetOtherMailboxConfigurationRequest {
  get action() {
    return "GetOtherMailboxConfiguration";
  }
}

class OWAGetPeopleFiltersRequest {
  /** This is an empty request, but it still needs an action. */
  get action() {
    return "GetPeopleFilters";
  }
}

export const kMaxFetchCount = 50;
