import type { EMail } from "../EMail";
import type { Person } from "../../Abstract/Person";
import type { MailAccount } from "../MailAccount";
import type { Folder } from "../Folder";
import type { Workspace } from "../../Abstract/Workspace";
import { getTagByName, type Tag } from "../../Abstract/Tag";
import { findPerson } from "../../Abstract/PersonUID";
import { appGlobal } from "../../app";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { notifyChangedProperty, Observable } from "../../util/Observable";
import { AbstractFunction } from "../../util/util";
import { SetColl, type ArrayColl } from "svelte-collections";

/** Contains the search criteria for emails.
 * Subclasses then implement the concrete search algo.
 * Criteria which are null are ignored in the search.
 * You fill out only the criteria fields that you want to search for. */
export class SearchEMail extends Observable {
  @notifyChangedProperty
  account: MailAccount | null = null;
  @notifyChangedProperty
  workspace: Workspace | null = null;
  _folder: Folder | null = null;
  @notifyChangedProperty
  folderID: string | undefined;
  get folder(): Folder | null {
    return this._folder ?? (this.folderID && (this._folder ??= this.account?.findFolder(folder => folder.id == this.folderID))) ?? null;
  }
  set folder(folder: Folder | null) {
    this._folder = folder;
    this.folderID = folder?.id;
    if (folder?.account) {
      this.account = folder.account;
    }
  }

  @notifyChangedProperty
  isOutgoing: boolean | null = null;
  @notifyChangedProperty
  includesPerson: Person | null = null;

  @notifyChangedProperty
  messageID: string | null = null;
  @notifyChangedProperty
  threadID: string | null = null;
  @notifyChangedProperty
  sentDateMin: Date | null = null;
  @notifyChangedProperty
  sentDateMax: Date | null = null;
  @notifyChangedProperty
  sizeMin: number | null = null;
  @notifyChangedProperty
  sizeMax: number | null = null;

  @notifyChangedProperty
  isRead: boolean | null = null;
  @notifyChangedProperty
  isStarred: boolean | null = null;
  @notifyChangedProperty
  isReplied: boolean | null = null;
  readonly tags = new SetColl<Tag>();

  @notifyChangedProperty
  hasAttachment: boolean | null = null;
  /** Has an attachment of one of these types.
   * Implicitly sets hasAttachment = true. */
  readonly hasAttachmentMIMETypes = new SetColl<string>;

  /** Searches the plaintext body and the subject.
   * Obviously, this is slow. */
  @notifyChangedProperty
  bodyText: string | null = null;

  /** The protocol cannot search for one of the criteria above, so the server
   * ignored it, and the results are a superset of what we searched for. */
  unsupportedFilters = false;

  async startSearch(limit?: number): Promise<ArrayColl<EMail>> {
    throw new AbstractFunction();
  }

  fromJSON(json: any) {
    function boolean(value: boolean | null): boolean | null {
      return typeof (value) == "boolean" ? value : null;
    }
    this.bodyText = sanitize.string(json.bodyText, null) ?? null;
    this.isOutgoing = boolean(json.isOutgoing);
    this.isRead = boolean(json.isRead);
    this.isReplied = boolean(json.isReplied);
    this.isStarred = boolean(json.isStarred);
    this.hasAttachment = boolean(json.hasAttachment);
    this.hasAttachmentMIMETypes.replaceAll(sanitize.array(
      json.hasAttachmentMIMETypes?.map(mimetype => sanitize.string(mimetype)), []));
    this.sizeMin = sanitize.integer(json.sizeMin, null) ?? null;
    this.sizeMax = sanitize.integer(json.sizeMax, null) ?? null;
    this.messageID = sanitize.string(json.messageID, null) ?? null;
    this.threadID = sanitize.string(json.threadID, null) ?? null;
    this.sentDateMin = sanitize.date(json.sentDateMin, null) ?? null;
    this.sentDateMax = sanitize.date(json.sentDateMax, null) ?? null;

    this.includesPerson = findPerson(json.includesPersonEMail);
    this.account = appGlobal.emailAccounts.find(acc => acc.id == json.accountID);
    this.folderID = sanitize.nonemptystring(json.folderID, null);
    this._folder = null;
    this.tags.replaceAll(sanitize.array(json.tags, [])?.map(name => getTagByName(name)));
  }

