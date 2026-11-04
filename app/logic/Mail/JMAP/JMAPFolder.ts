import { Folder, SpecialFolder } from "../Folder";
import { JMAPEMail } from "./JMAPEMail";
import type { JMAPAccount } from "./JMAPAccount";
import type { EMail } from "../EMail";
import type { EMailCollection } from "../Store/EMailCollection";
import type { TJMAPEMailHeaders, TJMAPFolder } from "./TJMAPMail";
import type { TJMAPChangeResponse, TJMAPGetResponse, TJMAPQueryResponse } from "./TJMAPGeneric";
import { checkChangeError } from "./JMAPError";
import { CreateMIME } from "../SMTP/CreateMIME";
import { Semaphore } from "../../util/flow/Semaphore";
import { PromiseAllDone } from "../../util/flow/PromiseAllDone";
import { retryOnTransientError } from "../../util/netUtil";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import { ArrayColl, SetColl, Collection } from "svelte-collections";
import { Buffer } from "buffer";
import { gt } from "../../../l10n/l10n";

export class JMAPFolder extends Folder {
  // id: JMAP ID
  declare account: JMAPAccount;
  declare readonly messages: EMailCollection<JMAPEMail>;
  declare readonly subFolders: ArrayColl<JMAPFolder>;
  declare readonly deletions: Set<string>;
  isSubscribed: boolean = true;
  sortOrder: number = Infinity;
  myRights = {} as TJMAPFolder["myRights"];
  protected poller: ReturnType<typeof setInterval>;

  constructor(account: JMAPAccount) {
    super(account);
  }

  fromJMAP(json: TJMAPFolder) {
    this.id = sanitize.nonemptystring(json.id);
    this.name = sanitize.nonemptystring(json.name);
    this.countTotal = sanitize.integer(json.totalEmails);
    this.countUnread = sanitize.integer(json.unreadEmails);
    this.isSubscribed = sanitize.boolean(json.isSubscribed, true);
    this.sortOrder = sanitize.integer(json.sortOrder);
    for (let right in json.myRights) {
      this.myRights[right] = sanitize.boolean(json.myRights[right], true);
    }
    this.setSpecialUse(json.role);
  }

  /** Lists messages in this folder. Updates are efficient.
   * But doesn't download their contents. @see downloadMessages() */
  async listMessages(): Promise<ArrayColl<JMAPEMail>> {
    await this.account.ensureLoggedIn();

    await this.readFolder();
    let lock = await this.listMessagesLock.lock();
    try {
      return this.messages.isEmpty
        ? await this.listAllMessages()
        : await this.listChangedMessages();
    } finally {
      lock.release();
    }
  }

  /** Lists all messages in this folder.
   * But doesn't download their contents. @see downloadMessages() */
  protected async listAllMessages(): Promise<ArrayColl<JMAPEMail>> {
    const batchSize = 200;
    let state: string;
    let allNewMessages = new ArrayColl<JMAPEMail>();
    let position = 0;
    const kMaxRounds = 5000; // 1,000,000 emails
    let previousIDs: string | null = null;
    let isComplete = false;
    for (let round = 1; round <= kMaxRounds; round++) {
      let { newMessages, syncState, ids, limit } = await retryOnTransientError(() =>
        this.fetchMessageList(position, batchSize));
      let pageIDs = ids.join(" ");
      if (pageIDs == previousIDs) {
        break;
      }
      previousIDs = pageIDs;
      state ??= syncState;
      this.messages.addAll(newMessages);
      await this.saveNewMsgs(newMessages);
      allNewMessages.addAll(newMessages);
      position += ids.length;
      if (ids.length < limit) {
        isComplete = true;
        break;
      }
    }
    if (!isComplete) {
      this.account.errorCallback(new Error(`${this.name}: Listing the emails: The server keeps returning more emails. Stopped.`));
    }
    if (state) {
      this.account.syncState.set("Email", state);
    }
    await this.storage.saveFolderProperties(this);
    return allNewMessages;
  }

