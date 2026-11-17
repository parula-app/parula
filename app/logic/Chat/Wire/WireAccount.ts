import { ChatAccount } from "../ChatAccount";
import { WireChatRoom } from "./WireChatRoom";
import { Wire1to1ChatRoom } from "./Wire1to1ChatRoom";
import { WireGroupChatRoom } from "./WireGroupChatRoom";
import { WirePerson } from "./WirePerson";
import { WireRoomEvent } from "./WireRoomEvent";
import { WireTransport } from "./WireTransport";
import { WireSession } from "./WireSession";
import { WireAPI } from "./WireAPI";
import { WireEventStream } from "./WireEventStream";
import { WireMedia } from "./WireMedia";
import type { WireMLSService } from "./WireMLSService";
import { ProteusService, type ProteusDevice } from "./Proteus/ProteusService";
import { ProteusStore } from "./Proteus/ProteusStore";
import { ProteusErrorCode } from "./Proteus/ProteusSession";
import { ClientAction, GenericMessage } from "./Proto/messages";
import { encode } from "../Signal/Proto/codec";
import type { TWireConnectionStatus, TWireConversation, TWireEvent, TWireFeature, TWireMLSConfig, TWirePrekey, TWireProtocol, TWireQualifiedID } from "./TWire";
import { ChatMessage } from "../ChatMessage";
import { base64Decode } from "../Signal/Crypto/primitives";
import { LoginError } from "../../Abstract/Account";
import { Group } from "../../Abstract/Group";
import { appGlobal } from "../../app";
import { assert } from "../../util/util";
import { blobToDataURL } from "../../util/blob";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { gt } from "../../../l10n/l10n";
import type { ArrayColl, MapColl } from "svelte-collections";

/**
 * A chat account on a Wire backend.
 *
 * Ties the pieces together: `WireSession` logs in and owns our device,
 * `WireAPI` is every REST call, `WireEventStream` brings everything that
 * happens, and `WireMLSService` / `ProteusService` are the two encryptions.
 *
 * Which of the two a conversation uses is the server's word for a group, and
 * for a 1:1 it follows from what both sides support: MLS if we both have it,
 * else Proteus, and never back again once MLS is established.
 */
export class WireAccount extends ChatAccount {
  readonly protocol: string = "wire";
  declare readonly rooms: MapColl<WirePerson | Group, WireChatRoom>;
  declare readonly roster: ArrayColl<WirePerson>;
  declare protected readonly allPersonsCached: MapColl<string, WeakRef<WirePerson>>;
  declare getPersonUID: (userID: string, name?: string) => WirePerson;

  transport: WireTransport;
  session: WireSession;
  api: WireAPI;
  eventStream: WireEventStream;
  media: WireMedia;
  /** MLS: our key packages, the commits, the welcomes. Only where the team
   * turned MLS on. */
  mls: WireMLSService | null = null;
  /** Proteus: Wire's per-device encryption. Still needed for a peer without
   * MLS, and the backend demands its prekeys even from an MLS-only client. */
  proteus: ProteusService | null = null;
  proteusStore: ProteusStore | null = null;

  /** The team's login code `wire-<uuid>`. null = an ordinary password login. */
  ssoCode: string | null = null;
  /** `endpoints.backendWSURL` of the backend config. A different host than the
   * REST API, and only the config knows it. */
  websocketURL: string | null = null;
  /** Our team, if our user is in one. Team members are contacts without a
   * contact request, so they are the second half of our roster. */
  teamID: string | null = null;
  /** What we tell others we speak. We may add `mls`, but never take it away. */
  supportedProtocols: TWireProtocol[] = ["proteus"];
  mlsEnabled = false;
  /** Which protocol a new group conversation gets */
  defaultProtocol: TWireProtocol = "proteus";
  defaultCipherSuite = kDefaultCipherSuite;
  /** Where we are in the notification stream. Persisted, so that a restart
   * picks up where we stopped instead of replaying everything. */
  lastNotificationID: string | null = null;

  /** Our own user as a chat contact. The sender of everything we send. */
  protected ownContact: WirePerson | null = null;
  protected keyRotationTimer: ReturnType<typeof setInterval> | null = null;
  /** Restored from the config until the objects that own it exist */
  protected sessionJSON: any = null;
  /** `WireMLSService.toJSON()`: our MLS identity and the key packages we
   * published. Their private keys are the only copy there is. */
  mlsClientJSON: any = null;
  protected proteusStoreJSON: any = null;

  get isLoggedIn(): boolean {
    return !!this.session?.transport.accessToken && !!this.session.clientID;
  }

  newRoom(isGroup = false): WireChatRoom {
    return isGroup ? new WireGroupChatRoom(this) : new Wire1to1ChatRoom(this);
  }

  protected newPersonUID(userID: string, name?: string): WirePerson {
    let id = WirePerson.parseChatID(userID);
    return new WirePerson(id.id, id.domain, name);
  }

