import { type RoomMessage, ChatMessage, DeliveryStatus } from "./ChatMessage";
import { ChatRoomEvent, IncomingCall, Invite, JoinLeave, RoomEventKind, RoomNameChange } from "./RoomEvent";
import type { ChatAccount } from "./ChatAccount";
import { ChatPersonUID } from "./ChatPersonUID";
import { Group } from "../Abstract/Group";
import { Observable, notifyChangedProperty } from "../util/Observable";
import { addon } from "../Addons/API/addon";
import { AbstractFunction } from "../util/util";
import { ArrayColl } from 'svelte-collections';

/**
 * Conversation between 2 or more people.
 * Can be a 1:1 with a single other person, or with a group of people.
 *
 * Called, in various systems:
 * - "chat" (WhatsApp 1:1, Teams 1:1)
 * - "group" (WhatsApp 1:n)
 * - "room" (Matrix)
 * - "channel" (IRC, Teams, Slack)
 */
@addon("chat.all")
export class ChatRoom extends Observable {
  /** Protocol-specific ID. For Matrix, it's the event_id */
  id: string;
  dbID: number;
  account: ChatAccount;
  /** If `contact` is a `Group`, then this is a chat room with multiple people.
   * If `contact` is a `ChatPersonUID`, this is a 1:1 conversation
   * between our user and one other person. */
  @notifyChangedProperty
  contact: ChatContact;
  /** Chat room name/title. Only used for Groups.
   * For 1:1 conversations, this is the name of the other person. */
  @notifyChangedProperty
  _name: string;
  /** For groups, this is a longer description of the room's purpose and scope.
   * It may contain URLs to resources which new members should read first.
   * Contains sanitized HTML. Must be sanitized *before* setting it here. */
  @notifyChangedProperty
  descriptionHTML: string;
  /** The people in this chat room.
   * If this is a 1:1 chat, contains only 1.
   * Not including our own user. */
  readonly members = new ArrayColl<ChatPersonUID>();
  /** The messages in this chat room.
   * This is also used for the MailChat view, so this may also contain EMails */
  @addon("chat.all")
  readonly messages = new ArrayColl<RoomMessage>();
  /** The newest human message, for the room list preview.
   * Calculating this would be very slow. */
  @notifyChangedProperty
  lastMessage: ChatMessage = null;

  /** Our user is admin in this chat room.
   * Allows e.g. to delete other people's messages,
   * and to kick people out. */
  @notifyChangedProperty
  isAdmin = false;
  /** Message that our user is currently composing, to this chat room */
  @notifyChangedProperty
  draftMessage: ChatMessage | null = null;
  syncState: string | null = null;

  constructor(account: ChatAccount) {
    super();
    this.account = account;
  }

  @addon("chat.all")
  get name(): string {
    if (this.contact instanceof Group && this._name) {
      return this._name;
    }
    // `contact` is always set; `|| this.id` only covers a contact/group whose own
    // name is empty, so the (NOT NULL) room name is never blank.
    return this.contact.name || this.id;
  }
  set name(val: string) {
    if (this.contact instanceof Group) {
      this._name = val;
    }
  }
  get picture(): string {
    return this.contact.picture;
  }
  async listMembers(): Promise<void> {
    throw new AbstractFunction();
  }

  /** Helper implementation for subclasses for 1:1 chat */
  protected async listMembers1to1(): Promise<void> {
    if (this.contact instanceof ChatPersonUID) {
      this.members.replaceAll([this.contact]);
    }
  }

  async listMessages(): Promise<void> {
    throw new AbstractFunction();
  }

  /** Protocol-specific room state persisted alongside the room (merged into the SQL
   * `json` column) so the room looks identical after a restart. Override in a subclass;
   * default is none. Paired with {@link fromExtraJSON}. */
  toExtraJSON(): any {
    return {};
  }
  fromExtraJSON(_json: any): void {
  }

  /** Our user wants to send this message out.
   * Data like recipient etc. is in the message object. */
  async sendMessage(message: ChatMessage) {
    message.deliveryStatus = DeliveryStatus.Sending;
    this.messages.add(message);
    throw new AbstractFunction();
  }

  newMessage(): ChatMessage {
    return new ChatMessage(this);
  }

  /** @param kind For `Generic`, protocols return their own subclass.
   * For all other kinds, this returns the kind's class. */
  newRoomEvent(kind: RoomEventKind = RoomEventKind.Generic): ChatRoomEvent {
    switch (kind) {
      case RoomEventKind.JoinLeave:
        return new JoinLeave(this);
      case RoomEventKind.Invite:
        return new Invite(this);
      case RoomEventKind.RoomNameChange:
        return new RoomNameChange(this);
      case RoomEventKind.IncomingCall:
        return new IncomingCall(this);
      default:
        return new ChatRoomEvent(this);
    }
  }

  async save(): Promise<void> {
    await this.account.storage.saveRoom(this);
  }
}

export type ChatContact = ChatPersonUID | Group;
