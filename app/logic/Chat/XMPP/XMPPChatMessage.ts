import { ChatMessage } from "../ChatMessage";
import type { XMPPChat } from "./XMPPChat";
import { Attachment, ContentDisposition } from "../../Abstract/Attachment";
import { fileExtensions } from "../../Files/FileType/MIMETypes";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { NS_RETRACT } from "./XMPPStanzaExtensions";
import { messageStylingToHTML } from "./XMPPMessageStyling";
import type { Message, Forward } from "stanza/protocol";
import type { JSONElement } from "stanza/jxt";

export class XMPPChatMessage extends ChatMessage {
  declare to: XMPPChat;

  /** Server/room-assigned ID (XEP-0359), referenced by reactions etc. in MUCs */
  stanzaID: string | null = null;
  /** Sender-assigned stable ID (XEP-0359 origin-id). What edits (XEP-0308) and
   * retractions (XEP-0424) reference, so we match incoming ones against it too. */
  originID: string | null = null;
  /** This message arrived OMEMO-encrypted (XEP-0384) */
  encrypted = false;
  /** The sender deleted this message again (XEP-0424) */
  retracted = false;
  /** The sender edited this message after sending (XEP-0308) */
  edited = false;

  constructor(chatRoom: XMPPChat) {
    super(chatRoom);
  }
  get chatRoom(): XMPPChat {
    return this.to as XMPPChat;
  }

  /**
   * Take a raw message from the server, interpret it, and set the values of this object.
   *
   * If from the archive:
   * @param wrapper The MAM/carbon envelope
   * @param archiveID The MAM archive ID
   */
  fromStanzaJS(json: Message, wrapper?: Forward, archiveID?: string): void {
    assert(json, "Need message");
    this.id = sanitize.nonemptystring(json.id, null) ??
      sanitize.nonemptystring(archiveID, null) ?? crypto.randomUUID();
    this.stanzaID = json.stanzaIds?.find(stanzaID => stanzaID.id)?.id ?? null;
    this.originID = sanitize.nonemptystring(json.originId, null);
    this.sent = sanitize.date(wrapper?.delay?.timestamp ?? json.delay?.timestamp, new Date());
    this.received = new Date(this.sent); // copy: callers may mutate dates in place
    // The chat resolves the sender (the chat partner for 1:1, the occupant for MUC)
    this.chatRoom.fillSender(this, json.from);
    let subject = sanitize.nonemptylabel(json.subject, null);
    if (json.hasSubject && subject) {
      this.subject = subject;
    }
    this.fromBody(json);
    if (json.reply?.id) {
      this.inReplyTo = json.reply.id; // XEP-0461
    }
  }

  override get canEdit(): boolean {
    return this.outgoing;
  }
  override get canDeleteForOthers(): boolean {
    return this.outgoing || this.to.isAdmin;
  }
  override canReact = true;

  /** Retract this message for everyone (XEP-0424). */
  protected override async sendRetractionToOthers(): Promise<void> {
    let room = this.chatRoom;
    let fallbackBody = gt`This message was deleted`;
    let stanza: Message = {
      type: room.messageType,
      to: room.id,
      id: crypto.randomUUID(),
      retract: {
        id: room.referenceID(this),
      },
      // XEP-0428: marks the body below as a fallback for the retraction, so a
      // client that supports XEP-0424 ignores the body and applies the retraction
      // instead of showing it as a new message (Conversations needs this).
      fallback: { for: NS_RETRACT },
      // A body so clients without XEP-0424 still show that something happened
      body: fallbackBody,
      processingHints: {
        store: true,
      },
    };
    // In an OMEMO chat the retraction must be encrypted too: Conversations only
    // applies a retraction whose OMEMO fingerprint matches the original message's
    // (`fingerprintsMatch`). A plaintext retraction of an encrypted message has no
    // fingerprint and is silently rejected. Encrypting carries our device key's
    // fingerprint, which equals the original's (same device).
    await room.encryptIfEnabled(stanza, fallbackBody);
    room.account.client.sendMessage(stanza);
  }

  /** Add or remove our own emoji reaction to this message (XEP-0444).
   * `emoji` null removes it; the wire carries the full set we want shown. */
  override async setMyReaction(emoji: string | null): Promise<void> {
    let room = this.chatRoom;
    room.account.client.sendMessage({
      type: room.messageType,
      to: room.id,
      id: crypto.randomUUID(),
      reactions: {
        id: room.referenceID(this),
        emojis: emoji ? [emoji] : [],
      },
      processingHints: {
        store: true,
      },
    });

    // locally
    let me = room.account.getOwnContact();
    if (emoji) {
      this.reactions.set(me, emoji);
    } else {
      this.reactions.delete(me);
    }
    await this.save();
  }

