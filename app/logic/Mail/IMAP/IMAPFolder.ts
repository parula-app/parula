import { Folder, SpecialFolder } from "../Folder";
import { IMAPEMail } from "./IMAPEMail";
import { type IMAPAccount, IMAPCommandError, ConnectionPurpose } from "./IMAPAccount";
import type { EMail } from "../EMail";
import type { EMailCollection } from "../Store/EMailCollection";
import { PersonUID } from "../../Abstract/PersonUID";
import { CreateMIME } from "../SMTP/CreateMIME";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { Debounce } from "../../util/flow/Debounce";
import type { Locked } from "../../util/flow/Lock";
import { assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { ArrayColl, Collection } from "svelte-collections";
import { Buffer } from "buffer";
import type { ImapFlow, MailboxLockObject, SearchObject } from "../../../../desktop/backend/node_modules/imapflow";

export class IMAPFolder extends Folder {
  declare account: IMAPAccount;
  declare readonly messages: EMailCollection<IMAPEMail>;
  declare readonly subFolders: ArrayColl<IMAPFolder>;
  declare readonly deletions: Set<number>;
  uidvalidity: number = 0;
  protected poller: ReturnType<typeof setInterval>;
  protected returnToInboxDebounce = new Debounce(2);

  constructor(account: IMAPAccount) {
    super(account);
  }

  get path(): string {
    return this.id;
  }
  set path(val: string) {
    this.id = val;
  }
  getPathComponents(): string[] {
    assert(this.path, "Missing folder path");
    assert(this.account.pathDelimiter, "Missing path delimiter");
    return this.path?.split(this.account.pathDelimiter);
  }

  /** Last sequence number seen */
  get lastModSeq(): bigint {
    return BigInt(this.syncState ?? 0n);
  }

  fromFlow(folderInfo: any) {
    this.name = folderInfo.name;
    this.path = folderInfo.path;
    if (folderInfo.status) {
      this.countTotal = folderInfo.status.messages;
      this.countUnread = folderInfo.status.unseen;
      this.countNewArrived = folderInfo.status.recent;
    }
    this.setSpecialUse(folderInfo.specialUse);
    if (this.name.toUpperCase() == "INBOX") {
      this.name = gt`Inbox`;
    }
  }

  async runCommand<T>(imapFunc: (conn: ImapFlow) => Promise<T>, purpose = ConnectionPurpose.Main, connection: ImapFlow = null): Promise<T> {
    let lockMailbox: MailboxLockObject;
    let lock: Locked;
    let conn = connection;
    try {
      conn ??= await this.account.connection(false, purpose);
      try {
        this.account.log(this, conn, "open mailbox");
        lock = await this.account.connectionLock.get(conn).lock();
        lockMailbox = await conn.getMailboxLock(this.path);
      } catch (ex) {
        this.account.log(this, conn, "open mailbox failed", ex);
        if (ex.code == "NoConnection") {
          lockMailbox?.release();
          lock?.release(); // reconnect() uses runOnce()
          conn = await this.account.reconnect(conn, purpose);
          this.account.log(this, conn, "open mailbox after reconnect");
          lock = await this.account.connectionLock.get(conn).lock();
          lockMailbox = await conn.getMailboxLock(this.path);
          // Re-try only once (to open mailbox)
        } else {
          throw ex;
        }
      }
      return await imapFunc(conn);
    } catch (ex) {
      this.account.log(this, null, "error", ex);
      throw IMAPCommandError.fromServerResponse(ex);
    } finally {
      lock?.release();
      lockMailbox?.release();
      this.account.log(this, null, "released lock");
      this.startIDLEonINBOX(conn)
        .catch(this.account.errorCallback);
    }
  }

  /** IDLE on the INBOX, not the last-selected folder, so that we get new mail. */
  protected async startIDLEonINBOX(conn: ImapFlow) {
    if (this != this.account.inbox &&
        this.account.getConnectionPurpose(conn) == ConnectionPurpose.Main) {
      await this.returnToInboxDebounce.debounce(async () => {
        await this.account.startIDLE(conn)
      });
    }
  }

  /** Lists all messages in this folder.
   * But doesn't download their contents. @see downloadMessages()
   * @returns new messages */
  async listMessages(): Promise<Collection<IMAPEMail>>  {
    await this.readFolder();
    if (this.countTotal === 0) {
      return new ArrayColl<IMAPEMail>();
    }
    let lock = await this.listMessagesLock.lock();
    try {
      if (this.countNewArrived) {
        this.countNewArrived = 0;
        await this.storage.saveFolderProperties(this);
      }
      let newMsgs: ArrayColl<IMAPEMail>;
      if (await this.account.hasCapability("CONDSTORE") && this.lastModSeq) {
        newMsgs = await this.listChangedMessages();
      } else {
        newMsgs = await this.listAllUnknownMessages();
        await this.updateNewFlags();
      }
      return newMsgs;
    } finally {
      lock.release();
    }
  }

  /** Lists all messages in this folder that have not been fetched yet.
   * But doesn't download their contents. @see downloadMessages() */
  protected async listAllUnknownMessages(): Promise<ArrayColl<IMAPEMail>> {
    // TODO save range of lowest and highest UID of emails that we have fetched and saved,
    // to not re-fetch the whole list over and over again.
    let isNewMail = this.messages.hasItems;
    let allUIDs = await this.fetchUIDList({ all: true });

    // Delete messages that are no longer on the server @see checkDeletedMessages()
    let deletedMsgs = this.messages.filterOnce(msg => !allUIDs.includes(msg.uid));
    this.messages.removeAll(deletedMsgs);
    for (let deletedMsg of deletedMsgs) {
      await deletedMsg.deleteMessageLocally();
    }

    // Fetch new msgs
    let localUIDs = new ArrayColl(this.messages.contents.map(msg => msg.uid));
    let newUIDs = allUIDs.subtract(localUIDs).sortBy(uid => -uid);
    let newMsgs = new ArrayColl<IMAPEMail>();
    //console.log("Folder", this.account.name, this.name, "has", allUIDs.length, "msgs,", localUIDs.length, "local msgs,", newUIDs.length, "new");
    const kBatchSize = 200;
    while (newUIDs.hasItems) {
      //let startTime = Date.now();
      let fetchUIDs = newUIDs.splice(0, kBatchSize); // Gets the first n, and removes them from the list
      let { newMessages } = await this.fetchMessageList({ uid: fetchUIDs.join(",") }, {});
      for (let msg of newMessages) {
        msg.isNewArrived ||= isNewMail; // \Recent deprecated by IMAP4rev2
      }
      newMsgs.addAll(newMessages);
      this.messages.addAll(newMessages);
      //let fetchTime = Date.now() - startTime;
      await this.saveNewMsgs(newMessages);
      //let saveTime = Date.now() - startTime - fetchTime;
      //console.log("  Fetched", fetchUIDs.length, ", remaining", newUIDs.length, "- Time: Fetch:", fetchTime / kBatchSize, "ms/msg, save time", saveTime / kBatchSize, "ms/msg");
    }

    await this.storage.saveFolderProperties(this);
    return newMsgs;
  }

  /** Lists all messages in this folder.
   * But doesn't download their contents. @see downloadMessages() */
  protected async listAllMessages(): Promise<ArrayColl<IMAPEMail>> {
    await this.readFolder();
    let lock = await this.listMessagesLock.lock();
    try {
      let { newMessages } = await this.fetchMessageList({ all: true }, { uid: true });
      this.messages.addAll(newMessages);
      await this.storage.saveFolderProperties(this);
      await this.saveNewMsgs(newMessages);
      return newMessages;
    } finally {
      lock.release();
    }
  }

  /** Lists all messages in this folder that are new or updated since the last fetch.
   * Works only with CONDSTORE server capability. */
  protected async listChangedMessages(): Promise<ArrayColl<IMAPEMail>> {
    let { newMessages, updatedMessages } = await this.fetchMessageList({ all: true }, {
      uid: true,
      changedSince: this.lastModSeq, // Works only with CONDSTORE capa
    });
    for (let msg of newMessages) {
      msg.isNewArrived = true;
    }
    this.messages.addAll(newMessages);
    await this.storage.saveFolderProperties(this);
    await this.saveNewMsgs(newMessages);
    await this.saveMsgUpdates(updatedMessages);
    return newMessages;
  }

  /** Lists new messages, based on the UID being higher.
   * But doesn't download their contents @see getNewMessages() */
  async listNewMessages(): Promise<ArrayColl<IMAPEMail>> {
    await this.readFolder();
    let lock = await this.listMessagesLock.lock();
    try {
      if (this.countTotal === 0) {
        return new ArrayColl();
      }
      let isNewMail = this.messages.hasItems;
      let fromUID = this.getHighestUID() ?? 1;
      let { newMessages } = await this.fetchMessageList({ uid: fromUID + ":*" }, {});
      for (let msg of newMessages) {
        msg.isNewArrived ||= isNewMail;
      }
      this.messages.addAll(newMessages);
      await this.saveNewMsgs(newMessages);
      await this.storage.saveFolderProperties(this);
      return newMessages;
    } finally {
      lock.release();
    }
  }

  /** Searches the messages of this folder on the server.
   * The results are *not* added to `this.messages`: they are only the matches,
   * not the entire folder contents.
   * @param query IMAP `SEARCH` keys, @see `IMAPSearchEMail`
   * @returns the matching emails, newest first */
  async searchMessages(query: SearchObject, limit?: number): Promise<ArrayColl<IMAPEMail>> {
    let uids = (await this.fetchUIDList(query)).sortBy(uid => -uid).contents;
    if (limit) {
      uids = uids.slice(0, limit);
    }
    let results = new ArrayColl<IMAPEMail>();
    const kBatchSize = 200; // A `FETCH` of all UIDs at once would exceed the line length
    for (let i = 0; i < uids.length; i += kBatchSize) {
      let { newMessages, updatedMessages } = await this.fetchMessageList(
        { uid: uids.slice(i, i + kBatchSize).join(",") }, {}, false);
      results.addAll(updatedMessages);
      results.addAll(newMessages);
    }
    return results;
  }

  /** @param updateSyncState Only if `range` covers the entire folder.
   *   The highest modseq of a few messages says nothing about the other messages,
   *   so taking it as folder sync state would skip their changes. */
  protected async fetchMessageList(range: any, options: any, updateSyncState = true): Promise<{ newMessages: ArrayColl<IMAPEMail>, updatedMessages: ArrayColl<IMAPEMail> }> {
    let newMessages = new ArrayColl<IMAPEMail>();
    let updatedMessages = new ArrayColl<IMAPEMail>();
    await this.runCommand(async (conn) => {
      let returnData = {
        uid: true,
        size: true,
        threadId: true,
        internalDate: true,
        envelope: true,
        flags: true,
      };
      this.account.log(this, conn, "fetchMessageList", range, options);
      let msgsAsyncIterator = await conn.fetch(range, returnData, options);
      let modseq: bigint;
      for await (let msgInfo of msgsAsyncIterator) {
        if (!msgInfo.envelope || this.deletions.has(msgInfo.uid)) {
          continue;
        }
        let msg = this.getEMailByUID(msgInfo.uid);
        if (msg) {
          msg.fromFlow(msgInfo);
          updatedMessages.add(msg);
        } else {
          msg = new IMAPEMail(this);
          msg.fromFlow(msgInfo);
          newMessages.add(msg);
        }
        modseq = msgInfo.modseq
      }
      if (updateSyncState) {
        await this.updateModSeq(modseq);
      }
    }, ConnectionPurpose.Fetch);
    return { newMessages, updatedMessages };
  }

  protected async fetchFlags(range: any, options: any, connection?: ImapFlow): Promise<{ updatedMessages: ArrayColl<IMAPEMail> }> {
    let updatedMessages = new ArrayColl<IMAPEMail>();
    await this.runCommand(async (conn) => {
      let returnData = {
        uid: true,
        flags: true,
        //threadId: true,
      };
      this.account.log(this, conn, "fetchFlags", range, options);
      let msgsAsyncIterator = await conn.fetch(range, returnData, options);
      for await (let msgInfo of msgsAsyncIterator) {
        if (!msgInfo.flags || this.deletions.has(msgInfo.uid)) {
          continue;
        }
        let msg = this.getEMailByUID(msgInfo.uid);
        if (!msg) {
          continue;
        }
        msg.setFlagsLocal(msgInfo.flags);
        updatedMessages.add(msg);
      }
    }, ConnectionPurpose.Fetch, connection);
    return { updatedMessages };
  }

  /** @returns UIDs within the requested range */
  protected async fetchUIDList(range: any, connection?: ImapFlow): Promise<ArrayColl<number>> {
    let ids: number[] | false;
    await this.runCommand(async (conn) => {
      this.account.log(this, conn, "fetchUIDList", range);
      ids = await conn.search(range, { uid: true });
    }, ConnectionPurpose.Fetch, connection);
    // ImapFlow returns `false` on server error. An empty result would
    // make callers believe that all messages were deleted on the server.
    assert(ids, "IMAP: Search for messages failed");
    return new ArrayColl(ids);
  }

  protected async updateNewFlags() {
    let recentMsg = this.getRecentMsg();
    let highestUID = this.getHighestUID();
    if (!recentMsg || !highestUID) {
      return;
    }
    let { updatedMessages } = await this.fetchFlags(
      { uid: recentMsg.uid + ":" + highestUID }, {});
    await this.saveMsgUpdates(updatedMessages);
  }

  /** Lists new messages, and downloads them */
  async getNewMessages(): Promise<Collection<IMAPEMail>> {
    await this.readFolder();
    if (this.messages.isEmpty) {
      // We have no UID to start from, so we would fetch `1:*`, i.e. everything
      return await this.getRecentMessages() as Collection<IMAPEMail>;
    }
    let newMsgs = await this.listNewMessages();
    await this.downloadMessages(newMsgs);
    await this.checkDeletedMessages(this.getRecentMsg()?.uid);
    return newMsgs;
  }

  /** Lists all messages, and downloads them */
  async getAllMessages(): Promise<ArrayColl<IMAPEMail>> {
    await this.checkDeletedMessages(1);
    let newMsgs = await this.listAllMessages();
    await this.downloadSmallMessagesFirst(newMsgs);
    return newMsgs;
  }

  /**
   * Downloads the emails in batches.
   * @return Actually newly downloaded msgs
   */
  async downloadMessages(emails: Collection<IMAPEMail>): Promise<Collection<IMAPEMail>> {
    let needMsgs = new ArrayColl(emails.sortBy(msg => -msg.uid));
    let downloadedMsgs = new ArrayColl<IMAPEMail>();
    const kMaxCount = 50;
    while (needMsgs.hasItems) {
      let downloadingMsgs = needMsgs.getIndexRange(needMsgs.length - kMaxCount, kMaxCount);
      needMsgs.removeAll(downloadingMsgs);
      downloadingMsgs = downloadingMsgs.filter((msg) => !msg.downloadRunOnce.running);
      if (!downloadingMsgs.length) {
        continue;
      }
      let uids = downloadingMsgs.map(msg => msg.uid).join(",");
      await this.runCommand(async (conn) => {
        this.account.log(this, conn, "downloadMessages", emails.contents.map(e => e.id).join(", "));
        let msgInfos = await conn.fetch({ uid: uids }, {
          uid: true,
          size: true,
          threadId: true,
          envelope: true,
          source: true,
          flags: true,
          // headers: true,
        }, { uid: true });
        for await (let msgInfo of msgInfos) {
          try {
            if (!msgInfo.envelope || !msgInfo.source?.length || this.deletions.has(msgInfo.uid)) {
              continue;
            }
            let msg = this.getEMailByUID(msgInfo.uid);
            if (msg?.downloadComplete) {
              continue;
            } else if (msg) {
              await this.updateModSeq(msgInfo.modseq);
              await msg.downloadRunOnce.runOnce(async () => {
                msg.fromFlow(msgInfo);
                await msg.parseMIME();
                await msg.saveCompleteMessage();
              });
              downloadedMsgs.add(msg);
            }
          } catch (ex) {
            this.account.errorCallback(ex);
          }
        }
      }, ConnectionPurpose.Fetch);
    }

    /*for (let msg of this.messages) {
      if (!msg.threadID && msg.dbID) {
        await msg.findThread(this.messages);
      }
    }*/

    return downloadedMsgs;
  }

  getEMailByUID(uid: number): IMAPEMail {
    return this.messages.find(m => m.uid == uid);
  }

  /** @returns UID of newest message known locally */
  protected getHighestUID(): number {
    let highest = 1;
    for (let msg of this.messages) {
      if (msg.uid > highest) {
        highest = msg.uid;
      }
    }
    return highest;
  }

  /** @returns message from n days ago */
  protected getRecentMsg(): IMAPEMail {
    const kDaysPast = 7;
    let recently = new Date();
    recently.setDate(recently.getDate() - kDaysPast);
    return this.messages
      .filterOnce(msg => msg.received.getTime() > recently.getTime()) // last n days
      .sortBy(msg => msg.uid)
      .first; // oldest
  }

  /** Save partial headers of newly discovered emails.
   *
   * Note: Completely downloaded emails are not saved here, but in
   * `downloadMessages()` -> `msg.saveCompleteMessage()` */
  protected async saveNewMsgs(msgs: Collection<IMAPEMail>) {
    if (msgs.isEmpty) {
      return;
    }
    let startTime = Date.now();
    await this.storage.saveMessages(msgs);
    let saveTime = Date.now() - startTime;
    console.log("  Saved", msgs.length, "msgs in", saveTime, "ms =", saveTime / msgs.length, "ms/msg");
  }

  protected async saveMsgUpdates(msgs: Collection<IMAPEMail>) {
    for (let email of msgs) {
      try {
        if (email.subject && email.dbID) {
          await email.saveWritablePropsLocally();
        }
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }
  }

  async updateModSeq(modseq: bigint) {
    if (!modseq) {
      return;
    }
    assert(typeof (modseq) == "bigint", "IMAP Folder modseq must be a bigint");
    if (modseq > this.lastModSeq) {
      this.syncState = String(sanitize.bigint(modseq));
      await this.storage.saveFolderProperties(this);
    }
  }

  startPolling() {
    if (!this.account.pollIntervalMinutes) {
      return;
    }
    this.stopPolling();

    this.poller = setInterval(async () => {
      try {
        await this.pollRun();
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

  protected async pollRun() {
    await this.getNewMessages();
  }

  /**
   * Compares messages on the server with the locally known messages,
   * and deletes all messages locally that do not exist on the server.
   *
   * @param fromUID Check all messages starting with this UID,
   *   up to the newest message in this folder.
   *   Optional. By default, checks entire folder (may be slow!)
   */
  async checkDeletedMessages(fromUID: number = 1) {
    let localMsgs = this.messages.filterOnce(msg => msg.uid >= fromUID);
    let serverUIDs = await this.fetchUIDList({ uid: fromUID + ":" + this.getHighestUID() });
    let deletedMsgs = localMsgs.filterOnce(msg => !serverUIDs.includes(msg.uid));

    this.messages.removeAll(deletedMsgs);
    for (let deletedMsg of deletedMsgs) {
      await deletedMsg.deleteMessageLocally();
    }
  }

  /** We received an event from the server that the
   * number of emails in the folder changed */
  async countChanged(newCount: number, oldCount: number): Promise<void> {
    let hasChanged = newCount != oldCount || newCount != this.countTotal;
    if (hasChanged) {
      this.account.log(this, null, "notify: new message count:", newCount, "server old:", oldCount, "our old:", this.countTotal);
      this.countTotal = newCount;
      await this.getNewMessages();
    }
  }

  /** We received an event from the server that the
   * unread or flag status of an email changed */
  async messageFlagsChanged(uid: number | null, seq: number, flags: Set<string>, newModSeq?: bigint, connection?: ImapFlow): Promise<void> {
    // console.log("msg flags changed", "uid", uid, "seq", seq, "flags", flags, "modseq", newModSeq);
    if (this.deletions.has(uid)) {
      return;
    }
    let query = uid && this.getEMailByUID(uid)
      ? { uid: uid }
      : { seq: seq }; // needs to happen on the same IMAP connection where we got the seq number from
    this.account.log(this, connection, "notify: message flags changed", "uid", uid, "seq", seq, "found email UID", uid);
    let { updatedMessages } = await this.fetchFlags(query, {}, connection);
    await this.saveMsgUpdates(updatedMessages);
  }

  /** We received an event from the server that a
   * message was deleted */
  async messageDeletedNotification(seq: number, connection: ImapFlow): Promise<void> {
    this.account.log(this, connection, "notify: message deleted", "seq", seq);

    // We need to map from msg sequence number to UID
    // Ask server to list all known messages (as UID) from 1 msg before seq to seq.
    // (whereas `seq` is now the message after (!) the deleted msg,
    // given that seq are order numbers and therefore get re-assigned on delete.)
    // This should return exactly 2 messages (unless we're at the end or start).
    // Any UIDs between those 2 UIDs are deleted messages.
    // We should purge them from our cache.
    // This works even if several messages are deleted in a row.
    // Thanks to Arnt Gulbrandsen for the ingeneous tip

    if (seq == 1) {
      return; // TODO Handle seq == 1
    }
    // needs to happen on the same IMAP connection where we got the seq number from
    let remainingUIDs = await this.fetchUIDList({ seq: (seq - 1) + ":" + seq }, connection);
    if (remainingUIDs.length != 2) {
      this.account.log(this, connection, "newest message deleted", "TODO handle this");
      return; // TODO Handle start and end
    }
    let startUID = remainingUIDs.first;
    let endUID = remainingUIDs.last;
    let deletedMsgs = this.messages.filterOnce(msg => startUID < msg.uid && msg.uid < endUID);
    for (let deletedMsg of deletedMsgs) {
      this.account.log(this, connection, "Deleted msg", deletedMsg.subject);
      await deletedMsg.deleteMessageLocally();
    }
  }

  protected async moveOrCopyMessagesOnServer(action: "move" | "copy", messages: Collection<IMAPEMail>) {
    let actionVerb = sanitize.translate(action, { move: "Move", copy: "Copy" });
    let sourceFolder = messages.first.folder;
    let ids = messages.contents.map(msg => msg.uid).join(",");
    await sourceFolder.runCommand(async conn => {
      this.account.log(this, conn, action, "message from", sourceFolder.id, ids);
      await conn["message" + actionVerb](ids, this.path, { uid: true });
    });
  }

  async addMessage(message: EMail) {
    message.mime ??= await CreateMIME.getMIME(message, true);
    await this.runCommand(async (conn) => {
      await conn.append(this.path, Buffer.from(message.mime), IMAPEMail.getIMAPFlags(message), message.received);
    });
  }

  async moveFolderHere(folder: IMAPFolder) {
    await super.moveFolderHere(folder);
    /*
    assert(folder.subFolders.isEmpty, `Folder ${folder.name} has sub-folders. Cannot yet move entire folder hierarchies. You may move the folders individually.`);
    let newFolder = await this.createSubFolder(folder.name);
    await newFolder.moveMessagesHere(folder.messages);
    await folder.deleteIt();
    console.log("Folder moved from", folder.path, "to", newFolder.path);
    */
    let newPath: string;
    await this.runCommand(async (conn) => {
      let renamed = await conn.mailboxRename(folder.path, [this.path, folder.getPathComponents().pop()]);
      newPath = renamed.newPath;
    });
    await folder.updatePath(newPath);
  }

  async createSubFolder(name: string): Promise<IMAPFolder> {
    let newFolder = await super.createSubFolder(name) as IMAPFolder;
    newFolder.path = this.path + "/" + name;
    await this.runCommand(async (conn) => {
      let created = await conn.mailboxCreate([this.path, name]);
      newFolder.path = created.path;
    });
    console.log("IMAP folder created", name, newFolder.path);
    await newFolder.listMessages();
    return newFolder;
  }

  async rename(newName: string): Promise<void> {
    await super.rename(newName);
    let parentPath = this.getPathComponents().slice(0, -1);
    let newPath: string;
    await this.runCommand(async (conn) => {
      let renamed = await conn.mailboxRename(this.path, [...parentPath, newName]);
      newPath = renamed.newPath;
    });
    await this.updatePath(newPath);
    console.log("IMAP folder renamed to", this.path);
  }

  /** After a rename or move on the server, update our folder path
   * and those of all subfolders, and save them. */
  protected async updatePath(newPath: string): Promise<void> {
    assert(newPath, "Need the new folder path");
    let oldPath = this.path;
    this.path = newPath;
    await this.save();
    for (let subFolder of this.subFolders) {
      await subFolder.updatePath(newPath + subFolder.path.slice(oldPath.length));
    }
  }

  /** Warning: Also deletes all messages in the folder, also on the server */
  protected async deleteItOnServer(): Promise<void> {
    await this.runCommand(async (conn) => {
      await conn.mailboxDelete(this.path);
    });
    console.log("IMAP folder deleted", this.name, this.path);
  }

  async markAllRead(): Promise<void> {
    await super.markAllRead();
    await this.runCommand(async (conn) => {
      await conn.messageFlagsAdd("1:*", ["\\Seen"], { uid: true });
    });
  }

  /** @param specialUse From RFC 6154, e.g. `\Sent`
   * <https://datatracker.ietf.org/doc/html/rfc6154> */
  setSpecialUse(specialUse: string): void {
    switch (specialUse) {
      case "\\Inbox":
        this.specialFolder = SpecialFolder.Inbox;
        break;
      case "\\Trash":
        this.specialFolder = SpecialFolder.Trash;
        break;
      case "\\Junk":
        this.specialFolder = SpecialFolder.Spam;
        break;
      case "\\Sent":
        this.specialFolder = SpecialFolder.Sent;
        break;
      case "\\Drafts":
        this.specialFolder = SpecialFolder.Drafts;
        break;
      case "\\Archive":
        this.specialFolder = SpecialFolder.Archive;
        break;
    }
    if (this.path.toUpperCase() == "INBOX") {
      this.specialFolder = SpecialFolder.Inbox;
    } else if (!this.account.getSpecialFolder(SpecialFolder.Sent) && this.path.toLowerCase() == "sent") {
      // or "INBOX/Sent" or "Sent Messages" (Exchange) or various translated versions of it
      this.specialFolder = SpecialFolder.Sent;
    } else if (!this.account.getSpecialFolder(SpecialFolder.Drafts) && this.path.toLowerCase() == "drafts") {
      this.specialFolder = SpecialFolder.Drafts;
    } else if (!this.account.getSpecialFolder(SpecialFolder.Trash) && this.path.toLowerCase() == "trash") {
      this.specialFolder = SpecialFolder.Trash;
    }
  }

  newEMail(): IMAPEMail {
    return new IMAPEMail(this);
  }

  async getSharedPersons(): Promise<ArrayColl<PersonUID> | undefined> {
    if (!await this.account.hasCapability("ACL")) {
      return undefined;
    }
    let attributes: Array<{ type: string, value: string }>;
    let persons = new ArrayColl<PersonUID>();
    let conn = await this.account.connection();
    let lock = await this.account.connectionLock.get(conn).lock();
    try {
      let response = await conn.exec('GETACL', [{ type: 'ATOM', value: this.path }], { untagged: { async ACL(untagged) { attributes = untagged.attributes; } } });
      await response.next();
    } finally {
      lock.release();
    }
    for (let i = 1; i < attributes.length; i += 2) {
      let name = sanitize.nonemptystring(attributes[i].value);
      if (name == this.account.username) {
        continue;
      }
      let emailAddress = name.includes('@') ? name : name + this.account.emailAddress.slice(this.account.emailAddress.indexOf('@'));
      persons.add(new PersonUID(emailAddress, name));
    }
    return persons;
  }

  async addPermission(permission: PersonUID, rights: string) {
    let conn = await this.account.connection();
    let lock = await this.account.connectionLock.get(conn).lock();
    try {
      let response = await conn.exec('SETACL', [{ type: 'ATOM', value: this.path }, { type: 'ATOM', value: permission.name }, { type: 'ATOM', value: "+" + rights }]);
      await response.next();
    } finally {
      lock.release();
    }
  }

  async removePermission(permission: PersonUID) {
    let conn = await this.account.connection();
    let lock = await this.account.connectionLock.get(conn).lock();
    try {
      let response = await conn.exec('DELETEACL', [{ type: 'ATOM', value: this.path }, { type: 'ATOM', value: permission.name }]);
      await response.next();
    } finally {
      lock.release();
    }
  }

  fromExtraJSON(json: any) {
    super.fromExtraJSON(json);
    this.uidvalidity = sanitize.integer(json.uidvalidity, 0);
  }
  toExtraJSON(): any {
    let json = super.toExtraJSON();
    json.uidvalidity = this.uidvalidity;
    return json;
  }
}