  /** Lists all messages in this folder that are new or updated since the last fetch. */
  protected async listChangedMessages(): Promise<ArrayColl<JMAPEMail>> {
    if (!this.account.syncState.has("Email")) {
      return await this.listAllMessages();
    }

    try {
      return await this.fetchChangedMessagesForAllFolders();
    } catch (ex) {
      if (ex.code == "cannotCalculateChanges") {
        // Our sync state is too old <https://www.rfc-editor.org/rfc/rfc8620#section-5.2>
        this.account.syncState.delete("Email");
        return await this.listAllMessages();
      }
      throw ex;
    }
  }

  protected async fetchMessageList(start?: number, limit?: number, options?: any): Promise<{ newMessages: ArrayColl<JMAPEMail>, updatedMessages: ArrayColl<JMAPEMail>, syncState: string, ids: string[], limit: number }> {
    console.log("JMAP fetch", limit || start ? `start ${start} limit ${limit}` : "all");
    let listResponse: TJMAPGetResponse<TJMAPEMailHeaders>;
    let lock = await this.account.stateLock.lock();
    try {
      // <https://www.rfc-editor.org/rfc/rfc8621.html#section-4.4>
      let response = await this.account.makeCombinedCall([
        [
          "Email/query", {
            accountId: this.account.accountID,
            filter: {
              inMailbox: this.id,
            },
            sort: [
              { property: "receivedAt", isAscending: false }
            ],
            position: start,
            limit: limit,
          },
          "list",
        ], [
          "Email/get", {
            accountId: this.account.accountID,
            "#ids": {
              name: "Email/query",
              path: "/ids",
              resultOf: "list",
            },
            properties: JMAPEMail.listProperties,
          },
          "emails",
        ],
      ]);
      listResponse = response["emails"];
      let query = response["list"] as TJMAPQueryResponse;

      return {
        ...this.parseMessageList(listResponse.list),
        syncState: listResponse.state,
        ids: sanitize.array(query.ids, []),
        limit: sanitize.integer(query.limit, limit), // The server may set a lower limit
      };
    } finally {
      lock.release();
    }
  }

