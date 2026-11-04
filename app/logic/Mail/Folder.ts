import { EMail } from "./EMail";
import type { MailAccount } from "./MailAccount";
import { EMailCollection } from "./Store/EMailCollection";
import { Observable, notifyChangedProperty } from "../util/Observable";
import { addon } from "../Addons/API/addon";
import { ArrayColl, Collection } from 'svelte-collections';
import { Lock } from "../util/flow/Lock";
import { assert, AbstractFunction } from "../util/util";
import { gt } from "../../l10n/l10n";

@addon("mail.all")
export class Folder extends Observable {
  /** IMAP: folder path */
  id: string;
  dbID: number | string;
  @addon("mail.all")
  @notifyChangedProperty
  name: string;
  @notifyChangedProperty
  parent: Folder | null;
  @addon("mail.all")
  account: MailAccount;
  @addon("mail.all")
  @notifyChangedProperty
  specialFolder: SpecialFolder = SpecialFolder.Normal;
  @addon("mail.all")
  readonly messages = new EMailCollection<EMail>(this);
  @addon("mail.all")
  readonly subFolders = new ArrayColl<Folder>();
  @addon("mail.all")
  @notifyChangedProperty
  countTotal = 0;
  @addon("mail.all")
  @notifyChangedProperty
  countUnread = 0;
  @notifyChangedProperty
  countNewArrived = 0;
  /**
   * IMAP: modseq from CONDSTORE, as string
   * EWS: Sync state, as string
   */
  syncState: number | string | null = null;
  readonly deletions = new Set<number | string>();
  readonly storageLock = new Lock();
  protected readonly readFolderLock = new Lock();
  protected readonly listMessagesLock = new Lock();

  constructor(account: MailAccount) {
    super();
    this.account = account;
  }

  get fullPath(): string {
    let path = this.name;
    let cur = this.parent;
    while (cur) {
      path = cur.name + "/" + path;
      cur = cur.parent;
    }
    return path;
  }

  get orderPos(): string {
    return this.specialFolder ? "   " + specialFolderOrder.indexOf(this.specialFolder) : this.name;
  }

  get storage() {
    return this.account.storage;
  }

  protected haveReadFolder = false;

  protected async readFolder() {
    if (this.haveReadFolder) {
      return;
    }
    let lock = await this.readFolderLock.lock();
    try {
      if (this.haveReadFolder) {
        return;
      }
      if (!this.dbID) {
        await this.save();
      }
      let log = "Reading msgs from DB, for folder " + this.account.name + " " + this.name;
      console.time(log + " first 200");
      await this.storage.readAllMessagesMainProperties(this, 200);
      console.timeEnd(log + " first 200");
      console.time(log);
      await this.storage.readAllMessagesMainProperties(this, null, 200);
      console.timeEnd(log);
      this.haveReadFolder = true;
    } finally {
      lock.release();
    }
  }

  /** Gets the metadata of the emails in this folder.
   * May be slow, depending on the protocol.
   * @returns the new messages (not yet downloaded). */
  async listMessages(): Promise<Collection<EMail>> {
    throw new AbstractFunction();
  }

  /** Downloads the entire MIME of *all* emails in this folder.
   * Assumes that you did `listMessages()` first.
   * @returns the actually downloaded emails. */
  async downloadAllMessages(): Promise<Collection<EMail>> {
    return await this.downloadSmallMessagesFirst(this.messages as any as Collection<EMail>);
  }

  /** Downloads the `emails` that we do not have yet, the small ones first,
   * so that most of them are readable as early as possible.
   * @returns the actually downloaded emails. */
  protected async downloadSmallMessagesFirst(emails: Collection<EMail>): Promise<Collection<EMail>> {
    const kMaxSize = 50000;
    let isLarge = (msg: EMail) => !!msg.size && msg.size > kMaxSize;
    let missing = emails.filterOnce(msg => !msg.downloadComplete);
    let downloadedSmall = await this.downloadMessages(missing.filterOnce(msg => !isLarge(msg)));
    let downloadedLarge = await this.downloadMessages(missing.filterOnce(isLarge));
    return downloadedSmall.concat(downloadedLarge);
  }