  /** The contact for a Wire user, reused across all rooms of this account */
  getWirePerson(userID: TWireQualifiedID, name?: string): WirePerson {
    return this.getPersonUID(WirePerson.chatID(userID), name);
  }

  getOwnContact(): WirePerson {
    return this.ownContact ??= this.getWirePerson(
      { id: this.session.userID, domain: this.session.domain }, this.realname);
  }

  /** Who caused an event. The unqualified `from` is the pre-federation form
   * and then means our own backend. */
  personForEvent(event: TWireEvent): WirePerson {
    return this.getWirePerson({
      id: sanitize.nonemptystring(event.qualified_from?.id ?? event.from),
      domain: sanitize.hostname(event.qualified_from?.domain ?? this.transport.domain),
    });
  }

  // --- Login ---

  async login(interactive: boolean): Promise<void> {
    if (this.isLoggedIn) {
      return;
    }
    await super.login(interactive);
    await Promise.all(appGlobal.addressbooks.contents.map(ab => ab.readContactsFromDB())); // rooms need Persons
    await this.listRooms(); // saves the account, and loads the known rooms from our DB
    await this.connect(interactive);
    await this.setupEncryption();
    await this.listContacts();
    await this.listConversations();
    await this.startEventStream();
    this.isOnline = true;
    await this.save();
    this.readProfilePictures()
      .catch(this.errorCallback);
  }

  /** For setup only. Tests that the login works, and leaves nothing running. */
  async verifyLogin(): Promise<void> {
    try {
      await this.connect(true);
    } finally {
      this.session?.stop();
    }
  }

  async startup(): Promise<void> {
    await this.listRooms();
  }

  /** Logs in with whichever credential this account has: the cookie that
   * survived the last run, the team's identity provider, or the password. */
  protected async connect(interactive: boolean): Promise<void> {
    this.setup();
    if (this.transport.cookie) {
      await this.session.resume();
    } else if (!interactive) {
      throw new LoginError(null, gt`Please log in again`);
    } else if (this.ssoCode) {
      await this.session.loginWithSSO(this.ssoCode);
    } else {
      assert(this.username && this.password, gt`Need your email address and password`);
      await this.session.loginWithPassword(this.username, this.password);
    }
    this.username ??= this.session.emailAddress;
    this.media = new WireMedia(this.api, this.session.domain ?? this.transport.domain);
    await this.readBackendConfig();
  }

  /** Builds the objects that talk to the backend, and gives them back the
   * state that {@link fromConfigJSON} restored. */
  setup(): void {
    if (this.transport) {
      return;
    }
    assert(this.url, gt`Need the address of your chat server`);
    this.transport = new WireTransport(this.url);
    this.session = new WireSession(this.transport);
    this.session.refreshErrorCallback = ex => this.errorCallback(ex);
    this.session.onVerificationCode = () => this.onVerificationCode();
    if (this.sessionJSON) {
      this.session.fromJSON(this.sessionJSON);
    }
    this.api = new WireAPI(this.transport);
    this.media = new WireMedia(this.api, this.session.domain ?? "");
  }

  /** The backend tells us its WebSocket host in its own config document. Our
   * fallback is Wire's `nginz-https` / `nginz-ssl` naming, which holds for
   * Wire's own backends but for no other deployment. */
  protected async readBackendConfig(): Promise<void> {
    if (this.websocketURL) {
      return;
    }
    try {
      let json = await this.transport.get("/config.json", { unversioned: true });
      this.websocketURL = sanitize.url(json?.endpoints?.backendWSURL, null)
        ?.replace(/^http/, "ws");
    } catch (ex) {
      console.log("Wire: The backend serves no config.json", ex);
    }
  }

  /** The 2FA code that the backend mailed to our user. The setup UI replaces
   * this with a prompt. */
  onVerificationCode: () => Promise<string> = async () => {
    throw new LoginError(null, gt`Please log in again`);
  };

  // --- Encryption ---

  /** Registers our device and both kinds of key material.
   *
   * The order matters: the backend assigns our client ID when we register, and
   * the MLS credential names that client ID, so MLS can only be set up once we
   * have one. */
  protected async setupEncryption(): Promise<void> {
    await this.readFeatureConfig();
    this.proteusStore ??= this.proteusStoreJSON
      ? ProteusStore.fromJSON(this.proteusStoreJSON)
      : ProteusStore.createNew();
    let prekeys = this.proteusStore.oneTimePreKeys
      .map(preKey => preKey.toJSONForServer(this.proteusStore.identity));
    let lastPrekey = this.proteusStore.lastResortPreKey.toJSONForServer(this.proteusStore.identity);
    let isNewDevice = !this.session.clientID;
    if (this.mlsEnabled) {
      // MLS registers the device itself: the backend refuses a key package
      // whose signature key it has not seen on our device before.
      await this.setupMLS(prekeys, lastPrekey);
      await this.publishSupportedProtocols();
    } else {
      await this.session.ensureClient({}, prekeys, lastPrekey);
    }
    this.setupProteus();
    if (isNewDevice) {
      await this.startAtEndOfNotifications();
    }
    await this.proteus.replenishPreKeys();
  }

