import { ChatAccount } from '../ChatAccount';
import type { ChatRoom } from '../ChatRoom';
import { XMPPChat, Encryption } from './XMPPChat';
import { XMPP1to1Chat } from './XMPP1to1Chat';
import { XMPPGroupChat } from './XMPPGroupChat';
import { XMPPPerson } from './XMPPPerson';
import { OMEMO } from './OMEMO/OMEMO';
import { XMPPMedia } from './XMPPMedia';
import { registerXMPPExtensions } from './XMPPStanzaExtensions';
import { Group } from '../../Abstract/Group';
import { ChatPersonUID, nameFromChatID } from '../ChatPersonUID';
import { ConnectError, LoginError } from '../../Abstract/Account';
import { kImageMimeTypes } from '../../Files/FileType/MIMETypes';
import { sanitize } from '../../../../lib/util/sanitizeDatatypes';
import { assert } from '../../util/util';
import { blobToDataURL } from '../../util/blob';
import { gt } from '../../../l10n/l10n';
import { NS_OMEMO_AXOLOTL_DEVICELIST } from 'stanza/Namespaces';
import { Buffer } from 'stanza/platform';
import { sha1 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/curves/utils.js';
import { ArrayColl, MapColl } from 'svelte-collections';
import type * as XMPP from 'stanza';

export class XMPPAccount extends ChatAccount {
  readonly protocol: string = "xmpp";
  declare readonly rooms: MapColl<XMPPPerson | Group, XMPPChat>;
  declare readonly roster: ArrayColl<XMPPPerson>;
  declare protected readonly allPersonsCached: MapColl<string, WeakRef<XMPPPerson>>;
  declare getPersonUID: (userID: string, name?: string) => XMPPPerson;

  client: XMPP.Agent;
  deviceID: string;
  /** Bare JID of our own user */
  jid: string;
  /** Whether the server supports message archives (XEP-0313) */
  hasMAM = true;
  /** OMEMO end-to-end encryption engine (XEP-0384) */
  readonly omemo = new OMEMO(this);
  /** File upload/download (XEP-0363 + OMEMO media sharing) */
  readonly media = new XMPPMedia(this);
  /** Our own user as a chat identity, keyed by our JID (not the global app user).
   * Used as the sender (`from`) of messages and reactions that we send. */
  ownContact: XMPPPerson;

  get isLoggedIn(): boolean {
    return !!this.client?.sessionStarted;
  }

  /** Login to this account on the server. Opens network connection.
   * You must call this after creating the object and having set its properties. */
  async login(interactive: boolean): Promise<void> {
    if (this.isLoggedIn) {
      return;
    }
    await super.login(interactive);
    await this.readFromDB();
    await this.connect();
  }

  /** This will populate `roster` and `rooms`. */
  async syncOnStartup(): Promise<void> {
    await this.getRoster();
    await this.createChatsFromRoster();
    await this.getGroupChats();
    this.client.sendPresence(); // the server sends us messages only once we are available
    this.client.enableKeepAlive();
    this.client.enableCarbons()
      .catch(ex => console.log("XMPP carbons not enabled", ex?.error?.condition ?? ex));
    this.setupOMEMO()
      .catch(this.errorCallback);
    this.listMessagesOfAllChatRooms()
      .catch(this.errorCallback);
    this.getAllPersonDetails()
      .catch(this.errorCallback);
  }

  /** Publishes our OMEMO keys so others can encrypt to us, then turns on
   * encryption for contacts who already use OMEMO. */
  protected async setupOMEMO(): Promise<void> {
    await this.omemo.publishOwnKeys();
    for (let room of this.rooms.contents) {
      if (!(room instanceof XMPP1to1Chat) || room.encryption == Encryption.OMEMO) {
        continue;
      }
      let devices = await this.omemo.knownDevices(room.id);
      if (devices.length) {
        room.encryption = Encryption.OMEMO;
      }
    }
  }

  /** For setup only. Test that the login works. */
  async verifyLogin(): Promise<void> {
    await super.login(true);
    await this.connect();
    await this.disconnect();
  }

  async connect(): Promise<void> {
    await this.disconnect();
    this.jid = getBareJID(this.username);
    assert(this.jid?.includes("@"), gt`XMPP username must be a Jabber ID in the form username@server`);
    const XMPP = await import("stanza");
    this.client = XMPP.createClient({
      jid: this.jid,
      password: this.password,
      // credentials: { token: ... }, TODO OAuth2

      // If no URL is configured, find it using
      // `/.well-known/host-meta.json` of the JID domain, per XEP-0156.
      transports: {
        websocket: this.url ? allowedURL(this.url, "wss", "ws") : true,
        bosh: this.url ? allowedURL(this.url, "https", "http") : true,
      },
    });
    registerXMPPExtensions(this.client);
    this.addListeners();
    await this.connectAndWaitForSession();
    this.client.updateConfig({ autoReconnect: true });
  }

  /** stanza's `connect()` returns once the connection attempt started,
   * not when it's logged in, so wait for the session events. */
  protected async connectAndWaitForSession(): Promise<void> {
    let client = this.client;
    await new Promise<void>((resolve, reject) => {
      let cleanup = () => {
        clearTimeout(timeout);
        client.off("session:started", onSuccess);
        client.off("auth:failed", onAuthFailed);
        client.off("stream:error", onStreamError);
        client.off("disconnected", onDisconnected);
      };
      let onSuccess = () => {
        cleanup();
        resolve();
      };
      let onAuthFailed = () => {
        cleanup();
        reject(new LoginError(null, gt`Login failed`));
      };
      let onStreamError = (streamError: XMPP.Stanzas.StreamError, error?: Error) => {
        cleanup();
        let text = sanitize.nonemptylabel(streamError?.text, null);
        reject(new ConnectError(error, text ?? gt`Failed to connect to chat account ${this.name}`));
      };
      let onDisconnected = () => {
        cleanup();
        reject(new ConnectError(null, gt`Failed to connect to chat account ${this.name}`));
      };
      let timeout = setTimeout(onDisconnected, kNetworkTimeoutInMS);
      client.on("session:started", onSuccess);
      client.on("auth:failed", onAuthFailed);
      client.on("stream:error", onStreamError);
      client.on("disconnected", onDisconnected);
      client.connect();
    });
  }

  async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }
    let client = this.client;
    this.client = null;
    this.isOnline = false;
    client.updateConfig({ autoReconnect: false });
    await client.disconnect();
  }

  /** Gets the contact list from the server, and the `Person` for each entry */
  async getRoster(): Promise<void> {
    let roster = await this.client.getRoster();
    for (let item of roster.items ?? []) {
      try {
        await this.getRosterPerson(item.jid, item.name);
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
  }

  /** Makes sure that each roster entry has a 1:1 chat */
  protected async createChatsFromRoster(): Promise<void> {
    for (let person of this.roster) {
      try {
        let jid = person.chatID;
        if (this.getExistingChat(jid)) {
          continue;
        }
        await this.getNewChat(jid);
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
  }

  /** Gets new messages of all chats from the server archive,
   * skipping messages that are already in our DB */
  protected async listMessagesOfAllChatRooms(): Promise<void> {
    for (let chatRoom of this.rooms.contents) {
      try {
        await chatRoom.listMessages();
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
  }

  /** Gets profile photos etc. for the roster contacts, where missing */
  protected async getAllPersonDetails(): Promise<void> {
    for (let person of this.roster) {
      if (person.picture) {
        continue;
      }
      try {
        await this.fetchVCardPhoto(person, person.chatID);
      } catch (ex) {
        // contact has no vCard
      }
    }
  }

  /** Sets a contact's name and picture from their vCard (vcard-temp, XEP-0054).
   * @throws if the contact has no vCard */
  protected async fetchVCardPhoto(person: ChatPersonUID, jid: string): Promise<void> {
    let vcard = await this.client.getVCard(jid);
    let fullName = sanitize.nonemptylabel(vcard.fullName, null);
    if (fullName && person.name == nameFromChatID(jid)) {
      person.name = fullName;
    }
    let photo = vcard.records?.find(r => r.type == "photo") as XMPP.Stanzas.VCardTempPhoto;
    if (photo?.data) {
      let mimetype = sanitize.enum(photo.mediaType, kImageMimeTypes);
      let blob = new Blob([new Uint8Array(photo.data)], { type: mimetype });
      person.picture = await blobToDataURL(blob);
    }
  }

  /** A contact published or changed their avatar — over PEP (XEP-0084) or vCard.
   * stanza fires this when it sees the metadata; we fetch the image and set it. */
  protected async onAvatar(event: { jid: string, avatars: XMPP.Stanzas.AvatarVersion[], source: "pubsub" | "vcard" }): Promise<void> {
    let person = this.getExistingPerson(event.jid);
    if (!person) {
      return; // an avatar for someone not in our roster
    }
    if (event.source == "vcard") {
      await this.fetchVCardPhoto(person, event.jid);
      return;
    }
    let version = event.avatars?.find(avatar => avatar.id);
    if (!version) {
      return;
    }
    let item = await this.client.getAvatar(event.jid, version.id);
    let data = item.content?.data;
    if (data) {
      let blob = new Blob([new Uint8Array(data)], { type: version.mediaType ?? "image/png" });
      person.picture = await blobToDataURL(blob);
    }
  }

  /** Publishes our user's avatar (XEP-0084), so contacts can show it. */
  async publishOwnAvatar(image: Blob): Promise<void> {
    let bytes = new Uint8Array(await image.arrayBuffer());
    let id = bytesToHex(sha1(bytes)); // XEP-0084: the item id is the SHA-1 of the image
    await this.client.publishAvatar(id, Buffer.from(bytes));
    await this.client.useAvatars([{ id, bytes: bytes.length, mediaType: image.type }]);
  }

  newRoom(isGroup = false): ChatRoom {
    return isGroup ? new XMPPGroupChat(this) : new XMPP1to1Chat(this);
  }

  async getNewChat(jid: string): Promise<XMPPChat> {
    jid = getBareJID(jid);
    let person = await this.getRosterPerson(jid);
    let existing = this.getExistingChat(jid); // two messages of a new peer may race here
    if (existing) {
      return existing;
    }
    let chatRoom = new XMPP1to1Chat(this);
    chatRoom.id = jid;
    chatRoom.contact = person;
    this.rooms.set(person, chatRoom);
    await chatRoom.save();
    return chatRoom;
  }

  /** Gets the group chat rooms that our user is in, from the
   * bookmarks on the server (XEP-0048/0402), and enters them. */
  protected async getGroupChats(): Promise<void> {
    let bookmarks: XMPP.Stanzas.MUCBookmark[] = [];
    try {
      bookmarks = await this.client.getBookmarks();
    } catch (errIQ) {
      console.log("XMPP bookmarks not available", errIQ?.error?.condition ?? errIQ);
    }
    for (let bookmark of bookmarks) {
      try {
        let chatRoom = this.getExistingChat(bookmark.jid) ?? await this.getNewGroupChat(bookmark);
        if (chatRoom instanceof XMPPGroupChat) {
          chatRoom.nick ??= sanitize.nonemptystring(bookmark.nick, null);
        }
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
    for (let chatRoom of this.rooms.contents) {
      if (!(chatRoom instanceof XMPPGroupChat)) {
        continue;
      }
      try {
        await chatRoom.join();
        chatRoom.listMessages() // MUC archive history (XEP-0313)
          .catch(this.errorCallback);
      } catch (exOrPresence) {
        this.errorCallback(exOrPresence instanceof Error ? exOrPresence
          : new Error(gt`Failed to enter the chat room ${chatRoom.name}`));
      }
    }
  }

  async getNewGroupChat(bookmark: XMPP.Stanzas.MUCBookmark): Promise<XMPPGroupChat> {
    let jid = getBareJID(bookmark.jid);
    // The group is only the room's name/avatar. Its members live in `room.members`.
    let group = new Group();
    group.name = sanitize.label(bookmark.name, null) ?? jid.split("@")[0];
    let chatRoom = new XMPPGroupChat(this);
    chatRoom.id = jid;
    chatRoom.contact = group;
    chatRoom.nick = sanitize.nonemptystring(bookmark.nick, null);
    this.rooms.set(group, chatRoom);
    await chatRoom.save();
    return chatRoom;
  }

  getExistingChat(jid: string): XMPPChat | null {
    jid = getBareJID(jid);
    return this.rooms.find(room => room.id == jid);
  }

  getExistingPerson(jid: string): ChatPersonUID | null {
    return this.allPersonsCached.get(getBareJID(jid))?.deref() ?? null;
  }

  /** @returns the JID without the resource, e.g. "fred@example.com" */
  bareJID(jid: string): string {
    return getBareJID(jid);
  }

  /** Our own user as a chat identity, identified by our JID (not the global app
   * user). Lives in the chat account's own address book, so it has a chat
   * account (our JID) for persistence but isn't shown as a contact. Used as the
   * sender of messages and reactions that we send. */
  getOwnContact(): XMPPPerson {
    return this.ownContact ??= this.getPersonUID(this.jid, this.realname) as XMPPPerson;
  }

  /** The 1:1 chat contact for this JID, as in the `roster` */
  async getRosterPerson(jid: string, name?: string): Promise<ChatPersonUID> {
    jid = getBareJID(jid);
    name = sanitize.nonemptylabel(name, null);
    let person = this.getPersonUID(jid, name);
    if (name && person.name != name) {
      person.name = name;
    }
    if (!this.roster.includes(person)) {
      this.roster.add(person);
    }
    return person;
  }

  fromConfigJSON(json: any): void {
    super.fromConfigJSON(json);
    this.omemo.fromJSON(json?.omemo);
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.omemo = this.omemo.toJSON();
    return json;
  }

  protected addListeners(): void {
    this.client.on("session:started", () => {
      this.isOnline = true;
    });
    this.client.on("disconnected", () => {
      this.isOnline = false;
    });
    this.client.on("message", msg => {
      this.onMessage(msg)
        .catch(this.errorCallback);
    });
    this.client.on("muc:available", pres => {
      let chatRoom = this.getExistingChat(pres.from);
      if (chatRoom instanceof XMPPGroupChat) {
        chatRoom.onOccupantPresence(pres);
      }
    });
    this.client.on("muc:unavailable", pres => {
      let chatRoom = this.getExistingChat(pres.from);
      if (chatRoom instanceof XMPPGroupChat) {
        chatRoom.onOccupantPresence(pres);
      }
    });
    this.client.on("muc:topic", ev => {
      let chatRoom = this.getExistingChat(ev.room);
      if (chatRoom instanceof XMPPGroupChat) {
        chatRoom.onSubject(ev.topic);
      }
    });
    this.client.on("message:error", msg => {
      let reason = sanitize.nonemptylabel(msg.error?.text, null) ??
        sanitize.alphanumdash(msg.error?.condition, "");
      this.errorCallback(new Error(gt`Chat message failed` + ": " + reason));
    });
    this.client.on("pubsub:published", (event: any) => {
      this.onDeviceListUpdate(event);
    });
    this.client.on("avatar", event => {
      this.onAvatar(event)
        .catch(this.errorCallback);
    });
  }

  /** A message arrived over the open connection. Unwraps message carbons
   * (XEP-0280) — so messages our user sent or received on another device also
   * show here — then routes it to the chat room it belongs to. */
  protected async onMessage(xmppMsg: XMPP.Stanzas.Message): Promise<void> {
    let carbon = (xmppMsg as any).carbon?.forwarded?.message;
    await this.routeMessage(carbon ?? xmppMsg);
  }

  /** Lets the right chat room interpret the message (a new message, or a
   * reaction/receipt/edit/… for an existing one). */
  protected async routeMessage(xmppMsg: XMPP.Stanzas.Message): Promise<void> {
    let from = getBareJID(xmppMsg.from);
    let to = getBareJID(xmppMsg.to);
    let chatRoom: XMPPChat | null;
    if (xmppMsg.type == "groupchat") {
      chatRoom = this.getExistingChat(from); // only rooms we have joined
    } else {
      let peer = from == this.jid ? to : from;
      chatRoom = peer ? this.getExistingChat(peer) ?? await this.getNewChat(peer) : null;
    }
    if (!chatRoom) {
      return;
    }
    let msg = await chatRoom.addMessage(xmppMsg);
    if (!msg) {
      return; // a side-effect (reaction, receipt, …), not a new message
    }
    chatRoom.lastMessage = msg;
    await chatRoom.saveNewMessages([msg]);
  }

  /** A contact (or our own account) published a new OMEMO device list (PEP). */
  protected onDeviceListUpdate(event: any): void {
    if (event?.node != NS_OMEMO_AXOLOTL_DEVICELIST) {
      return;
    }
    let jid = getBareJID(event.from ?? event.jid ?? this.jid);
    let devices = event.published?.[0]?.content?.devices ?? event.items?.published?.[0]?.content?.devices;
    if (jid && Array.isArray(devices)) {
      this.omemo.onDeviceListChanged(jid, devices);
    }
  }
}

/** @returns the JID without the resource, e.g. "fred@example.com" */
export function getBareJID(jid: string): string {
  return sanitize.nonemptystring(jid, null)?.split("/")[0].toLowerCase();
}

/** TLS or local
 * @returns URL or null */
function allowedURL(url: string, secure: "wss" | "https", plain: "ws" | "http"): string | null {
  if (url.startsWith(secure + ":")) {
    return url;
  }
  try {
    let parsed = new URL(url);
    if (parsed.protocol == plain + ":" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
      return url;
    }
  } catch (ex) {
  }
  return null;
}

const kNetworkTimeoutInMS = 5 * 1000; // 5 seconds
