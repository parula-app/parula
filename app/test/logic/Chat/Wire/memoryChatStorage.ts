import type { WireAccount } from "../../../../logic/Chat/Wire/WireAccount";
import type { WirePerson } from "../../../../logic/Chat/Wire/WirePerson";
import { DummyChatStorage } from "../../../../logic/Chat/SQL/DummyChatStorage";
import type { ChatRoom } from "../../../../logic/Chat/ChatRoom";
import type { Attachment } from "../../../../logic/Abstract/Attachment";
import { Group } from "../../../../logic/Abstract/Group";

/**
 * Stands in for the chat database.
 *
 * `SQLChatRoom` writes `toExtraJSON()` and reads `fromExtraJSON()` back, so a
 * restart really goes through that pair, and losing MLS state there would show.
 * `readAttachment()` says "not on disk", which is what makes the Wire download
 * behind it run at all.
 */
export class MemoryChatStorage extends DummyChatStorage {
  readonly rooms = new Map<string, SavedRoom>();
  readonly files = new Map<Attachment, File>();

  override async saveRoom(room: ChatRoom): Promise<void> {
    this.rooms.set(room.id, {
      id: room.id,
      name: room.name,
      isGroup: room.contact instanceof Group,
      contactID: room.contact instanceof Group ? room.contact.name : (room.contact as WirePerson).chatID,
      json: JSON.stringify(room.toExtraJSON()),
    });
  }

  override async deleteRoom(room: ChatRoom): Promise<void> {
    this.rooms.delete(room.id);
  }

  /** What `SQLChatRoom.readAll()` does when the app starts */
  restoreInto(account: WireAccount): void {
    for (let saved of this.rooms.values()) {
      let room = account.newRoom(saved.isGroup);
      room.id = saved.id;
      if (saved.isGroup) {
        let group = new Group();
        group.name = saved.contactID;
        room.contact = group;
      } else {
        room.contact = account.getPersonUID(saved.contactID);
      }
      room.fromExtraJSON(JSON.parse(saved.json));
      room.name = saved.name;
      account.rooms.set(room.contact, room);
    }
  }

  override async readAttachment(attachment: Attachment): Promise<boolean> {
    let file = this.files.get(attachment);
    if (!file) {
      return false; // not on disk, so the Wire asset store is asked next
    }
    attachment.content = file;
    return true;
  }

  override async saveAttachment(attachment: Attachment): Promise<void> {
    if (attachment.content) {
      this.files.set(attachment, attachment.content);
    }
  }
}

interface SavedRoom {
  id: string;
  name: string;
  isGroup: boolean;
  contactID: string;
  json: string;
}
