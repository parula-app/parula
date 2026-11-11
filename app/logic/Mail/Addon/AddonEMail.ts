import { EMail } from "../EMail";
import type { AddonFolder } from "./AddonFolder";
import { SpecialFolder } from "../Folder";
import { DeleteStrategy } from "../MailAccount";
import type { PersonUID } from "../../Abstract/PersonUID";
import type { MessageFlags } from "../../Addons/Sandbox/MustangAPI";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { ArrayColl } from "svelte-collections";

export class AddonEMail extends EMail {
  /** pID: ID of the server */
  declare folder: AddonFolder;

  constructor(folder: AddonFolder) {
    super(folder);
  }

  /** @param json `MessageData` from the addon, unchecked */
  fromAddon(json: any) {
    const kMaxLength = 1000;
    const kMaxSubjectLength = 10000;
    let account = this.folder.account;
    this.pID = account.connection.checkID(json.id);
    this.isRead = json.isRead === true;
    this.isStarred = json.isStarred === true;
    this.isReplied = json.isReplied === true;
    this.isForwarded = json.isForwarded === true;
    this.isDraft = json.isDraft === true;
    this.isSpam = json.isSpam === true;
    // Not `=`: The sender's `Importance:` header is not on the server
    this.isImportant ||= json.isImportant === true;
    if (this.downloadComplete) {
      return;
    }
    this.id = account.connection.checkText(json.messageID, kMaxLength, null) ?? this.pID as string;
    this.subject = account.connection.checkText(json.subject, kMaxSubjectLength, "");
    this.received = sanitize.date(json.received, this.received ?? new Date());
    this.sent = sanitize.date(json.sent, this.received);
    this.inReplyTo = account.connection.checkText(json.inReplyTo, kMaxLength, null);
    this.from = account.connection.checkPerson(json.from);
    this.replyTo = json.replyTo ? account.connection.checkPerson(json.replyTo) : null;
    this.setPersonsFromAddon(this.to, json.to);
    this.setPersonsFromAddon(this.cc, json.cc);
    this.setPersonsFromAddon(this.bcc, json.bcc);
    this.outgoing = account.isMyEMailAddress(this.from.emailAddress);
    this.contact = this.outgoing ? this.to.first : this.from;
    this.size = account.connection.checkCount(json.size, null);
  }

  protected setPersonsFromAddon(persons: ArrayColl<PersonUID>, value: unknown) {
    const kMaxPersons = 1000;
    let account = this.folder.account;
    persons.replaceAll(Array.isArray(value)
      ? account.connection.checkList(value, kMaxPersons, "recipients").map(json => account.connection.checkPerson(json))
      : []);
  }

  async download() {
    await this.downloadRunOnce.runOnce(async () => {
      let downloaded = await this.folder.downloadBatch(new ArrayColl([this]));
      assert(downloaded.contains(this), gt`The addon ${this.folder.account.connection.addonName} did not give the message`);
    });
  }

  async markRead(read = true) {
    await super.markRead(read);
    await this.setFlagsOnServer({ isRead: read });
  }

  async markStarred(starred = true) {
    await super.markStarred(starred);
    await this.setFlagsOnServer({ isStarred: starred });
  }

  async markSpam(spam = true) {
    await super.markSpam(spam);
    await this.setFlagsOnServer({ isSpam: spam });
  }

  async markReplied() {
    await super.markReplied();
    await this.setFlagsOnServer({ isReplied: true });
  }

  async markForwarded() {
    await super.markForwarded();
    await this.setFlagsOnServer({ isForwarded: true });
  }

  async markImportant(isImportant = true) {
    await super.markImportant(isImportant);
    await this.setFlagsOnServer({ isImportant });
  }

  async markDraft(isDraft = true) {
    await super.markDraft(isDraft);
    await this.setFlagsOnServer({ isDraft });
  }

  protected async setFlagsOnServer(flags: MessageFlags) {
    await this.folder.setFlagsOnServer(new ArrayColl([this]), flags);
  }

  async deleteMessageOnServer(strategy = this.folder.account.deleteStrategy) {
    let folder = this.folder;
    let trash = folder.account.getAllFolders().find(folder => folder.specialFolder == SpecialFolder.Trash);
    folder.deletions.add(this.pID);
    try {
      if (strategy == DeleteStrategy.DeleteImmediately || !trash || trash == folder || folder.specialFolder == SpecialFolder.Spam) {
        await folder.account.connection.call("deleteMessages", folder.id, [this.pID]);
        return;
      }
      await trash.moveMessageHere(this);
    } finally {
      folder.deletions.delete(this.pID);
    }
  }
}
