import { ChatAccount } from "../ChatAccount";
import { AddonChatRoom } from "./AddonChatRoom";
import type { ChatPersonUID } from "../ChatPersonUID";
import type { Group } from "../../Abstract/Group";
import { AuthMethod } from "../../Abstract/Account";
import { AddonConnection } from "../../Addons/AddonConnection";
import type { AddonProtocolAccount } from "../../Addons/AddonProtocols";
import { appGlobal } from "../../app";
import { RunOnce } from "../../util/flow/RunOnce";
import { RunAgain } from "../../util/flow/RunAgain";
import type { MapColl } from "svelte-collections";

/** A chat account whose protocol an addon implements.
 * The addon does only the server talk. Rooms and messages are stored and shown like those of other protocols.
 * Everything that the addon returns is checked here and in `AddonChatRoom` and `AddonChatMessage`. */
export class AddonChatAccount extends ChatAccount implements AddonProtocolAccount {
  readonly protocol: string;
  readonly connection = new AddonConnection(this, appGlobal.chatAccounts);
  declare readonly rooms: MapColl<ChatPersonUID | Group, AddonChatRoom>;
  protected listRoomsRunOnce = new RunOnce<void>();
  protected newRoomsRunAgain = new RunAgain(100);

  /** @param protocol `AddonProtocol.accountProtocol()` */
  constructor(protocol: string) {
    super();
    this.protocol = protocol;
    this.authMethod = AuthMethod.Password;
  }

  get isLoggedIn(): boolean {
    return this.connection.isLoggedIn;
  }

  async login(interactive: boolean): Promise<void> {
    await super.login(interactive);
    await this.connection.login();
  }

  async verifyLogin(): Promise<void> {
    await this.connection.verifyLogin();
  }

  async disconnect(): Promise<void> {
    this.connection.disconnect();
  }

  /** Lists the rooms, and gets the new messages of all rooms */
  async syncOnStartup(): Promise<void> {
    await this.listRooms();
    for (let room of this.rooms.contents) {
      try {
        await room.listMessages();
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
  }

  /** Reads the rooms that we know, then gets those that the user has on the server */
  async listRooms(): Promise<void> {
    await this.listRoomsRunOnce.runOnce(async () => {
      await super.listRooms();
      await this.listRoomsFromServer();
    });
  }

  protected async listRoomsFromServer(): Promise<void> {
    const kMaxRooms = 10000;
    let connection = this.connection;
    let list = connection.checkList(await connection.call("listRooms"), kMaxRooms, "chat rooms");
    let listedIDs = new Set<string>();
    let byID = new Map(this.rooms.contents.map(room => [room.id, room]));
    for (let json of list) {
      try {
        let id = connection.checkID(json?.id);
        if (listedIDs.has(id)) {
          continue;
        }
        listedIDs.add(id);
        let room = byID.get(id) ?? this.newRoom();
        let oldContact = room.contact;
        room.fromAddon(json);
        let existing = this.rooms.get(room.contact);
        if (existing && existing != room) {
          throw new Error(`${this.name}: The addon gave two chats with ${room.contact.name}`);
        }
        if (oldContact && oldContact != room.contact) {
          this.rooms.delete(oldContact);
        }
        this.rooms.set(room.contact, room);
        await room.save();
      } catch (ex) {
        this.dataError(ex);
      }
    }
    for (let room of this.rooms.contents) {
      if (listedIDs.has(room.id)) {
        continue;
      }
      this.rooms.delete(room.contact);
      if (room.dbID) {
        await this.storage.deleteRoom(room);
      }
    }
  }

  getRoomByID(id: string): AddonChatRoom | undefined {
    return this.rooms.find(room => room.id == id);
  }

  /** The addon says that the server has new messages in this chat room */
  onNewMessages(roomID: string): void {
    let room = this.getRoomByID(roomID);
    if (!room) {
      this.newRoomOnServer();
      return;
    }
    room.newMessagesOnServer();
  }

  /** A room that we don't know yet: List the rooms, and get the messages of the new ones.
   * While this runs, more of these result in one more run. */
  protected newRoomOnServer(): void {
    this.newRoomsRunAgain.run(async () => {
      let knownRooms = new Set(this.rooms.contents);
      await this.listRooms();
      for (let room of this.rooms.contents) {
        if (!knownRooms.has(room)) {
          await room.listMessages();
        }
      }
    }).catch(this.errorCallback);
  }

  newRoom(isGroup = false): AddonChatRoom {
    return new AddonChatRoom(this);
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.connection.fromConfigJSON(json);
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    this.connection.toConfigJSON(json);
    return json;
  }
}
