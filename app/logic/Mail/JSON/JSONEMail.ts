import type { EMail } from "../EMail";
import { PersonUID, findOrCreatePersonUID, kDummyPerson } from "../../Abstract/PersonUID";
import { Attachment } from "../../Abstract/Attachment";
import { getTagByName } from "../../Abstract/Tag";
import { getFilesDir } from "../../../logic/util/backend-wrapper";
import { EMailProcessorList } from "../EMailProcessor";
import { SMLData } from "../SML/SMLData";
import { EncryptionSystem } from "../Encryption/enums";
import { assert, ensureArray } from "../../util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { internalError } from "../../util/error";
import type { ArrayColl } from "svelte-collections";

export class JSONEMail {
  static filesDir: string | null = null;
  static async init() {
    this.filesDir ??= await getFilesDir();
  }

  /**
   * Save only fully downloaded emails
   */
  static save(email: EMail): any {
    let json: any = {};
    json.id = email.id;
    json.folderID = email.folder.id;
    json.pID = email.pID;
    json.inReplyTo = email.inReplyTo;
    json.size = email.size;
    json.sent = email.sent.getTime() / 1000;
    json.received = email.received.getTime() / 1000;
    json.outgoing = email.outgoing;
    json.subject = email.subject;
    json.plaintext = email.rawText;
    json.html = email.rawHTMLDangerous;

    this.saveWritableProps(email, json);
    this.saveRecipients(email, json);
    json.attachments = this.saveAttachments(email);
    json.tags = this.saveTags(email);
    //json.headers = email.headers.contentKeyValues();
    return json;
  }

  static saveWritableProps(email: EMail, json: any) {
    json.isRead = email.isRead;
    json.isStarred = email.isStarred;
    json.isReplied = email.isReplied;
    json.isForwarded = email.isForwarded;
    json.isImportant = email.isImportant;
    json.isSpam = email.isSpam;
    json.isNotSpam = email.isNotSpam;
    json.isDraft = email.isDraft;
    json.threadID = email.threadID;
    json.downloadComplete = email.downloadComplete;
    this.saveExtraData(email, json);
  }

  static saveExtraData(email: EMail, json: any) {
    let extraDataJSON = [];
    email.extraData.forEach((extraData, type) => {
      let json = extraData.toJSON() as any;
      if (json == null) {
        return;
      }
      json.type = type;
      extraDataJSON.push(json);
    });
    if (extraDataJSON.length) {
      json.extraData = extraDataJSON;
    }

    json.sml = email.sml?.toJSON();

    if (email.invitationMessage) {
      json.invitationMessage = email.invitationMessage;
    }

    if (email.signedByKeyID || email.wasEncrypted || email.mustEncrypt || email.shouldEncrypt) {
      let e = json.encryption = {} as any;
      e.system = email.system;
      e.signedPublicKeyID = email.signedByKeyID;
      e.signedPublicKey = this.saveSigner(email);
      e.wasEncrypted = email.wasEncrypted;
      e.mustEncrypt = email.mustEncrypt;
      e.shouldEncrypt = email.shouldEncrypt;
    }
  }

  /** Only for senders who are not in the addressbook,
   * because the addressbook has the better copy.
   * @returns {JSON} what we read, if we never parsed the key */
  protected static saveSigner(email: EMail): any {
    let onContact = email.from?.findPerson()?.encryptionPublicKeys
      .find(key => key.id == email.signedByKeyID);
    if (onContact) {
      return null;
    }
    return email.signedKey?.toJSON() ?? email.signedKeyJSON;
  }

  protected static saveRecipients(email: EMail, json: any) {
    json.from = this.saveRecipient(email.from);
    json.to = this.saveRecipientsOfType(email.to);
    json.cc = this.saveRecipientsOfType(email.cc);
    json.bcc = this.saveRecipientsOfType(email.bcc);
    if (email.replyTo?.emailAddress) {
      json.replyTo = this.saveRecipient(email.replyTo);
    }
  }

  protected static saveRecipientsOfType(recipients: ArrayColl<PersonUID>): any[] {
    return recipients.contents.map(r => this.saveRecipient(r));
  }

