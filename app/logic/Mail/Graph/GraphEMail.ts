import { EMail } from "../EMail";
import type { GraphFolder } from "./GraphFolder";
import type { GraphAccount } from "./GraphAccount";
import { SpecialFolder } from "../Folder";
import { DeleteStrategy } from "../MailAccount";
import { EMailFlag, EMailFlagPidTag, EMailFlagTimePidTag, IconIndex, IconIndexPidTag } from "../EWS/ExchangeEMail";
import { getTagByName, type Tag } from "../../Abstract/Tag";
import { PersonUID, findOrCreatePersonUID } from "../../Abstract/PersonUID";
import type { TGraphEMail, TGraphPersonUID, TGraphEMailHeader, TGraphMailAttachment } from "./TGraphMail";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { arrayRemove, assert, NotReached, getUserPreference } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import type { ArrayColl, Collection } from "svelte-collections";
import { ContentDisposition } from "../../Abstract/Attachment";

export class GraphEMail extends EMail {
  pID: string | null = null;
  declare folder: GraphFolder;
  protected flagsChanging = false;

  constructor(folder: GraphFolder) {
    super(folder);
  }

  get path(): string {
    return `messages/${this.pID}`;
  }

  fromGraph(json: TGraphEMail) {
    this.setFlagsLocal(json);
    // <https://www.rfc-editor.org/rfc/rfc8621.html#section-4.2.1>
    this.pID = sanitize.nonemptystring(json.id, null);
    if (this.downloadComplete) {
      return;
    }
    this.id = sanitize.nonemptystring(json.internetMessageId, this.pID);
    this.subject = sanitize.string(json.subject, null);
    this.received = sanitize.date(json.receivedDateTime, this.received ?? new Date());
    this.sent = sanitize.date(json.sentDateTime, this.received);
    // inReplyTo and size are not supported (what gives?!!??)
    this.threadID = sanitize.string(json.conversationId, null);
    this.from = getPersonUID(json.from);
    setPersons(this.to, json.toRecipients);
    setPersons(this.cc, json.ccRecipients);
    setPersons(this.bcc, json.bccRecipients);
    this.outgoing = this.folder?.account.isMyEMailAddress(this.from.emailAddress);
    this.contact = this.outgoing ? this.to.first : this.from;
    // Content, attachments etc will be parsed from RFC822 MIME
  }

  setFlagsLocal(json: TGraphEMail) {
    // isReplied, isForwarded, isSpam are not supported
    // `isNewArrived` @see GraphFolder.processChangedMessages()
    this.isRead = sanitize.boolean(json.isRead, true);
    // Not `=`: The sender's `Importance:` header is not in the response
    this.isImportant ||= json.importance == "high";
    this.isDraft = sanitize.boolean(json.isDraft, false);
    this.isStarred = json.flag?.flagStatus && json.flag.flagStatus != "notFlagged";

    if (!Array.isArray(json.categories)) {
      return;
    }
    let tags: Tag[] = [];
    for (let customTag of json.categories) {
      if (!customTag ||
          customTag.startsWith("$") ||
          ["nonjunk", "junk"].includes(customTag.toLowerCase())) {
        continue;
      }
      tags.push(getTagByName(sanitize.string(customTag)));
    }
    this.tags.replaceAll(tags);
  }

  fromHeaders(headers: TGraphEMailHeader[]) {
    for (let header of headers) {
      this.headers.set(header.name, header.value);
    }
    this.inReplyTo = this.headers.get("In-Reply-To")?.split(" ")[0]; // TODO remove <>
  }

  static getGraphCategories(email: EMail): string[] {
    let flags = [];
    if (email.isSpam) {
      flags.push("$junk");
    }
    if (email.isReplied) {
      flags.push("$answered");
    }
    if (email.isForwarded) {
      flags.push("$forwarded");
    }

    for (let tag of email.tags) {
      flags.push(tag.name);
    }
    return flags;
  }

  protected static getGraphEmailAddress(puid: PersonUID): TGraphPersonUID {
    return {
      emailAddress: {
        name: puid.name,
        address: puid.emailAddress,
      }
    };
  }
  protected static getGraphEmailAddresses(puids: Collection<PersonUID>): TGraphPersonUID[] | undefined {
    let emails = puids.contents.map(r => GraphEMail.getGraphEmailAddress(r));
    return emails.length ? emails : undefined;
  }

  static async getGraphEmailObject(email: EMail, account: GraphAccount): Promise<any> {
    assert(email.folder.id, "need folder");
    let doHTML = getUserPreference("mail.send.format", "html") == "html";
    let e: TGraphEMail = {
      id: undefined,
      subject: email.subject,
      internetMessageId: email.messageID,
      from: GraphEMail.getGraphEmailAddress(email.from),
      replyTo: email.replyTo ? [GraphEMail.getGraphEmailAddress(email.replyTo)] : undefined,
      toRecipients: GraphEMail.getGraphEmailAddresses(email.to),
      ccRecipients: GraphEMail.getGraphEmailAddresses(email.cc),
      bccRecipients: GraphEMail.getGraphEmailAddresses(email.bcc),
      body: {
        contentType: doHTML ? "html" : "text",
        content: doHTML ? email.html : email.text,
      },
      sentDateTime: email.sent?.toISOString(),
      receivedDateTime: email.received?.toISOString(),
      categories: GraphEMail.getGraphCategories(email),
      importance: email.isImportant ? "high" : "normal",
      parentFolderId: email.folder.id,
      internetMessageHeaders: [] as TGraphEMailHeader[],
      isRead: email.isRead,
      isDraft: email.isDraft,
      hasAttachments: email.attachments.hasItems,
      attachments: [] as TGraphMailAttachment[],
    };
    for (let name of email.headers.contentKeys()) {
      e.internetMessageHeaders.push({
        name: name,
        value: email.headers.get(name),
      });
    }
    for (let attachment of email.attachments) {
      e.attachments.push({
        id: undefined,
        name: attachment.filename,
        size: attachment.size,
        contentType: attachment.mimeType,
        contentBytes: await attachment.contentAsBase64(),
        contentId: attachment.contentID,
        isInline: attachment.disposition == ContentDisposition.inline,
      });
    }
    return e;
  }