  /** Downloads the emails of the last 2 weeks. Listing a folder for the first
   * time returns years of mail, and we do not want to download all of that.
   * Older mail is downloaded on demand, or by `downloadAllMessages()`.
   * @param emails the emails that `listMessages()` just returned
   * @returns the actually downloaded emails. */
  async downloadRecentMessages(emails: Collection<EMail>): Promise<Collection<EMail>> {
    const kDaysPast = 14;
    let oldest = new Date();
    oldest.setDate(oldest.getDate() - kDaysPast);
    return await this.downloadSmallMessagesFirst(emails.filterOnce(msg => msg.received > oldest));
  }

  /** Downloads the entire MIME of the given emails.
   * @returns the actually downloaded emails. */
  async downloadMessages(emails: Collection<EMail>): Promise<Collection<EMail>> {
    throw new AbstractFunction();
  }

  /** Lists all messages of this folder, and then downloads the recent ones
   * @returns the newly listed messages */
  async getRecentMessages(): Promise<Collection<EMail>> {
    let newMessages = await this.listMessages();
    await this.downloadRecentMessages(this.messages); // not newMessages, in case we missed some last time
    return newMessages;
  }

  /** Lists only the new messages, and downloads them.
   *
   * Should be implemented as fast as possible (a few seconds),
   * so that the action can be repeated routinely every few minutes.
   * @returns the new messages */
  async getNewMessages(): Promise<Collection<EMail>> {
    throw new AbstractFunction();
  }

  async moveMessageHere(message: EMail) {
    await this.moveMessagesHere(new ArrayColl([message]));
  }

  async copyMessageHere(message: EMail) {
    await this.copyMessagesHere(new ArrayColl([message]));
  }

  /**
   * To move messages from one folder to another, call this function
   * on the target folder. The `messages` are in the source folder.
   *
   * All messages must be from the same source folder.
   *
   * Attention:
   * Always pass in a copy of the array, not the live `selectedMessages` array from the UI.
   * If the user deletes or moves messages, they will be removed from the UI
   * instantly, which changes the current selection, so the wrong emails get deleted.
   * (Alternatively, all implementations here would need to make a copy of the array at start.)
   */
  async moveMessagesHere(messages: Collection<EMail>) {
    await this.moveOrCopyMessagesHere("move", messages);
  }

  /**
   * To copy messages from one folder to another, call this function
   * on the target folder. The `messages` are in the source folder.
   *
   * All messages must be from the same source folder.
   */
  async copyMessagesHere(messages: Collection<EMail>) {
    await this.moveOrCopyMessagesHere("copy", messages);
  }

  /**
   * Helper function for `copyMessagesHere()` and `moveMessagesHere()`.
   * Calls `moveOrCopyMessagesOnServer()` as needed.
   *
   * @param sameServer
   *   true = source and target folder are on the same server, and we can move the email directly on the server and locally
   *   false = we need to upload the full email to the target and hard delete it on the source
   *   default: true, if target and source folder are the same account, otherwise false
   *   You may want to override that to true for delegate accounts or dependent accounts.
   */
  protected async moveOrCopyMessagesHere(action: "move" | "copy", messages: Collection<EMail>, sameServer?: boolean) {
    let sourceFolder = messages.first.folder;
    sameServer ??= this.account == sourceFolder.account;
    assert(sourceFolder, "Need source folder");
    assert(messages.contents.every(msg => msg.folder === sourceFolder), "All messages must be from the same folder");

    if (action == "move") {
      for (let msg of messages) {
        if (msg.pID) {
          sourceFolder.deletions.add(msg.pID);
        }
      }
    }
    try {
      if (action == "move") {
        sourceFolder.messages.removeAll(messages);
      }
      if (!sameServer) {
        for (let message of messages) {
          await message.loadMIME();
          await this.addMessage(message);
          if (action == "move") {
            await message.deleteMessage();
          }
        }
        return;
      }

      this.countTotal += messages.length;

      await this.moveOrCopyMessagesOnServer(action, messages);

      if (action == "move") {
        sourceFolder.countTotal -= messages.length;
        for (let sourceMsg of messages) {
          await sourceMsg.deleteMessageLocally();
        }
      }
    } finally {
      if (action == "move") {
        for (let msg of messages) {
          if (msg.pID) {
            sourceFolder.deletions.delete(msg.pID);
          }
        }
      }
    }
  }

