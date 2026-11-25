import { ChatRoomEvent, RoomEventKind } from "../RoomEvent";
import type { WireChatRoom } from "./WireChatRoom";
import type { WirePerson } from "./WirePerson";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { gt } from "../../../l10n/l10n";
import { ArrayColl } from "svelte-collections";

/**
 * What happened in a Wire conversation, apart from what humans wrote:
 * somebody joined or left, the conversation was renamed, a call came in.
 *
 * One class for all of them, because Wire delivers them all as `conversation.*`
 * events with the same envelope, and they differ only in what they say.
 */
export class WireRoomEvent extends ChatRoomEvent {
  declare to: WireChatRoom;
  /** The Wire event type, e.g. `conversation.member-join` */
  wireType: string | null = null;
  /** Who joined or left */
  readonly persons = new ArrayColl<WirePerson>();
  /** The new conversation name, for `conversation.rename` */
  newName: string | null = null;
  /** Why they left: `left`, `removed` or `user-deleted` */
  leaveReason: string | null = null;
  protected _kind = RoomEventKind.Generic;

  constructor(room: WireChatRoom) {
    super(room);
  }

  get room(): WireChatRoom {
    return this.to;
  }

  get kind(): RoomEventKind {
    return this._kind;
  }
  set kind(val: RoomEventKind) {
    this._kind = val;
  }

  /** Somebody joined or left. `join` false also covers being removed. */
  membersChanged(persons: WirePerson[], join: boolean, reason: string | null = null): void {
    this._kind = RoomEventKind.JoinLeave;
    this.persons.replaceAll(persons);
    this.leaveReason = reason;
    let names = persons.map(person => person.name).join(", ");
    this.text = join
      ? gt`${names} joined the conversation`
      : reason == "removed"
        ? gt`${names} was removed from the conversation`
        : gt`${names} left the conversation`;
  }

  renamed(newName: string): void {
    this._kind = RoomEventKind.RoomNameChange;
    this.newName = newName;
    this.text = gt`The conversation was renamed to ${newName}`;
  }

  /** The other side is calling. The call itself rides in the `Calling`
   * protobuf, which we do not join; we only show that it happened. */
  incomingCall(): void {
    this._kind = RoomEventKind.IncomingCall;
    this.text = gt`Incoming call`;
  }

  toExtraJSON(): any {
    let json = super.toExtraJSON();
    json.wireType = this.wireType;
    json.name = this.newName;
    json.reason = this.leaveReason;
    json.personIDs = this.persons.contents.map(person => person.chatID);
    return json;
  }

  fromExtraJSON(json: any): void {
    super.fromExtraJSON(json);
    this.wireType = sanitize.nonemptystring(json.wireType, null);
    this.newName = sanitize.label(json.name, null);
    this.leaveReason = sanitize.nonemptystring(json.reason, null);
    this.persons.replaceAll(sanitize.array(json.personIDs, [])
      .map(chatID => this.to.account.getPersonUID(sanitize.nonemptystring(chatID))));
  }
}
