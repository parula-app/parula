import { EMail, setPersons } from "../EMail";
import type { IMAPFolder } from "./IMAPFolder";
import { ConnectionPurpose } from "./IMAPAccount";
import { SpecialFolder } from "../Folder";
import { DeleteStrategy } from "../MailAccount";
import { getTagByName, type Tag } from "../../Abstract/Tag";
import { findOrCreatePersonUID, kDummyPerson } from "../../Abstract/PersonUID";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert, NotReached } from "../../util/util";
import { gt } from "../../../l10n/l10n";

export class IMAPEMail extends EMail {
  declare folder: IMAPFolder;
  /** From IMAP server */
  seq: number | null = null;
  flagsChanging = false;

  constructor(folder: IMAPFolder) {
    super(folder);
  }

  get uid(): number | null {
    return this.pID as number | null;
  }
  set uid(val: number | null) {
    assert(val === null || typeof (val) == "number", "IMAP EMail UID must be a number");
    this.pID = val;
  }

  async download() {
    await this.downloadRunOnce.runOnce(async () => {
      let msgInfo: any;
      try {
        msgInfo = await this.folder.runCommand(async (conn) => {
          this.folder.account.log(this.folder, conn, "download email", this.uid, this.subject);
          return await conn.fetchOne(this.uid + "", {
            uid: true,
            size: true,
            threadId: true,
            envelope: true,
            source: true,
            flags: true,
          }, { uid: true });
        }, ConnectionPurpose.Display);
      } catch (ex) {
        if (ex.message == "IMAP UID FETCH: Invalid uidset") {
          await this.disappeared();
          return;
        } else {
          throw ex;
        }
      }
      if (!msgInfo.envelope || this.folder.deletions.has(msgInfo.uid)) {
        await this.disappeared();
        return;
      }
      this.fromFlow(msgInfo);
      this.mime ??= msgInfo.source; // Temp HACK when `downloadComplete` == true, but mime is not there
      await this.parseMIME();
      await this.saveCompleteMessage();
    });
  }

  fromFlow(msgInfo: any) {
    this.setFlagsLocal(msgInfo.flags);
    // <https://imapflow.com/global.html#FetchMessageObject>
    this.uid = sanitize.integer(msgInfo.uid, null);
    this.seq = sanitize.integer(msgInfo.seq, null);
    this.size = sanitize.integer(msgInfo.size, null);
    if (this.downloadComplete) {
      return;
    }
    // <https://imapflow.com/global.html#MessageEnvelopeObject>
    let env = msgInfo.envelope;
    this.id = sanitize.nonemptystring(env.messageId, this.uid + "");
    this.subject = sanitize.string(env.subject, null);
    this.received = msgInfo.internalDate ?? new Date();
    this.sent = sanitize.date(env.date, this.received);
    this.inReplyTo = sanitize.string(env.inReplyTo, null);
    this.threadID = sanitize.string(env.threadId, null); // Only if server supports OBJECTID or X-GM-EXT-1 IMAP extension
    if (env.from?.length && env.from[0]?.address) {
      let firstFrom = env.from[0];
      this.from = findOrCreatePersonUID(
        sanitize.emailAddress(firstFrom.address, null),
        sanitize.nonemptylabel(firstFrom.name, null));
    } else {
      this.from = kDummyPerson;
    }
    setPersons(this.to, env.to);
    setPersons(this.cc, env.cc);
    setPersons(this.bcc, env.bcc);
    this.outgoing = this.folder?.account.isMyEMailAddress(this.from.emailAddress);
    this.contact = this.outgoing ? this.to.first : this.from;
    assert(!msgInfo.source || msgInfo.source instanceof Uint8Array, "MIME source needs to be a buffer");
    if (msgInfo.source) {
      this.mime = msgInfo.source;
    }
  }

  /** Can happen when another client deleted the email and we didn't get the news yet. */
  protected async disappeared() {
    await this.deleteMessageLocally();
    this.folder.checkDeletedMessages()
      .catch(this.folder.account.errorCallback);
  }

