import { ChatMessage, DeliveryStatus } from "../ChatMessage";
import type { WireChatRoom } from "./WireChatRoom";
import { WireMedia, type WireAssetState } from "./WireMedia";
import { ephemeralContentKind, type Asset, type AssetRemoteData, type Ephemeral, type GenericMessage, type Knock, type Text } from "./Proto/messages";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";

/**
 * A message that a human wrote, as it arrived in a `GenericMessage`.
 *
 * The payload is the same bytes over MLS and over Proteus, so everything here
 * is written once and knows nothing about either transport.
 *
 * Wire has no rich text: `Text.content` is plain UTF-8, with markdown syntax
 * sitting literally in it. There is no HTML anywhere in the protocol.
 */
export class WireChatMessage extends ChatMessage {
  declare to: WireChatRoom;
  /** The device that sent it. Proteus names it in the event, MLS derives it
   * from the group, so it is only known for messages we received. */
  senderClientID: string | null = null;
  /** The sender asked for a read receipt */
  expectsReadConfirmation = false;
  /** Self-deleting message: how long it lives after our user saw it, in ms.
   * 0 = it stays. */
  ephemeralMillis = 0;
  /** The sender deleted this message for everyone */
  deleted = false;
  /** The sender changed the text after sending */
  edited = false;
  /** How far the sender's attachment upload got. A sender may send the
   * metadata before the upload finished, and an abort after it failed, all
   * under this message ID. */
  assetState: WireAssetState | null = null;
  /** Where to fetch the attachment from Wire's asset store. Persisted, or a
   * restart could no longer download a file that we never fetched. */
  assetRemote: AssetRemoteData | null = null;

  constructor(room: WireChatRoom) {
    super(room);
  }

  get chatRoom(): WireChatRoom {
    return this.to;
  }

  override get canEdit(): boolean {
    return this.outgoing && !!this.text;
  }
  override get canDeleteForOthers(): boolean {
    return this.outgoing;
  }
  override canReact = true;

  // --- Receiving ---

  /** Fills this message from the payload that both transports carry.
   * @param sent the server's event time, the only timestamp a Wire message has
   * @returns false if there is nothing for the user to see */
  fromGenericMessage(msg: GenericMessage, sent: Date): boolean {
    this.id = sanitize.nonemptystring(msg.messageID, null) ?? crypto.randomUUID();
    this.sent = sent;
    this.received = new Date(sent);
    let content = msg.ephemeral ? this.fromEphemeral(msg.ephemeral) : msg;
    if (content.text) {
      this.fromText(content.text);
    }
    if (content.knock) {
      this.text = gt`Ping!`;
      this.expectsReadConfirmation ||= !!content.knock.expectsReadConfirmation;
    }
    if (content.asset) {
      this.applyAsset(content.asset);
    }
    return !!this.text || this.attachments.hasItems;
  }

  /** An ephemeral message is a wrapper around the ordinary content, under the
   * same message ID, and carries only how long the content lives. */
  protected fromEphemeral(ephemeral: Ephemeral): { text?: Text, knock?: Knock, asset?: Asset } {
    this.ephemeralMillis = sanitize.integer(ephemeral.expireAfterMillis, 0);
    return ephemeralContentKind(ephemeral) ? ephemeral : {};
  }

  protected fromText(text: Text): void {
    this.text = sanitize.string(text.content, "");
    this.expectsReadConfirmation = !!text.expectsReadConfirmation;
    // A quote is Wire's reply-to. Its `quotedMessageSHA256` is an integrity
    // hash whose pre-image no client computes, so we neither send nor read it.
    this.inReplyTo = sanitize.nonemptystring(text.quote?.quotedMessageID, null);
  }

  /** The sender may send the same asset up to 3 times under this message ID:
   * the metadata while the upload runs, then the upload result, or an abort.
   * Only the first carries `original`, so each one only adds what it knows. */
  applyAsset(asset: Asset): void {
    this.assetState = this.chatRoom.account.media.applyAsset(this, asset);
    this.assetRemote = asset.uploaded ?? this.assetRemote;
  }

  /** After a DB read: lets `attachment.read()` fetch the file again.
   * Without this, a file we never downloaded is unreachable after a restart. */
  makeAttachmentsDownloadable(): void {
    if (!this.assetRemote) {
      return;
    }
    for (let attachment of this.attachments) {
      this.chatRoom.account.media.makeDownloadable(attachment, this.assetRemote);
    }
  }

