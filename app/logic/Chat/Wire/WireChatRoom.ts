import { ChatRoom } from "../ChatRoom";
import { ChatMessage, DeliveryStatus, type RoomMessage } from "../ChatMessage";
import { RoomEventKind } from "../RoomEvent";
import { WireChatMessage } from "./WireChatMessage";
import { WireRoomEvent } from "./WireRoomEvent";
import { WirePerson } from "./WirePerson";
import type { WireAccount } from "./WireAccount";
import type { TWireConversation, TWireConversationType, TWireEvent, TWireQualifiedID } from "./TWire";
import { GenericMessage, ConfirmationType, contentKind } from "./Proto/messages";
import { decode, encode } from "../Signal/Proto/codec";
import { base64Decode } from "../Signal/Crypto/primitives";
import { SQLChatMessage } from "../SQL/SQLChatMessage";
import type { Group } from "../../Abstract/Group";
import { Lock } from "../../util/flow/Lock";
import { notifyChangedProperty } from "../../util/Observable";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import type { ArrayColl } from "svelte-collections";

/**
 * A Wire conversation.
 *
 * Wire encrypts a conversation either with MLS or with Proteus, and the two
 * carry the *same* bytes: a `GenericMessage`. So everything about messages
 * lives here, and only {@link sendPayload} and the account's event handling
 * know which transport a conversation uses.
 *
 * Wire keeps no message history on the server — the notification stream is
 * everything — so our DB is the archive.
 */
export class WireChatRoom extends ChatRoom {
  declare account: WireAccount;
  declare readonly members: ArrayColl<WirePerson>;
  declare contact: WirePerson | Group;

  /** 0 = group, 1 = our own notes, 2 = 1:1, 3 = pending contact request */
  type: TWireConversationType = 0;
  /** How the messages in it are encrypted. `mixed` is a group in migration:
   * MLS for anybody who can, Proteus for the rest. */
  @notifyChangedProperty
  protocol: "proteus" | "mls" | "mixed" = "proteus";
  /** The MLS group ID, base64 as the backend sends it. Arbitrary bytes, never
   * text, and a conversation reset replaces it. */
  groupID: string | null = null;
  epoch = 0;
  cipherSuite: number | null = null;
  /** Our role in it: `wire_admin` or `wire_member` */
  role: string = kMemberRole;
  /** 0 = read receipts off, 1 = on. Senders copy this into each message. */
  receiptMode = 0;
  /** Self-deleting messages, in milliseconds. 0 = off. */
  messageTimer = 0;
  /** 0 = all notifications, 1 = only mentions, 3 = none */
  @notifyChangedProperty
  mutedStatus = 0;
  /** The other side is typing */
  @notifyChangedProperty
  contactIsTyping = false;
  /** The newest event we applied here. Wire delivers some events twice, and
   * this is what tells the second copy apart. */
  lastEventDate: Date | null = null;
  /** When we last re-keyed our own leaf in the MLS group. Due every 30 days,
   * so that a key that leaked stops being useful. */
  lastKeyRotation: Date | null = null;
  /** Our MLS state for this conversation, as `MLSGroup.toJSON()`.
   * `WireMLSService` owns it and writes it back here whenever the group moves
   * into a new epoch; `MLSClient.fromJSON()` deliberately does not bring the
   * groups with it, so each room restores its own. */
  mlsGroupJSON: any = null;
  /** Serializes the DB load against live messages arriving */
  protected readonly syncLock = new Lock();
  protected historyLoaded = false;

  /** The conversation on its own backend */
  get qualifiedID(): TWireQualifiedID {
    return WirePerson.parseChatID(this.id);
  }

  /** MLS carries the messages, whether or not Proteus is still allowed */
  get isMLS(): boolean {
    return this.protocol == "mls" || this.protocol == "mixed";
  }

  newMessage(): WireChatMessage {
    return new WireChatMessage(this);
  }

  newRoomEvent(kind = RoomEventKind.Generic): WireRoomEvent {
    let event = new WireRoomEvent(this);
    event.kind = kind;
    return event;
  }

  // --- The conversation itself ---

  /** Takes a conversation as the server describes it. */
  fromServer(json: TWireConversation): void {
    this.id = WirePerson.chatID(json.qualified_id);
    this.type = json.type;
    this.protocol = json.protocol;
    this.groupID = json.group_id;
    this.epoch = json.epoch ?? 0;
    this.cipherSuite = json.cipher_suite;
    this.receiptMode = json.receipt_mode ?? 0;
    this.messageTimer = json.message_timer ?? 0;
    // Absent means `wire_admin`, and on API v10+ our own membership may be
    // missing entirely, which means we are not a member.
    this.role = json.members?.self?.conversation_role ?? kAdminRole;
    this.isAdmin = this.role == kAdminRole;
    this.mutedStatus = json.members?.self?.otr_muted_status ?? 0;
    this.members.replaceAll(json.members?.others
      ?.filter(member => member.qualified_id.id != this.account.session.userID)
      .map(member => this.account.getWirePerson(member.qualified_id)) ?? []);
  }

