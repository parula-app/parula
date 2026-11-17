import { Folder, SpecialFolder } from "../Folder";
import { POP3EMail } from "./POP3EMail";
import type { POP3Account } from "./POP3Account";
import { POP3Error, type POP3Connection } from "./POP3Connection";
import type { EMail } from "../EMail";
import type { EMailCollection } from "../Store/EMailCollection";
import { CreateMIME } from "../SMTP/CreateMIME";
import { RunOnce } from "../../util/flow/RunOnce";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { ArrayColl, MapColl, SetColl, type Collection } from "svelte-collections";

export class POP3Folder extends Folder {
  declare account: POP3Account;
  declare readonly messages: EMailCollection<POP3EMail>;
  declare readonly subFolders: ArrayColl<POP3Folder>;
  declare parent: POP3Folder | null;
  /** Inbox only: UIDL → when we downloaded it, for all mails still on the server */
  readonly downloaded = new MapColl<string, Date>();
  /** Inbox only: The last mail of the previous session. If it is still at that number,
   * nothing before it changed, and we list only the mails after it. */
  protected anchor: { number: number, uidl: string } | null = null;
  protected lastFullListing: Date | null = null;
  protected poller: ReturnType<typeof setInterval>;
  protected getNewMessagesRunOnce = new RunOnce<Collection<POP3EMail>>();

  constructor(account: POP3Account) {
    super(account);
  }

  get path(): string {
    return this.id;
  }
  set path(val: string) {
    this.id = val;
  }

  get isOnServer(): boolean {
    return this.specialFolder == SpecialFolder.Inbox;
  }

  /** POP3 has no message list without the messages, so this downloads them. */
  async listMessages(): Promise<Collection<POP3EMail>> {
    return await this.getNewMessages();
  }

  /** All listed messages are downloaded already */
  async downloadMessages(emails: Collection<POP3EMail>): Promise<Collection<POP3EMail>> {
    return new ArrayColl<POP3EMail>();
  }

  async getNewMessages(): Promise<Collection<POP3EMail>> {
    await this.readFolder();
    if (!this.isOnServer) {
      return new ArrayColl<POP3EMail>();
    }
    return await this.getNewMessagesRunOnce.runOnce(async () => {
      let conn = await this.account.connect();
      try {
        let listing = await this.listUIDLs(conn);
        let newMsgs = await this.retrieveNewMessages(conn, listing);
        await this.deleteFromServer(conn, listing);
        await conn.quit();
        this.updateAnchor(listing);
        return newMsgs;
      } finally {
        await conn.close();
        await this.storage.saveFolderProperties(this);
      }
    });
  }

  /** Big mailboxes: If the `anchor` is still in place, only the mails after it */
  protected async listUIDLs(conn: POP3Connection): Promise<MapColl<number, string>> {
    let { count } = await conn.stat();
    let listing = new MapColl<number, string>();
    if (!count) {
      this.downloaded.clear();
      this.anchor = null;
      return listing;
    }
    const kListAllBelow = 1000;
    const kListAllAfterHours = 24;
    let deleteBefore = this.account.deleteFromServerBefore();
    let haveExpired = deleteBefore && this.downloaded.contents.some(date => date <= deleteBefore);
    let listAll = !this.anchor || count < this.anchor.number || count < kListAllBelow || haveExpired ||
      count - this.anchor.number > (conn.pipelining ? 2000 : 20) ||
      Date.now() - (this.lastFullListing?.getTime() ?? 0) > kListAllAfterHours * 60 * 60 * 1000;
    if (!listAll) {
      listAll = await conn.uidl(this.anchor.number) != this.anchor.uidl;
    }
    if (listAll) {
      listing = await conn.uidlAll();
      let onServer = new SetColl<string>();
      onServer.addAll(listing.contents);
      for (let uidl of [...this.downloaded.keys()]) {
        if (!onServer.contains(uidl)) {
          this.downloaded.delete(uidl);
        }
      }
      this.lastFullListing = new Date();
    } else {
      let numbers: number[] = [];
      for (let number = this.anchor.number + 1; number <= count; number++) {
        numbers.push(number);
      }
      const kBatchSize = 100;
      for (let i = 0; i < numbers.length; i += kBatchSize) {
        await Promise.all(numbers.slice(i, i + kBatchSize).map(async number =>
          listing.set(number, await conn.uidl(number))));
      }
    }
    return listing;
  }

  /** Only once all listed mails are downloaded. Otherwise, the next session must list them again. */
  protected updateAnchor(listing: MapColl<number, string>) {
    let last = 0;
    for (let [number, uidl] of listing.entries()) {
      if (!this.downloaded.has(uidl)) {
        return;
      }
      last = Math.max(last, number);
    }
    if (last) {
      this.anchor = { number: last, uidl: listing.get(last) };
    }
  }

