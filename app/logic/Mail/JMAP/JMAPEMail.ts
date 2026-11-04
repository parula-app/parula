import { EMail } from "../EMail";
import type { JMAPFolder } from "./JMAPFolder";
import type { JMAPAccount } from "./JMAPAccount";
import { SpecialFolder } from "../Folder";
import { DeleteStrategy } from "../MailAccount";
import { availableTags, getTagByName, type Tag } from "../../Abstract/Tag";
import { PersonUID, findOrCreatePersonUID, kDummyPerson } from "../../Abstract/PersonUID";
import type { TJMAPEmailAddress, TJMAPEmailBodyPart, TJMAPEMailHeaders, TJMAPPerson } from "./TJMAPMail";
import type { TJMAPGetResponse } from "./TJMAPGeneric";
import { retryOnTransientError } from "../../util/netUtil";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert, NotReached, getUserPreference } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import type { ArrayColl, Collection } from "svelte-collections";

export class JMAPEMail extends EMail {
  /** What `fromJMAP()` and the folder sync use. The defaults of `Email/get` include the body structure. */
  static readonly listProperties = ["id", "blobId", "threadId", "mailboxIds", "keywords", "size", "receivedAt", "sentAt", "messageId", "inReplyTo", "subject", "from", "to", "cc", "bcc"];
  declare folder: JMAPFolder;
  mimeBlobId: string | null = null; // TODO Save in DB
  protected flagsChanging = false;

  constructor(folder: JMAPFolder) {
    super(folder);
  }

  get jmapID(): string {
    return this.pID as string;
  }
  set jmapID(val: string) {
    this.pID = val;
  }

  fromJMAP(json: TJMAPEMailHeaders) {
    this.setFlagsLocal(json.keywords);
    // <https://www.rfc-editor.org/rfc/rfc8621.html#section-4.2.1>
    this.jmapID = sanitize.nonemptystring(json.id, null);
    if (this.downloadComplete) {
      return;
    }
    this.id = sanitize.nonemptystring(json.messageId?.[0], this.jmapID);
    this.subject = sanitize.string(json.subject, null);
    this.received = sanitize.date(json.receivedAt, this.received ?? new Date());
    this.sent = sanitize.date(json.sentAt, this.received);
    this.inReplyTo = sanitize.string(json.inReplyTo?.[0], null);
    this.threadID = sanitize.string(json.threadId, null);
    this.from = getPersonUID(json.from?.[0] ?? {} as TJMAPPerson);
    setPersons(this.to, json.to);
    setPersons(this.cc, json.cc);
    setPersons(this.bcc, json.bcc);
    this.outgoing = this.folder?.account.isMyEMailAddress(this.from.emailAddress);
    this.contact = this.outgoing ? this.to.first : this.from;
    this.size = sanitize.integer(json.size, null);
    this.mimeBlobId = sanitize.string(json.blobId, null);
    //assert(!json.source || json.source instanceof Uint8Array, "MIME source needs to be a buffer");
    // this.mime = json.source;
  }

  setFlagsLocal(flags: Record<string, boolean>) {
    if (!(flags && flags instanceof Object) || this.flagsChanging) {
      return;
    }
    // <https://www.rfc-editor.org/rfc/rfc8621.html#section-4.1.1>
    this.isRead = sanitize.boolean(flags["$seen"], true);
    this.isStarred = sanitize.boolean(flags["$flagged"], false);
    this.isReplied = sanitize.boolean(flags["$answered"], false);
    this.isForwarded = sanitize.boolean(flags["$forwarded"], false);
    // Not `=`: The sender's `Importance:` header is not on the server
    this.isImportant ||= sanitize.boolean(flags["$important"], false); // RFC 8457
    this.isDraft = sanitize.boolean(flags["$draft"], false);
    this.isSpam = sanitize.boolean(flags["$junk"], false);
    // `isNewArrived` @see JMAPFolder.fetchChangedMessagesForAllFolders()

    let tags: Tag[] = [];
    for (let customTag in flags) {
      if (!customTag ||
          customTag.startsWith("$") ||
          ["nonjunk", "junk"].includes(customTag.toLowerCase())) {
        continue;
      }
      tags.push(JMAPEMail.tagForKeyword(sanitize.string(customTag)));
    }
    this.tags.replaceAll(tags);
  }

