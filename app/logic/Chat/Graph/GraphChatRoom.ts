import { ChatRoom } from "../ChatRoom";
import { GraphChatMessage } from "./GraphChatMessage";
import { GraphRoomEvent } from "./GraphRoomEvent";
import { type ChatRoomEvent, RoomEventKind } from "../RoomEvent";
import { GraphChatPerson } from "./GraphChatPerson";
import type { GraphChatAccount } from "./GraphChatAccount";
import type { TGraphChat, TGraphChatMember, TGraphChatMessage } from "./TGraphChat";
import { ChatMessage, DeliveryStatus } from "../ChatMessage";
import { Group } from "../../Abstract/Group";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { ArrayColl } from "svelte-collections";
import { kDummyPerson } from "../../Abstract/PersonUID";

export class GraphChatRoom extends ChatRoom {
  declare account: GraphChatAccount;
  declare readonly members: ArrayColl<GraphChatPerson>;
  declare contact: GraphChatPerson | Group;

  info: TGraphChat;
  lastReadTime: Date;
  constructor(account: GraphChatAccount) {
    super(account);
  }

  get path(): string {
    return `chats/${this.id}`;
  }

  fromGraph(info: TGraphChat) {
    this.info = info;
    this.id = sanitize.nonemptystring(info.id);
    this._name = sanitize.label(info.topic, null);
    this.lastReadTime = sanitize.date(info.viewpoint?.lastMessageReadDateTime, null);
    this.updatedLastRead();
  }

  async listMembers(): Promise<void> {
    assert(this.info, "call fromGraph() first");
    let membersJSON = await this.account.account.graphGetAll<TGraphChatMember>(this.path + "/members");
    let members = new ArrayColl<GraphChatPerson>();
    for (let memberJSON of membersJSON) {
      try {
        let id = sanitize.nonemptystring(memberJSON.id);
        let name = sanitize.label(memberJSON.displayName, null);
        let person = this.account.getPersonUID(id, name);
        if (memberJSON.email &&
            (!person.emailAddress || person.emailAddress == kDummyPerson.emailAddress)) {
          person.emailAddress = sanitize.emailAddress(memberJSON.email, null);
        }
        members.add(person);
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }
    this.members.replaceAll(members.contents);
    if (this.info.chatType == "oneOnOne" && this.members.hasItems) {
      this.contact = this.members.first;
      if (this.contact instanceof GraphChatPerson && !this.account.roster.includes(this.contact)) {
        this.account.roster.add(this.contact);
      }
    } else {
      let group = new Group();
      // fall back to list of first names
      group.name = sanitize.label(this.info.topic, null) ?? members.contents.map(p => p.name?.split(" ")[0] ?? "*").join(", ").substring(0, 30);
      this.contact = group;
    }
  }

  async listMessages(): Promise<void> {
    assert(this.info, "call fromGraph() first");
    let messagesJSON = await this.account.account.graphGetAll<TGraphChatMessage>(this.path + "/messages");
    this.messages.clear();
    for (let messageJSON of messagesJSON) {
      if (messageJSON.messageType != "message") {
        continue;
      }
      let msg = this.newMessage();
      await msg.fromGraph(messageJSON);
      msg.isRead = this.lastReadTime && msg.received && this.lastReadTime.getTime() > msg.received.getTime();
      this.messages.add(msg);
      await msg.save();
    }
  }

  protected updatedLastRead() {
    for (let msg of this.messages) {
      if (!msg.isRead) {
        msg.isRead = this.lastReadTime && msg.received && this.lastReadTime.getTime() > msg.received.getTime();
      }
    }
  }

  /** Our user wants to send this message out.
   * Data like recipient etc. is in the message object. */
  async sendMessage(message: GraphChatMessage) {
    message.deliveryStatus = DeliveryStatus.Sending;
    assert(!message.attachments.some(att => !att.content), gt`Attachment is empty`);
    this.messages.add(message);
  }

  newMessage(): GraphChatMessage {
    return new GraphChatMessage(this);
  }

  newRoomEvent(kind?: RoomEventKind): ChatRoomEvent {
    if (kind && kind != RoomEventKind.Generic) {
      return super.newRoomEvent(kind);
    }
    return new GraphRoomEvent(this);
  }
}