  /** `Attachment.load()` calls this. `WireAssetDownload` deliberately does not
   * save what it downloaded, so we write it to disk here. */
  async loadAttachments(): Promise<void> {
    for (let attachment of this.attachments) {
      if (attachment.content) {
        continue;
      }
      await attachment.read();
      await attachment.save();
    }
  }

  // --- Sending ---

  /** What our user typed, as the payload for either transport. */
  toGenericMessage(): GenericMessage {
    return {
      messageID: this.id,
      text: {
        content: this.text,
        expectsReadConfirmation: this.chatRoom.receiptMode == 1 ? true : undefined,
        quote: this.inReplyTo ? { quotedMessageID: this.inReplyTo } : undefined,
      },
    };
  }

  /** Delete for everyone. Only the sender may do this, except for an ephemeral
   * message, which its recipient may also delete. */
  protected override async sendRetractionToOthers(): Promise<void> {
    await this.chatRoom.sendGenericMessage({
      messageID: crypto.randomUUID(),
      deleted: { messageID: this.id },
    });
    this.deleted = true;
  }

  /** Wire carries the sender's *entire* current reaction set on a message, as
   * one comma-separated string, not a single emoji and not a change. */
  override async setMyReaction(emoji: string | null): Promise<void> {
    let me = this.chatRoom.account.getOwnContact();
    if (emoji) {
      this.reactions.set(me, emoji);
    } else {
      this.reactions.delete(me);
    }
    await this.chatRoom.sendGenericMessage({
      messageID: crypto.randomUUID(),
      reaction: { messageID: this.id, emoji: emoji ?? "" },
    });
    await this.save();
  }

  /** An edit created by `createEdit()` supersedes the original: it carries a
   * new message ID and names the old one, and the receiver re-keys its copy to
   * the new ID. So we do the same to ours. */
  async sendEdit(): Promise<void> {
    assert(this.isEdit, "Not an edited message");
    let original = this.chatRoom.findMessage(this.isEdit);
    assert(original instanceof WireChatMessage, gt`Cannot find the message to edit`);
    this.id ??= crypto.randomUUID();
    await this.chatRoom.sendGenericMessage({
      messageID: this.id,
      edited: {
        replacingMessageID: original.id,
        text: { content: this.text },
      },
    });
    original.applyEdit(this.text, this.id);
    await original.save();
  }

  /** Takes over the new text and the new message ID of an edit of this
   * message, so that a later edit or reaction naming that ID finds us. */
  applyEdit(text: string, newMessageID: string): void {
    this.text = text;
    this.id = newMessageID;
    this.edited = true;
  }

  /** Tells the sender that our user has seen this message. Wire has no receipt
   * event: a receipt is an ordinary encrypted message back. */
  override async markRead(read = true): Promise<void> {
    await super.markRead(read);
    if (read && !this.outgoing && this.expectsReadConfirmation) {
      await this.chatRoom.sendConfirmation(this, "read");
    }
  }

  toExtraJSON(): any {
    let json = super.toExtraJSON();
    json.senderClientID = this.senderClientID;
    json.deleted = this.deleted;
    json.edited = this.edited;
    json.expectsReadConfirmation = this.expectsReadConfirmation;
    json.ephemeralMillis = this.ephemeralMillis || undefined;
    json.deliveryStatus = this.deliveryStatus;
    json.assetState = this.assetState;
    json.asset = this.assetRemote ? WireMedia.remoteToJSON(this.assetRemote) : undefined;
    return json;
  }

  fromExtraJSON(json: any): void {
    super.fromExtraJSON(json);
    this.senderClientID = sanitize.nonemptystring(json.senderClientID, null);
    this.deleted = sanitize.boolean(json.deleted, false);
    this.edited = sanitize.boolean(json.edited, false);
    this.expectsReadConfirmation = sanitize.boolean(json.expectsReadConfirmation, false);
    this.ephemeralMillis = sanitize.integer(json.ephemeralMillis, 0);
    this.deliveryStatus = sanitize.enum(json.deliveryStatus, Object.values(DeliveryStatus), DeliveryStatus.Unknown) as DeliveryStatus;
    this.assetState = sanitize.nonemptystring(json.assetState, null) as WireAssetState;
    // The attachments are read after us, so the download is hooked up later,
    // in `makeAttachmentsDownloadable()`.
    this.assetRemote = WireMedia.remoteFromJSON(json.asset);
  }
}
