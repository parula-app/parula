import { ExchangeMailAccount } from "./ExchangeMailAccount";
import { AuthMethod, type Account } from "../../Abstract/Account";
import type { EMail } from "../EMail";
import { SpecialFolder, MailShareCombinedPermissions, type Folder, type MailShareIndividualPermissions } from "../Folder";
import { EWSFolder, getEWSItem } from "./EWSFolder";
import { EWSSearchEMail } from "./EWSSearchEMail";
import { deleteExchangePermissions, setExchangePermissions } from "./ExchangePermission";
import { EWSCreateItemRequest } from "./Request/EWSCreateItemRequest";
import type { EWSDeleteItemRequest } from "./Request/EWSDeleteItemRequest";
import type { EWSUpdateItemRequest } from "./Request/EWSUpdateItemRequest";
import { EWSError, EWSItemError } from "./EWSError";
import type { EWSAddressbook } from "../../Contacts/EWS/EWSAddressbook";
import type { EWSCalendar } from "../../Calendar/EWS/EWSCalendar";
import { EWSGAL } from "../../Contacts/EWS/EWSGAL";
import { newAccountForProtocol } from "../AccountsList/MailAccounts";
import { newAddressbookForProtocol } from "../../Contacts/AccountsList/Addressbooks";
import { newCalendarForProtocol} from "../../Calendar/AccountsList/Calendars";
import type { PersonUID } from "../../Abstract/PersonUID";
import { getOAuth2BuiltIn } from "../../Auth/OAuth2Util";
import { NTLMConnectionPool } from "../../Auth/NTLM/NTLMConnectionPool";
import { NTLMChromiumSession } from "../../Auth/NTLM/NTLMChromiumSession";
import { ContentDisposition } from "../../Abstract/Attachment";
import { ConnectError, LoginError } from "../../Abstract/Account";
import { appGlobal } from "../../app";
import { XML2JSON, JSON2XML } from "./XML2JSON";
import { EWSCalendarShortcut } from "../../Calendar/EWS/EWSCalendarShortcut";
import { ensureLicensed } from "../../util/LicenseClient";
import { Throttle } from "../../util/flow/Throttle";
import { Timeout } from "../../util/flow/Timeout";
import { Semaphore } from "../../util/flow/Semaphore";
import { ConnectionPurpose } from "./ConnectionPurpose";
import { RunOnce } from "../../util/flow/RunOnce";
import { Lock } from "../../util/flow/Lock";
import { notifyChangedProperty } from "../../util/Observable";
import { isNetworkError } from "../../util/netUtil";
import { logErrorToServer } from "../../util/error";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert, ensureArray, sleep, NotReached, NotSupported, type Json } from "../../util/util";
import { base64ToUint8Array } from "../../util/blob";
import { gt } from "../../../l10n/l10n";
import { ArrayColl } from "svelte-collections";

export class EWSAccount extends ExchangeMailAccount implements EWSSubscribable {
  readonly protocol: string = "ews";
  readonly folderMap = new Map<string, EWSFolder>;
  /** The login worked and we fetched the folder list, so the account
   * is ready to take commands. Not merely: we have a password. */
  @notifyChangedProperty
  protected hasLoggedIn = false;
  protected throttle = new Throttle(50, 1);
  /** How many requests may be underway at the same time.
   * The user commands have their own budget, so that they never wait for
   * the background download. @see `ConnectionPurpose`
   * @see `NTLMConnectionPool` has its own limits for TCP conn on top of this. */
  protected semaphores = new Map<ConnectionPurpose, Semaphore>([
    [ConnectionPurpose.Fetch, new Semaphore(16)],
    [ConnectionPurpose.Display, new Semaphore(4)],
  ]);
  protected loginRunOnce = new RunOnce();
  protected startupRunOnce = new RunOnce();
  /** NTLM authenticates TCP connections, not HTTP requests, so it needs
   * connections that we control. Only for `AuthMethod.NTLM`. */
  protected ntlmTransport: NTLMChromiumSession | NTLMConnectionPool | null = null;
  @notifyChangedProperty
  protected _useChromiumNTLM = false;
  /** null: if this is our account
   * msgfolderroot: if this is an account shared with us
   * inbox: if this is an inbox shared with us */
  protected sharedFolderRoot: "msgfolderroot" | "inbox" | null;
  /** AbortController for streaming notifications */
  protected notificationAbort: Record<string, AbortController> = {};
  protected subscribeLock = new Lock();
  /** SubscriptionId for unsubscribing on disconnect */
  subscriptionID?: string;

  newFolder(): EWSFolder {
    return new EWSFolder(this);
  }

  newSearch(): EWSSearchEMail {
    return new EWSSearchEMail();
  }

  get folderID(): string {
    return this.inbox.id;
  }

  get isLoggedIn(): boolean {
    if (this.mainAccount) {
      return this.mainAccount.isLoggedIn;
    }
    return this.hasLoggedIn &&
      (this.authMethod != AuthMethod.OAuth2 || this.oAuth2?.isLoggedIn);
  }

  async verifyLogin(): Promise<void> {
    if (this.mainAccount) {
      throw new NotReached();
    }
    await this.loginCommon(true);

    let query = {
      m$FindFolder: {
        Traversal: "Shallow",
        m$FolderShape: {
          t$BaseShape: "IdOnly",
        },
        m$ParentFolderIds: {
          t$DistinguishedFolderId: [{
            Id: "msgfolderroot",
          }],
        },
      },
    };
    await this.callEWS(query);
  }

  protected async loginCommon(interactive: boolean): Promise<void> {
    if (this.authMethod == AuthMethod.OAuth2) {
      this.oAuth2 ??= getOAuth2BuiltIn(this);
      assert(this.oAuth2, gt`Could not find OAuth2 config for ${this.hostname}`);
      this.oAuth2.subscribe(() => {
        this.notifyObservers();
        this.notifyObserversOfSubaccounts();
      });
      await this.oAuth2.login(interactive);
    }
  }