  /**
   * Checks new messages for *all* folders in this account,
   * and updates *all* the folders.
   * @returns new messages of *this* folder
   */
  async fetchChangedMessagesForAllFolders(): Promise<ArrayColl<JMAPEMail>> {
    assert(this.account.syncState.has("Email"), "No sync state");
    let newMessagesOfThisFolder = new ArrayColl<JMAPEMail>();
    const kMaxRounds = 1000;
    for (let round = 1; round <= kMaxRounds; round++) {
      let lock = await this.account.stateLock.lock();
      try {
        let sinceState = this.account.syncState.get("Email");
        //console.log("JMAP fetching changes for folder", this.name);
        // <https://www.rfc-editor.org/rfc/rfc8620#section-5.2>
        let response = await retryOnTransientError(() => this.account.makeCombinedCall([
          [
            "Email/changes", {
              accountId: this.account.accountID,
              sinceState: sinceState,
              maxChanges: 500,
            },
            "changes",
          ], [
            "Email/get", {
              accountId: this.account.accountID,
              "#ids": {
                resultOf: "changes",
                name: "Email/changes",
                path: "/created",
              },
              properties: JMAPEMail.listProperties,
            },
            "added",
          ], [
            "Email/get", {
              accountId: this.account.accountID,
              "#ids": {
                resultOf: "changes",
                name: "Email/changes",
                path: "/updated",
              },
              properties: JMAPEMail.listProperties,
            },
            "changed",
          ],
        ]));
        //console.log("sync response", response);

        let changes = response["changes"] as TJMAPChangeResponse<TJMAPEMailHeaders>;
        let addedResponse = response["added"] as TJMAPGetResponse<TJMAPEMailHeaders>;
        let changedResponse = response["changed"] as TJMAPGetResponse<TJMAPEMailHeaders>;

        // Split the responses by folder: map Folder JMAP ID -> JMAP EMail
        let addedByFolder = new Map<string, TJMAPEMailHeaders[]>();
        let changedByFolder = new Map<string, TJMAPEMailHeaders[]>();
        splitByFolder(addedResponse.list, addedByFolder);
        splitByFolder(changedResponse.list, changedByFolder);

        let allFolders = this.account.getAllFolders() as ArrayColl<JMAPFolder>;
        for (let folder of allFolders) {
          let removed = this.findMovedAway(changedResponse.list, folder); // catches deletes e.g. from Inbox, which we read anyways
          let addedThisFolder = addedByFolder.get(folder.id);
          let changedThisFolder = changedByFolder.get(folder.id);
          if (!(addedThisFolder || changedThisFolder ||
                removed.hasItems ||
                changes.destroyed?.length && (folder.messages.hasItems || [SpecialFolder.Trash, SpecialFolder.Spam].includes(folder.specialFolder)))) {
            continue;
          }
          /** To avoid reading all messages of all folders, we handle
           * - permanent deletes only from folders that we already read, and Trash / Spam (`DeleteStrategy.MoveToTrash`)
           * - moves only from folders that we already read
           * - new messages only in folders that we already listed
           * This is a tradeoff. */
          await folder.readFolder();
          if (folder.messages.isEmpty && folder.countTotal > 0) {
            continue; // Adding messages here would stop listAllMessages() from ever running
          }
          removed = this.findMovedAway(changedResponse.list, folder); // repeat after reading the folder
          removed.addAll(await folder.parseRemovedMessages(changes.destroyed ?? []));
          // A draft or email uploaded from here comes back in `created`, so need dup checks
          let addedResult = folder.parseMessageList(addedThisFolder ?? []);
          let changedResult = folder.parseMessageList(changedThisFolder ?? []);
          addedResult.newMessages.addAll(changedResult.newMessages);
          //console.log(folder.name, "added messages", addedResult.newMessages.contents.map(e => e.subject));
          //console.log(folder.name, "updated messages", changedResult.updatedMessages.contents.map(e => e.subject));
          //console.log(folder.name, "removed messages", removedMessages.contents.map(e => e.subject));

          folder.messages.removeAll(removed);
          for (let msg of addedResult.newMessages) {
            msg.isNewArrived = true;
          }
          folder.messages.addAll(addedResult.newMessages);
          for (let msg of removed) {
            await msg.deleteMessageLocally();
          }
          await folder.storage.saveFolderProperties(folder);
          await folder.saveMsgUpdates(changedResult.updatedMessages);
          await folder.saveNewMsgs(addedResult.newMessages);
          if (this === folder) {
            newMessagesOfThisFolder.addAll(addedResult.newMessages);
          }
        }

        this.account.syncState.set("Email", changes.newState);
        await this.account.save();
        if (!changes.hasMoreChanges) {
          return newMessagesOfThisFolder;
        }
        if (changes.newState == sinceState) {
          break;
        }
      } finally {
        lock.release();
      }
    }
    this.account.errorCallback(new Error("Email changes: The server keeps reporting more changes. Stopped."));
    return newMessagesOfThisFolder;
  }

  protected async parseRemovedMessages(messageIDs: string[]): Promise<SetColl<JMAPEMail>> {
    let removedMessages = new SetColl<JMAPEMail>();
    for (let removedID of messageIDs) {
      let msg = this.getEMailByJMAPID(removedID);
      if (!msg) {
        continue;
      }
      removedMessages.add(msg);
    }
    return removedMessages;
  }

