import { MailAccount, DeleteStrategy } from "../MailAccount";
import { AuthMethod } from "../../Abstract/Account";
import { TLSSocketType } from "../../Abstract/TCPAccount";
import { IMAPFolder } from "./IMAPFolder";
import { IMAPSearchEMail } from "./IMAPSearchEMail";
import { appGlobal } from "../../app";
import type { EMail } from "../EMail";
import { ConnectError, LoginError } from "../../Abstract/Account";
import { SpecialFolder, MailShareCombinedPermissions, MailShareIndividualPermissions } from "../Folder";
import { assert, NotReached, SpecificError } from "../../util/util";
import { retryOnTransientError } from "../../util/netUtil";
import { Lock } from "../../util/flow/Lock";
import { Throttle } from "../../util/flow/Throttle";
import { RunOnce } from "../../util/flow/RunOnce";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { appName, appVersion, siteRoot } from "../../build";
import { ArrayColl, MapColl, type Collection } from "svelte-collections";
import type { ImapFlow } from "../../../../desktop/backend/node_modules/imapflow";
import type { PersonUID } from "../../Abstract/PersonUID";
import { gt } from "../../../l10n/l10n";

export class IMAPAccount extends MailAccount {
  readonly protocol: string = "imap";
  pathDelimiter: string; /** Separator in folder path. E.g. '.' or '/', depending on server */
  deleteStrategy: DeleteStrategy = DeleteStrategy.MoveToTrash;
  /**
   * An object representing the IMAP namespaces on this server.
   * See @IMAPNamespace, @IMAPNamespaceRecord
   */
  namespaces = kDefaultNamespaces;
  /** if polling is enabled, how often to poll.
   * In minutes. 0 or null = polling disabled */
  pollIntervalMinutes = 10;
  protected connections = new MapColl<ConnectionPurpose, ImapFlow>();
  protected connectRunOnce = new MapColl<ConnectionPurpose, RunOnce<ImapFlow>>();
  connectionLock = new MapColl<ImapFlow, Lock>();
  protected throttle = new Throttle(50, 1);
  protected reconnectRunOnce = new MapColl<ConnectionPurpose, RunOnce<ImapFlow>>();
  protected loginRunOnce = new RunOnce();
  protected startupRunOnce = new RunOnce();
  /** High level logging about the commands we issue, logged by us */
  logCommands = false;
  /** Logs by ImapFlow */
  logLibrary = false;

  constructor() {
    super();
    assert(appGlobal.remoteApp.createIMAPFlowConnection, "IMAP: Need backend");
    for (let purpose of connectionPurposes) {
      this.connectRunOnce.set(purpose, new RunOnce<ImapFlow>());
      this.reconnectRunOnce.set(purpose, new RunOnce<ImapFlow>());
    }
  }

  get isLoggedIn(): boolean {
    return !!this.connections.get(ConnectionPurpose.Main);
  }

  /** @returns The purpose that the given connection currently serves */
  getConnectionPurpose(connection: ImapFlow): ConnectionPurpose | null {
    return this.connections.getKeyForValue(connection) ?? null;
  }

  async login(interactive: boolean): Promise<void> {
    await this.loginRunOnce.runOnce(async () => {
      await super.login(interactive);
      if (!this.dbID) {
        await this.storage.saveAccount(this);
      }
      await this.storage.readFolderHierarchy(this);

      await this.connection(interactive);
    });
  }

  async syncOnStartup() {
    await this.startupRunOnce.runOnce(async () => {
      this.namespaces = await this.getNamespaces();
      await super.syncOnStartup();
      this.notifyObservers();
      (this.inbox as IMAPFolder).startPolling();
      await this.startIDLE(await this.connection(false, ConnectionPurpose.Main));
    });
  }

  async verifyLogin(): Promise<void> {
    await this.connection(true);
    await this.logout(false);
  }

