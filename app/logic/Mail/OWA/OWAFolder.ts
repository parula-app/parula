import { ExchangeFolder } from "../EWS/ExchangeFolder";
import { MessageFlagsPidTag } from "../EWS/ExchangeEMail";
import { SpecialFolder } from "../Folder";
import type { EMail } from "../EMail";
import { getSharedPersons, ExchangePermission } from "../EWS/ExchangePermission";
import { OWAEMail } from "./OWAEMail";
import { type OWAAccount, kMaxFetchCount } from "./OWAAccount";
import { OWAError } from "./OWAError";
import { OWACreateItemRequest } from "./Request/OWACreateItemRequest";
import {
  owaCreateNewSubFolderRequest, owaDeleteFolderRequest,
  owaDownloadMsgsRequest, owaFindMsgsInFolderRequest,
  owaFolderCountsRequest, owaFolderMarkAllMsgsReadRequest,
  owaGetNewMsgHeadersRequest, owaMoveEntireFolderRequest,
  owaMoveOrCopyMsgsIntoFolderRequest, owaRenameFolderRequest,
  owaSetFolderPermissionsRequest, owaGetPermissionsRequest
} from "./Request/OWAFolderRequests";
import type { EMailCollection } from "../Store/EMailCollection";
import type { PersonUID } from "../../Abstract/PersonUID";
import { CreateMIME } from "../SMTP/CreateMIME";
import { ensureArray } from "../../util/util";
import { base64ToUint8Array, blobToBase64 } from "../../util/blob";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { ArrayColl, Collection } from "svelte-collections";

export class OWAFolder extends ExchangeFolder {
  declare account: OWAAccount;
  declare readonly messages: EMailCollection<OWAEMail>;
  declare readonly subFolders: ArrayColl<OWAFolder>;
  declare readonly deletions: Set<string>;
  // Whether a folder scan or notification changed the counts
  dirty: boolean = false;

  newEMail(): OWAEMail {
    return new OWAEMail(this);
  }

  fromJSON(json: any) {
    if (this.countTotal != sanitize.integer(json.TotalCount) ||
        this.countUnread != sanitize.integer(json.UnreadCount)) {
      this.dirty = true;
    }
    this.id = sanitize.nonemptystring(json.FolderId.Id);
    this.name = sanitize.nonemptylabel(json.DisplayName);
    this.countTotal = sanitize.integer(json.TotalCount);
    this.countUnread = sanitize.integer(json.UnreadCount);
    switch (json.DistinguishedFolderId) { // allowed to be null
    case "inbox":
      this.specialFolder = SpecialFolder.Inbox;
      break;
    case "drafts":
      this.specialFolder = SpecialFolder.Drafts;
      break;
    case "sentitems":
      this.specialFolder = SpecialFolder.Sent;
      break;
    case "junkemail":
      this.specialFolder = SpecialFolder.Spam;
      break;
    case "deleteditems":
      this.specialFolder = SpecialFolder.Trash;
      break;
    //case "outbox":
    }
  }

  /**
   * OWA doesn't do sync, so we only read the folder if the counts have changed,
   * either by a notification setting the `dirty` flag or by a manual check.
   */
  async folderCountsChanged() {
    if (this.dirty) {
      this.dirty = false;
      return true;
    }
    let result = await this.account.callOWA(owaFolderCountsRequest(this.id));
    let countTotal = sanitize.integer(result.Folders[0].TotalCount);
    let countUnread = sanitize.integer(result.Folders[0].UnreadCount);
    if (this.countTotal == countTotal && this.countUnread == countUnread) {
      // Nothing to do, hopefully.
      return false;
    }
    this.countTotal = countTotal;
    this.countUnread = countUnread;
    return true;
  }

