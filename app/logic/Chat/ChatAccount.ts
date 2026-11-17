import { TCPAccount } from "../Abstract/TCPAccount";
import { ChatPersonUID } from "./ChatPersonUID";
import type { Group } from "../Abstract/Group";
import { ChatRoom } from "./ChatRoom";
import type { RoomMessage } from "./ChatMessage";
import type { AttachmentStorage } from "../Abstract/Attachment";
import { SQLChatRoom } from "./SQL/SQLChatRoom";
import { appGlobal } from "../app";
import { notifyChangedProperty } from "../util/Observable";
import { RunOnce } from "../util/flow/RunOnce";
import { ArrayColl, MapColl } from 'svelte-collections';

export class ChatAccount extends TCPAccount {
  readonly protocol: string = "chat";
  @notifyChangedProperty
  storage: ChatAccountStorage;

  /** A list of all chat rooms that the user has open.
   * This includes both 1:1 chats with persons (key is ChatPersonUID),
   * as well as chat rooms with multiple people (key is Group).
   *
   * This list is persisted across restarts. */
  readonly rooms = new MapColl<ChatPersonUID | Group, ChatRoom>;
  /** A list of persons that the user has a 1:1 chat with.
   * This list is persisted across restarts. */
  readonly roster = new ArrayColl<ChatPersonUID>;

  /** A cache of all chat contacts that the user currently sees in any
   * room. This allows to re-use ChatPersonUID objects when
   * the same contact appears in multiple rooms at the same time.
   * Accessed via `getPersonUID()`
   *
   * This list is not persisted.
   * key = userID, e.g. jid for XMPP
   * value = WeakRef of ChatPersonUID, or null when no longer in use.
   */
  protected readonly allPersonsCached = new MapColl<string, WeakRef<ChatPersonUID>>();

  @notifyChangedProperty
  isOnline = false;
  readDBRunOnce = new RunOnce();

  /** Protocols that can list the rooms on the server override this,
   * and call `super.listRooms()` first, for the rooms that we know already. */
  async listRooms(): Promise<void> {
    await this.readFromDB();
  }

  async readFromDB(): Promise<void> {
    await this.readDBRunOnce.runOnce(async () => {
      if (!this.dbID) {
        await this.save();
      }
      await Promise.all(appGlobal.addressbooks.contents.map(ab => ab.readContactsFromDB())); // ChatRooms need Persons
      if (this.rooms.isEmpty) {
        await SQLChatRoom.readAll(this);
      }
    });
  }

  /** @param isGroup true = chat with a `Group`, false = 1:1 chat.
   * Protocols with separate classes for them return the right one. */
  newRoom(isGroup = false): ChatRoom {
    return new ChatRoom(this);
  }

  /** Protocols override this
   * Accessed via `getPersonUID()`
   * @returns Protocol-specific `ChatPersonUID` subclass, e.g. `MatrixPerson` or `WhatsAppContact`. */
  protected newPersonUID(userID: string, name?: string): ChatPersonUID {
    return new ChatPersonUID(this.protocol, userID, name);
  }

  /** The chat contact for this user ID, reused across all rooms of this account
   * (cached in `allPersonsCached`), so one can see which rooms a contact is in.
   * @param userID e.g. the JID
   * @param name Used only when the contact is not known yet */
  getPersonUID(userID: string, name?: string): ChatPersonUID {
    let cached = this.allPersonsCached.get(userID)?.deref();
    if (cached) {
      if (!cached.name && name) {
        cached.name = name;
      }
      return cached;
    }
    let person = this.newPersonUID(userID, name);
    this.allPersonsCached.set(userID, new WeakRef(person));
    return person;
  }

  async save(): Promise<void> {
    await super.save();
    await this.storage?.saveAccount(this);
  }

  async deleteIt(): Promise<void> {
    await super.deleteIt();
    await this.storage?.deleteAccount(this);
    appGlobal.chatAccounts.remove(this);
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    if (!appGlobal.me.name && this.realname) {
      appGlobal.me.name = this.realname;
    }
  }
}

export interface ChatAccountStorage extends AttachmentStorage {
  saveMessage(message: RoomMessage): Promise<void>;
  deleteMessage(message: RoomMessage): Promise<void>;
  saveRoom(room: ChatRoom): Promise<void>;
  deleteRoom(room: ChatRoom): Promise<void>;
  saveAccount(account: ChatAccount): Promise<void>;
  deleteAccount(account: ChatAccount): Promise<void>;
}