  async connection(interactive = false, purpose = ConnectionPurpose.Main): Promise<ImapFlow> {
    await this.throttle.throttle();
    let conn = this.connections.get(purpose);
    if (conn) {
      return conn;
    }
    return await this.connectRunOnce.get(purpose).runOnce(async () => {
      this.fatalError = null;

      // Auth method
      let usePassword = [
        AuthMethod.Password,
        AuthMethod.CRAMMD5,
        AuthMethod.GSSAPI,
        AuthMethod.NTLM,
        AuthMethod.Unknown,
      ].includes(this.authMethod);
      let useOAuth2 = [
        AuthMethod.OAuth2,
      ].includes(this.authMethod);
      if (useOAuth2) {
        assert(this.oAuth2, this.name + `: ` + gt`Need OAuth2 configuration`);
        if (!this.oAuth2.isLoggedIn) {
          await this.oAuth2.login(interactive);
        }
        assert(this.oAuth2.accessToken, this.name + `: ` + gt`OAuth2: Login failed`);
      }

      // <https://imapflow.com/module-imapflow-ImapFlow.html>
      let options = {
        host: this.hostname,
        port: this.port,
        secure: this.tls == TLSSocketType.TLS,
        doSTARTTLS: this.tls == TLSSocketType.STARTTLS,
        auth: {
          user: this.username,
          pass: usePassword ? this.password : undefined,
          accessToken: useOAuth2 ? this.oAuth2.accessToken : undefined,
          loginMethod: this.authMethod == AuthMethod.CRAMMD5 ? "AUTH=CRAM-MD5" : undefined,
        },
        clientInfo: useragent,
        tls: {
          minVersion: this.acceptOldTLS ? 'TLSv1' : undefined,
          rejectUnauthorized: !this.acceptBrokenTLSCerts,
        },
        disableAutoIdle: purpose != ConnectionPurpose.Main,
        autoIdleDelay: 2000,
        maxIdleTime: kIDLERenewalSeconds * 1000, // renew IDLE, so that server and NAT don't drop us as stale
        connectionTimeout: 5 * 1000, // 5 s connection timeout
        greetingTimeout: 5 * 1000, // 5 s greeting timeout
        socketTimeout: purpose == ConnectionPurpose.Main
          ? (2 * kIDLERenewalSeconds) * 1000 + 1 * 60 * 1000 // 2 * 5 min IDLE + 1 min leeway
          : (Math.max(this.pollIntervalMinutes, 10) + 1) * 60 * 1000, // 11 min - Fetch/Display connections time out when unused, and we re-create them on demand
        logger: false, // true, // Run backend using: `yarn run dev | npx pino-pretty -i time,msg`
        emitLogs: this.logLibrary,
      }
      // console.log("IMAP connection", options);

      let connection = await appGlobal.remoteApp.createIMAPFlowConnection(options) as ImapFlow;
      assert(connection, `Connection is null\n${this.hostname} IMAP server`);
      this.attachListeners(connection);
      this.log(null, connection, "connect", purpose);

      try {
        await connection.connect();
      } catch (ex) {
        let msg = ex?.responseText || ex?.message || "";
        if (ex.authenticationFailed) {
          throw this.fatalError = new LoginError(ex,
            "Check your login, username, and password.\n" + msg);
        } else if (ex.code == "EAUTH" || ex.code == "ClosedAfterConnectTLS") {
          throw this.fatalError = new LoginError(ex,
            "Check your login, username, and password.\n" + msg);
        } else if (ex.code == "NoConnection" || ex.code == "NoConn" || msg.startsWith("Command failed") ||
            // Offline with a dual-stack server -> node throws an `AggregateError` with an empty `message`
            !msg) {
          throw this.fatalError = new ConnectError(ex,
            "Failed to connect to server " + this.hostname + " for account " + this.name);
        } else {
          throw this.fatalError = new ConnectError(ex, msg);
        }
      }
      this.connections.set(purpose, connection);
      this.connectionLock.set(connection, new Lock());
      if (purpose == ConnectionPurpose.Main) {
        this.notifyObservers();
      }
      this.log(null, connection, "connected");
      return connection;
    });
  }

