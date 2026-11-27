import type { Group } from "./Group";
import type { Person } from "./Person";
import type { PersonUID } from "../Abstract/PersonUID";
import { ChatPersonUID } from "../Chat/ChatPersonUID";
import type { Attachment } from "./Attachment";
import { convertHTMLToText, convertTextToHTML, sanitizeHTML, sanitizeHTMLExternal } from "../util/convertHTML";
import { Observable, notifyChangedProperty } from "../util/Observable";
import { addon } from "../Addons/API/addon";
import { dataError } from "../util/error";
import { AbstractFunction, type HTMLString } from "../util/util";
import { ArrayColl, MapColl } from "svelte-collections";

export class Message extends Observable {
  /** protocol-specific ID for this message.
   * Allows for reactions, corrections etc. */
  id: string;
  dbID: number | string;
  outgoing = false;
  /**
   * Who this message was exchanged with.
   * if outgoing = true, this is the recipient, otherwise the sender
   */
  @notifyChangedProperty
  contact: PersonUID | Person | Group;
  /** Who sent this message. If outgoing = true, this is always our user. */
  @addon("message")
  @notifyChangedProperty
  from: PersonUID;
  /** When the message was sent */
  @addon("message")
  @notifyChangedProperty
  sent: Date;
  /** When the message was received */
  @addon("message")
  @notifyChangedProperty
  received: Date;
  /** This message just arrived in the inbox and this is the first
   * session to see this message */
  @notifyChangedProperty
  isNewArrived = false;
  /** User has read the contents of the message */
  @addon("message")
  @notifyChangedProperty
  isRead = false;
  /** User marked this message as special to remember */
  @addon("message")
  @notifyChangedProperty
  isStarred = false;
  /** Msg ID of another message that this one is a reply of */
  inReplyTo: string | null = null;
  @addon("message")
  readonly attachments = new ArrayColl<Attachment>();

  /** Contains all reactions, as seen by the server, including mine */
  readonly reactions = new MapColl<PersonUID, string>();

  @addon("message", "mail.compose")
  @notifyChangedProperty
  subject: string = "";
  @notifyChangedProperty
  protected _text: string = null;
  /** Plaintext version of the message */
  @addon("message")
  get text(): string {
    if (this._text) {
      return this._text;
    }
    if (this._rawHTML) {
      return this._text = convertHTMLToText(this._rawHTML);
    }
    return "";
  }
  /** Must also set `.html` (or at least get `.html` to auto-generate it),
   * to keep them in sync. */
  set text(val: string) {
    this._text = val;
    this._rawHTML = null;
    this._sanitizedHTML = null;
  }

  /** Re-create the plaintext from the current HTML, which is the source of
   * truth in the composer. Unlike `set text`, this keeps the HTML. */
  regenerateTextFromHTML() {
    if (!this._rawHTML) { // plaintext-only
      return;
    }
    this._text = convertHTMLToText(this._rawHTML);
  }

  /** HTML version of the message.
   * Directly from the network.
   * Attention: Untrusted. MUST be sanitized before using it.
   * This is the version that will be saved on disk.
   * @see _sanitizedHTML */
  @notifyChangedProperty
  protected _rawHTML: string = null;
  /** HTML version of the message.
   * Sanitized.
   * This is only cached here in RAM, but not saved on disk,
   * so that we can change the sanitization. */
  protected _sanitizedHTML: string = null;
  /** Allow HTTPS? */
  @notifyChangedProperty
  protected _loadExternalImages = false;

  /** HTML version of the message.
   * Sanitized. */
  @addon("message", "mail.compose")
  get html(): HTMLString {
    if (this._sanitizedHTML) {
      return this._sanitizedHTML;
    }
    try {
      if (this._rawHTML) {
        return this._sanitizedHTML = this.loadExternalImages
          ? sanitizeHTMLExternal(this._rawHTML)
          : sanitizeHTML(this._rawHTML);
      }
      if (this._text) {
        return this._sanitizedHTML = convertTextToHTML(this._text);
      }
    } catch (ex) {
      dataError(ex);
    }
    return "";
  }

  /** Must also set `.text` (or at least get `.text` to auto-generate it),
   * to keep them in sync. */
  set html(val: HTMLString) {
    this._rawHTML = val;
    this._sanitizedHTML = null;
  }
  /** Get the raw HTML, as we received it from the network.
   * ATTENTION: DANGEROUS: You MUST NOT render this,
   * neither directly nor indirectly.  If you save this, make sure that
   * all reading paths sanitize the HTML before rendering it. */
  get rawHTMLDangerous(): string {
    return this._rawHTML;
  }
  set rawHTMLDangerous(val: string) {
    this.html = val;
  }
  get rawText(): string {
    return this._text;
  }
  get hasHTML(): boolean {
    return !!this._rawHTML;
  }
  get hasVisibleAttachments(): boolean {
    return this.attachments.hasItems && this.attachments.some(att => !att.hidden);
  }

  /** Allow images and stylesheets to load from https: ? */
  get loadExternalImages(): boolean {
    return this._loadExternalImages;
  }
  set loadExternalImages(val: boolean) {
    if (this._loadExternalImages == val) {
      return;
    }
    this._sanitizedHTML = null; // forces re-rendering
    this._loadExternalImages = val; // notifyChangedProperty triggers update
  }

  async markRead(read = true) {
    this.isRead = read;
  }
  async markStarred(starred = true) {
    this.isStarred = starred;
  }

  /** Sets or removes our own user's emoji reaction to this message.
   * @param emoji the reaction to set, or null to remove our reaction. */
  async setMyReaction(emoji: string | null) {
    await this.setMyReactionLocally(emoji);
    await this.setMyReactionOnServer(emoji);
  }
  async setMyReactionLocally(emoji: string | null) {
    let me = this.outgoing
      ? this.from
      : this.contact instanceof ChatPersonUID
        ? this.contact
        : this.from;
    if (emoji) {
      this.reactions.set(me, emoji);
    } else {
      this.reactions.delete(me);
    }
    await this.save();
  }
  async setMyReactionOnServer(emoji: string | null) {
  }

  newAttachment(): Attachment {
    throw new AbstractFunction();
  }

  async save() {
    throw new AbstractFunction();
  }
  async deleteMessage() {
    throw new AbstractFunction();
  }

  copyFrom(other: Message, withAttachments: boolean = false): void {
    other.outgoing = this.outgoing;
    other.contact = this.contact;
    other.sent.setTime(this.sent.getTime());
    other.received.setTime(this.received.getTime());
    other.isNewArrived = this.isNewArrived;
    other.isRead = this.isRead;
    other.isStarred = this.isStarred;
    other.inReplyTo = this.inReplyTo;
    other.subject = this.subject;
    other._text = this._text;
    other._rawHTML = this._rawHTML;
    // _sanitizedHTML and _loadExternalImages not copied
    if (withAttachments) {
      // TODO Clone `Attachment` objects
      other.attachments.replaceAll(this.attachments);
    }
  }
}