  async listMembers(): Promise<void> {
    let json = await this.account.api.getConversation(this.qualifiedID);
    this.fromServer(json);
    await this.save();
  }

  // --- History ---

  /** Wire has no server-side archive: the notification stream delivers a
   * message once, and our DB keeps it. */
  async listMessages(): Promise<void> {
    let lock = await this.syncLock.lock();
    try {
      await this.readMessagesFromDB();
    } finally {
      lock.release();
    }
  }

  protected async readMessagesFromDB(): Promise<void> {
    if (this.historyLoaded || !this.dbID) {
      return;
    }
    this.historyLoaded = true;
    await SQLChatMessage.readAll(this);
    for (let msg of this.messages) {
      if (msg instanceof WireChatMessage) {
        msg.makeAttachmentsDownloadable();
      }
    }
    this.lastMessage = this.messages.contents
      .filter((msg): msg is ChatMessage => msg instanceof ChatMessage)
      .reduce((last, msg) => !last || msg.sent > last.sent ? msg : last, null);
  }

  async saveNewMessages(messages: RoomMessage[]): Promise<void> {
    if (!this.dbID) {
      await this.save();
    }
    for (let msg of messages) {
      try {
        await msg.save();
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }
  }

  findMessage(id: string): RoomMessage | undefined {
    return this.messages.find(msg => msg.id == id);
  }

  // --- Receiving ---

  /** The payload of one message, from either transport. Both carry the same
   * bytes, so this is the only place that reads a `GenericMessage`.
   * @param event the `conversation.otr-message-add` or `.mls-message-add`
   * @returns the new message, or null when the payload only changed an
   *   existing one (a reaction, an edit, a receipt) or is nothing to show */
  async receivePayload(plaintext: Uint8Array, event: TWireEvent): Promise<RoomMessage | null> {
    let msg = decode(GenericMessage, plaintext);
    if (msg.external) {
      msg = await this.unwrapExternal(msg, event);
    }
    return await this.addMessage(msg, event);
  }

  /** A big message is sent once, symmetrically encrypted, and only its key
   * travels per device. Proteus only; MLS needs none of this. */
  protected async unwrapExternal(outer: GenericMessage, event: TWireEvent): Promise<GenericMessage> {
    let ciphertext = base64Decode(sanitize.nonemptystring(event.data?.data));
    let plaintext = await this.account.media.decrypt(ciphertext, {
      otrKey: outer.external.otrKey,
      sha256: outer.external.sha256,
      encryption: outer.external.encryption,
    });
    let inner = decode(GenericMessage, plaintext);
    inner.messageID = outer.messageID; // the wrapper owns the ID
    return inner;
  }

  async addMessage(msg: GenericMessage, event: TWireEvent): Promise<RoomMessage | null> {
    let sender = this.account.personForEvent(event);
    let sent = sanitize.date(event.time, new Date());
    let outgoing = sender == this.account.getOwnContact();
    switch (msg.ephemeral ? "ephemeral" : contentKind(msg)) {
      case "text":
      case "asset":
      case "knock":
      case "ephemeral":
        return await this.addHumanMessage(msg, event, sender, sent, outgoing);
      case "reaction":
        await this.receiveReaction(msg, sender);
        return null;
      case "edited":
        await this.receiveEdit(msg, sender);
        return null;
      case "deleted":
        await this.receiveDeletion(msg, sender);
        return null;
      case "confirmation":
        this.receiveConfirmation(msg);
        return null;
      default:
        // Call signalling, session resets, and the state that our own other
        // devices sync with us: nothing the user should see in the timeline.
        return null;
    }
  }

  /** Creates the message, or updates the one we already have under that ID.
   * The same ID arriving twice is normal: an asset comes as up to 3 messages,
   * and the notification stream replays after a reconnect. */
  protected async addHumanMessage(json: GenericMessage, event: TWireEvent, sender: WirePerson,
    sent: Date, outgoing: boolean): Promise<WireChatMessage | null> {
    let messageID = sanitize.nonemptystring(json.messageID, null);
    let existing = messageID && this.findMessage(messageID);
    if (existing instanceof WireChatMessage) {
      let content = json.ephemeral ?? json;
      if (content.asset) {
        existing.applyAsset(content.asset);
        await existing.save();
      }
      return null;
    }
    let msg = this.newMessage();
    msg.from = sender;
    msg.contact = outgoing || this.contact instanceof WirePerson ? this.contact : sender;
    msg.outgoing = outgoing;
    msg.senderClientID = sanitize.nonemptystring(event.data?.sender, null);
    msg.deliveryStatus = outgoing ? DeliveryStatus.Server : DeliveryStatus.Unknown;
    if (!msg.fromGenericMessage(json, sent)) {
      return null;
    }
    this.messages.add(msg);
    this.contactIsTyping = false;
    return msg;
  }

  /** Wire sends the sender's *entire* current reaction set as one
   * comma-separated string, so replace theirs rather than adding to it. */
  protected async receiveReaction(json: GenericMessage, sender: WirePerson): Promise<void> {
    let target = this.findMessage(sanitize.nonemptystring(json.reaction.messageID, ""));
    if (!(target instanceof ChatMessage)) {
      return;
    }
    let emojis = sanitize.string(json.reaction.emoji, "").split(",").filter(emoji => !!emoji);
    if (emojis.length) {
      target.reactions.set(sender, emojis.join(""));
    } else {
      target.reactions.delete(sender);
    }
    await target.save();
  }

  /** An edit carries a new message ID and names the old one. The receiver
   * re-keys its copy, so that later edits and reactions still find it. */
  protected async receiveEdit(json: GenericMessage, sender: WirePerson): Promise<void> {
    let target = this.findMessage(sanitize.nonemptystring(json.edited.replacingMessageID, ""));
    if (!(target instanceof WireChatMessage) || target.from != sender) {
      return; // only the sender may edit their own message
    }
    target.applyEdit(sanitize.string(json.edited.text?.content, ""),
      sanitize.nonemptystring(json.messageID, target.id));
    await target.save();
  }

  protected async receiveDeletion(json: GenericMessage, sender: WirePerson): Promise<void> {
    let target = this.findMessage(sanitize.nonemptystring(json.deleted.messageID, ""));
    if (!(target instanceof WireChatMessage)) {
      return;
    }
    // The sender may delete their own message; the recipient of a self-deleting
    // message may delete it for everybody, which is how the timer works.
    if (target.from != sender && !target.ephemeralMillis) {
      return;
    }
    target.deleted = true;
    target.text = gt`This message was deleted`;
    target.attachments.clear();
    await target.save();
  }

  /** A read or delivery receipt for messages we sent. Wire has no receipt
   * event: it is an ordinary encrypted message coming back. */
  protected receiveConfirmation(json: GenericMessage): void {
    let status = json.confirmation.type == ConfirmationType.Read
      ? DeliveryStatus.Seen
      : DeliveryStatus.User;
    let messageIDs = [json.confirmation.firstMessageID, ...json.confirmation.moreMessageIDs ?? []];
    for (let messageID of messageIDs) {
      let target = this.findMessage(sanitize.nonemptystring(messageID, ""));
      if (target instanceof ChatMessage) {
        target.deliveryStatus = status;
      }
    }
  }

  /** Wire delivers 8 event types twice: once as the answer to the call that
   * caused them, and again on the notification stream. Drop the older copy,
   * doc 06 §11.4. */
  isOutdatedEvent(event: TWireEvent): boolean {
    if (!this.lastEventDate || !kDuplicateRiskEventTypes.includes(event.type)) {
      return false;
    }
    let time = sanitize.date(event.time, null);
    return !!time && this.lastEventDate.getTime() >= time.getTime();
  }

  /** The watermark that {@link isOutdatedEvent} compares against, as the
   * newest event time we ever applied. */
  noteEventTime(event: TWireEvent): void {
    let time = sanitize.date(event.time, null);
    if (time && (!this.lastEventDate || time > this.lastEventDate)) {
      this.lastEventDate = time;
    }
  }

  // --- Sending ---

  async sendMessage(message: WireChatMessage): Promise<void> {
    assert(this.account.isLoggedIn, "Wire chat account is not logged in");
    if (message.isEdit) {
      await message.sendEdit();
      return;
    }
    assert(!message.attachments.some(attachment => !attachment.content), gt`Attachment is empty`);
    message.deliveryStatus = DeliveryStatus.Sending;
    message.id ??= crypto.randomUUID();
    message.from ??= this.account.getOwnContact();
    message.outgoing = true;
    if (!this.messages.contents.includes(message)) {
      this.messages.add(message);
    }
    // Wire carries one file per message, so each attachment is its own
    // message: encrypted with its own key, uploaded, and only then announced.
    // One of them keeps *our* message ID – the text, or the first file where
    // there is no text – because that is the ID everybody else will name in a
    // receipt, a reaction, an edit or a deletion for this message.
    let sentAt: Date | null = null;
    let ourID = message.text ? null : message.id;
    for (let attachment of message.attachments) {
      let asset = await this.account.media.uploadAttachment(attachment);
      sentAt = await this.sendGenericMessage({ messageID: ourID ?? crypto.randomUUID(), asset });
      ourID = null;
    }
    if (message.text) {
      sentAt = await this.sendGenericMessage(message.toGenericMessage());
    }
    // The backend dates the message, and it is the only clock everybody shares.
    message.sent = sentAt ?? new Date();
    message.received = new Date(message.sent);
    message.deliveryStatus = DeliveryStatus.Server;
    this.lastMessage = message;
    await this.saveNewMessages([message]);
  }

  /** Encodes the payload once and hands it to whichever transport this
   * conversation uses.
   * @returns the server's time for it, the only timestamp a Wire message has */
  async sendGenericMessage(msg: GenericMessage, options: WireSendOptions = {}): Promise<Date | null> {
    return await this.sendPayload(encode(GenericMessage, msg), options);
  }

  protected async sendPayload(plaintext: Uint8Array, options: WireSendOptions): Promise<Date | null> {
    if (this.isMLS) {
      let status = await this.account.mls.sendMessage(this, plaintext);
      return status?.time ? new Date(status.time) : null;
    }
    let result = await this.account.proteus.send(this.qualifiedID, this.participantIDs(), plaintext, options);
    return result.status?.time ? new Date(result.status.time) : null;
  }

  /** Everybody a Proteus message must be encrypted for: the other members, and
   * our own user, so that our other devices see what we sent. */
  protected participantIDs(): TWireQualifiedID[] {
    return [...this.members.contents.map(member => member.qualifiedID),
      this.account.getOwnContact().qualifiedID];
  }

  /** Tells the sender that our user got or read their message. Silent: it must
   * not wake anybody's phone. */
  async sendConfirmation(message: WireChatMessage, type: "delivered" | "read"): Promise<void> {
    await this.sendGenericMessage({
      messageID: crypto.randomUUID(),
      confirmation: {
        firstMessageID: message.id,
        type: type == "read" ? ConfirmationType.Read : ConfirmationType.Delivered,
      },
    }, { nativePush: false });
  }

  // --- Persistence ---

  toExtraJSON(): any {
    return {
      type: this.type,
      protocol: this.protocol,
      groupID: this.groupID,
      epoch: this.epoch,
      cipherSuite: this.cipherSuite,
      role: this.role,
      receiptMode: this.receiptMode,
      messageTimer: this.messageTimer || undefined,
      mutedStatus: this.mutedStatus || undefined,
      lastEventDate: this.lastEventDate?.toISOString(),
      lastKeyRotation: this.lastKeyRotation?.toISOString(),
      mlsGroup: this.mlsGroupJSON ?? undefined,
    };
  }

  fromExtraJSON(json: any): void {
    this.type = sanitize.integerRange(json.type, 0, 3, 0) as TWireConversationType;
    this.protocol = sanitize.enum(json.protocol, ["proteus", "mls", "mixed"], "proteus") as "proteus" | "mls" | "mixed";
    this.groupID = sanitize.nonemptystring(json.groupID, null);
    this.epoch = sanitize.integer(json.epoch, 0);
    this.cipherSuite = sanitize.integer(json.cipherSuite, null);
    this.role = sanitize.nonemptystring(json.role, kMemberRole);
    this.isAdmin = this.role == kAdminRole;
    this.receiptMode = sanitize.integer(json.receiptMode, 0);
    this.messageTimer = sanitize.integer(json.messageTimer, 0);
    this.mutedStatus = sanitize.integer(json.mutedStatus, 0);
    this.lastEventDate = sanitize.date(json.lastEventDate, null);
    this.lastKeyRotation = sanitize.date(json.lastKeyRotation, null);
    this.mlsGroupJSON = json.mlsGroup ?? null;
  }
}

export interface WireSendOptions {
  /** Wake the recipients' devices. False for receipts and other silent traffic. */
  nativePush?: boolean;
}

/** The 8 event types that Wire may deliver twice, doc 06 §11.4 */
const kDuplicateRiskEventTypes = [
  "conversation.member-join",
  "conversation.member-leave",
  "conversation.create",
  "conversation.rename",
  "conversation.protocol-update",
  "conversation.message-timer-update",
  "conversation.receipt-mode-update",
  "conversation.add-permission-update",
];

export const kAdminRole = "wire_admin";
export const kMemberRole = "wire_member";