  attachListeners(connection: ImapFlow): void {
    connection.on("close", async () => {
      try {
        let purpose = this.connections.getKeyForValue(connection);
        if (purpose == ConnectionPurpose.Main) {
          await retryOnTransientError(() => this.reconnect(connection, purpose));
        } else if (purpose) {
          this.dropConnection(connection);
        } // else: We closed it ourselves, e.g. logout() or reconnect()
        console.warn(`${new Date().toISOString()} IMAP connection to ${this.hostname} was closed by server, network or OS. Reconnecting...`);
      } catch (ex) {
        this.fatalError = new ConnectError(ex,
          `Reconnection failed after connection closed:\n${ex.message}\n${this.hostname} IMAP server`);
      }
    });
    connection.on("error", async (ex: any) => {
      // ImapFlow emits `close` right after `error`
      console.warn(`${new Date().toISOString()} IMAP connection to ${this.hostname} for ${this.name} failed: ${ex.code ?? ""} ${ex.message}`);
    });
    connection.on("exists", async (info) => {
      try {
        let folder = this.getFolderByPath(info.path);
        assert(folder, `We don't know about this folder`);
        assert(typeof (info.count) == "number" && typeof (info.prevCount) == "number", "Counts need to be numbers");
        await folder.countChanged(info.count, info.prevCount);
      } catch (ex) {
        console.log("Server event", info);
        this.errorCallback(new IMAPCommandError(ex, `Server event about folder ${info.path} failed:\n${ex.message}\n${this.hostname} IMAP server`));
      }
    });
    connection.on("flags", async (info) => {
      try {
        // console.log("flag change", info);
        let folder = this.getFolderByPath(info.path);
        assert(folder, `We don't know about this folder`);
        assert(!info.uid || typeof (info.uid) == "number", "Expected optional number for UID");
        assert(typeof (info.seq) == "number", "Expected number for seq");
        assert(!info.modseq || typeof (info.modseq) == "bigint", "Expected bigint for modseq");
        assert(info.flags instanceof Set, "Expected Set for flags");
        await folder.messageFlagsChanged(info.uid ?? null, info.seq, info.flags, info.modseq, connection);
      } catch (ex) {
        console.error("Error", ex, "in processing server event", info);
        this.errorCallback(new IMAPCommandError(ex, `Server event about a message in folder ${info.path} failed:\n${ex.message}\n${this.hostname} IMAP server`));
      }
    });
    connection.on("expunge", async (info) => {
      try {
        let folder = this.getFolderByPath(info.path);
        assert(folder, `We don't know about this folder`);
        assert(typeof (info.seq) == "number", "seq must be a number");
        await folder.messageDeletedNotification(info.seq, connection);
      } catch (ex) {
        console.error("Server event", info);
        this.errorCallback(new IMAPCommandError(ex, `Server event about folder ${info.path} failed:\n${ex.message}\n${this.hostname} IMAP server`));
      }
    });
    if (this.logLibrary) {
      connection.on("log", async (entry) => {
        this.log(null, connection, "ImapFlow", entry.msg);
      });
    }
  }

  async reconnect(connection: ImapFlow, purpose?: ConnectionPurpose): Promise<ImapFlow> {
    // Note: Do not stop polling
    assert(connection, "Reconnect: Connection unknown");

    purpose = this.connections.getKeyForValue(connection) ?? purpose;
    assert(purpose, "Connection purpose unknown");
    this.log(null, connection, "reconnect", purpose);

    return await this.reconnectRunOnce.get(purpose).runOnce(async () => {
      let current = this.connections.get(purpose);
      if (current && current != connection) {
        return current; // Another caller already reconnected
      }
      if (this.connections.getKeyForValue(connection)) { // on retry, it was already dropped
        this.dropConnection(connection);
      }

      if (this.authMethod == AuthMethod.OAuth2 && this.oAuth2 &&
        !this.oAuth2?.isLoggedIn) {
        await this.oAuth2.login(false);
      }
      if (!(this.password || this.oAuth2?.isLoggedIn)) {
        throw new LoginError(new Error(), "Reconnect failed due to missing login");
      }

      let newConn = await this.connection(false, purpose);
      if (purpose == ConnectionPurpose.Main) {
        await this.startIDLE(newConn);
      }
      return newConn;
    });
  }