  async login(interactive: boolean): Promise<void> {
    await this.loginRunOnce.runOnce(async () => {
      if (this.mainAccount) {
        await this.mainAccount.login(interactive);
        await (this.mainAccount as EWSAccount).subscribeToNotificationsForSubaccount(this);
        return;
      }
      await ensureLicensed(); // Not in generic `Account`, to keep license code in the proprietary parts
      await super.login(interactive);
      await this.loginCommon(interactive);
      this.hasLoggedIn = true;
      this.notifyObserversOfSubaccounts();
    });
  }

  async syncOnStartup() {
    await this.startupRunOnce.runOnce(async () => {
      try {
        await super.syncOnStartup();
        if (this.isDependentAccount) {
          return; // `login()` subscribed us to the notifications
        }
        if (!appGlobal.searchOnlyAddressbooks.some(ab => ab.mainAccount == this)) {
          appGlobal.searchOnlyAddressbooks.add(new EWSGAL(this));
        }
        // `listFolders()` will subscribe to new user-added addressbooks and calendars

        await this.subscribeToNotifications();
      } finally { // Even when the mail folders failed, so that calendar and addressbook still work
        await this.startupDependentAccounts();
      }
    });
  }

  async disconnect(): Promise<void> {
    this.hasLoggedIn = false;
    this.notifyObserversOfSubaccounts();
    if (this.mainAccount) {
      await (this.mainAccount as EWSAccount).unsubscribeNotifications(this);
    } else {
      await this.unsubscribeAllSubscriptions();
      this.ntlmTransport?.close();
      this.ntlmTransport = null;
    }

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
    let folder = email.folder as EWSFolder;
    assert(folder?.id, "Need folder to save the sent email in");
    assert((folder.account.mainAccount ?? folder.account) == (this.mainAccount ?? this), "Need saved folder to have same master account");
    if (folder.account.mainAccount) {
      let mainAccount = folder.account.mainAccount as EWSAccount;
      if (!await folder.mayCreateItems(mainAccount.emailAddress)) {
        folder = mainAccount.getSpecialFolder(SpecialFolder.Sent) as EWSFolder;
      }
    }
    let request = new EWSCreateItemRequest({ m$SavedItemFolderId: { t$FolderId: { Id: folder.id } }, MessageDisposition: "SendAndSaveCopy" });
    if (email.sendRawMIME) {
      request.addField("Message", "MimeContent", btoa(email.sendRawMIME), "item:MimeContent");
    } else {
      request.addField("Message", "ItemClass", "IPM.Note", "item:ItemClass");
      request.addField("Message", "Subject", email.subject, "item:Subject");
      request.addField("Message", "Body", {
        BodyType: email.html ? "HTML" : "Text",
        _TextContent_: email.html || email.text,
      }, "item:Body");
      if (email.attachments.hasItems) {
        request.addField("Message", "Attachments", {
          t$FileAttachment: await Promise.all(email.attachments.contents.map(async attachment => ({
            t$Name: attachment.filename,
            t$ContentType: attachment.mimeType,
            t$ContentId: attachment.contentID,
            t$Size: attachment.size,
            t$IsInline: attachment.disposition == ContentDisposition.inline,
            t$Content: await attachment.contentAsBase64(),
          }))),
        }, "item:Attachments");
      }
      if (email.inReplyTo) {
        request.addField("Message", "InReplyTo", email.inReplyTo, "item:InReplyTo");
      }
      if (email.headers.hasItems) {
        request.addField("Message", "ExtendedProperty", [...email.headers.entries()].map(([header, value]) => ({
          t$ExtendedFieldURI: {
            PropertyName: header,
            DistinguishedPropertySetId: "InternetHeaders",
            PropertyType: "String",
            // TODO Sends header names as all-lowercase. Should preserve casing.
          },
          t$Value: value,
        })), null);
      }
      // Older versions of Exchange require a specific order of parameters
      addRecipients(request, "ToRecipients", email.to.contents);
      addRecipients(request, "CcRecipients", email.cc.contents);
    }
    addRecipients(request, "BccRecipients", email.bcc.contents);
    addRecipients(request, "From", [email.from]);
    if (!email.sendRawMIME && email.replyTo) {
      addRecipients(request, "ReplyTo", [email.replyTo]);
    }
    await this.callEWS(request);
  }

  request2XML(aRequest: JsonRequest): string {
    let xml = document.implementation.createDocument("http://schemas.xmlsoap.org/soap/envelope/", "s:Envelope");
    xml.documentElement.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:s", "http://schemas.xmlsoap.org/soap/envelope/");
    xml.documentElement.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:m", "http://schemas.microsoft.com/exchange/services/2006/messages");
    xml.documentElement.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:t", "http://schemas.microsoft.com/exchange/services/2006/types");
    JSON2XML({
      t$RequestServerVersion: {
        Version: "Exchange2013",
      },
      t$TimeZoneContext: {
        t$TimeZoneDefinition: {
          Id: "UTC",
        },
      },
    }, xml.documentElement, "http://schemas.xmlsoap.org/soap/envelope/", "s:Header");
    JSON2XML(aRequest as Json, xml.documentElement, "http://schemas.xmlsoap.org/soap/envelope/", "s:Body");
    return new XMLSerializer().serializeToString(xml);
  }

  checkResponse(aResponse: Record<string, any>, aRequest: JsonRequest): Json {
    let responseXML = aResponse.responseXML as XMLDocument;
    if (!responseXML) {
      throw new EWSError(aResponse, aRequest);
    }
    // Free/Busy is a special snowflake and has its own element.
    let freebusy = responseXML.querySelector("FreeBusyResponseArray");
    if (freebusy) {
      return ensureArray(getEWSItem(XML2JSON(freebusy)));
    }
    // GetDelegate returns a possibly missing array of responses
    let delegate = responseXML.querySelector("GetDelegateResponse");
    if (delegate?.getAttribute("ResponseClass") == "Success") {
      return [...responseXML.querySelectorAll("DelegateUser")].map(user => XML2JSON(user));
    }
    let messages = responseXML.querySelector("ResponseMessages");
    if (!messages) {
      throw new EWSError(aResponse, aRequest);
    }
    let message = Object.values(XML2JSON(messages))[0];
    if (message.ResponseClass == "Error") {
      throw new EWSItemError(message, aRequest);
    }
    return message;
  }

