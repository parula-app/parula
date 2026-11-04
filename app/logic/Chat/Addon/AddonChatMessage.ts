import { ChatMessage, DeliveryStatus } from "../ChatMessage";
import type { AddonChatRoom } from "./AddonChatRoom";
import { Group } from "../../Abstract/Group";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

export class AddonChatMessage extends ChatMessage {
  /** id: of the server */
  declare to: AddonChatRoom;

  constructor(room: AddonChatRoom) {
    super(room);
  }

  /** @param json `ChatMessageData` from the addon, unchecked */
  fromAddon(json: any) {
    const kMaxLength = 1000;
    const kMaxTextLength = 1024 * 1024;
    let account = this.to.account;
    let connection = account.connection;
    this.id = connection.checkID(json.id);
    this.outgoing = json.outgoing === true;
    this.from = json.from == null ? undefined : account.getPersonUID(connection.checkID(json.from));
    this.contact = this.from && !this.outgoing && this.to.contact instanceof Group ? this.from : this.to.contact;
    if (typeof json.html == "string") {
      this.html = json.html.substring(0, kMaxTextLength);
    } else {
      this.text = typeof json.text == "string" ? json.text.substring(0, kMaxTextLength) : "";
    }
    this.inReplyTo = connection.checkText(json.inReplyTo, kMaxLength, null);
    this.received = sanitize.date(json.received, this.received ?? new Date());
    this.sent = sanitize.date(json.sent, this.received);
    this.isRead = this.outgoing || json.isRead === true;
    if (this.outgoing) {
      this.deliveryStatus = DeliveryStatus.Server;
    }
  }
}