  /** Servers return keywords in lowercase (RFC 8621 section 4.1.1), but our tag may be "Work" */
  protected static tagForKeyword(keyword: string): Tag {
    return availableTags.find(tag => tag.name.toLowerCase() == keyword.toLowerCase()) ??
      getTagByName(keyword);
  }

  static getJMAPFlags(email: EMail): Record<string, boolean> {
    let flags: Record<string, boolean> = {};
    flags["$seen"] = email.isRead ? true : undefined;
    flags["$flagged"] = email.isStarred ? true : undefined;
    flags["$answered"] = email.isReplied ? true : undefined;
    flags["$forwarded"] = email.isForwarded ? true : undefined;
    flags["$important"] = email.isImportant ? true : undefined;
    flags["$draft"] = email.isDraft ? true : undefined;
    flags["$junk"] = email.isSpam ? true : undefined;
    for (let tag of email.tags) {
      flags[tag.name] = true;
    }
    return flags;
  }

  protected static getJMAPEmailAddress(puid: PersonUID): TJMAPEmailAddress {
    return {
      name: puid.name,
      email: puid.emailAddress,
    };
  }
  protected static getJMAPEmailAddresses(puids: Collection<PersonUID>): TJMAPEmailAddress[] | undefined {
    let emails = puids.contents.map(r => JMAPEMail.getJMAPEmailAddress(r));
    return emails.length ? emails : undefined;
  }

  protected static async uploadEmailBodyPart(blob: Buffer, mimeType: string, filename: string = null, account: JMAPAccount): Promise<TJMAPEmailBodyPart> {
    let upload = await account.uploadBlob(blob, mimeType, filename);
    return {
      blobId: upload.blobId,
      size: upload.size,
      type: mimeType,
      name: filename,
      charset: mimeType.startsWith("text/") ? "utf-8" : undefined,
    };
  }

  static async getJMAPEmailObject(email: EMail, account: JMAPAccount): Promise<any> {
    assert(email.folder.id, "need folder");
    let doHTML = getUserPreference("mail.send.format", "html") == "html";
    let e = {
      subject: email.subject,
      messageId: [email.messageID],
      from: [JMAPEMail.getJMAPEmailAddress(email.from)],
      replyTo: email.replyTo ? [JMAPEMail.getJMAPEmailAddress(email.replyTo)] : undefined,
      inReplyTo: email.inReplyTo ? [email.inReplyTo] : undefined,
      references: email.references ?? undefined,
      to: JMAPEMail.getJMAPEmailAddresses(email.to),
      cc: JMAPEMail.getJMAPEmailAddresses(email.cc),
      bcc: JMAPEMail.getJMAPEmailAddresses(email.bcc),
      textBody: [await JMAPEMail.uploadEmailBodyPart(Buffer.from(email.text), "text/plain", null, account)],
      htmlBody: doHTML ? [await JMAPEMail.uploadEmailBodyPart(Buffer.from(email.html), "text/html", null, account)] : undefined,
      attachments: [],
      sentAt: email.sent?.toISOString(),
      receivedAt: email.received?.toISOString(),
      keywords: JMAPEMail.getJMAPFlags(email),
      mailboxIds: {
        [email.folder.id]: true,
      },
    };
    for (let name of email.headers.contentKeys()) {
      e["header:" + name] = email.headers.get(name);
    }
    for (let attachment of email.attachments) {
      e.attachments.push(await JMAPEMail.uploadEmailBodyPart(
        Buffer.from(await attachment.content.arrayBuffer()),
        attachment.mimeType,
        attachment.filename, account));
    }
    return e;
  }