  /**
   * Find messages (`msgs`) that were moved away from `folder`.
   *
   * To handle copy of the same email object to a second folder, and then deleting it from only one of the folders,
   * we need to check *all* folders for *every* changed message, even if the folder didn't change (!), because
   * JMAP doesn't tell us about moves or removals of the second copy. :-(
   * @return removed emails. It's the caller's obligation to remove them from the folder
   */
  protected findMovedAway(msgs: TJMAPEMailHeaders[], folder: JMAPFolder): SetColl<JMAPEMail> {
    let removed = new SetColl<JMAPEMail>();
    for (let msg of msgs) {
      let existing = folder.getEMailByJMAPID(msg.id);
      // added messages are handled by `folder.parseMessageList(changedThisFolder...`
      if (existing && !msg.mailboxIds[folder.id]) {
        removed.add(existing);
      }
    }
    return removed;
  }

  parseMessageList(msgs: TJMAPEMailHeaders[], checkUpdates = true): { newMessages: ArrayColl<JMAPEMail>, updatedMessages: ArrayColl<JMAPEMail> } {
    let newMessages = new ArrayColl<JMAPEMail>();
    let updatedMessages = new ArrayColl<JMAPEMail>();
    for (let json of msgs) {
      try {
        let jmapID = sanitize.nonemptystring(json.id);
        if (this.deletions.has(jmapID)) {
          continue;
        }
        let msg = checkUpdates && this.getEMailByJMAPID(jmapID);
        if (msg) {
          msg.fromJMAP(json);
          updatedMessages.add(msg);
        } else {
          msg = this.newEMail();
          msg.fromJMAP(json);
          newMessages.add(msg);
        }
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }
    return { newMessages, updatedMessages };
  }

  /** Lists new messages, and downloads them */
  async getNewMessages(): Promise<Collection<JMAPEMail>> {
    if (!this.account.syncState.has("Email")) {
      // Without sync state, we would fetch the entire folder
      return await this.getRecentMessages() as Collection<JMAPEMail>;
    }
    let newMsgs = await this.listMessages();
    await this.downloadMessages(newMsgs);
    return newMsgs;
  }

  /** Lists all messages, and downloads them */
  async getAllMessages(): Promise<ArrayColl<JMAPEMail>> {
    let newMsgs = await this.listAllMessages();
    await this.downloadSmallMessagesFirst(newMsgs);
    let updateNew = await this.getNewMessages();
    newMsgs.addAll(updateNew);
    return newMsgs;
  }

  /**
   * Downloads the emails in batches.
   * @return Actually newly downloaded msgs
   */
  async downloadMessages(emails: Collection<JMAPEMail>): Promise<Collection<JMAPEMail>> {
    let needMsgs = new ArrayColl(emails);
    let downloadedMsgs = new ArrayColl<JMAPEMail>();
    let semaphore = new Semaphore(this.account.maxParallelRequests);
    let downloads = new PromiseAllDone();
    while (needMsgs.hasItems) {
      let msg = needMsgs.pop();
      if (msg.downloadRunOnce.running) {
        continue;
      }
      let lock = await semaphore.lock();
      downloads.add((async () => {
        try {
          await msg.download();
          downloadedMsgs.add(msg);
        } catch (ex) {
          this.account.errorCallback(ex);
        } finally {
          lock.release();
        }
      })());
    }
    await downloads.wait();
    return downloadedMsgs;
  }

  protected getEMailByJMAPID(jmapID: string): JMAPEMail {
    return this.messages.find((m: JMAPEMail) => m.jmapID == jmapID) as JMAPEMail;
  }

  protected async saveNewMsgs(msgs: Collection<JMAPEMail>) {
    let startTime = Date.now();
    for (let email of msgs) {
      try {
        if (email.subject) {
          await email.saveMetadataLocally();
        }
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }
    let saveTime = Date.now() - startTime;
    console.log("  Saved", msgs.length, "msgs in", saveTime, "ms =", saveTime / msgs.length, "ms/msg");
  }

  protected async saveMsgUpdates(msgs: Collection<JMAPEMail>) {
    for (let email of msgs) {
      try {
        if (email.subject) {
          await email.saveWritablePropsLocally();
        }
      } catch (ex) {
        this.account.errorCallback(ex);
      }
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

  async addMessage(email: EMail) {
    // #if [!WEBMAIL]
    await this.addMessageFromMIME(email);
    // #else
    await this.addMessageFromProperties(email);
    // #endif
  }

  /** Creates a MIME message locally and uploads that to the JMAP server */
  async addMessageFromMIME(email: EMail) {
    email.mime ??= await CreateMIME.getMIME(email, true);

    let uploadResponse = await this.account.uploadBlob(Buffer.from(email.mime), "message/rfc822", "email");
    let blobId = uploadResponse.blobId;
    assert(uploadResponse.size == email.mime.length, `Storing message failed: Sent ${email.mime.length} bytes, received: ${uploadResponse.size} bytes`);
    let createResponse = await this.account.makeSingleCall("Email/import", {
      accountId: this.account.accountID,
      emails: {
        "addMessage": {
          mailboxIds: {
            [this.id]: true
          },
          blobId: blobId,
          keywords: JMAPEMail.getJMAPFlags(email),
          receivedAt: email.received?.toISOString(),
        },
      },
    }) as TJMAPChangeResponse<TJMAPEMailHeaders>;
    checkChangeError(createResponse);
    // TODO need to clone email into a new JMAPEMail, esp. when copying (not moving) from EWS to JMAP.
    email.pID = createResponse.created["addMessage"].id;
    email.folder = this;
    // this.messages.add(email); -- see above
    await this.listChangedMessages();
  }

  /** Uploads the email as individual properties and body parts to the JMAP server */
  async addMessageFromProperties(email: EMail) {
    email.folder = this;
    let createResponse = await this.account.makeSingleCall("Email/set", {
      accountId: this.account.accountID,
      create: {
        "addMessage": await JMAPEMail.getJMAPEmailObject(email, this.account),
      },
    }) as TJMAPChangeResponse<TJMAPEMailHeaders>;
    checkChangeError(createResponse);
    // need to clone email -- see above
    email.pID = createResponse.created["addMessage"].id;
    // this.messages.add(email); -- see above
    await this.listChangedMessages();
  }

  protected async moveOrCopyMessagesOnServer(action: "move" | "copy", messages: Collection<JMAPEMail>) {
    let targetFolderID = this.id;
    let batchSize = this.account.maxObjectsInSet;
    for (let i = 0; i < messages.length; i += batchSize) {
      let updates: Record<string, Record<string, boolean>> = {};
      for (let msg of messages.getIndexRange(i, batchSize)) {
        let id = msg.jmapID;
        let sourceFolderID = msg.folder.id;
        updates[id] = {
          [`mailboxIds/${targetFolderID}`]: true,
          [`mailboxIds/${sourceFolderID}`]: action == "copy" ? true : null,
        };
      }
      await this.account.makeSingleCall("Email/set", {
        accountId: this.account.accountID,
        update: updates,
      });
    }

    this.countTotal += messages.length;
    let sourceFolder = messages.first.folder;
    if (action == "move") {
      sourceFolder.countTotal -= messages.length;
      for (let sourceMsg of messages) {
        await sourceMsg.deleteMessageLocally();
      }
    }

    await this.listChangedMessages();
    // if move: listChangedMessages() checks all folders, so the source folder is automatically fetched as well.
  }

  async moveFolderHere(folder: JMAPFolder) {
    await super.moveFolderHere(folder);
    let response = await this.account.makeSingleCall("Mailbox/set", {
      accountId: this.account.accountID,
      update: {
        [folder.id]: {
          parentId: this.id,
        },
      },
    }) as TJMAPChangeResponse<TJMAPFolder>;
    checkChangeError(response);
    await folder.save();
    await this.account.listFolders();
  }

  async createSubFolder(name: string): Promise<JMAPFolder> {
    let newFolder = await super.createSubFolder(name) as JMAPFolder;
    let response = await this.account.makeSingleCall("Mailbox/set", {
      accountId: this.account.accountID,
      create: {
        "newFolder": {
          parentId: this.id,
          name: name,
          isSubscribed: true,
        },
      },
    }) as TJMAPChangeResponse<TJMAPEMailHeaders>;
    checkChangeError(response);
    newFolder.id = response.created["newFolder"].id;
    console.log("JMAP folder created", name);
    await this.account.listFolders();
    await newFolder.listMessages();
    return newFolder;
  }

  async rename(newName: string): Promise<void> {
    await super.rename(newName);
    await this.account.makeSingleCall("Mailbox/set", {
      accountId: this.account.accountID,
      update: {
        [this.id]: {
          name: newName,
        },
      },
    });
  }

  /** Warning: Also deletes all messages in the folder, also on the server */
  protected async deleteItOnServer(): Promise<void> {
    await this.account.makeSingleCall("Mailbox/set", {
      accountId: this.account.accountID,
      destroy: [this.id],
    });
    console.log("JMAP folder deleted", this.name, this.id);
  }

  async markAllRead(): Promise<void> {
    await super.markAllRead();
    let batchSize = Math.max(1, sanitize.integer(this.account.session?.capabilities?.["urn:ietf:params:jmap:core"]?.maxObjectsInSet, 500));
    const kMaxEMails = 1000000;
    let maxRounds = Math.ceil(kMaxEMails / batchSize);
    let previousIDs: string | null = null;
    for (let round = 1; round <= maxRounds; round++) {
      let query = await this.account.makeSingleCall("Email/query", {
        accountId: this.account.accountID,
        filter: {
          inMailbox: this.id,
          notKeyword: "$seen",
        },
        limit: batchSize,
      }) as TJMAPQueryResponse;
      if (!query.ids.length) {
        return;
      }
      let ids = query.ids.join(" ");
      if (ids == previousIDs) {
        break;
      }
      previousIDs = ids;
      let update: Record<string, Record<string, boolean>> = {};
      for (let id of query.ids) {
        update[id] = { "keywords/$seen": true };
      }
      let response = await this.account.makeSingleCall("Email/set", {
        accountId: this.account.accountID,
        update: update,
      }) as TJMAPChangeResponse<TJMAPEMailHeaders>;
      checkChangeError(response);
    }
    this.account.errorCallback(new Error(`${this.name}: Mark all as read: The server keeps returning unread emails. Stopped.`));
  }

  /** @param specialUse From RFC 6154, e.g. `\Sent`
   * <https://datatracker.ietf.org/doc/html/rfc6154> */
  setSpecialUse(role: string): void {
    switch (role) {
      case "inbox":
        this.specialFolder = SpecialFolder.Inbox;
        break;
      case "trash":
        this.specialFolder = SpecialFolder.Trash;
        break;
      case "junk":
        this.specialFolder = SpecialFolder.Spam;
        break;
      case "sent":
        this.specialFolder = SpecialFolder.Sent;
        break;
      case "drafts":
        this.specialFolder = SpecialFolder.Drafts;
        break;
      case "archive":
        this.specialFolder = SpecialFolder.Archive;
        break;
    }
  }

  disableDelete(): string | false {
    return super.disableDelete() ||
      (this.myRights.mayDelete
        ? false
        : gt`You cannot delete this folder, because the server forbids it.`);
  }

  disableRename(): string | false {
    return super.disableRename() ||
      (this.myRights.mayRename
        ? false
        : gt`You cannot rename this folder, because the server forbids it.`);
  }

  disableSubfolders(): string | false {
    return super.disableSubfolders() ||
      (this.myRights.mayCreateChild
        ? false
        : gt`You cannot create subfolders of this folder, because the server forbids it.`);
  }

  newEMail(): JMAPEMail {
    return new JMAPEMail(this);
  }
}

function splitByFolder(list: TJMAPEMailHeaders[], map: Map<string, TJMAPEMailHeaders[]>) {
  for (let resp of list) {
    for (let mailboxID in resp.mailboxIds) {
      let list = map.get(mailboxID);
      if (!list) {
        list = [];
        map.set(mailboxID, list);
      }
      list.push(resp);
    }
  }
}