  async download() {
    await this.downloadRunOnce.runOnce(async () => {
      let account = this.folder.account;
      let mime = await account.graphCall(`${this.path}/$value`, { method: "get", result: "text" }) as string;
      assert(mime, "EMail no longer on server");
      this.mime = new TextEncoder().encode(mime);
      await this.parseMIME();
      await this.saveCompleteMessage();
    });
  }

  async markRead(read = true) {
    await super.markRead(read);
    await this.folder.account.graphPatch(this.path, { isRead: read });
  }

  async markStarred(starred = true) {
    await super.markStarred(starred);
    await this.folder.account.graphPatch(this.path, { flag: {
      flagStatus: starred ? "flagged" : "notFlagged",
      startDateTime: starred ? new Date().toISOString() : undefined,
      dueDateTime: null,
      completedDateTime: starred ? null : new Date().toISOString(),
    }});
  }

  async markSpam(spam = true) {
    await super.markSpam(spam);
    await this.setFlagServer("$junk", spam);
    if (!spam) {
      await this.setFlagServer("$notjunk", spam);
    }
  }

  async markReplied() {
    await super.markReplied();
    await this.setLastVerb(EMailFlag.ReplyToSender, IconIndex.Replied);
  }

  async markForwarded() {
    await super.markForwarded();
    await this.setLastVerb(EMailFlag.Forward, IconIndex.Forwarded);
  }

  async markImportant(isImportant = true) {
    await super.markImportant(isImportant);
    await this.folder.account.graphPatch(this.path, { importance: isImportant ? "high" : "normal" });
  }

  /** Graph has no replied and forwarded flags, only the MAPI properties
   * that make Outlook show the reply and forward arrows. */
  protected async setLastVerb(verb: EMailFlag, icon: IconIndex) {
    await this.folder.account.graphPatch(this.path, {
      singleValueExtendedProperties: [{
        id: `Integer ${EMailFlagPidTag}`,
        value: String(verb),
      }, {
        id: `SystemTime ${EMailFlagTimePidTag}`,
        value: new Date().toISOString(),
      }, {
        id: `Integer ${IconIndexPidTag}`,
        value: String(icon),
      }],
    });
  }

  async markDraft(isDraft = true) {
    await super.markDraft(isDraft);
    await this.folder.account.graphPatch(this.path, { isDraft: isDraft });
  }

  /**
   * Set read/starred etc. flag on the message
   *
   * @param name -- the flag, e.g. "\Seen", "\Recent", "$Junk" etc., or a user-set tag
   * @param set -- true = add the flag, false = remove the flag
   */
  async setFlagServer(name: string, set: boolean) {
    this.flagsChanging = true;

    let categories = this.tags.contents.map(tag => tag.name);
    if (name.startsWith("$")) {
      if (set) {
        categories.push(name);
      } else {
        arrayRemove(categories, name);
      }
    }

    await this.folder.account.graphPatch(this.path, { categories });
    this.flagsChanging = false;
  }

  async addTagOnServer(tag: Tag) {
    await this.setFlagServer(tag.name, true);
  }

  async removeTagOnServer(tag: Tag) {
    await this.setFlagServer(tag.name, false);
  }

  async deleteMessageOnServer(strategy = this.folder.account.deleteStrategy) {
    try {
      this.folder.deletions.add(this.pID);
      if (strategy == DeleteStrategy.DeleteImmediately ||
          [SpecialFolder.Trash, SpecialFolder.Spam].includes(this.folder.specialFolder)) {
        await this.folder.account.graphDelete(this.path);
      } else if (strategy == DeleteStrategy.MoveToTrash || strategy == DeleteStrategy.Flag) {
        let trash = this.folder.account.getSpecialFolder(SpecialFolder.Trash);
        assert(trash, gt`Trash folder is not set. Cannot delete the email. Please go to folder properties and set Use As: Trash.`);
        await trash.moveMessageHere(this);
      } else {
        throw new NotReached("Unknown delete strategy");
      }
    } finally {
      this.folder.deletions.delete(this.pID);
    }
  }
}

function setPersons(targetList: ArrayColl<PersonUID>, personList: TGraphPersonUID[]): void {
  targetList.clear();
  if (!personList?.length) {
    return;
  }
  targetList.addAll(personList.map(p => getPersonUID(p)));
}

function getPersonUID(p: TGraphPersonUID): PersonUID {
  return findOrCreatePersonUID(
    sanitize.emailAddress(p?.emailAddress.address, null),
    sanitize.nonemptylabel(p?.emailAddress.name, null));
}