  protected async moveOrCopyMessagesOnServer(action: "move" | "copy", messages: Collection<EMail>) {
    throw new AbstractFunction();
  }

  /**
   * Uploads a message to this folder on the server.
   *
   * MIME:
   * - If this is an existing message, e.g. from another
   *   server or from an .eml file, make sure that
   *   `.mime` is populated with the RFC5322 message.
   * - If this is a new message that you just created,
   *   then this function will create the MIME from the properties.
   */
  async addMessage(message: EMail) {
    throw new AbstractFunction();
  }

  async moveFolderHere(folder: Folder) {
    assert(folder.account == this.account, gt`Cannot move folders between accounts yet. You can create a new folder and move the messages`);
    assert(folder != folder.account.getSpecialFolder(SpecialFolder.Inbox), "Cannot move the inbox");
    assert(!folder.specialFolder || folder.specialFolder == SpecialFolder.Normal, "Should not move special folders");
    assert(folder != this, "Cannot move a folder into itself. Neither physics nor logic allow that. We would run into a circle and run and run and run...");
    assert(!folder.getInclusiveDescendants().contains(this), gt`You cannot move a folder into its own subfolder`);
    assert(!this.subFolders.contains(folder), "This folder is *already* a subfolder of the target folder");
    let disableSubfolders = this.disableSubfolders();
    assert(!disableSubfolders, disableSubfolders || "This folder cannot have subfolders");
    if (folder.parent) {
      folder.parent.subFolders.remove(folder);
    } else {
      folder.account.rootFolders.remove(folder);
    }
    folder.parent = this;
    this.subFolders.add(folder);
  }

  /** @see MailAccount.createToplevelFolder() */
  async createSubFolder(name: string): Promise<Folder> {
    let disableSubfolders = this.disableSubfolders();
    assert(!disableSubfolders, disableSubfolders || "This folder cannot have subfolders");
    let folder = this.account.newFolder();
    folder.name = name;
    folder.parent = this;
    this.subFolders.add(folder);
    return folder;
  }

  async rename(newName: string): Promise<void> {
    let disabled = this.disableRename();
    assert(!disabled, disabled || "Cannot rename");
    this.name = newName;
  }

  async save(): Promise<void> {
    await this.storage.saveFolder(this);
  }

  /** Warning: Also deletes all messages in the folder, also on the server */
  async deleteIt(): Promise<void> {
    let disableDelete = this.disableDelete();
    assert(!disableDelete, disableDelete || "Cannot delete");
    await this.deleteItLocally();
    await this.deleteItOnServer();
  }

  /** Warning: Also deletes all messages and subfolders of the folder */
  async deleteItLocally(): Promise<void> {
    for (let subFolder of this.subFolders.contents) {
      await subFolder.deleteItLocally();
    }
    if (this.parent) {
      this.parent.subFolders.remove(this);
    } else {
      this.account.rootFolders.remove(this);
    }
    if (this.dbID) {
      await this.storage.deleteFolder(this);
    }
  }

  protected async deleteItOnServer() {
  }

  async markAllRead(): Promise<void> {
    this.countUnread = 0;
    for (let message of this.messages) {
      message.isRead = true;
    }
  }

  /**
   * Triggers a full resync of the folder.
   * Works only for protocols that have a sync key (e.g. EWS).
   * For some protocols (e.g. JMAP), might trigger a full resync of
   * *every* folder (in the account), on their respective next sync.
   */
  async fullResync(): Promise<void> {
    this.syncState = null;
    await this.listMessages();
  }

  get children(): Collection<Folder> {
    return this.subFolders as any as Collection<Folder>;
  }

  /**
   * Return this folder and all of its descendants.
   */
  getInclusiveDescendants(): ArrayColl<Folder> {
    let descendants = new ArrayColl<Folder>();
    function iterateFolders(folder: Folder) {
      descendants.add(folder);
      for (let child of folder.subFolders) {
        iterateFolders(child);
      }
    }
    iterateFolders(this);
    return descendants;
  }

