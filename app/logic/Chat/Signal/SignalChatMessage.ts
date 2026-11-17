import { ChatMessage, DeliveryStatus } from "../ChatMessage";
import type { SignalChatRoom } from "./SignalChatRoom";
import type { SignalContact } from "./SignalContact";
import type { Content, DataMessage } from "./Proto/signalService";
import { ReceiptType, TypingAction } from "./Proto/signalService";
import { assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";

/** A Signal chat message
 * UI renders, it parses a decrypted Signal `Content` into itself (`fromSignal` and
 * the `fromSignal*` side-channel appliers) and pushes per-message operations to the
 * server (`send`, `setMyReaction`, …) by reaching into its room + account. The wire
 * encryption + transport live on `SignalAccount`; this stays crypto-free. */
export class SignalChatMessage extends ChatMessage {
  declare to: SignalChatRoom;

  /** True once a remote-delete (DataMessage.delete) tombstoned this message. */
  deleted = false;
  /** True once an EditMessage replaced this message's content. */
  edited = false;
  /** Whether this message was delivered sealed-sender (no server-visible sender). */
  sealedSender = false;
  override get canEdit(): boolean {
    return this.outgoing;
  }
  override get canDeleteForOthers(): boolean {
    return this.outgoing || this.to.isAdmin;
  }
  override canReact = true;

  constructor(room: SignalChatRoom) {
    super(room);
  }

  /** Interprets messages coming into a room into a message or message state changes
   * (or in few cases into room state changes). */
  static processMessage(room: SignalChatRoom, content: Content, sender: SignalContact, isOutgoing: boolean): SignalChatMessage | null {
    if (content.typingMessage) { // Room state
      room.contactIsTyping = content.typingMessage.action == TypingAction.Started;
      return null;
    }
    if (content.receiptMessage) {
      let status = content.receiptMessage.type == ReceiptType.Read || content.receiptMessage.type == ReceiptType.Viewed
        ? DeliveryStatus.Seen : DeliveryStatus.User;
      for (let ts of content.receiptMessage.timestamp ?? []) {
        room.findBySentTimestamp(ts)?.
          fromSignalReceipt(status);
      }
      return null;
    }
    if (content.editMessage?.dataMessage) {
      room.findBySentTimestamp(content.editMessage.targetSentTimestamp!)?.
        fromSignalEdit(content.editMessage.dataMessage);
      return null;
    }
    let data = content.dataMessage;
    if (!data) {
      return null;
    }
    if (data.flags && (data.flags & 2 /* EXPIRATION_TIMER_UPDATE */)) { // Room state
      room.expireTimer = data.expireTimer ?? 0;
      room.expireTimerVersion = data.expireTimerVersion ?? room.expireTimerVersion;
      return null;
    }
    if (data.reaction) {
      room.findBySentTimestamp(data.reaction.targetSentTimestamp!)?.
        fromSignalReaction(data.reaction, sender);
      return null;
    }
    if (data.delete) {
      room.findBySentTimestamp(data.delete.targetSentTimestamp!)?.
        fromSignalDelete();
      return null;
    }
    if (!data.body && !data.attachments?.length) {
      return null; // nothing to show (e.g. a profile-key update)
    }

    // This is a new chat message
    let msg = room.newMessage();
    msg.fromSignal(data, sender, isOutgoing);
    room.messages.add(msg);
    return msg;
  }

  /** Fill this new message from an incoming or sync'd DataMessage. */
  fromSignal(data: DataMessage, sender: SignalContact, isOutgoing: boolean) {
    let account = this.to.account;
    this.setSentTimestamp(data.timestamp ?? Date.now());
    this.outgoing = isOutgoing;
    this.from = isOutgoing ? account.getOwnContact() : sender;
    this.contact = this.to.contact;
    this.text = data.body ?? "";
    this.sent = new Date(data.timestamp ?? Date.now());
    this.received = new Date();
    this.deliveryStatus = isOutgoing ? DeliveryStatus.Server : DeliveryStatus.User;

    for (let attachment of data.attachments ?? []) {
      account.media.downloadOne(this, attachment)
        // download + decrypt in the background
        .catch(ex => account.errorCallback(ex));
    }
  }

  /** Apply an incoming reaction (DataMessage.reaction) from `sender`. */
  fromSignalReaction(reaction: NonNullable<DataMessage["reaction"]>, sender: SignalContact): void {
    if (reaction.remove) {
      this.reactions.delete(sender);
    } else if (reaction.emoji) {
      this.reactions.set(sender, reaction.emoji);
    }
    this.save().catch(this.to.account.errorCallback);
  }

  /** Tombstone this message (incoming DataMessage.delete). */
  fromSignalDelete(): void {
    this.deleted = true;
    this.text = gt`This message was deleted`;
    this.save().catch(this.to.account.errorCallback);
  }

  /** Replace this message's content (incoming EditMessage). */
  fromSignalEdit(data: DataMessage): void {
    this.text = data.body ?? "";
    this.edited = true;
    this.save().catch(this.to.account.errorCallback);
  }

  /** A delivery/read receipt (ReceiptMessage) for this outgoing message. */
  fromSignalReceipt(status: DeliveryStatus): void {
    if (this.outgoing) {
      this.deliveryStatus = status;
    }
  }

  /** Mark this outgoing message seen — from another linked device's SyncMessage.Read. */
  markSentRead(): void {
    if (this.outgoing) {
      this.deliveryStatus = DeliveryStatus.Seen;
      this.save().catch(this.to.account.errorCallback);
    }
  }

  /** Signal references messages by their sender's send timestamp (ms) — the
   * `timestamp` in DataMessage and the target of reactions/edits/deletes/receipts.
   * It is also the message `id` (which the DB persists/restores), so derive it from
   * `id` rather than a separate field the SQL layer would not restore. */
  get sentTimestamp(): number {
    return Number(this.id);
  }
  set sentTimestamp(timestamp: number) {
    this.id = String(timestamp);
  }

  /** Sets `sentTimestamp` and uses it as the message `id` (Signal's message key). */
  setSentTimestamp(timestamp: number): void {
    this.id = String(timestamp);
  }

  /** Delete this message for everyone (DataMessage.delete). */
  protected override async sendRetractionToOthers(): Promise<void> {
    let data: DataMessage = {
      timestamp: Date.now(),
      groupV2: this.to.groupContext(),
      delete: { targetSentTimestamp: this.sentTimestamp },
    };
    await this.to.account.sendToRoom(this.to, { message: data }, data.timestamp!);
    this.deleted = true;
    this.text = gt`This message was deleted`;
    await this.save();
  }

  /** Add or remove our own emoji reaction to this message (DataMessage.reaction). */
  override async setMyReaction(emoji: string | null): Promise<void> {
    let account = this.to.account;
    let isRemoval = !emoji;
    let data: DataMessage = {
      timestamp: Date.now(),
      groupV2: this.to.groupContext(),
      reaction: {
        emoji: emoji ?? "",
        remove: isRemoval,
        targetAuthorAci: (this.from as SignalContact)?.serviceId?.uuidString(),
        targetSentTimestamp: this.sentTimestamp,
      },
    };
    await account.sendToRoom(this.to, { message: data }, data.timestamp!);

    // local
    let me = account.getOwnContact();
    if (isRemoval) {
      this.reactions.delete(me);
    } else {
      this.reactions.set(me, emoji);
    }
    await this.save();
  }

  /** Send this message to its room (the 1:1 partner, or every group member). */
  async send(): Promise<void> {
    let account = this.to.account;
    if (this.isEdit) {
      await this.sendEdit();
      return;
    }
    if (!this.sentTimestamp) {
      this.setSentTimestamp(Date.now());
    }
    this.from ??= account.getOwnContact();
    this.contact = this.to.contact;
    this.deliveryStatus = DeliveryStatus.Sending;
    if (!this.to.messages.contents.includes(this)) {
      this.to.messages.add(this);
    }
    let attachments = await account.media.uploadAll(this.attachments.contents);
    let data: DataMessage = {
      body: this.text || undefined,
      timestamp: this.sentTimestamp,
      attachments: attachments.length ? attachments : undefined,
      expireTimer: this.to.expireTimer || undefined,
      expireTimerVersion: this.to.expireTimer ? this.to.expireTimerVersion : undefined,
      groupV2: this.to.groupContext(),
    };
    // Send to the room's recipients and mirror to our own devices (e.g. the phone).
    await account.sendToRoom(this.to, { message: data }, this.sentTimestamp);
    this.sent = new Date();
    this.received = new Date();
    this.deliveryStatus = DeliveryStatus.Server;
    this.to.lastMessage = this;
    await this.to.saveNewMessages([this]);
  }

  /** Send this as an edit (EditMessage) of the message it supersedes (`isEdit`),
   * then update that original in place.
   * The send counterpart of {@link fromSignalEdit}.
   * Reached from {@link send} for an edit message, built by `createEdit()`. */
  protected async sendEdit(): Promise<void> {
    let original = this.to.findBySentTimestamp(Number(this.isEdit));
    assert(original, gt`Cannot find the message to edit`);
    let now = Date.now();
    let editMessage = {
      targetSentTimestamp: original.sentTimestamp,
      dataMessage: {
        body: this.text,
        timestamp: now,
        groupV2: this.to.groupContext(),
      },
    };
    await this.to.account.sendToRoom(this.to, { editMessage }, now);
    original.text = this.text;
    original.edited = true;
    await original.save();
  }

  /** Tell the sender we've read this (incoming) message (ReceiptMessage READ). */
  async sendReadReceipt(): Promise<void> {
    if (this.outgoing) {
      return;
    }
    let from = (this.from as SignalContact)?.serviceId;
    if (from) {
      await this.to.account.sendContent([from],
        { receiptMessage: { type: ReceiptType.Read, timestamp: [this.sentTimestamp] } }, Date.now());
      // Mirror the read to our own other devices (the phone) so they clear unread too.
      await this.to.account.sendReadSync(from, this.sentTimestamp);
    }
  }

  override toExtraJSON(): any {
    return { deleted: this.deleted, edited: this.edited, sealedSender: this.sealedSender };
  }
  override fromExtraJSON(json: any): void {
    this.deleted = !!json?.deleted;
    this.edited = !!json?.edited;
    this.sealedSender = !!json?.sealedSender;
  }
}