  toJSON() {
    return {
      bodyText: this.bodyText,
      isOutgoing: this.isOutgoing,
      isRead: this.isRead,
      isReplied: this.isReplied,
      isStarred: this.isStarred,
      hasAttachment: this.hasAttachment,
      hasAttachmentMIMETypes: this.hasAttachmentMIMETypes.contents,
      sizeMin: this.sizeMin,
      sizeMax: this.sizeMax,
      messageID: this.messageID,
      threadID: this.threadID,
      sentDateMin: this.sentDateMin?.toISOString(),
      sentDateMax: this.sentDateMax?.toISOString(),
      includesPersonEMail: this.includesPerson?.emailAddresses.first?.value ?? null,
      accountID: this.account?.id ?? this.folder?.account?.id,
      folderID: this.folderID,
      tags: this.tags?.contents.map(tag => tag.name),
    };
  }

  copyFrom(other: SearchEMail) {
    this.account = other.account;
    this.workspace = other.workspace;
    this._folder = other._folder;
    this.folderID = other.folderID;
    this.isOutgoing = other.isOutgoing;
    this.includesPerson = other.includesPerson;
    this.messageID = other.messageID;
    this.threadID = other.threadID;
    this.sentDateMin = other.sentDateMin;
    this.sentDateMax = other.sentDateMax;
    this.sizeMin = other.sizeMin;
    this.sizeMax = other.sizeMax;
    this.isRead = other.isRead;
    this.isStarred = other.isStarred;
    this.isReplied = other.isReplied;
    this.tags.replaceAll(other.tags);
    this.hasAttachment = other.hasAttachment;
    this.hasAttachmentMIMETypes.replaceAll(other.hasAttachmentMIMETypes);
    this.bodyText = other.bodyText;
  }

  clone(): SearchEMail {
    let clone = new (this as any).constructor();
    clone.copyFrom(this);
    return clone;
  }

  matches(email: EMail): boolean {
    if (this.messageID && this.messageID != email.messageID) {
      return false;
    }
    if (this.threadID && this.threadID != email.threadID) {
      return false;
    }
    if (this.folder && this.folder != email.folder) {
      return false;
    }
    if (this.account && this.account != email.folder?.account) {
      return false;
    }
    if (!matchesBoolean(this.isOutgoing, email.outgoing)) {
      return false;
    }
    if (!matchesBoolean(this.isRead, email.isRead)) {
      return false;
    }
    if (!matchesBoolean(this.isStarred, email.isStarred)) {
      return false;
    }
    if (!matchesBoolean(this.isReplied, email.isReplied)) {
      return false;
    }
    if (!matchesBoolean(this.hasAttachment, email.attachments.hasItems)) {
      return false;
    }
    // TODO attachment type
    if (this.sizeMin && !(this.sizeMin <= email.size)) {
      return false;
    }
    if (this.sizeMax && !(this.sizeMax >= email.size)) {
      return false;
    }
    if (this.sentDateMin && !(this.sentDateMin.getTime() <= email.sent.getTime())) {
      return false;
    }
    if (this.sentDateMax && !(this.sentDateMax.getTime() >= email.sent.getTime())) {
      return false;
    }
    if (this.bodyText && // TODO `.text`? Avoid triggering a full load
        !email.rawText?.toLowerCase().includes(this.bodyText.toLowerCase()) &&
        !email.subject.toLowerCase().includes(this.bodyText.toLowerCase())) {
      return false;
    }
    if (this.tags.hasItems) {
      if (!email.tags?.hasItems) {
        return false;
      }
      for (let tag of this.tags) {
        if (!email.tags.has(tag)) {
          return false;
        }
      }
    }
    if (this.includesPerson) {
      let person = this.includesPerson;
      if (!email.from.matchesPerson(person) &&
          !email.to.find(uid => uid.matchesPerson(person)) &&
          !email.cc.find(uid => uid.matchesPerson(person)) &&
          !email.bcc.find(uid => uid.matchesPerson(person))) {
        return false;
      }
    }
    return true;
  }
}

/* TODO Move into SetColl() ctor
function createSetColl<Item>(initial: Item[]): SetColl<Item> {
  let set = new SetColl<Item>();
  if (Array.isArray(initial) && initial.length || initial instanceof Set && initial.size) {
    for (let item of initial) {
      set.add(item);
    }
  }
  return set;
}*/

function matchesBoolean(search: boolean | undefined, value: boolean) {
  return search === null || search === undefined || search === value;
}

export function msgHasSearchTerm(msg: EMail, searchTerm: string) {
  searchTerm = searchTerm.toLowerCase();
  return msg.subject?.toLowerCase().includes(searchTerm) ||
    msg.contact?.name?.toLowerCase().includes(searchTerm) ||
    msg.from?.name?.toLowerCase().includes(searchTerm) ||
    msg.from?.emailAddress?.toLowerCase().includes(searchTerm) ||
    msg.to?.some(to =>
      to.name?.toLowerCase().includes(searchTerm) ||
      to.emailAddress?.toLowerCase().includes(searchTerm)) ||
    msg.text?.toLowerCase().includes(searchTerm);
}