  setFlagsLocal(flags: Set<string>) {
    if (!(flags && flags instanceof Set) || this.flagsChanging) {
      return;
    }
    // <https://www.ietf.org/rfc/rfc9051.html#section-2.3.2>
    this.isRead = flags.has("\\Seen");
    this.isNewArrived = flags.has("\\Recent");
    this.isStarred = flags.has("\\Flagged");
    this.isReplied = flags.has("\\Answered");
    this.isForwarded = flags.has("$Forwarded");
    // Not `=`: The sender's `Importance:` header is not on the server
    this.isImportant ||= flags.has("$Important"); // RFC 8457
    this.isDraft = flags.has("\\Draft");
    this.isSpam = flags.has("$Junk");

    for (let customTag of flags) {
      if (customTag.startsWith("\\") || customTag.startsWith("$") ||
          ["nonjunk", "junk"].includes(customTag.toLowerCase())) {
        continue;
      }
      this.tags.add(getTagByName(customTag));
    }
  }

  static getIMAPFlags(message: EMail): Array<string> {
    let flags = new Array<string>();
    if (message.isRead) {
      flags.push("\\Seen");
    }
    // Not \Recent: it is set by the server only, and servers reject it in APPEND
    if (message.isStarred) {
      flags.push("\\Flagged");
    }
    if (message.isReplied) {
      flags.push("\\Answered");
    }
    if (message.isForwarded) {
      flags.push("$Forwarded");
    }
    if (message.isImportant) {
      flags.push("$Important");
    }
    if (message.isDraft) {
      flags.push("\\Draft");
    }
    if (message.isSpam) {
      flags.push("$Junk");
    }
    for (let tag of message.tags) {
      flags.push(tag.name);
    }
    return flags;
  }

  async markRead(read = true) {
    await super.markRead(read);
    await this.setFlagServer("\\Seen", read);
  }

  async markStarred(starred = true) {
    await super.markStarred(starred);
    await this.setFlagServer("\\Flagged", starred);
  }

  async markSpam(spam = true) {
    await super.markSpam(spam);
    await this.setFlagServer("$Junk", spam);
  }

  async markReplied() {
    await super.markReplied();
    await this.setFlagServer("\\Answered", true);
  }

  async markForwarded() {
    await super.markForwarded();
    await this.setFlagServer("$Forwarded", true);
  }

  async markImportant(isImportant = true) {
    await super.markImportant(isImportant);
    await this.setFlagServer("$Important", isImportant); // RFC 8457
  }

  async markDraft(isDraft = true) {
    await super.markDraft(isDraft);
    await this.setFlagServer("\\Draft", isDraft);
  }

  /**
   * Set read/starred etc. flag on the message
   *
   * @param name -- the flag, e.g. "\Seen", "\Recent", "$Junk" etc., or a user-set tag
   * @param set -- true = add the flag, false = remove the flag
   */
  async setFlagServer(name: string, set = true) {
    try {
      this.flagsChanging = true;
      await this.folder.runCommand(async (conn) => {
        this.flagsChanging = true;
        this.folder.account.log(this.folder, conn, set ? "set" : "remove" + " email flag", this.uid, name, this.subject);
        if (set) {
          await conn.messageFlagsAdd(this.uid, [name], { uid: true });
        } else {
          await conn.messageFlagsRemove(this.uid, [name], { uid: true });
        }
      });
    } finally {
      this.flagsChanging = false;
    }
  }

  async addTagOnServer(tag: Tag) {
    await this.setFlagServer(tag.name, true);
  }

  async removeTagOnServer(tag: Tag) {
    await this.setFlagServer(tag.name, false);
  }

  async deleteMessageOnServer(strategy = this.folder.account.deleteStrategy) {
    try {
      if (!this.uid) {
        return;
      }
      this.folder.deletions.add(this.uid);
      if (strategy == DeleteStrategy.DeleteImmediately ||
          [SpecialFolder.Trash, SpecialFolder.Spam].includes(this.folder.specialFolder)) {
        await this.folder.runCommand(async (conn) => {
          this.folder.account.log(this.folder, conn, "delete email flag", this.uid, this.subject);
          await conn.messageDelete(this.uid, { uid: true });
        });
      } else if (strategy == DeleteStrategy.MoveToTrash) {
        let trash = this.folder.account.getSpecialFolder(SpecialFolder.Trash);
        assert(trash, gt`Trash folder is not set. Cannot delete the email. Please go to folder properties and set Use As: Trash.`);
        await trash.moveMessageHere(this);
      } else if (strategy == DeleteStrategy.Flag) {
        await this.setFlagServer("\\Deleted", true);
      } else {
        throw new NotReached("Unknown delete strategy");
      }
    } finally {
      this.folder.deletions.delete(this.uid);
    }
  }
}