  /** ImapFlow starts IDLE only once a folder is open */
  async startIDLE(connection: ImapFlow): Promise<void> {
    let inbox = this.inbox as IMAPFolder;
    if (!inbox?.path) {
      return;
    }
    let lock = await this.connectionLock.get(connection)?.lock();
    try {
      if (connection != this.connections.get(ConnectionPurpose.Main)) {
        return; // reconnected meanwhile; reconnect() re-selects the inbox
      }
      await connection.mailboxOpen(inbox.path);
    } catch (ex) {
      throw IMAPCommandError.fromServerResponse(ex);
    } finally {
      lock?.release();
    }
  }

  dropConnection(connection: ImapFlow): void {
    let purpose = this.connections.getKeyForValue(connection);
    assert(purpose, "Connection purpose unknown");
    this.log(null, connection, "drop", purpose);
    try {
      connection.close();
    } catch (ex) {
      // Sometimes gives "Connection not available". Do nothing.
    }
    this.connectionLock.delete(connection);
    this.connections.set(purpose, null);
    this.notifyObservers();
  }

  async hasCapability(capa: string): Promise<boolean> {
    if (!this.isLoggedIn) {
      throw new LoginError(null, gt`Please login`);
    }
    let conn = await this.connection();
    // conn.capabilities was automatically updated via `getNamespaces`
    return await conn.capabilities.has(capa);
  }

  /**
   * This will return the server's namespaces.
   * @see this.namespaces
   */
  async getNamespaces(): Promise<Record<IMAPNamespace, {prefix: string, delimiter: string}[]>> {
    let conn = await this.connection();
    // This ImapFlow command checks for the NAMESPACE capability
    // and returns the default namespaces if it doesn't support it.
    await conn.run("NAMESPACE");
    await conn.__refresh();
    return conn.namespaces;
  }

  async listFolders(): Promise<void> {
    await this.storage.readFolderHierarchy(this);

    // listTree() doesn't return the message count and is not well-implemented
    let conn = await this.connection();
    let lock = await this.connectionLock.get(conn).lock();
    let foldersInfo;
    try {
      this.log(null, conn, "list folders");
      foldersInfo = await conn.list({
        statusQuery: {
          messages: true, // Total msg count
          recent: true, // \Recent msg count
          unseen: true, // Unseen msg count
        },
      });
    } finally {
      lock?.release();
    }
    // console.log("folders", foldersFlat);
    let currentFolders = new ArrayColl<IMAPFolder>();
    let subFoldersInfo = foldersInfo.filter(folderInfo => folderInfo.parentPath == "");
    this.readFolders(null, this.rootFolders as ArrayColl<IMAPFolder>, subFoldersInfo, foldersInfo, currentFolders);

    for (let folder of this.getAllFolders()) {
      if (!currentFolders.includes(folder as IMAPFolder)) {
        await folder.deleteItLocally();
        continue;
      }
      if (!folder.dbID) {
        await this.storage.saveFolder(folder);
      } else {
        await this.storage.saveFolderProperties(folder);
      }
    }
  }

