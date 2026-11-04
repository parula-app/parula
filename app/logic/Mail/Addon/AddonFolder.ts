import { Folder, SpecialFolder } from "../Folder";
import { AddonEMail } from "./AddonEMail";
import type { AddonMailAccount } from "./AddonMailAccount";
import type { EMailCollection } from "../Store/EMailCollection";
import type { MessageFlags } from "../../Addons/Sandbox/MustangAPI";
import { RunAgain } from "../../util/flow/RunAgain";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { ArrayColl, type Collection } from "svelte-collections";

export class AddonFolder extends Folder {
  /** id: of the server */
  declare account: AddonMailAccount;
  declare readonly messages: EMailCollection<AddonEMail>;
  declare readonly subFolders: ArrayColl<AddonFolder>;
  /** Opaque, from the addon */
  declare syncState: string | null;
  protected newMessagesRunAgain = new RunAgain(100);

  constructor(account: AddonMailAccount) {
    super(account);
  }

  fromAddon(json: any) {
    const kMaxLength = 1000;
    this.id = this.account.connection.checkID(json.id);
    this.name = this.account.connection.checkText(json.name, kMaxLength, null) ?? this.id;
    this.specialFolder = sanitize.enum(json.specialFolder, [
      SpecialFolder.Normal, SpecialFolder.Inbox, SpecialFolder.Sent, SpecialFolder.Drafts,
      SpecialFolder.Trash, SpecialFolder.Spam, SpecialFolder.Archive, SpecialFolder.Outbox,
    ], SpecialFolder.Normal);
    this.countTotal = this.account.connection.checkCount(json.countTotal, this.countTotal);
    this.countUnread = this.account.connection.checkCount(json.countUnread, this.countUnread);
  }

  /** Lists the new, changed and removed messages, in chunks.
   * Doesn't download their contents. @see downloadMessages() */
  async listMessages(): Promise<ArrayColl<AddonEMail>> {
    await this.readFolder();
    let lock = await this.listMessagesLock.lock();
    try {
      let isFirstSync = !this.syncState;
      let newMessages = new ArrayColl<AddonEMail>();
      await this.account.connection.listChanges("listMessages", [this.id], this.syncState, "messages",
        async (messages, removed, syncState) => await this.applyMessageList(messages, removed, syncState, newMessages, isFirstSync));
      return newMessages;
    } finally {
      lock.release();
    }
  }

  /** Stores one checked chunk from the addon
   * @param newMessages Adds the new messages to it */
  protected async applyMessageList(messages: any[], removed: unknown[], syncState: string, newMessages: ArrayColl<AddonEMail>, isFirstSync: boolean): Promise<void> {
    let account = this.account;
    let byID = new Map<string, AddonEMail>();
    for (let email of this.messages) {
      byID.set(email.pID as string, email);
    }

    let added = new ArrayColl<AddonEMail>();
    let updated = new ArrayColl<AddonEMail>();
    for (let json of messages) {
      try {
        let id = account.connection.checkID(json?.id);
        if (this.deletions.has(id)) {
          continue;
        }
        let email = byID.get(id);
        if (email) {
          email.fromAddon(json);
          updated.add(email);
          continue;
        }
        email = this.newEMail();
        email.fromAddon(json);
        email.isNewArrived = !isFirstSync;
        byID.set(id, email);
        added.add(email);
      } catch (ex) {
        account.dataError(ex);
      }
    }
    let gone = new ArrayColl<AddonEMail>();
    for (let id of removed) {
      let email = typeof id == "string" ? byID.get(id) : undefined;
      if (email) {
        gone.add(email);
      }
    }

    this.messages.addAll(added);
    this.messages.removeAll(gone);
    for (let email of gone) {
      await email.deleteMessageLocally();
    }
    if (added.hasItems) {
      await this.storage.saveMessages(added);
    }
    for (let email of updated) {
      if (email.dbID) {
        await email.saveWritablePropsLocally();
      }
    }
    newMessages.addAll(added);
    this.syncState = syncState;
    this.countTotal = this.messages.length;
    this.countUnread = this.messages.filterOnce(email => !email.isRead).length;
    await this.storage.saveFolderProperties(this);
  }

  /** Lists the new messages, and downloads them */
  async getNewMessages(): Promise<Collection<AddonEMail>> {
    if (!this.syncState) {
      // Would download the entire folder
      return await this.getRecentMessages() as Collection<AddonEMail>;
    }
    let newMessages = await this.listMessages();
    await this.downloadMessages(newMessages);
    return newMessages;
  }

  /** The addon says that the server has new messages.
   * While a sync runs, more of these result in one more sync. */
  newMessagesOnServer(): void {
    this.newMessagesRunAgain.run(async () => {
      await this.getNewMessages();
    }).catch(this.account.errorCallback);
  }

