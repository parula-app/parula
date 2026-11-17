import { ChatAccount } from '../ChatAccount';
import { MatrixRoom } from './MatrixRoom';
import { MatrixVideoConf } from '../../Meet/Matrix/MatrixVideoConf';
import { ChatMessage } from '../ChatMessage';
import { SQLChatMessage } from '../SQL/SQLChatMessage';
import { IncomingCall, RoomEventKind } from '../RoomEvent';
import { Group } from '../../Abstract/Group';
import { MatrixPerson } from './MatrixPerson';
import { sanitize } from '../../../../lib/util/sanitizeDatatypes';
import { appName } from '../../build';
import { assert } from '../../util/util';
import { ArrayColl, MapColl } from 'svelte-collections';
import type { MatrixClient, PendingEventOrdering } from 'matrix-js-sdk';
import type { MatrixCall, MatrixEvent, Room, RoomMember, UIAuthCallback } from 'matrix-js-sdk/lib/matrix';

export class MatrixAccount extends ChatAccount {
  readonly protocol: string = "matrix";
  declare readonly rooms: MapColl<MatrixPerson | Group, MatrixRoom>;
  declare readonly roster: ArrayColl<MatrixPerson>;
  declare protected readonly allPersonsCached: MapColl<string, WeakRef<MatrixPerson>>;
  declare getPersonUID: (userID: string, name?: string) => MatrixPerson;

  client: MatrixClient;
  baseURL = "https://matrix.org";
  username: string;
  password: string;
  deviceID: string;
  globalUserID: string;

  /** Login to this account on the server. Opens network connection.
   * You must call this after creating the object and having set its properties. */
  async login(interactive: boolean) {
    await super.login(interactive);
    let accessToken: string;
    if (this.mainAccount?.oAuth2) {
      this.oAuth2 = this.mainAccount.oAuth2;
    }
    if (this.oAuth2 && !this.oAuth2.isLoggedIn) {
      await this.oAuth2.login(interactive);
      accessToken = this.oAuth2.accessToken;
    }
    let serverID = this.baseURL.replace("https://", "");
    let userID = `@${this.username}:${serverID}`;
    this.deviceID ??= crypto.randomUUID();
    // Tutorial <https://matrix-org.github.io/matrix-js-sdk/>
    const matrix = await import("matrix-js-sdk");
    if (!this.oAuth2) {
      let loginClient = matrix.createClient({
        baseUrl: this.baseURL,
        userId: userID,
        deviceId: this.deviceID,
      });
      assert(this.password, "need password");
      let loginResponse = await loginClient.loginRequest({
        type: "m.login.password",
        password: this.password,
        identifier: {
          type: "m.id.user",
          user: this.username,
        },
        device_id: this.deviceID,
        initial_device_display_name: appName,
      });
      accessToken = loginResponse.access_token;
    }
    this.client = matrix.createClient({
      baseUrl: this.baseURL,
      userId: userID,
      deviceId: this.deviceID,
      accessToken: accessToken,
      cryptoCallbacks: {
        // getSecretStorageKey: async ({ keys }) => {}, TODO
        // cacheSecretStorageKey: (keyId, keyInfo, key) => {},
      },
    });
    await this.client.initRustCrypto({ cryptoDatabasePrefix: this.id });
    //let crypto = this.client.getCrypto();
    //await crypto.requestOwnUserVerification();
  }

  /** Starts the sync with the server, which populates `persons` and `chats`. */
  async syncOnStartup(): Promise<void> {
    // "detached": local echoes live in a separate pending list. Required for sending
    // events that relate to another (e.g. an `m.replace` edit): the SDK resolves the
    // target via `room.getPendingEvents()`, which throws under the legacy default
    // `chronological` ordering ("Cannot call getPendingEvents with ...").
    await this.client.startClient({ pendingEventOrdering: "detached" as PendingEventOrdering });
    await this.waitForEvent("sync"); // Sync finished

    this.listRooms()
      .catch(this.errorCallback);
    this.listenToRoomMessages();
  }

  /** Call this only once after setup
   * TODO need to implement `getSecretStorageKey()` first */
  async cryptoSetup() {
    let crypto = this.client.getCrypto();
    await crypto.bootstrapCrossSigning({
      authUploadDeviceSigningKeys: async (makeRequest: UIAuthCallback) => {
        return makeRequest({
          // <copied from="loginBase()">
          type: "m.login.password",
          password: this.password,
          identifier: {
            type: "m.id.user",
            user: this.username,
          },
          device_id: this.deviceID,
          initial_device_display_name: appName,
          // </copied>
        });
      },
    });
    //await crypto.requestOwnUserVerification();
  };

  /** TODO `listRooms()` would create a second room object for each room read here. */
  async readFromDB(): Promise<void> {
  }