  /** An edit (created via `createEdit()`) supersedes the original
   * send a XEP-0308 correction that references the original message,
   * but carries our new text, then update the original in place.
   * `this` is the new version and `this.isEdit` is the ID of the original it replaces. */
  async sendEdit(): Promise<void> {
    assert(this.isEdit, "Not an edited message");
    let room = this.chatRoom;
    let original = room.findMessage(this.isEdit);
    assert(original instanceof XMPPChatMessage, gt`Cannot find the message to edit`);
    let stanza: Message = {
      type: room.messageType,
      to: room.id,
      id: crypto.randomUUID(),
      body: this.text, // the new text
      replace: room.referenceID(original),
    };
    await room.encryptIfEnabled(stanza, this.text);
    room.account.client.sendMessage(stanza);
    // Update our own view in place. The bubble renders `.html`, so refresh both
    // `text` and `html`; setting only `text` leaves the stale rendered HTML.
    // The edit has only the body, so show it as the others see it.
    original.text = this.text;
    original.html = messageStylingToHTML(this.text);
    original.edited = true;
    await original.save();
  }

  /** Mark this message as read locally, and — when actually reading (not
   * un-reading) — send the sender a read receipt (see {@link sendDisplayedMarker}). */
  override async markRead(read = true): Promise<void> {
    await super.markRead(read);
    if (read && !this.outgoing) {
      await this.sendDisplayedMarker();
    }
  }

  /**
   * Send the sender a "read receipt" for this message
   * XEP-0333 chat marker of ype `displayed`.
   *
   * Its purpose is to tell the other side that our user has actually *seen*
   * (displayed) this message, not merely that it was delivered, so the sender's
   * client can show a "read"/"seen" indicator next to their message.
   * It is the read-level acknowledgement, above XEP-0184 delivery receipts.
   */
  async sendDisplayedMarker(): Promise<void> {
    if (this.outgoing) {
      return;
    }
    let room = this.chatRoom;
    room.account.client.sendMessage({
      type: room.messageType,
      to: room.id,
      id: crypto.randomUUID(),
      marker: {
        type: "displayed",
        id: room.referenceID(this),
      },
    });
  }

  /** Creates an attachment for a shared-file URL (XEP-0363 / OMEMO media) and
   * downloads it — decrypting an aesgcm:// URL — in the background. */
  addMediaFromURL(url: string): void {
    // The filename is derived from a peer-supplied URL, so decode it (it may be
    // percent-encoded) and sanitize away path separators and the like.
    let path = url.split("#")[0].split("?")[0].split("/").pop() || "";
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch (ex) {
      decoded = path; // malformed %-escape: keep the raw form for sanitizing
    }
    let filename = sanitize.filename(decoded, gt`File`);
    let extension = filename.split(".").pop()?.toLowerCase() ?? "";
    let attachment = this.newAttachment();
    attachment.filename = filename;
    attachment.mimeType = (fileExtensions as Record<string, string>)[extension] ?? "application/octet-stream";
    attachment.disposition = attachment.mimeType.startsWith("image/")
      ? ContentDisposition.inline
      : ContentDisposition.attachment;
    this.attachments.add(attachment);
    this.chatRoom.account.media.download(url)
      .then(async data => {
        attachment.content = new File([new Uint8Array(data)], filename, { type: attachment.mimeType });
        attachment.size = data.length;
        await attachment.save();
      })
      .catch(ex => this.chatRoom.account.errorCallback(ex));
  }

  /** Sets our text from the `<body>`, and our HTML from the XHTML-IM body (XEP-0071),
   * or else from the Message Styling (XEP-0393) of the body, e.g. `*bold*`,
   * which Conversations, Dino and Gajim send, also in OMEMO messages. */
  fromBody(json: Message): void {
    this.text = sanitize.string(json.body, "");
    if (json.html?.body) {
      this.fromHTML(json.html.body as JSONElement);
    } else if (this.text) {
      this.html = messageStylingToHTML(this.text);
    }
  }

  /** Sets our HTML from a XEP-0071 XHTML body. stanza gives us a parsed
   * `JSONElement`, not XML text, so we serialize it back ourselves. */
  fromHTML(htmlBody: JSONElement | string): void {
    let html = jsonElementToXML(htmlBody);
    if (html) {
      this.html = html; // the .html getter sanitizes
    }
  }
}

/** Serializes a XEP-0071 XHTML body back to an HTML string. */
function jsonElementToXML(el: JSONElement | string): string {
  if (typeof el == "string") {
    return escapeXMLText(el);
  }
  let attrs = Object.entries(el.attributes ?? {})
    .filter(([_name, value]) => value !== undefined && value !== null)
    .map(([name, value]) => ` ${name}="${escapeXMLAttribute(value)}"`)
    .join("");
  let children = (el.children ?? []).map(jsonElementToXML).join("");
  return `<${el.name}${attrs}>${children}</${el.name}>`;
}

function escapeXMLText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeXMLAttribute(text: string): string {
  return escapeXMLText(text).replace(/"/g, "&quot;");
}
