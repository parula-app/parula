import { Message } from "../Abstract/Message";
import type { ChatRoom } from "./ChatRoom";
import type { VideoConfMeeting } from "../Meet/VideoConfMeeting";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { notifyChangedProperty } from "../util/Observable";
import { assert } from "../util/util";

/**
 * Information about what happens in the chat room,
 * which is *not* a message written by a human,
 * but e.g. a person joining or leaving, the room title changing,
 * and similar events.
 *
 * Create instances with `chatRoom.newRoomEvent(kind)`.
 */
export class ChatRoomEvent extends Message {
  @notifyChangedProperty
  to: ChatRoom;

  constructor(room: ChatRoom) {
    super();
    this.to = room;
    this.contact = room?.contact;
  }

  get kind(): RoomEventKind {
    return RoomEventKind.Generic;
  }

  /** The kind and kind-specific values of this event,
   * for the DB json column. */
  toExtraJSON(): any {
    let json: any = {};
    json.kind = this.kind;
    return json;
  }
  fromExtraJSON(json: any) {
    assert(typeof (json) == "object", "Must be a JSON object");
    // `kind` determined the class, see `SQLChatMessage`
  }

  get room(): ChatRoom {
    return this.to;
  }
  set room(val: ChatRoom) {
    this.to = val;
  }

  async save() {
    await this.to.account.storage.saveMessage(this);
  }
}

export class JoinLeave extends ChatRoomEvent {
  /** true = the contact joined the chat room.
   * false = the contact left the chat room. */
  @notifyChangedProperty
  join: boolean;
  @notifyChangedProperty
  invite: boolean;

  get kind(): RoomEventKind {
    return RoomEventKind.JoinLeave;
  }

  toExtraJSON(): any {
    let json = super.toExtraJSON();
    json.join = this.join;
    json.invite = this.invite;
    return json;
  }
  fromExtraJSON(json: any) {
    super.fromExtraJSON(json);
    this.join = sanitize.boolean(json.join, false);
    this.invite = sanitize.boolean(json.invite, false);
  }
}

export class Invite extends ChatRoomEvent {
  get kind(): RoomEventKind {
    return RoomEventKind.Invite;
  }
}

export class RoomNameChange extends ChatRoomEvent {
  /** The new name of the room. */
  @notifyChangedProperty
  newName: string;

  get kind(): RoomEventKind {
    return RoomEventKind.RoomNameChange;
  }

  toExtraJSON(): any {
    let json = super.toExtraJSON();
    json.name = this.newName;
    return json;
  }
  fromExtraJSON(json: any) {
    super.fromExtraJSON(json);
    this.newName = sanitize.label(json.name, null);
  }
}

export class IncomingCall extends ChatRoomEvent {
  @notifyChangedProperty
  conf: VideoConfMeeting;
  @notifyChangedProperty
  video = true;
  @notifyChangedProperty
  audio = true;

  get kind(): RoomEventKind {
    return RoomEventKind.IncomingCall;
  }
}

/** What happened in the chat room.
 * Values: For storage in the DB. Do not change them. */
export enum RoomEventKind {
  /** Protocol-specific or unrecognized event, shown raw */
  Generic = "generic",
  JoinLeave = "join-leave",
  Invite = "invite",
  RoomNameChange = "name-change",
  IncomingCall = "call",
}