  protected static saveRecipient(puid: PersonUID): any {
    let json: any = {};
    json.name = puid.name;
    json.emailAddress = puid.emailAddress;
    json.personID = puid.person?.dbID;
    return json;
  }

  static saveAttachments(email: EMail): any[] {
    return email.attachments.contents.map(a => this.saveAttachment(email, a));
  }

  static saveAttachment(email: EMail, a: Attachment): any {
    assert(this.filesDir, "Please call init() first");
    let json = a.toJSON();
    json.filepathLocal = a.filepathLocal?.replace(this.filesDir + "/", "");
    return json;
  }

  static saveTags(email: EMail): any[] {
    return email.tags.contents.map(tag => tag.name);
  }

  static read(dbID: number | string, email: EMail, json: any): EMail {
    email.dbID = typeof (dbID) == "number"
      ? sanitize.integer(dbID, null)
      : sanitize.string(dbID, null);
    email.pID = typeof(json.pID) == "number"
      ? sanitize.integer(json.pID, null)
      : sanitize.string(json.pID, null);
    email.id = sanitize.nonemptystring(json.id, "");
    // .folder is set by caller when doing `email = folder.newEMail()`
    email.inReplyTo = sanitize.string(json.inReplyTo, null);
    email.size = sanitize.integer(json.size, null);
    email.received = sanitize.date(json.received * 1000, new Date());
    email.sent = sanitize.date(json.sent * 1000, email.received);
    email.outgoing = sanitize.boolean(json.outgoing, false);
    email.subject = sanitize.string(json.subject, null);
    if (json.plaintext != null || json.html != null) {
      email.text = sanitize.string(json.plaintext, null);
      let html = sanitize.string(json.html, null);
      if (html) {
        email.html = html;
      }
    }

    this.readWritableProps(email, json);
    this.readRecipients(email, json);
    this.readAttachments(email, json);
    this.readExtraData(email, json);
    this.readTags(email, json);
    email.contact = email.outgoing ? email.to.first : email.from;
    /*email.headers.clear();
    for (let name in json.headers) {
      email.headers.set(
        sanitize.nonemptystring(name),
        sanitize.nonemptystring(json.headers[name]));
    }*/
    return email;
  }

  /** Read only the most important properties for the msg list view. */
  static readMainProperties(dbID: number | string, email: EMail, json: any): void {
    email.dbID = typeof (dbID) == "number"
      ? sanitize.integer(dbID, null)
      : sanitize.string(dbID, null);
    email.pID = typeof (json.pID) == "number"
      ? sanitize.integer(json.pID, null)
      : sanitize.string(json.pID, null);
    email.id = sanitize.nonemptystring(json.id, "");
    email.inReplyTo = sanitize.string(json.inReplyTo, null);
    email.size = sanitize.integer(json.size, null);
    email.sent = sanitize.date(json.sent * 1000, new Date());
    email.received = sanitize.date(json.received * 1000, new Date());
    email.outgoing = sanitize.boolean(json.outgoing, false);
    email.subject = sanitize.string(json.subject, null);

    email.isRead = sanitize.boolean(json.isRead, false);
    email.isStarred = sanitize.boolean(json.isStarred, false);
    email.isReplied = sanitize.boolean(json.isReplied, false);
    email.isForwarded = sanitize.boolean(json.isForwarded, false);
    email.isImportant = sanitize.boolean(json.isImportant, false);
    email.isSpam = sanitize.boolean(json.isSpam, false);
    email.isNotSpam = sanitize.boolean(json.isNotSpam, false);
    email.threadID = sanitize.string(json.threadID ?? json.inReplyTo, null);
    email.downloadComplete = sanitize.boolean(json.downloadComplete);

    // email.contact = findOrCreatePersonUID("foo45@example.com", sanitize.label(json.contactName, null));
  }