  async listMessages(): Promise<Collection<OWAEMail>> {
    await this.readFolder();
    let lock = await this.listMessagesLock.lock();
    try {
      if (!await this.folderCountsChanged()) {
        // Avoid unnecessarily rereading the message list.
        return new ArrayColl<OWAEMail>();
      }

      let isNewMail = this.messages.hasItems;
      let allMsgs = new ArrayColl<OWAEMail>();
      let newMsgs = new ArrayColl<OWAEMail>();
      let request = owaFindMsgsInFolderRequest(this.id, kMaxFetchCount);
      let result: any = { RootFolder: { IncludesLastItemInRange: false } };
      while (result?.RootFolder?.IncludesLastItemInRange === false) {
        result = await this.account.callOWA(request);
        if (!result?.RootFolder?.Items?.length) {
          // This folder is empty.
          break;
        }
        request.Body.Paging.Offset = sanitize.integer(result.RootFolder.IndexedPagingOffset);
        let messages = result.RootFolder.Items;
        let newMessageIDs: string[] = [];
        for (let message of messages) {
          let id = sanitize.nonemptystring(message.ItemId.Id);
          if (this.deletions.has(id)) {
            continue;
          }
          let email = this.getEmailByItemID(id);
          if (email) {
            email.setFlags(message);
            await email.saveWritablePropsLocally();
            allMsgs.add(email);
          } else {
            newMessageIDs.push(id);
          }
        }
        let newMsgsInIteration = await this.getNewMessageHeaders(newMessageIDs);
        for (let msg of newMsgsInIteration) {
          msg.isNewArrived = isNewMail;
        }
        newMsgs.addAll(newMsgsInIteration);
      }

      for (let email of this.messages.subtract(allMsgs)) {
        await this.storage.deleteMessage(email);
      }
      allMsgs.addAll(newMsgs);
      this.messages.replaceAll(allMsgs);
      return newMsgs;
    } finally {
      lock.release();
    }
  }

