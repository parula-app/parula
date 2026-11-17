import { MailAccount, DeleteStrategy } from "../MailAccount";
import { AuthMethod } from "../../Abstract/Account";
import { POP3Connection } from "./POP3Connection";
import { POP3Folder } from "./POP3Folder";
import type { EMail } from "../EMail";
import { SpecialFolder, specialFolderNames } from "../Folder";
import { appGlobal } from "../../app";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { notifyChangedProperty } from "../../util/Observable";
import { RunOnce } from "../../util/flow/RunOnce";
import { assert, capitalizeStart } from "../../util/util";
import { gt } from "../../../l10n/l10n";

export class POP3Account extends MailAccount {
  readonly protocol: string = "pop3";
  deleteStrategy: DeleteStrategy = DeleteStrategy.MoveToTrash;
  /** Otherwise, they are deleted from the server right after the download */
  @notifyChangedProperty
  leaveOnServer = true;
  /** Only with `leaveOnServer`. 0 = never */
  @notifyChangedProperty
  deleteAfterDays = 0;
  /** How often to check for new mail. In minutes. 0 or null = polling disabled */
  @notifyChangedProperty
  pollIntervalMinutes = 10;
  /** Whether we have successfully logged in *and* are polling.
   * Does not mean we have a standing TCP connection.
   * Compare @see POP3Connection.login() */
  @notifyChangedProperty
  protected isPolling = false;
  /** Opened by `login()`, for the first mail check */
  protected loginConnection: POP3Connection | null = null;
  /** High level logging about the commands we issue */
  logCommands = false;
  protected loginRunOnce = new RunOnce();

  constructor() {
    super();
    assert(appGlobal.remoteApp.newTCPSocket, "POP3: Need backend");
  }

  /** Whether we have successfully logged in *and* are polling.
   * Does not mean we have a standing TCP connection.
   * Compare @see POP3Connection.login() */
  get isLoggedIn(): boolean {
    return this.isPolling;
  }

  async login(interactive: boolean): Promise<void> {
    await this.loginRunOnce.runOnce(async () => {
      await super.login(interactive);
      if (!this.dbID) {
        await this.storage.saveAccount(this);
      }
      await this.storage.readFolderHierarchy(this);
      if (this.authMethod == AuthMethod.OAuth2 && !this.oAuth2?.isLoggedIn) {
        assert(this.oAuth2, this.name + `: ` + gt`Need OAuth2 configuration`);
        await this.oAuth2.login(interactive);
      }
      this.loginConnection = await this.connect();
    });
  }

  async syncOnStartup() {
    await super.syncOnStartup();
    this.notifyObservers();
    (this.inbox as POP3Folder).startPolling();
    this.isPolling = true;
  }

  async verifyLogin(): Promise<void> {
    if (this.authMethod == AuthMethod.OAuth2 && !this.oAuth2?.isLoggedIn) {
      assert(this.oAuth2, this.name + `: ` + gt`Need OAuth2 configuration`);
      await this.oAuth2.login(true);
    }
    let connection = await this.connect();
    await connection.quit();
  }

  /** Every mail check is its own short session: The server shows only the mails that existed at login */
  async connect(): Promise<POP3Connection> {
    let connection = this.loginConnection;
    this.loginConnection = null;
    if (connection && !connection.closed) {
      return connection;
    }
    this.fatalError = null;
    connection = new POP3Connection(this);
    try {
      await connection.login();
    } catch (ex) {
      throw this.fatalError = ex;
    }
    return connection;
  }

  /** Mails downloaded before this time are deleted from the server. null = keep them all */
  deleteFromServerBefore(): Date | null {
    if (!this.leaveOnServer) {
      return new Date();
    }
    if (!this.deleteAfterDays) {
      return null;
    }
    let before = new Date();
    before.setDate(before.getDate() - this.deleteAfterDays);
    return before;
  }

  /** The server has no folders, ours are local, so create them here.
   * Needs no server, so that the user can write mail even after a failed login. */
  async readFromDB(): Promise<void> {
    await this.readDBRunOnce.runOnce(async () => {
      await this.storage.readFolderHierarchy(this);
      if (this.rootFolders.hasItems) {
        return;
      }
      for (let specialFolder of [
        SpecialFolder.Inbox,
        SpecialFolder.Sent,
        SpecialFolder.Drafts,
        SpecialFolder.Trash,
      ]) {
        let folder = this.newFolder();
        folder.name = specialFolderNames[specialFolder]; // localized
        folder.path = sanitize.filename(capitalizeStart(specialFolder)); // not localized
        folder.specialFolder = specialFolder;
        this.rootFolders.add(folder);
        await folder.save();
      }
    });
  }

  async listFolders(): Promise<void> {
    await this.readFromDB();
  }

  async createToplevelFolder(name: string): Promise<POP3Folder> {
    sanitize.filename(name);
    let folder = await super.createToplevelFolder(name) as POP3Folder;
    folder.path = name;
    await folder.save();
    return folder;
  }

  async logout(): Promise<void> {
    for (let folder of this.getAllFolders()) {
      (folder as POP3Folder).stopPolling();
    }
    this.isPolling = false;
    await this.loginConnection?.quit();
    this.loginConnection = null;
    await this.oAuth2?.logout();
  }

  async send(email: EMail): Promise<void> {
    assert(this.outgoing, "SMTP server is not set up for POP3 account " + this.name);
    if (this.oAuth2 && !this.oAuth2.isLoggedIn) {
      await this.oAuth2.login(true);
    }
    await this.outgoing.send(email);
    await this.saveSent(email);
  };

  protected async saveSent(email: EMail): Promise<void> {
    let sentFolder = email.folder ?? this.getSpecialFolder(SpecialFolder.Sent);
    email.isRead = true;
    await sentFolder.addMessage(email);
  }

  fromConfigJSON(config: any) {
    super.fromConfigJSON(config);
    this.leaveOnServer = sanitize.boolean(config.leaveOnServer, this.leaveOnServer);
    this.deleteAfterDays = sanitize.integer(config.deleteAfterDays, this.deleteAfterDays);
    this.pollIntervalMinutes = sanitize.integer(config.pollIntervalMinutes, this.pollIntervalMinutes);
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.leaveOnServer = this.leaveOnServer;
    json.deleteAfterDays = this.deleteAfterDays;
    json.pollIntervalMinutes = this.pollIntervalMinutes;
    return json;
  }

  newFolder(): POP3Folder {
    return new POP3Folder(this);
  }
}