  protected setupProteus(): void {
    this.proteus = new ProteusService(this.api, this.proteusStore,
      this.session.userID, this.session.domain, this.session.clientID);
    // The ratchet moves on every encrypt and decrypt, and losing it means the
    // peer's next message can no longer be read.
    this.proteus.onStoreChanged = async () => await this.save();
    this.proteus.onSendSessionReset = async device => await this.sendSessionReset(device);
    this.proteus.onRemoteIdentityChanged = device => this.errorCallback(
      new Error(gt`A device of ${device.userID} changed its identity key`));
  }

  /** Tell the backend which protocols we speak, so that a peer starting a 1:1
   * with us can pick MLS. Nobody sees our team's feature flag; they see only
   * this, and it defaults to Proteus alone. §6.2 of `04-Users-…`: `mls` may be
   * added but never taken away, so we only ever add it. */
  protected async publishSupportedProtocols(): Promise<void> {
    if (this.session.publishedProtocols.includes("mls") ||
        !this.supportedProtocols.includes("mls") ||
        !await this.session.allDevicesHaveMLS()) {
      return;
    }
    await this.api.setSupportedProtocols(this.supportedProtocols);
    this.session.publishedProtocols = this.supportedProtocols;
  }

  /** The MLS stack is large, and only a team that turned MLS on needs it. */
  protected async setupMLS(prekeys: TWirePrekey[], lastPrekey: TWirePrekey): Promise<void> {
    let { WireMLSService } = await import("./WireMLSService");
    this.mls = new WireMLSService(this.api, this.session);
    this.mls.fromJSON(this.mlsClientJSON);
    // Our signature key and our published key packages are the only copy there
    // is: losing them locks us out of every group we are in.
    this.mls.onClientChanged = async () => {
      this.mlsClientJSON = this.mls.toJSON();
      await this.save();
    };
    // A Welcome can be the first we hear of a conversation.
    this.mls.onRoomForConversation = async (conversationID, conversation, peerID) =>
      await this.roomForConversation(conversationID, conversation, peerID);
    await this.mls.setup(prekeys, lastPrekey);
    this.restoreMLSGroups();
    await this.rotateOurKeys();
    this.keyRotationTimer = setInterval(() => this.rotateOurKeys()
      .catch(this.errorCallback), kKeyRotationCheckHours * 3600 * 1000);
  }