  parseXML(aXMLasText: string): Document {
    let cleanText = aXMLasText.replace(/&#x([0-8BCEF]|1[0-9A-F]|D[89A-F][0-9A-F][0-9A-F]|FFF[EF]);/gi, "");
    let document = new DOMParser().parseFromString(cleanText, "text/xml");
    return document.getElementsByTagName('parsererror').length ? null : document;
  }

  isThrottleError(ex: EWSItemError): boolean {
    if (ex.type != "ErrorServerBusy") {
      return false;
    }
    // Check whether the ConcurrentSyncCalls policy was exceeded.
    if (/'ConcurrentSyncCalls'.*'(\d+)'.*'Ews'/.test(ex.message) && Number(RegExp.$1) < this.throttle.maxTasks) {
      this.throttle.maxTasks = Number(RegExp.$1);
      console.log(`Server busy, reduced max concurrency to ${this.throttle.maxTasks}`);
    }
    let milliseconds = Number(ex.error.MessageXml?.Value?.Value);
    if (!milliseconds) {
      // Server isn't asking us to back off, so give up.
      throw ex;
    }
    if (milliseconds > 20000) {
      milliseconds = 20000; // Sensible upper limit
    }
    console.log(`Server busy, using ${milliseconds}ms backoff time`);
    this.throttle.waitForSecond(milliseconds / 1000);
    return true;
  }

  /** User setting: Use the Chromium network stack (HTTP and NTLM)
   * instead of our own NTLM implementation.
   * Honored only if the authentication is NTLM. */
  get useChromiumNTLM(): boolean {
    return this._useChromiumNTLM;
  }
  set useChromiumNTLM(val: boolean) {
    if (val == this._useChromiumNTLM) {
      return;
    }
    // Use the other implementation from now on
    this.ntlmTransport?.close();
    this.ntlmTransport = null;
    this._useChromiumNTLM = val;
  }

  /** For `AuthMethod.NTLM`. It authenticates each TCP connection. */
  protected get ntlm(): NTLMChromiumSession | NTLMConnectionPool {
    assert(this.username && this.password, gt`Need username and password`);
    return this.ntlmTransport ??= appGlobal.remoteApp.newNetSession && this.useChromiumNTLM
      ? new NTLMChromiumSession(this)
      : new NTLMConnectionPool(this);
  }

  createRequestOptions({ body, signal }: { body?: string, signal?: AbortSignal } = {}): any {
    let options: any = {
      body,
      headers: {
        'Content-Type': kXMLContentType,
      },
      method: "POST",
      signal,
    };
    if (this.authMethod == AuthMethod.OAuth2) {
      if (!this.oAuth2.isLoggedIn) {
        throw new LoginError(null, gt`Please login`);
      }
      options.headers.Authorization = this.oAuth2.authorizationHeader;
    } else if (this.authMethod == AuthMethod.NTLM) {
      throw new NotReached("NTLM requests go through the NTLM transport");
    } else if (this.authMethod == AuthMethod.Password) {
      options.headers.Authorization = `Basic ${btoa(unescape(encodeURIComponent(`${this.username}:${this.password}`)))}`;
    } else if (this.authMethod == AuthMethod.Unknown) {
      // triggers 401, which gives us WWW-Authenticate HTTP response header, which lists the login methods supported by the server
    } else {
      throw new NotReached(`Unknown authentication method ${this.authMethod}`);
    }
    return options;
  }

  /**
   * Make a HTTP call to the server.
   * @param options for internal use only
   * @returns XML2JSON = XML as JSON. What the server returned.
   */
  async callEWS(aRequest: JsonRequest, purpose = ConnectionPurpose.Display, options?: any): Promise<any> {
    if (this.mainAccount) {
      return await (this.mainAccount as EWSAccount).callEWS(aRequest, purpose, options);
    }
    await this.throttle.throttle();

    if (this.oAuth2 && !this.oAuth2.isLoggedIn) {
      await this.oAuth2.login(false);
    }

    let startTime = Date.now();
    let lock = await this.semaphores.get(purpose).lock();
    let response: any;
    try {
      response = this.authMethod == AuthMethod.NTLM
        ? await this.ntlm.request(this.request2XML(aRequest), { headers: { 'Content-Type': kXMLContentType }, purpose })
        : await fetch(this.url, this.createRequestOptions({ body: this.request2XML(aRequest) }));
    } finally {
      lock.release();

      let seconds = Math.round((Date.now() - startTime) / 100) / 10;
      if (purpose == ConnectionPurpose.Display && seconds > 3) {
        logErrorToServer(new Error(`Server needed ${seconds} seconds to answer`));
      }
    }
    try {
      response.responseText = await response.text();
    } catch (ex) {
      response.responseText = "";
    }
    this.fatalError = null;
    if (response.status == 200) {
      try {
        response.responseXML = this.parseXML(response.responseText);
        return this.checkResponse(response, aRequest);
      } catch (ex) {
        if (this.isThrottleError(ex)) {
          return await this.callEWS(aRequest, purpose);
        } else {
          this.throttle.waitForSecond(1);
          throw ex;
        }
      }
    }
    if (response.status == 401) {
      const repeat = async (options: any = {}) => {
        options.isRepeating = true;
        return await this.callEWS(aRequest, purpose, options); // repeat the call
      }
      if (options?.isRepeating) {
        let ex = new EWSError(response, aRequest);
        throw new LoginError(ex, gt`Login failed`);
      } else if (this.oAuth2) {
        await this.oAuth2.reset();
        await this.oAuth2.login(false); // will throw error, if interactive login is needed
        return repeat();
      } else if (this.authMethod == AuthMethod.NTLM) {
        // Login can fail transiently, e.g. when the connection closed during the login handshake
        return repeat();
      } else if (this.authMethod == AuthMethod.Password) {
        assert(/\bBasic\b/.test(response.headers.get("WWW-Authenticate")), gt`Your account is configured to use ${gt`Password`} authentication, but your server does not support it. Please change your account settings or set up the account again.`);
        throw this.fatalError = new LoginError(null, gt`Password incorrect`);
      } else if (this.authMethod == AuthMethod.Unknown) {
        if (/\bBasic\b/.test(response.headers.get("WWW-Authenticate"))) {
          this.authMethod = AuthMethod.Password;
        } else if (/\bNTLM\b/.test(response.headers.get("WWW-Authenticate"))) {
          this.authMethod = AuthMethod.NTLM;
        } else {
          throw this.fatalError = new ConnectError(null,
            gt`Unsupported authentication protocol(s): ${response.headers.get("WWW-Authenticate")}`);
        }
        return repeat();
      } else {
        throw this.fatalError = new ConnectError(null,
          gt`Server supports authentication protocol(s): ${response.headers.get("WWW-Authenticate")}. Please check your account configuration.`);
      }
    } else {
      this.throttle.waitForSecond(1);
      response.responseXML = this.parseXML(response.responseText);
      throw new EWSError(response, aRequest);
    }
  }

  /** @param username stable ID per stream, e.g. the streamed account's username */
  async callStream(request: Json, abort: AbortController, responseCallback: (message: Record<string, any>) => Promise<void>, username: string) {
    const kRetrySeconds = 10;
    let lastAttempt: number;
    let signal = abort.signal;
    // Exchange sends a heartbeat every 45 seconds. Without it, the connection is dead, e.g. after a VPN drop,
    // which doesn't always end the stream, or the stream below ended right away.
    let watchdog = new Timeout(2 * 45, () => {
      if (!signal.aborted) { // not replaced by a newer stream, nor unsubscribed
        this.streamNotifications(username)
          .catch(this.errorCallback);
      }
    });
    do {
      try {
        lastAttempt = Date.now();
        if (this.oAuth2 && !this.oAuth2.isLoggedIn) {
          await this.oAuth2.login(false); // e.g. the access token expired while the computer slept
        }
        const endEnvelope = "</Envelope>";
        let body = this.request2XML(request);
        let data = "";
        const processChunk = async (chunk: string) => {
          watchdog.fulfilled(); // processing the notifications may take longer
          data += chunk;
          while (data.includes(endEnvelope)) {
            let pos = data.indexOf(endEnvelope) + endEnvelope.length;
            chunk = data.slice(0, pos);
            data = data.slice(pos);
            try {
              let document = this.parseXML(chunk);
              if (!document) {
                continue;
              }
              let messages = document.querySelector("ResponseMessages");
              if (!messages) {
                continue;
              }
              let message = Object.values(XML2JSON(messages))[0];
              if (message.ResponseClass == "Error") {
                throw new EWSItemError(message, request);
              }
              if (message.ConnectionStatus == "Closed") {
                continue; // Re-open connection
              }
              await responseCallback(message);
            } catch (ex) {
              if (signal.aborted) {
                continue; // Server errors on cancel
              }
              if (ex.type == "ErrorSubscriptionNotFound" || ex.type == "ErrorMissedNotificationEvents") {
                // The server dropped it, e.g. while the computer slept
                await this.resubscribeNotifications(username);
                return; // it restarted the stream, and aborted this one
              }
              this.errorCallback(ex);
              if (ex instanceof EWSItemError) {
                return; // The server refused the stream, e.g. for missing rights. It would answer the same, if the watchdog asked again.
              }
            }
          }
          watchdog.restart();
        };
        let response: any;
        if (this.authMethod == AuthMethod.NTLM) {
          // The stream runs for up to 29 minutes, so give it its own
          // TCP connection, outside of the pool.
          let conn = this.ntlm.newDedicatedConnection(username);
          let onAbort = () => conn.close(); // the only way to abort the stream
          signal.addEventListener("abort", onAbort);
          try {
            assert(!signal.aborted, "Stream was aborted");
            // Streams via `processChunk`. Resolves once the stream ended.
            response = await conn.request(body, { headers: { 'Content-Type': kXMLContentType }, onChunk: processChunk });
          } finally {
            signal.removeEventListener("abort", onAbort);
            conn.close();
          }
        } else {
          response = await fetch(this.url, this.createRequestOptions({ body, signal }));
        }
        if (!response.ok) {
          console.error(`callStream failed with HTTP ${response.status} ${response.statusText}`);
          return;
        }
        if (response.body) { // `fetch()`. The NTLM path streamed via `processChunk` above.
          for await (let chunk of response.body.pipeThrough(new TextDecoderStream())) {
            await processChunk(chunk);
          }
        }
      } catch (ex) {
        if (signal.aborted) {
          // Log only for development purposes.
          console.log(signal.reason);
          break;
        }
        if (isNetworkError(ex) || ex?.message == "terminated") { // `fetch()` says "terminated"
          // Connection broke down, which is normal after a while.
          // Loop and re-open the connection.
          watchdog.restart(); // e.g. it failed while we processed a chunk, which pauses the watchdog
          if (Date.now() - lastAttempt < kRetrySeconds * 1000) {
            await sleep(kRetrySeconds); // e.g. the VPN tunnel isn't up yet
          }
          continue;
        }
        this.errorCallback(ex);
        watchdog.fulfilled();
        break;
      }
    } while (!signal.aborted && Date.now() - lastAttempt >= kRetrySeconds * 1000) // quit when the stream ended sooner. The watchdog tries again later.
  }

  /** The server lost our subscription. Get a new one, which restarts the stream. */
  protected async resubscribeNotifications(username: string) {
    if (username == this.username) {
      await this.subscribeToNotifications(true);
      // The new subscription doesn't know what happened before, e.g. mail that arrived while the computer slept
      this.inbox?.getNewMessages()
        .catch(this.errorCallback);
      return;
    }
    for (let account of this.subscribedAccounts(username)) {
      await this.subscribeToNotificationsForSubaccount(account, true);
    }
  }

  async unsubscribeAllSubscriptions() {
    for (let emailAddress in this.notificationAbort) {
      this.notificationAbort[emailAddress].abort("Disconnect requested");
    }
    this.notificationAbort = {};
    // Unsubscribe accepts only a single subscription ID per call
    for (let account of [this as EWSSubscribable, ...this.dependentAccounts().contents.filter((account: Account): account is EWSSubscribable => (account as EWSSubscribable).subscriptionID != undefined)]) {
      if (!account.subscriptionID) {
        continue;
      }
      let unsubscribe = {
        m$Unsubscribe: {
          m$SubscriptionId: account.subscriptionID,
        },
      };
      try {
        await this.callEWS(unsubscribe);
      } catch (ex) {
        this.errorCallback(ex);
      }
      account.subscriptionID = undefined;
    }
  }

  async unsubscribeNotifications(account: EWSSubscribable) {
    if (!account.subscriptionID) {
      return;
    }
    try {
      this.notificationAbort[account.username]?.abort("Unsubscribing");
      let unsubscribe = {
        m$Unsubscribe: {
          m$SubscriptionId: account.subscriptionID,
        },
      };
      account.subscriptionID = undefined;
      await this.callEWS(unsubscribe);
    } catch (ex) {
      this.errorCallback(ex);
    } finally {
      await this.streamNotifications(account.username);
    }
  }

  /** @param renew The server lost our subscription. Until we have a new one, we keep the lost one,
   *   so that a restarted stream finds out again, and we try again. */
  async subscribeToNotifications(renew = false) {
    let lock = await this.subscribeLock.lock();
    try {
      if (this.subscriptionID && !renew) {
        console.warn("EWS: Trying to re-subscribe");
        // E.g. re-login after connection loss. The subscription is still ours,
        // but the stream that carries it died with the connection.
        await this.streamNotifications(this.username);
        return;
      }
      let subscribe = {
        m$Subscribe: {
          m$StreamingSubscriptionRequest: {
            t$EventTypes: {
              t$EventType: [
                "CopiedEvent",
                "CreatedEvent",
                "DeletedEvent",
                "ModifiedEvent",
                "MovedEvent",
                "NewMailEvent",
              ],
            },
            SubscribeToAllFolders: true,
          },
        },
      };
      let response = await this.callEWS(subscribe);
      this.subscriptionID = sanitize.nonemptystring(response.SubscriptionId);
      await this.streamNotifications(this.username);
    } finally {
      lock.release();
    }
  }

  /** @param renew @see `subscribeToNotifications()` */
  async subscribeToNotificationsForSubaccount(account: EWSSubscribable, renew = false) {
    let lock = await this.subscribeLock.lock();
    try {
      if (account.subscriptionID && !renew) {
        console.warn("EWS: Trying to re-subscribe");
        // E.g. re-login after connection loss. The subscription is still ours,
        // but the stream that carries it died with the connection.
        await this.streamNotifications(account.username);
        return;
      }
      let subscribe = {
        m$Subscribe: {
          m$StreamingSubscriptionRequest: {
            t$FolderIds: {
              t$FolderId: {
                Id: account.folderID,
              },
            },
            t$EventTypes: {
              t$EventType: [
                "CopiedEvent",
                "CreatedEvent",
                "DeletedEvent",
                "ModifiedEvent",
                "MovedEvent",
              ],
            },
          },
        },
      };
      let response = await this.callEWS(subscribe);
      account.subscriptionID = sanitize.nonemptystring(response.SubscriptionId);
      await this.streamNotifications(account.username);
    } finally {
      lock.release();
    }
  }

  /** The shared mailboxes that stream their notifications under this user name */
  protected subscribedAccounts(username: string): EWSSubscribable[] {
    return this.dependentAccounts().contents.filter(
      (account: Account): account is EWSSubscribable => account.username == username && (account as EWSSubscribable).subscriptionID != undefined);
  }

  async streamNotifications(username: string) {
    this.notificationAbort[username]?.abort("Restarting stream due to changed subscription");
    this.notificationAbort[username] = new AbortController();
    let subscriptions = username == this.username
      ? [this.subscriptionID]
      : this.subscribedAccounts(username).map(account => account.subscriptionID);
    if (!subscriptions.length) {
      return;
    }
    let streamRequest = {
      m$GetStreamingEvents: {
        m$SubscriptionIds: {
          t$SubscriptionId: subscriptions,
        },
        // Maximum number of minutes to keep a stream open.
        // In minutes, between 1 and 30, inclusive.
        m$ConnectionTimeout: 29, // minutes
      },
    };
    // Now, connect and wait for the notifications. Runs 29 minutes long, so don't `await` it.
    this.callStream(streamRequest, this.notificationAbort[username], async message => {
      for (let notification of ensureArray(message.Notifications?.Notification)) {
        await this.processNotification(notification);
      }
    }, username).catch(this.errorCallback);
  }

  async processNotification(notification: Record<string, any>) {
    let hierarchyChanged = false;
    let folderIDs = new Set<string>();
    for (let copiedEvent of ensureArray(notification.CopiedEvent)) {
      if (copiedEvent.ItemId) {
        folderIDs.add(copiedEvent.ParentFolderId.Id);
      } else if (copiedEvent.FolderId) {
        hierarchyChanged = true;
      } else {
        this.errorCallback(new Error("CopiedEvent did not conform to schema"));
      }
    }
    for (let createdEvent of ensureArray(notification.CreatedEvent)) {
      if (createdEvent.ItemId) {
        folderIDs.add(createdEvent.ParentFolderId.Id);
      } else if (createdEvent.FolderId) {
        hierarchyChanged = true;
      } else {
        this.errorCallback(new Error("CreatedEvent did not conform to schema"));
      }
    }
    for (let deletedEvent of ensureArray(notification.DeletedEvent)) {
      if (deletedEvent.ItemId) {
        folderIDs.add(deletedEvent.ParentFolderId.Id);
      } else if (deletedEvent.FolderId) {
        hierarchyChanged = true;
      } else {
        this.errorCallback(new Error("DeletedEvent did not conform to schema"));
      }
    }
    for (let modifiedEvent of ensureArray(notification.ModifiedEvent)) {
      if (modifiedEvent.ItemId) {
        folderIDs.add(modifiedEvent.ParentFolderId.Id);
      } else if (modifiedEvent.FolderId) {
        hierarchyChanged = true;
      } else {
        this.errorCallback(new Error("ModifiedEvent did not conform to schema"));
      }
    }
    for (let movedEvent of ensureArray(notification.MovedEvent)) {
      if (movedEvent.ItemId) {
        folderIDs.add(movedEvent.OldParentFolderId.Id);
        folderIDs.add(movedEvent.ParentFolderId.Id);
      } else if (movedEvent.FolderId) {
        hierarchyChanged = true;
      } else {
        this.errorCallback(new Error("MovedEvent did not conform to schema"));
      }
    }
    for (let newMailEvent of ensureArray(notification.NewMailEvent)) {
      folderIDs.add(newMailEvent.ParentFolderId.Id);
    }
    if (hierarchyChanged) {
      try {
        await this.listFolders();
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
    for (let folderID of folderIDs) {
      try {
        let id = sanitize.string(folderID);
        let mailFolder = this.folderMap.get(id);
        if (!mailFolder) {
          // A mailbox that another user shared with us is a separate account
          // with its own folders, but its notifications arrive on our connection.
          let sharedAccount = appGlobal.emailAccounts.find((account: EWSAccount) =>
            account instanceof EWSAccount &&
            account.mainAccount == this &&
            account.folderMap?.has(id)) as EWSAccount | null;
          mailFolder = sharedAccount?.folderMap.get(id);
        }
        if (mailFolder) {
          let newMsgs = await mailFolder.updateChangedMessages();
          mailFolder.downloadMessages(newMsgs)
            .catch(this.errorCallback);
          continue;
        }
        let addressbook = appGlobal.addressbooks.find((addressbook: EWSAddressbook) =>
          addressbook.mainAccount == this &&
          addressbook.folderID == id) as EWSAddressbook | null;
        if (addressbook) {
          await addressbook.listContacts();
          continue;
        }
        let calendar = appGlobal.calendars.find((calendar: EWSCalendar) =>
          calendar.mainAccount == this &&
          calendar.folderID == id) as EWSCalendar | null;
        if (calendar) {
          await calendar.listEvents();
          continue;
        }
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
  }

  async listFolders(): Promise<void> {
    await this.storage.readFolderHierarchy(this);

    let query = {
      m$FindFolder: {
        Traversal: "Deep",
        m$FolderShape: {
          t$BaseShape: "Default",
          t$AdditionalProperties: {
            t$FieldURI: [{
              FieldURI: "folder:FolderClass",
            }, {
              FieldURI: "folder:ParentFolderId",
            }, {
              FieldURI: "folder:DistinguishedFolderId",
            }],
          },
        },
        m$ParentFolderIds: {
          t$DistinguishedFolderId: this.sharedFolderRoot
          ? {
            Id: this.sharedFolderRoot,
            t$Mailbox: {
              t$EmailAddress: this.username,
            },
          }
          : {
            Id: "msgfolderroot",
          },
        },
      },
    };
    let result = await this.callEWS(query);
    let folders = ensureArray(result.RootFolder.Folders.Folder);
    this.folderMap.clear();
    if (this.sharedFolderRoot == "inbox") {
      let request = {
        m$GetFolder: {
          m$FolderShape: {
            t$BaseShape: "Default",
            t$AdditionalProperties: {
              t$FieldURI: [{
                FieldURI: "folder:FolderClass",
              }, {
                FieldURI: "folder:ParentFolderId",
              }, {
                FieldURI: "folder:DistinguishedFolderId",
              }],
              t$ExtendedFieldURI: {
                PropertyTag: HiddenPidTag,
                PropertyType: "Boolean",
              },
            },
          },
          m$FolderIds: {
            t$DistinguishedFolderId: {
              Id: "inbox",
              t$Mailbox: {
                t$EmailAddress: this.username,
              },
            },
          },
        },
      };
      let response = await this.callEWS(request);
      folders.unshift(response.Folders.Folder);
    }
    for (let folder of folders) {
      if (!folder.FolderClass || folder.FolderClass == "IPF.Note" || folder.FolderClass.startsWith("IPF.Note.")) {
        let parent = this.folderMap.get(sanitize.string(folder.ParentFolderId.Id));
        let parentFolders = parent ? parent.subFolders : this.rootFolders;
        let ewsFolder = parentFolders.find(ewsFolder => ewsFolder.id == folder.FolderId.Id) as EWSFolder;
        if (!ewsFolder) {
          ewsFolder = this.findFolder(ewsFolder => ewsFolder.id == folder.FolderId.Id) as EWSFolder
            ?? this.newFolder();
          let oldParentFolders = ewsFolder.parent?.subFolders || this.rootFolders;
          oldParentFolders.remove(ewsFolder);
          ewsFolder.parent = parent || null;
          parentFolders.push(ewsFolder);
        }
        ewsFolder.fromXML(folder);
        this.folderMap.set(folder.FolderId.Id, ewsFolder);
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
    if (this.sharedFolderRoot) {
      return; // Don't automatically add shared addressbook or calendar.
    }
    // Create the primary address book and calendar automatically
    let haveAddressbook = appGlobal.addressbooks.some(addressbook => addressbook.dependsOn(this));
    if (!haveAddressbook) {
      let folder = ensureArray(result.RootFolder.Folders.ContactsFolder).find(folder =>
        folder.DistinguishedFolderId == "contacts" && folder.ExtendedProperty?.Value != "true");
      let addressbook = this.createAddressbookAccount(folder);
      // Add it before saving it, so that a concurrent `listFolders()` sees it
      appGlobal.addressbooks.add(addressbook);
      await addressbook.save();
    }
    let haveCalendar = appGlobal.calendars.some(calendar => calendar.dependsOn(this));
    if (!haveCalendar) {
      let folder = ensureArray(result.RootFolder.Folders.CalendarFolder).find(folder =>
        folder.DistinguishedFolderId == "calendar");
      let calendar = this.createCalendarAccount(folder);
      appGlobal.calendars.add(calendar);
      await calendar.save();
    }
  }

  async createToplevelFolder(name: string): Promise<EWSFolder> {
    if (this.sharedFolderRoot == "inbox") {
      throw new Error(gt`You only have access to the Inbox of this shared account`);
    }
    let request = {
      m$CreateFolder: {
        m$ParentFolderId: {
          t$DistinguishedFolderId: this.sharedFolderRoot
          ? {
            Id: "msgfolderroot",
            t$Mailbox: {
              t$EmailAddress: this.username,
            },
          }
          : {
            Id: "msgfolderroot",
          },
        },
        m$Folders: {
          t$Folder: {
            t$FolderClass: "IPF.Note",
            t$DisplayName: name,
          },
        },
      },
    };
    let result = await this.callEWS(request);
    let folder = await super.createToplevelFolder(name) as EWSFolder;
    folder.id = sanitize.nonemptystring(result.Folders.Folder.FolderId.Id);
    return folder;
  }

  async getUserConfigurationXML(name: string, distinguishedFolderID: string): Promise<Json | null> {
    let request = {
      m$GetUserConfiguration: {
        m$UserConfigurationName: {
          Name: name,
          t$DistinguishedFolderId: {
            Id: distinguishedFolderID,
          },
        },
        m$UserConfigurationProperties: "XmlData",
      },
    };
    let response: any;
    try {
      response = await this.callEWS(request);
    } catch (ex) {
      if (ex.type == "ErrorItemNotFound") {
        return null;
      }
      throw ex;
    }
    let xmlData = sanitize.string(response.UserConfiguration?.XmlData, null);
    if (!xmlData) {
      return null;
    }
    let xml = new TextDecoder().decode(base64ToUint8Array(xmlData));
    let root = this.parseXML(xml)?.documentElement;
    if (!root) {
      return null;
    }
    return { [root.localName]: XML2JSON(root) };
  }

  get mayHaveSubAccounts(): boolean {
    return true;
  }

  async listPossibleSubAccounts(): Promise<ArrayColl<Account>> {
    let accounts = await super.listPossibleSubAccounts();
    if (this.mainAccount) {
      return accounts;
    }
    let query = {
      m$FindFolder: {
        Traversal: "Deep",
        m$FolderShape: {
          t$BaseShape: "Default",
          t$AdditionalProperties: {
            t$FieldURI: [{
              FieldURI: "folder:FolderClass",
            }, {
              FieldURI: "folder:DistinguishedFolderId",
            }],
            t$ExtendedFieldURI: {
              PropertyTag: HiddenPidTag,
              PropertyType: "Boolean",
            },
          },
        },
        m$ParentFolderIds: {
          t$DistinguishedFolderId: {
            Id: "msgfolderroot",
          },
        },
      },
    };
    let result = await this.callEWS(query);
    let addressbooks = ensureArray(result.RootFolder.Folders.ContactsFolder)
      .filter(folder => folder.ExtendedProperty?.Value != "true");
    let calendars = ensureArray(result.RootFolder.Folders.CalendarFolder)
      .filter(folder => folder.FolderClass == "IPF.Appointment");
    for (let dependentAcc of this.dependentAccounts()) {
      if (dependentAcc instanceof EWSAccount) {
        let request = {
          m$GetFolder: {
            m$FolderShape: {
              t$BaseShape: "Default",
              t$AdditionalProperties: {
                t$FieldURI: [{
                  FieldURI: "folder:FolderClass",
                }, {
                  FieldURI: "folder:DistinguishedFolderId",
                }],
                t$ExtendedFieldURI: {
                  PropertyTag: HiddenPidTag,
                  PropertyType: "Boolean",
                },
              },
            },
            m$FolderIds: {
              t$DistinguishedFolderId: ["contacts", "calendar"].map(folder => ({
                Id: folder,
                t$Mailbox: {
                  t$EmailAddress: dependentAcc.username,
                },
              })),
            },
          },
        };
        let results = await this.callEWS(request);
        for (let result of results.filter(result => result.ResponseClass == "Success")) {
          if (result.Folders.ContactsFolder) {
            let folder = result.Folders.ContactsFolder;
            folder.dependentAcc = dependentAcc; // pass to createAddressbookAccount below
            addressbooks.push(folder);
          }
          if (result.Folders.CalendarFolder) {
            let folder = result.Folders.CalendarFolder;
            folder.dependentAcc = dependentAcc; // pass to createCalendarAccount below
            calendars.push(folder);
          }
        }
      }
    }
    accounts.addAll(addressbooks.map(ab => this.createAddressbookAccount(ab, ab.dependentAcc)).filter(Boolean));
    accounts.addAll(calendars.map(cal => this.createCalendarAccount(cal, cal.dependentAcc)).filter(Boolean));
    try {
      for (let calendar of await EWSCalendarShortcut.listCalendars(this)) {
        if (!accounts.find(account => account.protocol == "calendar-ews" &&
              (account as EWSCalendar).folderID == calendar.folderID)) {
          accounts.add(calendar);
        }
      }
    } catch (ex) {
      logErrorToServer(ex);
    }
    return accounts;
  }

  private createAddressbookAccount(folder: any, dependentAcc?: EWSAccount): EWSAddressbook | null {
    assert(folder.ExtendedProperty?.Value != "true", "Need visible addressbook");
    if (this.dependentAccounts().find(account => account.protocol == "addressbook-ews" &&
          (account as EWSAddressbook).folderID == folder.FolderId.Id)) {
      return null;
    }
    let addressbook = newAddressbookForProtocol("addressbook-ews") as EWSAddressbook;
    addressbook.initFromMainAccount(this);
    let isPrimary = !dependentAcc && folder.DistinguishedFolderId == "contacts";
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

  createCalendarAccount(folder: any, owner?: EWSAccount | { name: string, username: string, color: string }): EWSCalendar | null {
    assert(folder.FolderClass == "IPF.Appointment", "Need calendar");
    if (this.dependentAccounts().find(account => account.protocol == "calendar-ews" &&
          (account as EWSCalendar).folderID == folder.FolderId.Id)) {
      return null;
    }
    let calendar = newCalendarForProtocol("calendar-ews") as EWSCalendar;
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
    let config = await this.getUserConfigurationXML("OWA.OtherMailbox", "root") as any;
    return ensureArray(config?.OtherMailbox?.entry)
      .map(entry => this.newSharedAccountPerson(entry?.principalSMTPAddress, entry?.displayName))
      .filter(Boolean);
  }

  async findSharedFolders(person: PersonUID, DistinguishedIDs: string[]): Promise<string[]> {
    if (this.mainAccount) {
      throw new NotReached();
    }
    let request = {
      m$GetFolder: {
        m$FolderShape: {
          t$BaseShape: "IdOnly",
          t$AdditionalProperties: {
            t$FieldURI: {
              FieldURI: "folder:DistinguishedFolderId",
            },
          },
        },
        m$FolderIds: {
          t$DistinguishedFolderId: DistinguishedIDs.map(DistinguishedID => ({
            Id: DistinguishedID,
            t$Mailbox: {
              t$EmailAddress: person.emailAddress,
            },
          })),
        },
      },
    };
    try {
      let result = await this.callEWS(request);
      return result.filter(folder => folder.ResponseClass == "Success").map(folder => sanitize.string(getEWSItem(folder.Folders).DistinguishedFolderId));
    } catch (ex) {
      return [];
    }
  }

  async addSharedFolders(person: PersonUID, sharedFolderRoot: "msgfolderroot" | "inbox"): Promise<EWSAccount> {
    if (this.mainAccount) {
      throw new NotReached();
    }
    let account = newAccountForProtocol("ews") as EWSAccount;
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
    await account.loginAndStartup(false);
    return account;
  }

  async addSharedAddressbook(person: PersonUID): Promise<EWSAddressbook> {
    if (this.mainAccount) {
      throw new NotReached();
    }
    let request = {
      m$GetFolder: {
        m$FolderShape: {
          t$BaseShape: "Default",
        },
        m$FolderIds: {
          t$DistinguishedFolderId: {
            Id: "contacts",
            t$Mailbox: {
              t$EmailAddress: person.emailAddress,
            },
          },
        },
      },
    };
    let result = await this.callEWS(request);
    let folder = result.Folders.ContactsFolder;
    let folderID = sanitize.nonemptystring(folder.FolderId.Id);
    let existing = this.dependentAccounts().find(account =>
      account.protocol == "addressbook-ews" && (account as EWSAddressbook).folderID == folderID) as EWSAddressbook;
    if (existing) {
      return existing;
    }
    let addressbook = newAddressbookForProtocol("addressbook-ews") as EWSAddressbook;
    addressbook.initFromMainAccount(this);
    addressbook.color = this.colorForSharedAccount(person);
    addressbook.name = `${person.name} ${sanitize.label(folder.DisplayName)}`;
    addressbook.username = person.emailAddress;
    addressbook.folderID = folderID;
    appGlobal.addressbooks.add(addressbook);
    await addressbook.loginAndStartup(false);
    return addressbook;
  }

  async addSharedCalendar(person: PersonUID): Promise<EWSCalendar> {
    if (this.mainAccount) {
      throw new NotReached();
    }
    let request = {
      m$GetFolder: {
        m$FolderShape: {
          t$BaseShape: "Default",
        },
        m$FolderIds: {
          t$DistinguishedFolderId: {
            Id: "calendar",
            t$Mailbox: {
              t$EmailAddress: person.emailAddress,
            },
          },
        },
      },
    };
    let result = await this.callEWS(request);
    let folder = result.Folders.CalendarFolder;
    let folderID = sanitize.nonemptystring(folder.FolderId.Id);
    let existing = this.dependentAccounts().find(account =>
      account.protocol == "calendar-ews" && (account as EWSCalendar).folderID == folderID) as EWSCalendar;
    if (existing) {
      return existing;
    }
    let calendar = newCalendarForProtocol("calendar-ews") as EWSCalendar;
    calendar.initFromMainAccount(this);
    calendar.color = this.colorForSharedAccount(person);
    calendar.name = `${person.name} ${sanitize.label(folder.DisplayName)}`;
    calendar.username = person.emailAddress;
    calendar.folderID = folderID;
    calendar.useForInvitations = true;
    appGlobal.calendars.add(calendar);
    await calendar.loginAndStartup(false);
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
    return await (this.inbox as EWSFolder)?.getSharedPersons();
  }

  async deleteSharedPerson(otherPerson: PersonUID) {
    for (let folder of this.getAllFolders()) {
      await deleteExchangePermissions(folder as EWSFolder, otherPerson);
    }
  }

  async addSharedPerson(otherPerson: PersonUID, mailFolder: EWSFolder | null, includeSubfolders: boolean, access: MailShareCombinedPermissions, ...permissions: MailShareIndividualPermissions[]) {
    // XXX Need root folder to share all mail
    let foldersToShare = (!mailFolder ? this.getAllFolders() : includeSubfolders ? mailFolder.getInclusiveDescendants() : new ArrayColl<Folder>([mailFolder]));
    for (let folder of foldersToShare) {
      await setExchangePermissions(folder as EWSFolder, otherPerson, access, ...permissions);
    }
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.sharedFolderRoot = sanitize.enum(json.sharedFolderRoot, ["msgfolderroot", "inbox"], null);
    this.useChromiumNTLM = sanitize.boolean(json.useChromiumNTLM, false);
  }

  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.sharedFolderRoot = this.sharedFolderRoot;
    json.useChromiumNTLM = this.useChromiumNTLM;
    return json;
  }
}

export interface EWSSubscribable extends Account {
  /** FolderId to subscribe to */
  readonly folderID: string;
  /** SubscriptionId for unsubscribing on disconnect */
  subscriptionID?: string;
}

export type JsonRequest = Json | EWSCreateItemRequest | EWSDeleteItemRequest | EWSUpdateItemRequest;

const kXMLContentType = "text/xml; charset=utf-8";

/** @see <https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxprops/01b52d3c-d194-4a8c-83ee-4ac7506339da> */
const HiddenPidTag = "0x10F4";

function addRecipients(aRequest: any, aType: string, aRecipients: PersonUID[]): void {
  if (!aRecipients.length) {
    return;
  }
  aRequest.addField("Message", aType, {
    t$Mailbox: aRecipients.map(recipient => ({
      t$Name: recipient.name,
      t$EmailAddress: recipient.emailAddress,
    })),
  }, "message:" + aType);
}
