import { ChatRoom } from "../ChatRoom";
import { WhatsAppMessage } from "./WhatsAppMessage";
import { WhatsAppRoomEvent } from "./WhatsAppRoomEvent";
import { type ChatRoomEvent, RoomEventKind } from "../RoomEvent";
import { WhatsAppContact } from "./WhatsAppContact";
import { DeliveryStatus, type RoomMessage } from "../ChatMessage";
import type { Group } from "../../Abstract/Group";
import { SQLChatMessage } from "../SQL/SQLChatMessage";
import type { WhatsAppAccount } from "./WhatsAppAccount";
import type { WANode } from "./Binary/WANode";
import { JID } from "./Binary/JID";
import { ProtocolMessageType, type WAMessage, type ReactionMessage, type WebMessageInfo, type MessageKey } from "./Proto/schema";
import { assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { waLog } from "./util";
import type { ArrayColl } from "svelte-collections";

/** A WhatsApp chat room. The shared message machinery (receive/store/react/edit/
 * delete/send) lives here; the 1:1-vs-group differences — who a message is from,
 * how members are listed — are the two `contactForSender`/`historySender`/
 * `listMembers` hooks, overridden by {@link WhatsApp1to1ChatRoom} and
 * {@link WhatsAppGroupChatRoom}. Rooms are created via `WhatsAppAccount.newRoom`,
 * which picks the subclass from the chat type. */
export class WhatsAppChatRoom extends ChatRoom {
  declare account: WhatsAppAccount;
  declare readonly members: ArrayColl<WhatsAppContact>;
  declare contact: WhatsAppContact | Group;

  /** A live message can arrive before we load the old msgs from DB */
  protected loadedFromDB = false;

  async listMessages(): Promise<void> {
    if (this.loadedFromDB) {
      return;
    }
    this.loadedFromDB = true;
    await SQLChatMessage.readAll(this);
    this.updateLastMessage();
  }

  /** Integrates an incoming decrypted message into this room: stores new content,
   * or applies a reaction / edit / deletion to the message it targets. */
  async receiveMessage(stanza: WANode, rawPayload: WAMessage, sender: JID, outgoing = false): Promise<void> {
    let payload = WhatsAppMessage.unwrap(rawPayload);
    let protocol = payload.protocolMessage;
    if (payload.reactionMessage) {
      await this.reactionToMessage(payload.reactionMessage, sender);
    } else if (protocol) {
      // REVOKE is protobuf enum value 0 — the default — which WhatsApp omits on the
      // wire, so the decoded `type` is `undefined`, not 0. Normalize it, otherwise
      // an incoming delete-for-everyone is silently dropped (the message stays).
      let type = protocol.type ?? ProtocolMessageType.Revoke;
      waLog("recv protocolMessage: type", type, "key.id", protocol.key?.id, "edited", !!protocol.editedMessage);
      if (type == ProtocolMessageType.MessageEdit && protocol.editedMessage) {
        await this.editMessage(protocol.key?.id, protocol.editedMessage, sender);
      } else if (type == ProtocolMessageType.Revoke) {
        await this.deleteMessageByID(protocol.key?.id, sender);
      }
    } else {
      await this.addMessage(stanza, payload, sender, outgoing);
    }
  }

  /** Adds a newly received content message to this room. `outgoing` messages (sent
   * by us from another device) are attributed to the account owner; incoming ones
   * to the sender (see {@link contactForSender}). */
  protected async addMessage(stanza: WANode, payload: WAMessage, sender: JID, outgoing: boolean): Promise<void> {
    let id = stanza.attrs.id;
    if (!id || this.messages.some(msg => msg.id == id)) {
      return; // missing id or already have it
    }
    let message = this.newMessage();
    let contact = outgoing ? await this.account.getOwnContact() : this.contactForSender(sender);
    if (!message.fromWAMessage(stanza, payload, contact as any, outgoing)) {
      return; // a type we cannot display (call, poll, …)
    }
    this.messages.add(message);
    this.lastMessage = message;
    await message.save();
  }

  /** Adds a stored message from history sync (a WebMessageInfo) to this room.
   * Mirrors addMessage(), but the id/time/sender come from the stored key
   * instead of a live stanza. @returns whether a displayable message was added. */
  async addHistoryMessage(info: WebMessageInfo): Promise<boolean> {
    let id = info.key?.id;
    if (!id || !info.message) {
      return false;
    }
    let sent = new Date(Number(info.messageTimestamp ?? 0) * 1000);
    if (this.hasMessage(id, sent)) {
      return false; // already here — from live sync or a prior backup import
    }
    let message = this.newMessage();
    message.id = id;
    message.outgoing = !!info.key.fromMe;
    message.sent = sent;
    message.received = sent;
    message.isRead = true;
    message.contact = info.key.fromMe
      ? await this.account.getOwnContact()
      : this.historySender(info.key);
    if (!message.readContent(WhatsAppMessage.unwrap(info.message))) {
      return false; // a type we cannot display (call, poll, system event, …)
    }
    this.messages.add(message);
    if (!this.lastMessage || message.sent > this.lastMessage.sent) {
      this.lastMessage = message;
    }
    await message.save();
    return true;
  }

  /** Whether a message is already in this room
   * Matches on the WhatsApp message key id (a backup import stores the same
   * bare id as live history), falling back to the send time for an existing message
   * that has no id to compare. */
  hasMessage(keyID: string, sent: Date): boolean {
    return this.messages.some(msg =>
      msg.id ? msg.id == keyID : msg.sent?.getTime() == sent.getTime());
  }

  /** The person an incoming stored message is from. In a 1:1 it's the chat
   * partner; {@link WhatsAppGroupChatRoom} overrides for the group member. Our own
   * messages are attributed via {@link WhatsAppAccount.getOwnContact} instead. */
  protected historySender(key: MessageKey): WhatsAppContact | Group {
    return this.contact;
  }

  protected async reactionToMessage(reaction: ReactionMessage, sender: JID): Promise<void> {
    let target = this.messages.find(msg => msg.id == reaction.key?.id);
    if (!target) {
      return;
    }
    let person = this.contactForSender(sender);
    if (reaction.text) {
      target.reactions.set(person, reaction.text);
    } else {
      target.reactions.delete(person); // empty emoji removes the reaction
    }
    await target.save();
  }

  protected async editMessage(targetID: string | undefined, edited: WAMessage, sender: JID): Promise<void> {
    let target = this.messages.find(msg => msg.id == targetID) as WhatsAppMessage;
    if (!target || !this.isAuthor(target, sender)) {
      return;
    }
    target.text = "";
    target.attachments.clear();
    target.readContent(WhatsAppMessage.unwrap(edited));
    await target.save();
  }

  protected async deleteMessageByID(targetID: string | undefined, sender: JID): Promise<void> {
    let target = this.messages.find(msg => msg.id == targetID);
    waLog("revoke incoming: target id", targetID, "found", !!target);
    if (!target || !(this.isAuthor(target, sender) || await this.isAdminJID(sender))) {
      return;
    }
    target.text = gt`This message was deleted`;
    await target.save();
  }

  /** Whether `sender` wrote this message, by the message that we have, because the sender chooses the `key` of the edit */
  protected isAuthor(message: RoomMessage, sender: JID): boolean {
    return message.outgoing
      ? this.account.isOwnJID(sender)
      : (message.contact as WhatsAppContact).chatID == sender.toNonDevice().toString();
  }

  /** Whether `sender` may delete others' messages for everyone. {@link WhatsAppGroupChatRoom} overrides for the group admins. */
  protected async isAdminJID(sender: JID): Promise<boolean> {
    return false;
  }

  /** Who an incoming message is from: in a 1:1 it's the chat partner;
   * {@link WhatsAppGroupChatRoom} overrides for the group member. */
  protected contactForSender(sender: JID): WhatsAppContact {
    return this.contact as WhatsAppContact;
  }

  protected updateLastMessage() {
    this.lastMessage = this.messages.contents
      .filter((msg): msg is WhatsAppMessage => msg instanceof WhatsAppMessage)
      .reduce((last, msg) => !last || msg.sent > last.sent ? msg : last, null);
  }

  /** Sends our user's message to this chat: encrypts it per recipient device and
   * publishes it (see {@link WhatsAppSender}), then shows it as outgoing. Mirrors
   * XMPPChat.sendMessage — recipient/text come from the message object. A group
   * `id` (g.us) routes the sender to its sender-key path; the rest is the same. */
  async sendMessage(message: WhatsAppMessage): Promise<void> {
    if (message.isEdit) {
      await message.sendEdit();
      return;
    }
    let text = message.text;
    assert(text || message.attachments.hasItems, `Message is empty`);
    assert(message.attachments.every(att => att.content), gt`Attachment is empty`);
    message.outgoing = true;
    message.contact = await this.account.getOwnContact() as any;
    message.sent ??= new Date();
    message.received ??= message.sent; // outgoing: "received" = when we sent it (the DB column is non-null)
    message.deliveryStatus = DeliveryStatus.Sending;
    let chat = JID.parse(this.id);
    if (message.attachments.hasItems) {
      // Each file is its own WhatsApp media message; the text rides as the caption
      // of the first one, since WhatsApp has no combined text + media message.
      let first = true;
      for (let attachment of message.attachments) {
        message.id = await this.account.sender.sendMedia(chat, attachment, first ? text : undefined);
        first = false;
      }
    } else {
      message.id = await this.account.sender.sendText(chat, text);
    }
    if (!this.messages.some(msg => msg.id == message.id)) {
      this.messages.add(message);
    }
    this.lastMessage = message;
    message.deliveryStatus = DeliveryStatus.Server;
    await message.save();
  }

  newMessage(): WhatsAppMessage {
    return new WhatsAppMessage(this);
  }

  newRoomEvent(kind?: RoomEventKind): ChatRoomEvent {
    if (kind && kind != RoomEventKind.Generic) {
      return super.newRoomEvent(kind);
    }
    return new WhatsAppRoomEvent(this);
  }
}
