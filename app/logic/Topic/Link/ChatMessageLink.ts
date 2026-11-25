import { TopicLink, TopicLinkType } from "./TopicLink";
import { ChatMessage } from "../../Chat/ChatMessage";
import { appGlobal } from "../../app";

/** The protocol, the ID of the chat room and the ID of the message.
 * The same for all members of the room. */
export class ChatMessageLink extends TopicLink {
  readonly type = TopicLinkType.ChatMessage;
  static readonly targetClass = ChatMessage;
  protected readonly idProperty = "@id";
  protected readonly dateProperty = "dateSent";
  declare target: ChatMessage | null;

  setTarget(message: ChatMessage) {
    super.setTarget(message);
    let room = message.room;
    this.targetID = `chat:${room.account.protocol}/${encodeURIComponent(room.id)}/${encodeURIComponent(message.id)}`;
    this.name = message.text?.substring(0, 200);
    this.date = message.sent;
  }

  async findTarget(): Promise<ChatMessage | null> {
    let [protocol, roomID, messageID] = this.targetID.substring("chat:".length).split("/");
    for (let account of appGlobal.chatAccounts.filterOnce(account => account.protocol == protocol)) {
      await account.readFromDB();
      let room = account.rooms.find(room => room.id == decodeURIComponent(roomID));
      if (!room) {
        continue;
      }
      if (room.messages.isEmpty) {
        await room.listMessages();
      }
      let message = room.messages.find(message => message.id == decodeURIComponent(messageID));
      if (message instanceof ChatMessage) {
        return this.target = message;
      }
    }
    return this.target = null;
  }
}
