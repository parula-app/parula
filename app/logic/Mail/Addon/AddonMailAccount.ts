import { MailAccount, DeleteStrategy } from "../MailAccount";
import { AddonFolder } from "./AddonFolder";
import type { EMail } from "../EMail";
import { CreateMIME } from "../SMTP/CreateMIME";
import type { PersonUID } from "../../Abstract/PersonUID";
import { AuthMethod } from "../../Abstract/Account";
import { AddonConnection } from "../../Addons/AddonConnection";
import type { AddonProtocolAccount } from "../../Addons/AddonProtocols";
import { appGlobal } from "../../app";
import { RunOnce } from "../../util/flow/RunOnce";
import { ArrayColl } from "svelte-collections";

/** A mail account whose protocol an addon implements.
 * The addon does only the server talk. Folders and messages are stored and shown like those of other protocols.
 * Everything that the addon returns is checked here, in `AddonFolder` and in `AddonEMail`. */
export class AddonMailAccount extends MailAccount implements AddonProtocolAccount {
  readonly protocol: string;
  readonly connection = new AddonConnection(this, appGlobal.emailAccounts);
  deleteStrategy = DeleteStrategy.MoveToTrash;
  protected loginRunOnce = new RunOnce<void>();
  protected startupRunOnce = new RunOnce<void>();

  /** @param protocol `AddonProtocol.accountProtocol()` */
  constructor(protocol: string) {
    super();
    this.protocol = protocol;
    this.authMethod = AuthMethod.Password;
  }

  get isLoggedIn(): boolean {
    return this.connection.isLoggedIn;
  }

  async login(interactive: boolean): Promise<void> {
    await this.loginRunOnce.runOnce(async () => {
      await super.login(interactive);
      if (!this.dbID) {
        await this.storage.saveAccount(this);
      }
      await this.storage.readFolderHierarchy(this);
      await this.connection.login();
    });
  }

  async verifyLogin(): Promise<void> {
    await this.connection.verifyLogin();
  }

  async syncOnStartup(): Promise<void> {
    await this.startupRunOnce.runOnce(async () => {
      await super.syncOnStartup();
    });
  }

  async disconnect(): Promise<void> {
    this.connection.disconnect();
  }

  async listFolders(): Promise<void> {
    const kMaxFolders = 10000;
    let list = this.connection.checkList(await this.connection.call("listFolders"), kMaxFolders, "folders");
    await this.storage.readFolderHierarchy(this);
    let oldFolders = this.getAllFolders();
    let currentFolders = new Map<string, AddonFolder>();
    let parentIDs = new Map<string, string | null>();
    for (let json of list) {
      try {
        let id = this.connection.checkID(json?.id);
        if (currentFolders.has(id)) {
          continue;
        }
        let folder = this.findFolder(folder => folder.id == id) as AddonFolder ?? this.newFolder();
        folder.fromAddon(json);
        currentFolders.set(id, folder);
        parentIDs.set(id, json.parentID == null ? null : this.connection.checkID(json.parentID));
      } catch (ex) {
        this.dataError(ex);
      }
    }
    // Only now, because the addon may list a folder before its parent
    for (let [id, folder] of currentFolders) {
      let parent = currentFolders.get(parentIDs.get(id)) ?? null;
      let ancestorID = parentIDs.get(id);
      for (let i = 0; ancestorID && ancestorID != id && i < parentIDs.size; i++) {
        ancestorID = parentIDs.get(ancestorID);
      }
      if (ancestorID == id) {
        this.dataError(new Error(`Folder ${folder.name}: The addon made the folder a subfolder of itself. Showing it at the top level.`));
        parent = null;
      }
      let parentFolders = parent ? parent.subFolders : this.rootFolders;
      if (parentFolders.contains(folder)) {
        continue;
      }
      (folder.parent?.subFolders ?? this.rootFolders).remove(folder);
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
  }

  async createToplevelFolder(name: string): Promise<AddonFolder> {
    let json = this.connection.checkObject(await this.connection.call("createFolder", null, name), "folder");
    let folder = await super.createToplevelFolder(name) as AddonFolder;
    folder.fromAddon(json);
    await folder.save();
    return folder;
  }

  async send(email: EMail): Promise<void> {
    let mime = await CreateMIME.getMIME(email);
    let recipients = new ArrayColl<PersonUID>();
    recipients.addAll(email.to);
    recipients.addAll(email.cc);
    recipients.addAll(email.bcc);
    await this.connection.call("send", mime, email.from.emailAddress, recipients.contents.map(person => person.emailAddress));
  }

  /** The addon says that the server has new messages in this folder */
  onNewMessages(folderID: string): void {
    let folder = this.findFolder(folder => folder.id == folderID) as AddonFolder;
    folder?.newMessagesOnServer();
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.connection.fromConfigJSON(json);
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    this.connection.toConfigJSON(json);
    return json;
  }

  newFolder(): AddonFolder {
    return new AddonFolder(this);
  }
}