  async getNewMessageHeaders(newMessageIDs: string[]): Promise<ArrayColl<OWAEMail>> {
    let newMsgs = new ArrayColl<OWAEMail>();
    if (newMessageIDs.length) {
      try {
        let results = await this.account.callOWA(owaGetNewMsgHeadersRequest(newMessageIDs));
        let items = results.ResponseMessages ? this.account.itemsFromResponses(results.ResponseMessages.Items) : results.Items;
        for (let item of items) {
          try {
            let email = this.newEMail();
            email.fromJSON(item);
            await email.saveMetadataLocally();
            newMsgs.add(email);
          } catch (ex) {
            this.account.errorCallback(ex);
          }
        }
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }
    return newMsgs;
  }

  async downloadMessages(emails: Collection<OWAEMail>): Promise<Collection<OWAEMail>> {
    let downloadedEmail = new ArrayColl<OWAEMail>();
    let emailsToDownload = emails.contents;
    for (let i = 0; i < emailsToDownload.length; i += kMaxFetchCount) {
      let batch = emailsToDownload.slice(i, i + kMaxFetchCount);
      batch = batch.filter((email) => !email.downloadRunOnce.running);
      if (!batch.length) {
        continue;
      }
      try {
        let results = await this.account.callOWA(owaDownloadMsgsRequest(batch));
        let items = results.ResponseMessages ? this.account.itemsFromResponses(results.ResponseMessages.Items) : results.Items;
        for (let item of items) {
          let email = emailsToDownload.find(email => email.itemID == item.ItemId.Id);
          if (email && !email.downloadComplete) {
            try {
              let mimeBase64 = sanitize.nonemptystring(item.MimeContent.Value);
              await email.downloadRunOnce.runOnce(async () => {
                email.mime = base64ToUint8Array(mimeBase64);
                await email.parseMIME();
                await email.saveCompleteMessage();
              });
              downloadedEmail.add(email);
            } catch (ex) {
              this.account.errorCallback(ex);
            }
          }
        }
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }

    /*for (let email of this.messages) {
      if (!email.threadID && email.dbID) {
        await email.findThread(this.messages);
      }
    }*/

    return downloadedEmail;
  }

  /** Lists only the new messages, and downloads them.
   *
   * Should be implemented as fast as possible (a few seconds),
   * so that the action can be repeated routinely every few minutes.
   * @returns the new messages */
  async getNewMessages(): Promise<Collection<OWAEMail>> {
    await this.readFolder();
    if (this.messages.isEmpty) {
      // OWA has no sync state, so we would fetch the entire folder
      return await this.getRecentMessages() as Collection<OWAEMail>;
    }
    let newMsgs = await this.listMessages(); // TODO get only the msgs from the last 4 weeks
    await this.downloadMessages(newMsgs);
    return newMsgs;
  }

  getEmailByItemID(id: string): OWAEMail | undefined {
    if (!id) {
      return undefined;
    }
    return this.messages.find((m: OWAEMail) => m.itemID == id) as OWAEMail | undefined;
  }

  protected async moveOrCopyMessagesHere(action: "move" | "copy", messages: Collection<EMail>) {
    // We can copy messages to and from shared folders for the main account,
    // but the messages all have to be from the same account.
    let sourceAccount = messages.first.folder.account;
    let sameServer = (sourceAccount.mainAccount ?? sourceAccount) == (this.account.mainAccount ?? this.account) &&
      messages.contents.every(msg => msg.folder.account == sourceAccount);
    await super.moveOrCopyMessagesHere(action, messages, sameServer);
  }

  protected async moveOrCopyMessagesOnServer(action: "move" | "copy", messages: Collection<OWAEMail>) {
    let actionVerb = sanitize.translate(action, { move: "Move", copy: "Copy" }) as "Move" | "Copy";
    // This function must be called using the source account
    let results = await messages.first.folder.account.callOWA(owaMoveOrCopyMsgsIntoFolderRequest(actionVerb, this.id, messages.contents));
    // The messages will be deleted locally after this returns,
    // so ensure that none of them failed on the server.
    for (let result of ensureArray(results.ResponseMessages?.Items)) {
      if (result.ResponseClass == "Error") {
        throw new OWAError({ json: result });
      }
    }
  }

  async addMessage(message: EMail) {
    message.mime ??= await CreateMIME.getMIME(message, true);
    let request = new OWACreateItemRequest({ SavedItemFolderId: { __type: "TargetFolderId:#Exchange", BaseFolderId: { __type: "FolderId:#Exchange", Id: this.id } }, MessageDisposition: "SaveOnly" });
    request.addField("Message", "MimeContent", { CharacterSet: "UTF-8", Value: await blobToBase64(new Blob([message.mime])) });
    if (message.tags.hasItems) {
      request.addField("Message", "Categories", message.tags.contents.map(tag => tag.name));
    }
    if (!message.isDraft) {
      request.addField("Message", "ExtendedProperty", [{ ExtendedFieldURI: { PropertyTag: MessageFlagsPidTag, PropertyType: "Integer" }, Value: "0" }]);
    }
    if (message.isStarred) {
      request.addField("Message", "Flag", {
        __type: "FlagType:#Exchange",
        CompleteDate: null,
        DueDate: null,
        StartDate: null,
        FlagStatus: "Flagged",
      });
    }
    request.addField("Message", "IsRead", message.isRead);
    await this.account.callOWA(request);
  }

  async moveFolderHere(folder: OWAFolder) {
    await super.moveFolderHere(folder);
    await this.account.callOWA(owaMoveEntireFolderRequest(folder.id, this.id));
    await folder.save();
  }

  async createSubFolder(name: string): Promise<OWAFolder> {
    let folder = await super.createSubFolder(name) as OWAFolder;
    let result = await this.account.callOWA(owaCreateNewSubFolderRequest(name, this.id));
    folder.id = sanitize.nonemptystring(result.Folders[0].FolderId.Id);
    this.account.folderMap.set(folder.id, folder);
    return folder;
  }

  async rename(name: string) {
    await super.rename(name);
    await this.account.callOWA(owaRenameFolderRequest(name, this.id));
  }

  protected async deleteItOnServer() {
    await this.account.callOWA(owaDeleteFolderRequest(this.id));
  }

  async markAllRead() {
    await super.markAllRead();
    await this.account.callOWA(owaFolderMarkAllMsgsReadRequest(this.id));
  }

  async getSharedPersons(): Promise<ArrayColl<PersonUID>> {
    let result = await this.account.callOWA(owaGetPermissionsRequest(this.id));
    return getSharedPersons(result.Folders[0].PermissionSet.Permissions, this.account.emailAddress);
  }

  async getPermissions(): Promise<ExchangePermission[]> {
    let result = await this.account.callOWA(owaGetPermissionsRequest(this.id));
    return result.Folders[0].PermissionSet.Permissions.map(permission => new ExchangePermission(permission));
  }

  async setPermissions(permissions: ExchangePermission[]) {
    await this.account.callOWA(owaSetFolderPermissionsRequest(this.id, permissions));
  }
}