  async listRooms(): Promise<void> {
    if (!this.dbID) {
      await this.save(); // needed to save rooms
    }
    let allRooms = await this.client.getRooms();
    await Promise.all(allRooms.map(room => this.getNewRoom(room)));
  }
  async getRoom(room: Room): Promise<MatrixRoom> {
    return this.getExistingRoom(room.roomId) ?? await this.getNewRoom(room);
  }
  async getNewRoom(room: Room): Promise<MatrixRoom> {
    let chatRoom = new MatrixRoom(this);
    chatRoom.id = room.roomId;
    if (!this.globalUserID) {
      this.globalUserID = room.myUserId;
    }
    let members = new ArrayColl<MatrixPerson>();
    for (let member of room.getJoinedMembers()) {
      members.add(this.getMemberPerson(member));
    }
    // `members` excludes our own user.
    let others = members.filterOnce(person => person.chatID != this.globalUserID);
    chatRoom.members.replaceAll(others.contents);
    if (others.length > 1) {
      let group = new Group();
      group.name = room.name;
      chatRoom.contact = group;
    } else if (others.first) { // 1:1 chat
      let contact = others.first;
      chatRoom.contact = contact;
      if (contact && !this.roster.includes(contact)) {
        this.roster.add(contact);
      }
    } else { // no other members (a room with only us, or an empty room)
      let group = new Group();
      group.name = room.name;
      chatRoom.contact = group;
    }
    this.rooms.set(chatRoom.contact as MatrixPerson | Group, chatRoom);
    await chatRoom.save();
    await SQLChatMessage.readAll(chatRoom);

    for (let event of room.getLiveTimeline().getEvents()) {
      try {
        let id = event.getId();
        if (id && chatRoom.messages.some(msg => msg.id == id)) {
          continue; // already loaded from our DB in `readAll()` above
        }
        let msg = await chatRoom.getEvent(event); // process system events
        if (msg) {
          chatRoom.messages.add(msg);
          await this.storage.saveMessage(msg);
        }
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
    chatRoom.lastMessage = chatRoom.messages.contents
      .filter((msg): msg is ChatMessage => msg instanceof ChatMessage)
      .pop() ?? null;
    return chatRoom;
  }
  getExistingRoom(roomID: string): MatrixRoom {
    return this.rooms.find(chat => chat.id == roomID);
  }
  getMemberPerson(member: RoomMember): MatrixPerson {
    let person = this.getPersonUID(member.userId, member.name) as MatrixPerson;
    if (!person.picture) {
      person.setAvatar(member, this);
    }
    return person;
  }

  protected newPersonUID(userID: string, name?: string): MatrixPerson {
    return new MatrixPerson(userID, name);
  }
  async createRoom(name: string) {
    // TODO create room on server
    return new MatrixRoom(this);
  }

  /** Listen to messages for all rooms */
  listenToRoomMessages() {
    this.client.on("Room.timeline", async (event, room, toStartOfTimeline) => {
      try {
        if (toStartOfTimeline) {
          return; // no paginated results
        }
        let chatRoom = await this.getRoom(room); // the Room object, not its id
        let message = await chatRoom.getEvent(event);
        if (!message) {
          return;
        }
        chatRoom.messages.add(message);
        await this.storage.saveMessage(message);
        if (message instanceof ChatMessage) {
          chatRoom.lastMessage = message;
        }
      } catch (ex) {
        this.errorCallback(ex);
      }
    });
    this.client.on("Call.incoming", (call: MatrixCall) => {
      this.incomingCall(call)
        .catch(this.errorCallback);
    });
  }

  async incomingCall(call: MatrixCall) {
    try {
      console.log("Incoming call", call.roomId, call);
      let conf = new MatrixVideoConf(this, call);
      // Once the user accepts, call `conf.answer()`

      let room = this.getExistingRoom(conf._call.roomId);
      let msg = room.newRoomEvent(RoomEventKind.IncomingCall) as IncomingCall;
      msg.contact = room.contact;
      msg.text = msg.html = `${msg.contact.name} is calling`;
      msg.outgoing = false;
      msg.sent = msg.received = new Date();
      msg.conf = conf;
      room.messages.add(msg);
    } catch (ex) {
      this.errorCallback(ex);
    }
  }

  async waitForEvent(eventName: string): Promise<any> {
    await new Promise((resolve, reject) => {
      this.client.once(eventName as any, (...results) => resolve(results));
    });
  }

  async waitForEventMatching(eventName: string, matches: ((event: MatrixEvent) => boolean)): Promise<MatrixEvent> {
    return await new Promise((resolve, reject) => {
      let listener = (event: MatrixEvent) => {
        if (!matches(event)) {
          return;
        }
        this.client.off(eventName as any, listener);
        resolve(event);
      };
      this.client.on(eventName as any, listener);
    });
  }

  get isLoggedIn() {
    return !!this.client;
  }

  async logout() {
    await super.logout();
    await this.client.logout();
    this.client = null;
  }

  async deleteIt(): Promise<void> {
    await this.deleteAllKeys();
    await super.deleteIt();
  }

  async deleteAllKeys(): Promise<void> {
    indexedDB.deleteDatabase(this.id + "::matrix-sdk-crypto");
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.deviceID = sanitize.alphanumdash(json.deviceID);
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.deviceID = this.deviceID;
    return json;
  }
}
