import { EMail } from "../EMail";
import type { POP3Folder } from "./POP3Folder";
import { SpecialFolder } from "../Folder";
import { DeleteStrategy } from "../MailAccount";
import { assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";

export class POP3EMail extends EMail {
  declare folder: POP3Folder;

  constructor(folder: POP3Folder) {
    super(folder);
  }

  /** RFC 1939 unique-id on the server. Only for mails in the inbox. */
  get uidl(): string | null {
    return this.pID as string | null;
  }
  set uidl(val: string | null) {
    assert(val === null || typeof (val) == "string", "POP3 EMail UIDL must be a string");
    this.pID = val;
  }

  /** If the locally saved content got lost, get it from the server again */
  async download() {
    await this.downloadRunOnce.runOnce(async () => {
      assert(this.uidl && this.folder.isOnServer, gt`This mail is not on the server anymore`);
      let conn = await this.folder.account.connect();
      try {
        let number = (await conn.uidlAll()).getKeyForValue(this.uidl);
        assert(number, gt`This mail is not on the server anymore`);
        this.mime = await conn.retr(number);
        await conn.quit();
      } finally {
        await conn.close();
      }
      await this.parseMIME();
    });
  }

  async markRead(read = true) {
    if (this.isRead != read) {
      this.folder.countUnread += read ? -1 : 1;
    }
    await super.markRead(read);
    await this.saveFlags();
  }

  async markStarred(starred = true) {
    await super.markStarred(starred);
    await this.saveFlags();
  }

  async markSpam(spam = true) {
    await super.markSpam(spam);
    await this.saveFlags();
  }

  async markReplied() {
    await super.markReplied();
    await this.saveFlags();
  }

  async markForwarded() {
    await super.markForwarded();
    await this.saveFlags();
  }

  async markImportant(isImportant = true) {
    await super.markImportant(isImportant);
    await this.saveFlags();
  }

  /** There is no server to hold the flags, so save them right away */
  protected async saveFlags() {
    if (!this.dbID) {
      return;
    }
    await this.saveWritablePropsLocally();
    await this.folder.storage.saveFolderProperties(this.folder);
  }

  /** Move to trash first: Deleting locally destroys the only copy. */
  async deleteMessage(strategy = this.folder.account.deleteStrategy) {
    let trash = this.folder.account.getSpecialFolder(SpecialFolder.Trash);
    if (strategy == DeleteStrategy.MoveToTrash && trash?.specialFolder == SpecialFolder.Trash &&
        ![SpecialFolder.Trash, SpecialFolder.Spam].includes(this.folder.specialFolder)) {
      await trash.moveMessageHere(this);
    } else {
      await this.deleteMessageLocally();
    }
  }

  async deleteMessageLocally() {
    if (!this.isDeleted) {
      this.folder.countTotal--;
      if (!this.isRead) {
        this.folder.countUnread--;
      }
    }
    await super.deleteMessageLocally();
    await this.folder.storage.saveFolderProperties(this.folder);
  }
}