  /**
   * @param parent parent folder, to which to add the subfolders. null, if root.
   * @param addTo Array to add the subfolders to. Either `parent.subFolders` or `rootFolders`.
   * @param subFoldersInfo Source info of the subfolders that are to be created
   * @param allFoldersInfo Source info of all folders
   * @param resultAllFolders All result folders created so far
   */
  readFolders(parent: IMAPFolder, addTo: Collection<IMAPFolder>, subFoldersInfo: any[], allFoldersInfo: any[], resultAllFolders: Collection<IMAPFolder>): void {
    for (let folderInfo of subFoldersInfo) {
      let subFolder = addTo.find(folder => folder.path == folderInfo.path);
      if (subFolder) {
        subFolder.fromFlow(folderInfo); // update with new info
      } else if (folderInfo.path == "[Gmail]" || folderInfo.flags.has("\\NoSelect")) {
        let subFoldersInfo = allFoldersInfo.filter(f => f.parentPath == folderInfo.path);
        this.readFolders(parent, addTo, subFoldersInfo, allFoldersInfo, resultAllFolders);
        continue;
      } else {
        subFolder = new IMAPFolder(this);
        subFolder.fromFlow(folderInfo);
        addTo.add(subFolder);
        subFolder.parent = parent;
      }
      resultAllFolders.add(subFolder);
      if (!this.pathDelimiter && folderInfo.delimiter) {
        this.pathDelimiter = folderInfo.delimiter;
      }
      let subFoldersInfo = allFoldersInfo.filter(folderInfo => folderInfo.parentPath == subFolder.path);
      this.readFolders(subFolder, subFolder.subFolders as ArrayColl<IMAPFolder>, subFoldersInfo, allFoldersInfo, resultAllFolders);
    }
  }

  getFolderByPath(path: string): IMAPFolder | null {
    return this.findFolder(folder => folder.path == path) as IMAPFolder | null;
  }

  async createToplevelFolder(name: string): Promise<IMAPFolder> {
    let newFolder = await super.createToplevelFolder(name) as IMAPFolder;
    await (this.inbox as IMAPFolder).runCommand(async (conn) => {
      let created = await conn.mailboxCreate(name);
      newFolder.path = created.path;
    });
    console.log("IMAP folder created", name, newFolder.path);
    await newFolder.listMessages();
    return newFolder;
  }


  protected stopPolling() {
    for (let folder of this.getAllFolders()) {
      (folder as IMAPFolder).stopPolling();
    }
  }

  async logout(alsoOAuth2 = true): Promise<void> {
    this.stopPolling();
    for (let purpose of connectionPurposes) {
      let conn = this.connections.get(purpose);
      if (!conn) {
        continue;
      }
      this.log(null, conn, "logout");
      // Remove first, so that the close handler knows that this is intentional
      this.connections.delete(purpose);
      this.connectionLock.delete(conn);
      try {
        await conn.logout();
      } catch (ex) {
        // Connection might already be dead
      }
    }
    if (this.oAuth2 && alsoOAuth2) {
      await this.oAuth2.logout();
    }
  }

  async send(email: EMail): Promise<void> {
    assert(this.outgoing, "SMTP server is not set up for IMAP account " + this.name);
    if (!this.isLoggedIn) {
      await this.login(true);
    }
    await this.outgoing.send(email);
    await this.saveSent(email);
  };

  protected async saveSent(email: EMail): Promise<void> {
    let sentFolder = email.folder ?? this.getSpecialFolder(SpecialFolder.Sent);
    email.isRead = true;
    await sentFolder.addMessage(email);
  }


  get sharePermissionLevels(): MailShareCombinedPermissions[] {
    return [MailShareCombinedPermissions.Read, MailShareCombinedPermissions.FlagChange,
      MailShareCombinedPermissions.Modify, MailShareCombinedPermissions.Custom];
  }

  canShareWithPersons(): boolean {
    return this.namespaces?.other?.length > 0;
  }

  async getSharedPersons(): Promise<ArrayColl<PersonUID> | null> {
    // well, some of them at least...
    return await (this.inbox as IMAPFolder)?.getSharedPersons();
  }

  async deleteSharedPerson(otherPerson: PersonUID) {
    for (let folder of this.getAllFolders() as ArrayColl<IMAPFolder>) {
      await folder.removePermission(otherPerson);
    }
  }