  /** §14: re-key our own leaf in every group we are in, every 30 days, so that
   * a key that leaked stops opening anything. A group we only just joined was
   * keyed by the commit that let us in, so its clock starts there. */
  protected async rotateOurKeys(): Promise<void> {
    let due = new Date(Date.now() - kKeyRotationDays * 24 * 3600 * 1000);
    for (let room of this.rooms.contents) {
      if (!room.isMLS || !room.mlsGroupJSON || room.lastKeyRotation > due) {
        continue;
      }
      try {
        if (room.lastKeyRotation) {
          await this.mls.rotateOurKey(room);
        }
        room.lastKeyRotation = new Date();
        await room.save();
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
  }

  /** `MLSClient.fromJSON()` deliberately does not bring the groups back, so
   * each room hands its own group state over, and MLS registers it. */
  protected restoreMLSGroups(): void {
    for (let room of this.rooms.contents) {
      if (!room.isMLS) {
        continue;
      }
      try {
        this.mls.addRoom(room);
      } catch (ex) {
        this.errorCallback(ex); // a group we can no longer read; MLS rejoins it
      }
    }
  }

  /** The room of a conversation, fetching it from the server when a Welcome
   * named one that we have never seen.
   * @param conversation the conversation, where the caller already has it. An
   *   MLS 1:1 that nobody committed to yet is only in the
   *   `/one2one-conversations` answer, and fetching it would be a 404.
   * @param peerID who that 1:1 is with, which it does not say itself while its
   *   member list is still empty. */
  async roomForConversation(conversationID: TWireQualifiedID,
    conversation?: TWireConversation, peerID?: TWireQualifiedID): Promise<WireChatRoom> {
    let room = this.getExistingRoom(WirePerson.chatID(conversationID)) ??
      await this.getOrCreateRoom(conversation ?? await this.api.getConversation(conversationID), peerID);
    assert(room, `Wire: The conversation ${conversationID.id} is not a chat room`);
    return room;
  }

  /** Tells one peer device to throw away its half of a session we just reset,
   * so that its next message starts a new one. Proteus only. */
  protected async sendSessionReset(device: ProteusDevice): Promise<void> {
    let person = this.getWirePerson({ id: device.userID, domain: device.domain });
    let room = this.rooms.get(person);
    if (!room) {
      return;
    }
    await this.proteus.sendToDevices(room.qualifiedID, [device], encode(GenericMessage, {
      messageID: crypto.randomUUID(),
      clientAction: ClientAction.ResetSession,
    }), { mismatch: "ignoreAll" });
  }

  /** Which features our team has. Works for a personal account too, where the
   * backend answers with its own defaults. */
  protected async readFeatureConfig(): Promise<void> {
    let self = await this.api.getSelf();
    this.teamID = self.team;
    this.realname ||= self.name;
    this.getOwnContact().fromServer(self);
    let features = await this.api.getFeatureConfigs();
    this.applyFeatureConfig("mls", features.mls);
  }

  protected applyFeatureConfig(name: string, feature: TWireFeature | undefined): void {
    if (name != "mls") {
      return;
    }
    this.mlsEnabled = feature?.status == "enabled";
    let config = feature?.config as TWireMLSConfig;
    this.defaultProtocol = sanitize.enum(config?.defaultProtocol, kProtocols, "proteus") as TWireProtocol;
    this.defaultCipherSuite = sanitize.integer(config?.defaultCipherSuite, kDefaultCipherSuite);
    // The team decides what we may speak; an old team says nothing, and then
    // Proteus is all there is.
    this.supportedProtocols = this.mlsEnabled && config?.supportedProtocols?.length
      ? config.supportedProtocols
      : ["proteus"];
  }

  /** Only the protocols we understand, whatever the server sent */
  protected readProtocols(unchecked: any, fallback: TWireProtocol[]): TWireProtocol[] {
    let protocols = (sanitize.array(unchecked, []) as string[])
      .filter(protocol => (kProtocols as string[]).includes(protocol)) as TWireProtocol[];
    return protocols.length ? protocols : fallback;
  }

  /** Which encryption a 1:1 with this person uses: MLS if we both have it,
   * else Proteus. Never go back: a peer who drops MLS keeps the MLS 1:1 we
   * already have. */
  protocolFor(person: WirePerson): TWireProtocol {
    let existing = this.rooms.get(person);
    if (existing?.isMLS) {
      return "mls";
    }
    if (person.deleted || person.isService) {
      return "proteus"; // nothing to negotiate with
    }
    let common = person.supportedProtocols.filter(protocol => this.supportedProtocols.includes(protocol));
    if (common.length) {
      return common.includes("mls") ? "mls" : "proteus";
    }
    return this.supportedProtocols.includes("mls") ? "mls" : "proteus";
  }

  // --- Contacts ---

  /** Wire has no address book: our contacts are the contact requests we
   * accepted, plus everybody in our team. */
  async listContacts(): Promise<void> {
    let persons = new Map<string, WirePerson>();
    for (let connection of await this.api.listConnections()) {
      let person = this.getWirePerson(connection.qualified_to);
      person.connectionStatus = connection.status;
      person.proteusConversationID = connection.qualified_conversation;
      persons.set(person.chatID, person);
    }
    if (this.teamID) {
      for (let member of await this.api.listTeamMembers(this.teamID)) {
        if (member.user == this.session.userID) {
          continue; // we are in our own team, but not our own contact
        }
        let person = this.getWirePerson({ id: member.user, domain: this.session.domain });
        person.teamID = this.teamID;
        person.legalHold ||= member.legalhold_status == "enabled";
        persons.set(person.chatID, person);
      }
    }
    await this.readProfiles([...persons.values()]);
    this.roster.replaceAll([...persons.values()]
      .filter(person => person.isContact || person.isPendingInvite));
  }

  /** Neither the connections nor the team members carry a name or a picture. */
  protected async readProfiles(persons: WirePerson[]): Promise<void> {
    if (!persons.length) {
      return;
    }
    let result = await this.api.listUsers(persons.map(person => person.qualifiedID));
    for (let json of result.found) {
      this.getWirePerson(json.qualified_id).fromServer(json);
    }
    // `failed` is an unreachable backend, not a user who does not exist, so
    // keep what we know about them and try again later.
  }

  /** Cargohold wants our access token even for a public asset, so an
   * `<img src>` cannot load an avatar: we fetch it and keep the bytes. */
  protected async readProfilePictures(): Promise<void> {
    for (let person of this.roster) {
      let asset = person.pictureAsset;
      if (person.picture || !asset) {
        continue;
      }
      try {
        // A peer from before federation sends no domain with its asset, and
        // then the asset lives on that user's own backend.
        let bytes = await this.api.downloadAsset(asset.domain ?? person.domain, asset.key);
        person.picture = await blobToDataURL(
          new Blob([bytes as unknown as BlobPart], { type: "image/jpeg" }));
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
  }

  // --- Conversations ---

  async listRooms(): Promise<void> {
    await super.listRooms();
    if (this.isLoggedIn) {
      await this.listConversations();
    }
  }

  /** Every conversation we are in, as our rooms. */
  async listConversations(): Promise<void> {
    let result = await this.api.listAllConversations();
    for (let json of result.found) {
      try {
        await this.getOrCreateRoom(json);
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
    for (let gone of result.notFound) {
      await this.deleteRoom(WirePerson.chatID(gone));
    }
    // `failed` is an unreachable backend: keep those rooms and retry later.
  }

  /** The room for a conversation the server described, creating it if it is
   * new to us.
   * @returns null for our own notes, which carry only state sync */
  async getOrCreateRoom(json: TWireConversation, peerID?: TWireQualifiedID): Promise<WireChatRoom | null> {
    if (json.type == kSelfConversationType) {
      return null;
    }
    let isGroup = json.type == kGroupConversationType;
    let room = this.getExistingRoom(WirePerson.chatID(json.qualified_id));
    if (!room) {
      room = this.newRoom(isGroup);
      room.id = WirePerson.chatID(json.qualified_id);
      room.contact = isGroup ? newGroupContact(json)
        : peerID ? this.getWirePerson(peerID) : this.peerOf(json);
      // Wire has 2 one-to-one conversations per peer – the Proteus one that
      // the contact request created, and the MLS one – but `rooms` holds one
      // per contact, so one of them displaces the other. The MLS one wins, and
      // never gives way again, which is the rule `protocolFor()` follows.
      // Without this, which of the 2 the user sees would depend on the order
      // in which the server happened to list them.
      let sameContact = this.rooms.get(room.contact);
      if (sameContact?.isMLS && json.protocol != "mls") {
        return sameContact;
      }
      this.rooms.set(room.contact, room);
    }
    room.fromServer(json);
    if (isGroup && json.name && room.contact instanceof Group) {
      room.contact.name = json.name;
      room.name = json.name;
    }
    await room.save();
    return room;
  }

  /** The one other person in a 1:1. A contact request has them in `others`
   * too, so this covers both. */
  protected peerOf(json: TWireConversation): WirePerson {
    let other = json.members?.others
      ?.find(member => member.qualified_id.id != this.session.userID);
    assert(other, `Wire: The 1:1 conversation ${json.qualified_id.id} has nobody in it`);
    return this.getWirePerson(other.qualified_id);
  }

  getExistingRoom(id: string): WireChatRoom | null {
    return this.rooms.find(room => room.id == id) ?? null;
  }

  protected async deleteRoom(id: string): Promise<void> {
    let room = this.getExistingRoom(id);
    if (!room) {
      return;
    }
    this.rooms.delete(room.contact);
    await this.storage?.deleteRoom(room);
  }

  /** Opens the conversation with this person, over whichever encryption we
   * both support. Wire always has a Proteus 1:1; the MLS one is a different
   * conversation, which either backend conjures on demand. */
  async getChatWith(person: WirePerson): Promise<WireChatRoom> {
    if (this.protocolFor(person) == "mls") {
      let mlsRoom = await this.mls.oneToOneGroup(person.qualifiedID);
      return this.getExistingRoom(WirePerson.chatID(mlsRoom.qualifiedID));
    }
    let conversationID = person.proteusConversationID ??
      (await this.api.createConnection(person.qualifiedID)).qualified_conversation;
    assert(conversationID, gt`Could not open a chat with ${person.name}`);
    return await this.getOrCreateRoom(await this.api.getConversation(conversationID));
  }

  /** Opens a new conversation with several people, over whichever encryption
   * our team defaults to.
   *
   * MLS takes 2 steps, doc 07 §6.1: the conversation is created *empty*,
   * because the backend does not know the MLS membership and learns it from
   * the commit, and only that commit takes the group to epoch 1. Proteus takes
   * the members straight away. */
  async createGroupChat(name: string, persons: WirePerson[]): Promise<WireGroupChatRoom> {
    let userIDs = persons.map(person => person.qualifiedID);
    let isMLS = this.mlsEnabled && this.defaultProtocol == "mls";
    let json = isMLS
      ? await this.api.createMLSConversation({ name: name })
      : await this.api.createConversation({ name: name, qualified_users: userIDs });
    let room = await this.getOrCreateRoom(json) as WireGroupChatRoom;
    if (isMLS) {
      await this.mls.createGroup(room, userIDs);
    }
    await room.listMembers(); // the members and the epoch, as the server has them now
    return room;
  }

  // --- The event stream ---

  protected async startEventStream(): Promise<void> {
    this.eventStream = new WireEventStream(this.session, this.api);
    this.eventStream.websocketBaseURL = this.websocketURL;
    this.eventStream.onEvent = event => this.onEvent(event);
    this.eventStream.onError = ex => this.errorCallback(ex);
    this.eventStream.onDesynchronized = () => this.resynchronize();
    await this.eventStream.start(this.lastNotificationID);
  }

  /** A brand-new device starts at the end of the stream, instead of replaying
   * the whole history of the account. */
  protected async startAtEndOfNotifications(): Promise<void> {
    let last = await this.api.getLastNotification(this.session.clientID);
    this.lastNotificationID = last?.id ?? null;
  }

  /** We lost history and could not catch up, so nothing we have is certain
   * any more. Everything comes from the server again. */
  protected async resynchronize(): Promise<void> {
    await this.listContacts();
    await this.listConversations();
  }

  /** One event, in order, never two at a time. Whatever we throw here is not
   * acknowledged, so the backend hands it to us again. */
  protected async onEvent(event: TWireEvent): Promise<void> {
    let type = sanitize.nonemptystring(event.type, "");
    if (type.startsWith("conversation.")) {
      await this.onConversationEvent(type, event);
    } else if (type.startsWith("user.")) {
      await this.onUserEvent(type, event);
    } else if (type == "feature-config.update") {
      this.applyFeatureConfig(sanitize.string(event.name, ""), event.data);
    }
    let cursor = this.eventStream?.lastNotificationID;
    if (cursor && cursor != this.lastNotificationID) {
      this.lastNotificationID = cursor;
      await this.save();
    }
  }

  protected async onConversationEvent(type: string, event: TWireEvent): Promise<void> {
    let conversationID = this.conversationIDOf(event);
    let room = conversationID ? this.getExistingRoom(WirePerson.chatID(conversationID)) : null;
    // Wire delivers 8 event types twice — once as the answer to the call that
    // caused them, and again on the stream. Only the stream copy can be old.
    if (room && !this.eventStream.isLive && room.isOutdatedEvent(event)) {
      return;
    }
    switch (type) {
      case "conversation.otr-message-add":
        await this.onProteusMessage(room, event);
        break;
      case "conversation.mls-message-add":
        await this.onMLSMessage(room, event);
        break;
      case "conversation.mls-welcome":
        // The group ID is opaque, so the event's conversation is the only
        // thing that says which conversation the new group belongs to.
        await this.mls?.processWelcome(conversationID, base64Decode(sanitize.nonemptystring(event.data)));
        room = this.getExistingRoom(WirePerson.chatID(conversationID));
        break;
      case "conversation.create":
        room = await this.getOrCreateRoom(await this.api.getConversation(conversationID));
        break;
      case "conversation.delete":
      case "conversation.system.delete":
        await this.deleteRoom(WirePerson.chatID(conversationID));
        return;
      case "conversation.rename":
        await this.onRename(room, event);
        break;
      case "conversation.member-join":
        room = await this.onMemberJoin(room, conversationID, event);
        break;
      case "conversation.member-leave":
        await this.onMemberLeave(room, event);
        break;
      case "conversation.typing":
        if (room) {
          room.contactIsTyping = sanitize.string(event.data?.status, "") == "started";
        }
        break;
      case "conversation.protocol-update":
        if (room) {
          // A migration only ever goes towards MLS, and the group we are then
          // to use arrives as a Welcome.
          room.protocol = sanitize.enum(event.data?.protocol, kConversationProtocols, room.protocol);
          if (room.isMLS) {
            this.mls?.addRoom(room);
          }
          await room.save();
        }
        break;
      case "conversation.receipt-mode-update":
        if (room) {
          room.receiptMode = sanitize.integer(event.data?.receipt_mode, 0);
          await room.save();
        }
        break;
      case "conversation.message-timer-update":
        if (room) {
          room.messageTimer = sanitize.integer(event.data?.message_timer, 0);
          await room.save();
        }
        break;
      case "conversation.connect-request":
        room = await this.getOrCreateRoom(await this.api.getConversation(conversationID));
        break;
    }
    room?.noteEventTime(event);
  }

  protected conversationIDOf(event: TWireEvent): TWireQualifiedID | null {
    let id = sanitize.nonemptystring(event.qualified_conversation?.id ?? event.conversation, null);
    return id ? {
      id: id,
      domain: sanitize.hostname(event.qualified_conversation?.domain ?? this.transport.domain),
    } : null;
  }

  /** A message encrypted for our device alone. A duplicate is normal — the
   * notification stream replays — and the ratchet tells us so. */
  protected async onProteusMessage(room: WireChatRoom | null, event: TWireEvent): Promise<void> {
    if (!room) {
      return; // our own notes, or a conversation we do not have
    }
    let plaintext: Uint8Array;
    try {
      plaintext = await this.proteus.decryptEvent(event);
    } catch (ex) {
      if (ex?.code == ProteusErrorCode.DuplicateMessage || ex?.code == ProteusErrorCode.OutdatedMessage) {
        return;
      }
      this.errorCallback(ex); // the session was reset, so their next one arrives
      return;
    }
    await this.receiveMessage(room, plaintext, event);
  }

  /** An MLS message: application data, or a commit that moves the group into
   * its next epoch. */
  protected async onMLSMessage(room: WireChatRoom | null, event: TWireEvent): Promise<void> {
    if (!room || !this.mls) {
      return;
    }
    let result = await this.mls.processMessage(room,
      base64Decode(sanitize.nonemptystring(event.data)));
    if (result.kind == "application") {
      await this.receiveMessage(room, result.plaintext, event);
    }
  }

  /** The one place that reads a message. Both transports carry exactly the
   * same bytes, so only the decryption above them differs. */
  protected async receiveMessage(room: WireChatRoom, plaintext: Uint8Array, event: TWireEvent): Promise<void> {
    let msg = await room.receivePayload(plaintext, event);
    if (!msg) {
      return; // a reaction, a receipt, an edit: it changed a message we have
    }
    if (msg instanceof ChatMessage) {
      room.lastMessage = msg;
    }
    await room.saveNewMessages([msg]);
  }

  protected async onRename(room: WireChatRoom | null, event: TWireEvent): Promise<void> {
    let newName = sanitize.label(event.data?.name, null);
    if (!room || !newName) {
      return;
    }
    room.name = newName;
    if (room.contact instanceof Group) {
      room.contact.name = newName;
    }
    let roomEvent = room.newRoomEvent();
    roomEvent.wireType = event.type;
    roomEvent.renamed(newName);
    await this.addRoomEvent(room, roomEvent, event);
  }

  protected async onMemberJoin(room: WireChatRoom | null, conversationID: TWireQualifiedID,
    event: TWireEvent): Promise<WireChatRoom | null> {
    let persons = qualifiedIDsOf(event.data?.users?.map(member => member?.qualified_id))
      .map(id => this.getWirePerson(id));
    // We were added to a conversation that we did not know about
    let target = room ?? await this.getOrCreateRoom(await this.api.getConversation(conversationID));
    if (!target) {
      return null;
    }
    // The event names us too, when we are the one who was added, but
    // `room.members` is everybody *else*, as `fromServer()` fills it.
    let others = persons.filter(person => person != this.getOwnContact());
    target.members.addAll(others.filter(person => !target.members.includes(person)));
    let roomEvent = target.newRoomEvent();
    roomEvent.wireType = event.type;
    roomEvent.membersChanged(persons, true);
    await this.addRoomEvent(target, roomEvent, event);
    await target.save();
    return target;
  }

  protected async onMemberLeave(room: WireChatRoom | null, event: TWireEvent): Promise<void> {
    if (!room) {
      return;
    }
    let ids = qualifiedIDsOf(event.data?.qualified_user_ids);
    let persons = ids.map(id => this.getWirePerson(id));
    if (ids.some(id => id.id == this.session.userID)) {
      await this.deleteRoom(room.id); // we are out
      return;
    }
    room.members.removeAll(persons);
    let roomEvent = room.newRoomEvent();
    roomEvent.wireType = event.type;
    roomEvent.membersChanged(persons, false, sanitize.nonemptystring(event.data?.reason, null));
    await this.addRoomEvent(room, roomEvent, event);
    await room.save();
  }

  protected async addRoomEvent(room: WireChatRoom, roomEvent: WireRoomEvent, event: TWireEvent): Promise<void> {
    roomEvent.id = crypto.randomUUID();
    roomEvent.from = this.personForEvent(event);
    roomEvent.sent = sanitize.date(event.time, new Date());
    roomEvent.received = new Date(roomEvent.sent);
    room.messages.add(roomEvent);
    await room.saveNewMessages([roomEvent]);
  }

  protected async onUserEvent(type: string, event: TWireEvent): Promise<void> {
    if (type == "user.connection") {
      await this.onConnection(event);
    } else if (type == "user.update") {
      this.onUserUpdate(event);
    } else if (type == "user.delete") {
      let person = this.findPerson(sanitize.nonemptystring(event.qualified_id?.id ?? event.id, ""));
      if (person) {
        person.deleted = true;
        this.roster.remove(person);
      }
    }
  }

  /** Somebody asked us to connect, or answered our own request. */
  protected async onConnection(event: TWireEvent): Promise<void> {
    let connection = event.connection;
    let person = this.getWirePerson({
      id: sanitize.nonemptystring(connection?.qualified_to?.id ?? connection?.to),
      domain: sanitize.hostname(connection?.qualified_to?.domain ?? this.transport.domain),
    }, sanitize.nonemptylabel(event.user?.name, null));
    person.connectionStatus = sanitize.enum(connection?.status,
      kConnectionStatuses, null) as TWireConnectionStatus;
    if (connection?.qualified_conversation) {
      person.proteusConversationID = {
        id: sanitize.nonemptystring(connection.qualified_conversation.id),
        domain: sanitize.hostname(connection.qualified_conversation.domain),
      };
    }
    if (person.isContact || person.isPendingInvite) {
      if (!this.roster.includes(person)) {
        this.roster.add(person);
      }
      if (person.proteusConversationID && !this.rooms.get(person)) {
        await this.getOrCreateRoom(await this.api.getConversation(person.proteusConversationID));
      }
    } else {
      this.roster.remove(person);
    }
  }

  /** A profile changed. The event names the user unqualified, so we look them
   * up among the contacts we have rather than guessing a domain. */
  protected onUserUpdate(event: TWireEvent): void {
    let person = this.findPerson(sanitize.nonemptystring(event.user?.id, ""));
    if (!person) {
      return;
    }
    let json = event.user;
    person.name = sanitize.nonemptylabel(json.name, person.name);
    person.handle = sanitize.nonemptystring(json.handle, person.handle);
    if (json.supported_protocols) {
      person.supportedProtocols = this.readProtocols(json.supported_protocols, person.supportedProtocols);
    }
  }

  findPerson(userID: string): WirePerson | null {
    return this.roster.find(person => person.userID == userID) ?? null;
  }

  // --- Shutdown ---

  /** Ends everything that runs in the background, without giving up our
   * login: the app is closing, or the network went away. */
  async disconnect(): Promise<void> {
    this.isOnline = false;
    clearInterval(this.keyRotationTimer);
    this.keyRotationTimer = null;
    await this.eventStream?.stop();
    this.eventStream = null;
    this.session?.stop();
  }

  /** Gives up the login for good, and drops the cookie that would let us take
   * it up again. */
  async logout(): Promise<void> {
    await super.logout(); // disconnects
    await this.session?.logout();
    this.mls = null;
    this.proteus = null;
    this.api = null;
    this.media = null;
    this.session = null;
    this.transport = null;
    this.ownContact = null;
  }

  // --- Persistence ---

  fromConfigJSON(json: any): void {
    super.fromConfigJSON(json);
    let wire = json?.wire;
    if (!wire) {
      return;
    }
    this.sessionJSON = wire.session ?? null;
    this.ssoCode = sanitize.nonemptystring(wire.ssoCode, null);
    this.websocketURL = sanitize.url(wire.websocketURL, null);
    this.teamID = sanitize.nonemptystring(wire.teamID, null);
    this.lastNotificationID = sanitize.nonemptystring(wire.lastNotificationID, null);
    this.mlsEnabled = sanitize.boolean(wire.mlsEnabled, false);
    this.defaultProtocol = sanitize.enum(wire.defaultProtocol, kProtocols, "proteus") as TWireProtocol;
    this.defaultCipherSuite = sanitize.integer(wire.defaultCipherSuite, kDefaultCipherSuite);
    this.supportedProtocols = this.readProtocols(wire.supportedProtocols, ["proteus"]);
    this.mlsClientJSON = wire.mlsClient ?? null;
    this.proteusStoreJSON = wire.proteus ?? null;
  }

  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.wire = {
      session: this.session?.toJSON() ?? this.sessionJSON,
      ssoCode: this.ssoCode,
      websocketURL: this.websocketURL,
      teamID: this.teamID,
      lastNotificationID: this.lastNotificationID,
      mlsEnabled: this.mlsEnabled,
      defaultProtocol: this.defaultProtocol,
      defaultCipherSuite: this.defaultCipherSuite,
      supportedProtocols: this.supportedProtocols,
      mlsClient: this.mls?.toJSON() ?? this.mlsClientJSON,
      proteus: this.proteusStore?.toJSON() ?? this.proteusStoreJSON,
    };
    return json;
  }
}

/** A group conversation's name and picture. Its people live in
 * `room.members`, not in `group.participants`. */
function newGroupContact(json: TWireConversation): Group {
  let group = new Group();
  group.name = json.name || gt`Group conversation`;
  return group;
}

function qualifiedIDsOf(jsons: any): TWireQualifiedID[] {
  return (Array.isArray(jsons) ? jsons : []).map(json => ({
    id: sanitize.nonemptystring(json?.id),
    domain: sanitize.hostname(json?.domain),
  }));
}

const kProtocols: TWireProtocol[] = ["proteus", "mls"];
/** A conversation may also be `mixed`, i.e. in migration from Proteus to MLS */
const kConversationProtocols: ("proteus" | "mls" | "mixed")[] = ["proteus", "mls", "mixed"];
const kConnectionStatuses: TWireConnectionStatus[] = ["sent", "pending", "accepted", "blocked",
  "ignored", "cancelled", "missing-legalhold-consent"];
const kSelfConversationType = 1;
const kGroupConversationType = 0;
/** `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`, what Wire's backends use */
const kDefaultCipherSuite = 1;
/** RFC 9420 §14 asks for a rotation of our own leaf key this often */
const kKeyRotationDays = 30;
const kKeyRotationCheckHours = 12;