  /** Downloads the emails that are not downloaded yet, several per call to the addon
   * @returns The actually downloaded emails */
  async downloadMessages(emails: Collection<AddonEMail>): Promise<Collection<AddonEMail>> {
    return await this.downloadMIME(emails.filterOnce(email => !email.downloadComplete && !email.downloadRunOnce.running));
  }

  /** @returns The emails that we got */
  async downloadMIME(emails: Collection<AddonEMail>): Promise<ArrayColl<AddonEMail>> {
    const kMaxPerCall = 20;
    const kMaxSizePerCall = 10 * 1024 * 1024;
    let downloaded = new ArrayColl<AddonEMail>();
    let batch = new ArrayColl<AddonEMail>();
    let batchSize = 0;
    for (let email of emails) {
      batch.add(email);
      batchSize += email.size ?? 0;
      if (batch.length >= kMaxPerCall || batchSize >= kMaxSizePerCall) {
        await this.downloadBatchInto(batch, downloaded);
        batch = new ArrayColl<AddonEMail>();
        batchSize = 0;
      }
    }
    if (batch.hasItems) {
      await this.downloadBatchInto(batch, downloaded);
    }
    return downloaded;
  }

  protected async downloadBatchInto(emails: ArrayColl<AddonEMail>, downloaded: ArrayColl<AddonEMail>): Promise<void> {
    try {
      downloaded.addAll(await this.downloadBatch(emails));
    } catch (ex) {
      this.account.errorCallback(ex);
    }
  }

  /** @returns The emails that we got. Without those whose MIME was invalid. */
  async downloadBatch(emails: ArrayColl<AddonEMail>): Promise<ArrayColl<AddonEMail>> {
    const kMaxMIMESize = 50 * 1024 * 1024;
    let account = this.account;
    let downloaded = new ArrayColl<AddonEMail>();
    let ids = emails.contents.map(email => email.pID);
    let list = account.connection.checkList(await account.connection.call("downloadMessages", this.id, ids), emails.length, "messages");
    for (let json of list) {
      try {
        let id = account.connection.checkID(json?.id);
        let mime = json.mime;
        if (!(mime instanceof Uint8Array) || !mime.length || mime.buffer.byteLength > kMaxMIMESize) {
          throw new Error(`${account.name}: The addon gave no message for ID ${id}, or one larger than 50 MB`);
        }
        let email = emails.find(email => email.pID == id);
        if (!email || email.downloadComplete || downloaded.contains(email)) {
          continue;
        }
        email.mime = mime;
        await email.parseMIME();
        await email.saveCompleteMessage();
        downloaded.add(email);
      } catch (ex) {
        account.dataError(ex);
      }
    }
    return downloaded;
  }

  protected async moveOrCopyMessagesOnServer(action: "move" | "copy", messages: Collection<AddonEMail>) {
    const kBatchSize = 1000;
    let sourceFolder = messages.first.folder;
    for (let i = 0; i < messages.length; i += kBatchSize) {
      let ids = messages.getIndexRange(i, kBatchSize).map(email => email.pID);
      await this.account.connection.call(action == "move" ? "moveMessages" : "copyMessages", sourceFolder.id, ids, this.id);
    }
    await this.listMessages();
  }

  /** Sets the flags of many messages on the server */
  async setFlagsOnServer(emails: Collection<AddonEMail>, flags: MessageFlags): Promise<void> {
    const kBatchSize = 1000;
    for (let i = 0; i < emails.length; i += kBatchSize) {
      let ids = emails.getIndexRange(i, kBatchSize).map(email => email.pID);
      await this.account.connection.call("setFlags", this.id, ids, flags);
    }
  }

  async markAllRead(): Promise<void> {
    let unread = this.messages.filterOnce(email => !email.isRead);
    await super.markAllRead();
    await this.setFlagsOnServer(unread, { isRead: true });
  }

  async createSubFolder(name: string): Promise<AddonFolder> {
    let json = this.account.connection.checkObject(await this.account.connection.call("createFolder", this.id, name), "folder");
    let folder = await super.createSubFolder(name) as AddonFolder;
    folder.fromAddon(json);
    await folder.save();
    return folder;
  }

  async rename(newName: string): Promise<void> {
    await super.rename(newName);
    await this.account.connection.call("renameFolder", this.id, newName);
    await this.storage.saveFolderProperties(this);
  }

  /** Also deletes all messages in the folder, also on the server */
  protected async deleteItOnServer(): Promise<void> {
    await this.account.connection.call("deleteFolder", this.id);
  }

  fromExtraJSON(json: any) {
    // The database column of `syncState` turns "3" into 3
    this.syncState = typeof json.syncState == "string" ? json.syncState : null;
  }
  toExtraJSON(): any {
    return { syncState: this.syncState };
  }

  newEMail(): AddonEMail {
    return new AddonEMail(this);
  }
}