  async addSharedPerson(otherPerson: PersonUID, mailFolder: IMAPFolder | null, includeSubfolders: boolean, access: MailShareCombinedPermissions, ...permissions: MailShareIndividualPermissions[]) {
    let foldersToShare = (!mailFolder ? this.getAllFolders() : includeSubfolders ? mailFolder.getInclusiveDescendants() : new ArrayColl<IMAPFolder>([mailFolder])) as ArrayColl<IMAPFolder>;
    let rights = "";
    switch (access) {
    case MailShareCombinedPermissions.Read:
      rights = "lr";
      break;
    case MailShareCombinedPermissions.FlagChange:
      rights = "lrsw";
      break;
    case MailShareCombinedPermissions.Modify:
      rights = "lrswikxte";
      break;
    case MailShareCombinedPermissions.Custom:
      if (permissions.includes(MailShareIndividualPermissions.Read)) {
        rights += "r";
      }
      if (permissions.includes(MailShareIndividualPermissions.FlagChange)) {
        rights += "sw";
      }
      if (permissions.includes(MailShareIndividualPermissions.Delete)) {
        rights += "te";
      }
      if (permissions.includes(MailShareIndividualPermissions.Create)) {
        rights += "i";
      }
      if (permissions.includes(MailShareIndividualPermissions.DeleteFolder)) {
        rights += "x";
      }
      if (permissions.includes(MailShareIndividualPermissions.CreateSubfolders)) {
        rights += "k";
      }
      break;
    default:
      throw new NotReached();
    }
    for (let folder of foldersToShare) {
      await folder.addPermission(otherPerson, rights);
    }
  }

  log(folder: IMAPFolder | string | null, connection: ImapFlow, command: string, ...args: any[]) {
    let purpose = connection === null
      ? ""
      : this.connections.getKeyForValue(connection)
      ?? "unknown";
    purpose = purpose ? "p-" + purpose : "";
    let folderID = folder instanceof IMAPFolder
      ? folder?.id
      : typeof (folder) == "string"
        ? folder
        : "-";
    let connID = connection?.id.substring(0, 4) ?? "";
    console.log("IMAP", this.name, folderID, purpose, connID, command, ...args);
  }

  fromConfigJSON(config: any) {
    super.fromConfigJSON(config);
    this.pollIntervalMinutes = sanitize.integer(config.pollIntervalMinutes, this.pollIntervalMinutes);
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.pollIntervalMinutes = this.pollIntervalMinutes;
    return json;
  }

  newFolder(): IMAPFolder {
    return new IMAPFolder(this);
  }

  newSearch(): IMAPSearchEMail {
    return new IMAPSearchEMail();
  }
}

/**
 * The three categories of IMAP namespace.
 * personal = user's own folders
 * other = other users' folders
 * shared = company public folders
 * Each category has an array of namespace records.
 */
type IMAPNamespace = "personal" | "other" | "shared";
/**
 * An object representing an IMAP namespace record.
 * The prefix allows you to determine whether a path is in this namespace.
 * The delimiter tells you how you should construct subfolder paths,
 * because it can be different for each namespace for some reason...
 */
interface IMAPNamespaceRecord { prefix: string; delimiter: string };
/** The effective namespaces for servers that don't support namespaces. */
const kDefaultNamespaces: Record<IMAPNamespace, IMAPNamespaceRecord[] | false> = { personal: [{ prefix: "", delimiter: "." }], other: false, shared: false };

export enum ConnectionPurpose {
  Main = "main",
  Fetch = "fetch",
  Display = "display",
}
const connectionPurposes = [ConnectionPurpose.Main, ConnectionPurpose.Fetch, ConnectionPurpose.Display];

/** How often to renew IDLE.
 * Some servers (e.g. Gmail) drop connections that show no activity for ~10 minutes.
 * RFC 2177 recommends renewing at least every 29 minutes. */
const kIDLERenewalSeconds = 5 * 60;

export class IMAPCommandError extends SpecificError {
  /** ImapFlow reports every `NO`/`BAD` response as "Command failed" and puts
    * the reason that the server gave into `responseText`. Show that reason. */
  static fromServerResponse(ex: Error & { responseText?: string }): Error {
    if (!ex?.responseText) {
      return ex;
    }
    return new IMAPCommandError(ex, ex.responseText
      .replace("Error in IMAP command", "IMAP")
      .replace(/ \([\d\. +]* secs\)\./, ""));
  }
}

const useragent = {
  name: appName,
  version: appVersion,
  'support-url': siteRoot,
};