  static readWritableProps(email: EMail, json: any): void {
    email.isRead = sanitize.boolean(json.isRead, false);
    email.isStarred = sanitize.boolean(json.isStarred, false);
    email.isReplied = sanitize.boolean(json.isReplied, false);
    email.isForwarded = sanitize.boolean(json.isForwarded, false);
    email.isImportant = sanitize.boolean(json.isImportant, false);
    email.isDraft = sanitize.boolean(json.isDraft, false);
    email.isSpam = sanitize.boolean(json.isSpam, false);
    email.isNotSpam = sanitize.boolean(json.isNotSpam, false);
    email.threadID = sanitize.string(json.threadID ?? json.inReplyTo, null);
    email.downloadComplete = sanitize.boolean(json.downloadComplete, false);
    this.readTags(email, json);
  }

  static readExtraData(email: EMail, json: any): void {
    if (json.extraData) {
      for (let extra of json.extraData) {
        try {
          let type = sanitize.alphanumdash(extra.type);
          let ExtraDataSubclass = EMailProcessorList.extraDataTypes.get(type);
          let data = new ExtraDataSubclass();
          data.fromJSON(extra);
          email.extraData.set(type, data);
        } catch (ex) {
          internalError(ex);
        }
      }
    }
    if (json.sml) {
      email.sml = new SMLData();
      email.sml.fromJSON(json.sml);
    }
    email.invitationMessage = sanitize.integer(json.invitationMessage, 0);

    let e = json.encryption;
    if (e) {
      email.system = sanitize.enum<EncryptionSystem>(e.system, Object.values(EncryptionSystem), null);
      email.signedByKeyID = sanitize.alphanumdash(e.signedPublicKeyID, null);
      // Parsed on demand, @see `getPublicKeyByKeyID()`
      email.signedKeyJSON = e.signedPublicKey ?? null;
      email.wasEncrypted = sanitize.boolean(e.wasEncrypted, false);
      email.shouldEncrypt = sanitize.boolean(e.shouldEncrypt, false);
      email.mustEncrypt = sanitize.boolean(e.mustEncrypt, false);
    }
  }

  static readRecipients(email: EMail, json: any): void {
    email.to.clear();
    email.cc.clear();
    email.bcc.clear();
    email.from = this.readRecipient(json.from) ?? kDummyPerson;
    email.replyTo = this.readRecipient(json.replyTo);
    email.to.addAll(this.readRecipientsOfType(json.to));
    email.cc.addAll(this.readRecipientsOfType(json.cc));
    email.bcc.addAll(this.readRecipientsOfType(json.bcc));
  }

  protected static readRecipientsOfType(recipientsJSON: any[]): PersonUID[] {
    if (!recipientsJSON) {
      return [];
    }
    return recipientsJSON.map(r => this.readRecipient(r)).filter(r => r);
  }

  protected static readRecipient(json: any): PersonUID | null {
    if (!json) {
      return null;
    }
    return findOrCreatePersonUID(
      sanitize.emailAddress(json.emailAddress, null),
      sanitize.nonemptylabel(json.name, null));
  }

  protected static readAttachments(email: EMail, emailJSON: any): void {
    if (!emailJSON.attachments) {
      return;
    }
    assert(this.filesDir, "Please call init() first");
    let fallbackID = 0;
    email.attachments.clear();
    for (let row of emailJSON.attachments) {
      this.readAttachment(email, row, ++fallbackID);
    }
  }

  protected static readAttachment(email: EMail, json: any, fallbackID: number): Attachment | null {
    try {
      let a = email.newAttachment();
      a.fromJSON(json, fallbackID, this.filesDir);
      email.attachments.add(a);
      return a;
    } catch (ex) {
      email.folder.account.errorCallback(ex);
      return null;
    }
  }

  static readTags(email: EMail, emailJSON: any): void {
    if (!emailJSON.tags) {
      return;
    }
    email.tags.clear();
    for (let tag of ensureArray(emailJSON.tags)) {
      this.readTag(email, tag);
    }
  }

  protected static readTag(email: EMail, json: any): void {
    try {
      if (!json) {
        return;
      }
      let name = sanitize.nonemptystring(json);
      let tag = getTagByName(name);
      email.tags.add(tag);
    } catch (ex) {
      email.folder.account.errorCallback(ex);
    }
  }

  static readBody(email: EMail, json: any): void {
    let text = sanitize.string(json.plaintext, null)
    if (text) {
      email.text = text;
    }
    let html = sanitize.string(json.html, null);
    if (html) {
      email.html = html;
    }
  }
}