  async download() {
    await this.downloadRunOnce.runOnce(async () => {
      let account = this.folder.account;
      if (!this.mimeBlobId) {
        let response = await account.makeSingleCall(
          "Email/get", {
          accountId: account.accountID,
          "ids": [this.jmapID],
          properties: ["blobId"],
        },
        ) as TJMAPGetResponse<TJMAPEMailHeaders>;
        let json = response.list[0];
        assert(json, "JMAP: EMail no longer on server");
        this.mimeBlobId = sanitize.string(json.blobId);
      }

      let url = account.session.downloadUrl;
      url = url
        .replace("{accountId}", account.accountID)
        .replace("{blobId}", this.mimeBlobId)
        .replace("{name}", "email")
        .replace("{type}", "message/rfc822");
      let response = await retryOnTransientError(() => account.httpGet(url, {
        headers: {
          "Accept": "message/rfc822",
          "Content-Type": undefined, // override
        },
        result: "blob",
      }));
      this.mime = new Uint8Array(await response.arrayBuffer());
      await this.parseMIME();
      await this.saveCompleteMessage();
    });
  }

  async markRead(read = true) {
    await super.markRead(read);
    await this.setFlagServer("$seen", read);
  }

  async markStarred(starred = true) {
    await super.markStarred(starred);
    await this.setFlagServer("$flagged", starred);
  }

  async markSpam(spam = true) {
    await super.markSpam(spam);
    await this.setFlagServer("$junk", spam);
    await this.setFlagServer("$notjunk", !spam);
  }

  async markReplied() {
    await super.markReplied();
    await this.setFlagServer("$answered", true);
  }

  async markForwarded() {
    await super.markForwarded();
    await this.setFlagServer("$forwarded", true);
  }

  async markImportant(isImportant = true) {
    await super.markImportant(isImportant);
    await this.setFlagServer("$important", isImportant); // RFC 8457
  }

  async markDraft(isDraft = true) {
    await super.markDraft(isDraft);
    await this.setFlagServer("$draft", isDraft);
  }

  /**
   * Set read/starred etc. flag on the message
   *
   * @param name -- the flag, e.g. "\Seen", "\Recent", "$Junk" etc., or a user-set tag
   * @param set -- true = add the flag, false = remove the flag
   */
  async setFlagServer(name: string, set: boolean) {
    this.flagsChanging = true;
    try {
      await this.folder.account.makeSingleCall("Email/set", {
        accountId: this.folder.account.accountID,
        update: {
          [this.jmapID]: {
            [`keywords/${name}`]: set ? true : null,
          },
        },
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
      this.folder.deletions.add(this.jmapID);
      if (strategy == DeleteStrategy.DeleteImmediately ||
          [SpecialFolder.Trash, SpecialFolder.Spam].includes(this.folder.specialFolder)) {
        await this.folder.account.makeSingleCall("Email/set", {
          accountId: this.folder.account.accountID,
          destroy: [ this.jmapID ],
        });
      } else if (strategy == DeleteStrategy.MoveToTrash || strategy == DeleteStrategy.Flag) {
        let trash = this.folder.account.getSpecialFolder(SpecialFolder.Trash);
        assert(trash, gt`Trash folder is not set. Cannot delete the email. Please go to folder properties and set Use As: Trash.`);
        await trash.moveMessageHere(this);
      } else {
        throw new NotReached("Unknown delete strategy");
      }
    } finally {
      this.folder.deletions.delete(this.jmapID);
    }
  }
}

function setPersons(targetList: ArrayColl<PersonUID>, personList: TJMAPPerson[]): void {
  targetList.clear();
  if (!personList?.length) {
    return;
  }
  targetList.addAll(personList.map(p => getPersonUID(p)));
}

function getPersonUID(p: TJMAPPerson): PersonUID {
  return findOrCreatePersonUID(sanitize.emailAddress(p.email, null), sanitize.nonemptylabel(p.name, null));
}