  /** @return false, if delete is possible. If not, a string with the reason why it's not possible. */
  disableDelete(): string | false {
    if (this.specialFolder != SpecialFolder.Normal) {
      return gt`You cannot delete this folder, because it has a special use. See Use As.`;
    }
    return false;
  }

  /** @return false, if renaming is possible. If not, a string with the reason why it's not possible. */
  disableRename(): string | false {
    if (this.specialFolder == SpecialFolder.Inbox || this.name.toUpperCase() == "INBOX") {
      return gt`You cannot rename the inbox.`;
    }
    return false;
  }

  /** @return false, if creating subfolders is possible. If not, a string with the reason why it's not possible. */
  disableSubfolders(): string | false {
    return false;
  }

  /** @return false, if changing the special folder is possible. If not, a string with the reason why it's not possible. */
  disableChangeSpecial(): string | false {
    if (this.specialFolder == SpecialFolder.Inbox || this.name.toUpperCase() == "INBOX") {
      return gt`You cannot change the Inbox folder.`;
    }
    return false;
  }

  fromExtraJSON(json: any) {
  }
  toExtraJSON(): any {
    return {};
  }

  newEMail(): EMail {
    return new EMail(this);
  }
}

/** @addon("mail.all") */
export enum SpecialFolder {
  Normal = "normal",
  Inbox = "inbox",
  Sent = "sent",
  Drafts = "drafts",
  Trash = "trash",
  Spam = "spam",
  Archive = "archive",
  Outbox = "outbox",
  All = "all",
  Search = "search",
}

export const specialFolderOrder = [
  SpecialFolder.Inbox,
  SpecialFolder.Sent,
  SpecialFolder.Drafts,
  SpecialFolder.Trash,
  SpecialFolder.Spam,
  SpecialFolder.Archive,
  SpecialFolder.Outbox,
  SpecialFolder.All,
  SpecialFolder.Search,
  SpecialFolder.Normal,
];

export const specialFolderNames: Record<string, string> = {};
specialFolderNames[SpecialFolder.Inbox] = gt`Inbox`;
specialFolderNames[SpecialFolder.Sent] = gt`Sent`;
specialFolderNames[SpecialFolder.Drafts] = gt`Drafts`;
specialFolderNames[SpecialFolder.Trash] = gt`Trash`;
specialFolderNames[SpecialFolder.Spam] = gt`Spam`;
specialFolderNames[SpecialFolder.Archive] = gt`Archive`;
specialFolderNames[SpecialFolder.Outbox] = gt`Outbox`;
specialFolderNames[SpecialFolder.Search] = gt`Saved Search`;
specialFolderNames[SpecialFolder.Normal] = gt`Normal folder`;
specialFolderNames[SpecialFolder.All] = gt`All messages`;

export enum MailShareCombinedPermissions {
  Read = "read",
  /** Can read messages, and change the flags and tags,
   * but not add and delete emails */
  FlagChange = "flags-change",
  /** Full access, read, add and delete emails, and flag changes */
  Modify = "modify",
  Custom = "custom",
}
export enum MailShareIndividualPermissions {
  Read = "read",
  /** Can change the flags and tags */
  FlagChange = "flags-change",
  Delete = "delete",
  Create = "create",
  DeleteFolder = "delete-folder",
  CreateSubfolders = "create-subfolders",
}
export const mailShareCombinedPermissionsLabels: Record<string, string> = {
  [MailShareCombinedPermissions.Read]: gt`Read`,
  [MailShareCombinedPermissions.FlagChange]: gt`Tag, star, mark as read`,
  [MailShareCombinedPermissions.Modify]: gt`Delete, move and add mails`,
  [MailShareCombinedPermissions.Custom]: gt`Custom`,
};
export const mailShareIndividualPermissionsLabels: Record<string, string> = {
  [MailShareIndividualPermissions.Read]: gt`Read mail`,
  [MailShareIndividualPermissions.FlagChange]: gt`Change mail flags`,
  [MailShareIndividualPermissions.Delete]: gt`Delete mails`,
  [MailShareIndividualPermissions.Create]: gt`Add new mails`,
  [MailShareIndividualPermissions.DeleteFolder]: gt`Delete this folder`,
  [MailShareIndividualPermissions.CreateSubfolders]: gt`Add new folders`,
};