  protected async retrieveNewMessages(conn: POP3Connection, listing: MapColl<number, string>): Promise<ArrayColl<POP3EMail>> {
    let isNewMail = this.downloaded.hasItems; // the first download of an existing mailbox is not new mail
    let newNumbers = [...listing.entries()]
      .filter(([number, uidl]) => !this.downloaded.has(uidl))
      .map(([number]) => number);
    let newMsgs = new ArrayColl<POP3EMail>();
    const kBatchSize = 20;
    for (let i = 0; i < newNumbers.length; i += kBatchSize) {
      let batch = newNumbers.slice(i, i + kBatchSize);
      let downloads = await Promise.allSettled(batch.map(number => conn.retr(number)));
      let batchMsgs = new ArrayColl<POP3EMail>();
      for (let [j, number] of batch.entries()) {
        let download = downloads[j];
        if (download.status == "rejected" && !(download.reason instanceof POP3Error)) {
          throw download.reason; // the connection broke, and took the rest of the batch with it
        }
        let email = this.newEMail();
        email.uidl = listing.get(number);
        email.isNewArrived = isNewMail;
        try {
          if (download.status == "rejected") { // e.g. Courier, once another session deleted the mail
            throw download.reason;
          }
          email.mime = download.value;
          await email.parseMIME();
          email.id ||= email.uidl;
          email.received = email.sent;
          await email.saveCompleteMessage();
        } catch (ex) {
          this.account.errorCallback(ex);
          continue;
        }
        this.downloaded.set(email.uidl, new Date());
        batchMsgs.add(email);
      }
      this.messages.addAll(batchMsgs);
      newMsgs.addAll(batchMsgs);
      this.countTotal += batchMsgs.length;
      this.countUnread += batchMsgs.length;
      await this.storage.saveFolderProperties(this); // checkpoint `downloaded`, in case we die before the end
    }
    return newMsgs;
  }

  protected async deleteFromServer(conn: POP3Connection, listing: MapColl<number, string>) {
    let deleteBefore = this.account.deleteFromServerBefore();
    if (!deleteBefore) {
      return;
    }
    let numbers = [...listing.entries()]
      .filter(([number, uidl]) => this.downloaded.get(uidl) <= deleteBefore)
      .map(([number]) => number);
    const kBatchSize = 100;
    for (let i = 0; i < numbers.length; i += kBatchSize) {
      await Promise.all(numbers.slice(i, i + kBatchSize).map(number => conn.dele(number)));
    }
  }

  /** A copy, because all POP3 folders are local */
  async addMessage(message: EMail) {
    message.mime ??= await CreateMIME.getMIME(message);
    let email = this.newEMail();
    email.mime = message.mime;
    await email.parseMIME();
    email.id ||= message.id;
    email.received = message.received ?? email.sent;
    email.isRead = message.isRead;
    email.isStarred = message.isStarred;
    email.isReplied = message.isReplied;
    email.isForwarded = message.isForwarded;
    email.isImportant = message.isImportant;
    email.isDraft = message.isDraft;
    email.isSpam = message.isSpam;
    email.tags.addAll(message.tags);
    await email.saveCompleteMessage();
    this.messages.addAll([email]);
    this.countTotal++;
    if (!email.isRead) {
      this.countUnread++;
    }
    await this.storage.saveFolderProperties(this);
  }

  protected async moveOrCopyMessagesHere(action: "move" | "copy", messages: Collection<EMail>) {
    for (let message of messages) {
      await message.loadMIME();
      await this.addMessage(message);
      if (action == "copy") {
        continue;
      }
      if (message.folder.account == this.account) {
        await message.deleteMessageLocally();
      } else {
        await message.deleteMessage();
      }
    }
  }

  async markAllRead(): Promise<void> {
    await super.markAllRead();
    for (let message of this.messages) {
      if (message.dbID) {
        await message.saveWritablePropsLocally();
      }
    }
    await this.storage.saveFolderProperties(this);
  }

  async createSubFolder(name: string): Promise<POP3Folder> {
    sanitize.filename(name);
    let folder = await super.createSubFolder(name) as POP3Folder;
    folder.path = this.path + "/" + name;
    await folder.save();
    return folder;
  }

  async rename(newName: string): Promise<void> {
    sanitize.filename(newName);
    await super.rename(newName);
    await this.updatePath(this.parent ? this.parent.path + "/" + newName : newName);
  }

  async moveFolderHere(folder: POP3Folder) {
    await super.moveFolderHere(folder);
    await folder.updatePath(this.path + "/" + folder.name);
  }

  /** Also for all subfolders */
  protected async updatePath(newPath: string): Promise<void> {
    let oldPath = this.path;
    this.path = newPath;
    await this.save();
    for (let subFolder of this.subFolders) {
      await subFolder.updatePath(newPath + subFolder.path.slice(oldPath.length));
    }
  }

  startPolling() {
    if (!this.account.pollIntervalMinutes || !this.isOnServer) {
      return;
    }
    this.stopPolling();
    this.poller = setInterval(async () => {
      try {
        await this.getNewMessages();
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }, this.account.pollIntervalMinutes * 1000 * 60);
  }

  stopPolling() {
    if (!this.poller) {
      return;
    }
    clearInterval(this.poller);
    this.poller = null;
  }

  fromExtraJSON(json: any) {
    super.fromExtraJSON(json);
    this.downloaded.clear();
    for (let [uidl, time] of Object.entries(sanitize.object(json.downloaded, {}))) {
      this.downloaded.set(uidl, new Date(sanitize.integer(time as any, 0) * 1000));
    }
    this.anchor = json.anchor
      ? { number: sanitize.integer(json.anchor.number), uidl: sanitize.nonemptystring(json.anchor.uidl) }
      : null;
    this.lastFullListing = json.lastFullListing
      ? new Date(sanitize.integer(json.lastFullListing) * 1000)
      : null;
  }
  toExtraJSON(): any {
    let json = super.toExtraJSON();
    if (!this.isOnServer) {
      return json;
    }
    json.downloaded = {};
    for (let [uidl, date] of this.downloaded.entries()) {
      json.downloaded[uidl] = Math.floor(date.getTime() / 1000);
    }
    json.anchor = this.anchor;
    json.lastFullListing = this.lastFullListing ? Math.floor(this.lastFullListing.getTime() / 1000) : null;
    return json;
  }

  newEMail(): POP3EMail {
    return new POP3EMail(this);
  }
}
