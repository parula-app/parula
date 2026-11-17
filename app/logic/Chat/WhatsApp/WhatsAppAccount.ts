import { ChatAccount } from "../ChatAccount";
import { WhatsAppChatRoom } from "./WhatsAppChatRoom";
import { WhatsAppMessage } from "./WhatsAppMessage";
import { WhatsAppSender } from "./WhatsAppSend";
import { WhatsAppHistorySync } from "./WhatsAppHistorySync";
import { WhatsAppAppState } from "./WhatsAppAppState";
import { KeyPair } from "../Signal/Crypto/KeyPair";
import { SignalStore } from "../Signal/Crypto/Store";
import { decryptPreKeyMessage, decryptSignalMessage } from "../Signal/Crypto/SessionCipher";
import { groupDecrypt, processDistributionMessage } from "../Signal/Crypto/GroupCipher";
import { base64Encode, base64Decode } from "../Signal/Crypto/primitives";
import { WhatsAppConnection, isWhatsAppLiveAvailable, type WhatsAppTransport } from "./WhatsAppConnection";
import { WhatsAppPairing } from "./WhatsAppPairing";
import { deferred, type Deferred, stanzaErrorText, bigEndian, waLog, nodePreview, waDebugState } from "./util";
import { kDjbType } from "../Signal/Crypto/curve";
import { getLoginPayload } from "./clientInfo";
import { decodeWAMessage, type WAMessage } from "./Proto/schema";
import { WANode } from "./Binary/WANode";
import { JID, kServerUser } from "./Binary/JID";
import { WhatsAppContact } from "./WhatsAppContact";
import { WhatsApp1to1ChatRoom } from "./WhatsApp1to1ChatRoom";
import { WhatsAppGroupChatRoom } from "./WhatsAppGroupChatRoom";
import { WhatsAppMeetAccount } from "../../Meet/WhatsApp/WhatsAppMeetAccount";
import { ChatPersonUID } from "../ChatPersonUID";
import { Group } from "../../Abstract/Group";
import { appGlobal } from "../../app";
import { gt } from "../../../l10n/l10n";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import type { ArrayColl, MapColl } from "svelte-collections";

/**
 * A WhatsApp account, paired as a companion device of the user's own phone.
 *
 * Orchestrates the whole protocol: identity and Signal keys, the server
 * connection (Noise handshake + binary XMPP, see Connection/), and routing of
 * incoming stanzas to the chat rooms. Calls run through a dependent
 * WhatsAppMeetAccount.
 *
 * Two ways in: importing an encrypted backup (Import/, fully working) and the
 * live multi-device protocol (unit-tested under Crypto/, Binary/, Proto/). The
 * live path runs only when the desktop backend's TCP socket factory is
 * available (see isWhatsAppLiveAvailable()); web builds and unit tests have no
 * such socket, so the live connection stays off there.
 */
export class WhatsAppAccount extends ChatAccount {
  readonly protocol: string = "whatsapp";
  declare readonly rooms: MapColl<WhatsAppContact | Group, WhatsAppChatRoom>;
  declare readonly roster: ArrayColl<WhatsAppContact>;
  declare protected readonly allPersonsCached: MapColl<string, WeakRef<WhatsAppContact>>;
  declare getPersonUID: (userID: string, name?: string) => WhatsAppContact;

  /** Set `WhatsAppAccount.enableDebug = true` to trace the stanzas we send and
   * receive to the console (off by default; errors are always logged). */
  static get enableDebug(): boolean {
    return waDebugState.enabled;
  }
  static set enableDebug(on: boolean) {
    waDebugState.enabled = on;
  }

  /** State of the setup wizard. Set only during setup and import. Not saved. */
  setup: WhatsAppSetup | null = null;

  /** Signal identity, registration id and prekeys. Set at pairing or restored
   * from config. (Session/sender-key ratchet state is runtime-only for now.) */
  signalStore: SignalStore | null = null;
  /** Noise static key — our handshake identity; the server tied it to us when we
   * paired. Distinct from the Signal identity key. */
  noiseKey: KeyPair | null = null;
  /** The secret shared with the phone during pairing (kept for re-pairing checks). */
  advSecret: Uint8Array | null = null;
  /** Our account-signed `ADVSignedDeviceIdentity` from pairing — attached as
   * `<device-identity>` to outgoing `pkmsg` stanzas so a recipient can verify our
   * new session is from a device the user's account authorized. */
  deviceIdentityBytes: Uint8Array | null = null;
  /** Our device address, e.g. `491701234567:32@s.whatsapp.net`. */
  deviceJID: JID | null = null;
  /** Our own "LID" identity (e.g. `29850727395377@lid`), from the `<success>`
   * stanza. Modern accounts address us and our contacts by LID, so messages we
   * sent from the phone arrive `from` this — used to recognise them as outgoing. */
  ownLID: JID | null = null;
  /** Cached user ID for the account owner {@link getOwnContact} */
  protected ownContact: WhatsAppContact | null = null;
  connection: WhatsAppConnection | null = null;
  /** Voice/video calls run through this dependent Meet account. */
  meetAccount: WhatsAppMeetAccount | null = null;
  /** Fetches the chat list and old messages the phone sends after linking. */
  readonly historySync = new WhatsAppHistorySync(this);
  readonly appState = new WhatsAppAppState(this);
  /** Builds, encrypts and sends our outgoing messages (per-device Signal). */
  readonly sender = new WhatsAppSender(this);
  /** Recently sent payloads, keyed by message id, so a `<receipt type="retry">`
   * for one can be re-encrypted and re-sent. Bounded; old entries are evicted. */
  protected recentSends = new Map<string, WAMessage>();
  /** The in-progress QR pairing, while {@link startPairing} runs (for cancel). */
  protected pairing: WhatsAppPairing | null = null;
  /** Resolves/rejects the in-flight login once `<success>`/`<failure>` arrives. */
  protected loginResult: Deferred<void> | null = null;
  /** Periodic ping that keeps the connection alive (the server drops idle ones). */
  protected keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  /** Whether a dropped connection should auto-reconnect: true while we want to be
   * online, cleared by {@link disconnect} and by an auth failure. */
  protected shouldReconnect = false;
  /** Pending reconnect, and how many attempts so far (for exponential backoff). */
  protected reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  protected reconnectAttempts = 0;

  newRoom(isGroup = false): WhatsAppChatRoom {
    return isGroup ? new WhatsAppGroupChatRoom(this) : new WhatsApp1to1ChatRoom(this);
  }

  get isLoggedIn(): boolean {
    return this.isOnline;
  }

  async login(interactive: boolean): Promise<void> {
    await super.login(interactive);
    await this.readFromDB(); // so that new messages land in the known chats
    await this.connect();
  }

  /** Drives the "Link a device" QR flow, then logs in with the new device.
   * @param onQR called with each QR payload string to render (it rotates as
   *   refs expire).
   * @param onPairing called once the QR was scanned and pairing is finishing.
   *   Resolves once paired and logged in. */
  async startPairing(onQR: (qr: string) => void, onPairing?: () => void, transport?: WhatsAppTransport): Promise<void> {
    let pairing = new WhatsAppPairing();
    pairing.onQR = onQR;
    pairing.onPairing = onPairing ?? (() => undefined);
    this.pairing = pairing;
    try {
      let jid = await pairing.register(transport);
      this.noiseKey = pairing.creds.noiseKey;
      this.signalStore = pairing.creds.signalStore;
      this.advSecret = pairing.creds.advSecret;
      this.deviceIdentityBytes = pairing.creds.deviceIdentity ?? null;
      this.deviceJID = jid;
      this.username = jid.toString();
      this.realname ||= jid.user;
      await pairing.connection.disconnect();
      await this.connect(transport);
    } finally {
      this.pairing = null;
    }
  }

  /** Aborts an in-progress {@link startPairing}. */
  cancelPairing(): void {
    this.pairing?.cancel();
  }

  /** Connects to the WhatsApp servers as the paired companion device and logs
   * in. Gated: does nothing until the live path is available (or a test
   * transport is injected) and the account is paired. */
  async connect(transport?: WhatsAppTransport): Promise<void> {
    if (!this.signalStore || !this.noiseKey || !this.deviceJID) {
      return; // not paired yet
    }
    if (!transport && !isWhatsAppLiveAvailable()) {
      return; // no live backend (e.g. web build or unit test)
    }
    if (this.connection) {
      return; // already connected (or connecting/reconnecting)
    }
    this.shouldReconnect = true; // we want to stay connected; drops trigger a reconnect
    let connection = this.createConnection();
    this.connection = connection;
    connection.onStanza = node => this.onStanza(node);
    this.setupMeetAccount();
    this.loginResult = deferred<void>();
    try {
      await connection.connect(() =>
        getLoginPayload(Number(this.deviceJID!.user), this.deviceJID!.device), transport);
      await this.loginResult.promise;
    } catch (ex) {
      // The handshake/login failed (or the stream dropped mid-handshake). Drop
      // this dead connection so a reconnect can replace it, and — unless this was
      // an auth failure (onConnectionClosed clears shouldReconnect) — retry.
      if (this.connection == connection) {
        this.teardownConnection();
      }
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
      throw ex;
    }
    this.isOnline = true;
  }

  /** The live connection for {@link connect}. A seam so tests can substitute a
   * connection that trusts a test root certificate. */
  protected createConnection(): WhatsAppConnection {
    return new WhatsAppConnection({ noiseKey: this.noiseKey! });
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false; // intentional — don't auto-reconnect
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isOnline = false;
    this.stopKeepAlive();
    this.loginResult?.reject(new Error("Disconnected"));
    this.loginResult = null;
    await this.connection?.disconnect();
    this.connection = null;
  }

  /** Tears down a dead connection (after a drop or failed handshake): stops the
   * keepalive and discards the socket so we stop writing into it. Does not clear
   * {@link shouldReconnect}. A reconnect is scheduled separately. */
  protected teardownConnection(): void {
    this.isOnline = false;
    this.stopKeepAlive();
    let dead = this.connection;
    this.connection = null;
    dead?.disconnect().catch(() => undefined);
  }

  /**
   * The server routinely ends the stream (e.g. `<stream:error code="503">`) and expects the
   * client to reconnect.
   * This schedules a reconnect after a drop, with exponential backoff.
   * Reset by a successful `<success>`, and stopped by {@link disconnect}.
   */
  protected scheduleReconnect(): void {
    if (this.reconnectTimer || !this.shouldReconnect) {
      return;
    }
    let delay = Math.min(kReconnectBaseMs * 2 ** this.reconnectAttempts, kReconnectMaxMs);
    this.reconnectAttempts++;
    waLog(`WhatsApp: reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(ex => console.error("WhatsApp: reconnect attempt failed:", (ex as any)?.message ?? ex));
    }, delay);
    (this.reconnectTimer as any)?.unref?.(); // don't keep the (Node/test) event loop alive
  }

  /** Handles the stream ending: an auth `<failure>` (don't loop — likely logged
   * out) vs. a `<stream:error>` or dropped socket (the routine 503 reconnect
   * signal). Rejects any in-flight login, tears the dead connection down, and
   * (unless it was an auth failure) reconnects. */
  protected onConnectionClosed(node: WANode): void {
    let detail = stanzaErrorText(node);
    let authFailure = node.tag == "failure";
    if (authFailure) {
      waLog("WhatsApp: login failed:", node.tag + detail);
      this.shouldReconnect = false; // an auth/conflict failure — reconnecting would loop
    } else {
      waLog("WhatsApp: connection lost:", node.tag + detail);
    }
    this.loginResult?.reject(new Error(`WhatsApp connection ${authFailure ? "login failed" : "lost"}${detail}`));
    this.loginResult = null;
    this.teardownConnection();
    if (this.shouldReconnect) {
      this.scheduleReconnect();
    }
  }

  /** Routes a received stanza to the right handler. */
  protected onStanza(node: WANode) {
    if (node.tag == "success") {
      if (node.attrs.lid) {
        this.ownLID = JID.parse(node.attrs.lid);
      }
      this.reconnectAttempts = 0; // a clean login resets the backoff
      this.loginResult?.resolve();
      this.loginResult = null;
      this.afterLogin().catch(ex => this.errorCallback(ex));
    } else if (node.tag == "failure" || node.tag == "stream:error") {
      this.onConnectionClosed(node);
    } else if (node.tag == "message") {
      this.receiveMessageStanza(node).catch(ex => this.errorCallback(ex));
    } else if (node.tag == "notification") {
      this.onNotification(node).catch(ex => this.errorCallback(ex));
    } else if (node.tag == "receipt") {
      this.onReceipt(node).catch(ex => this.errorCallback(ex));
    } else if (node.tag == "iq") {
      this.onServerIQ(node).catch(ex => this.errorCallback(ex));
    } else if (node.tag == "call") {
      this.meetAccount?.handleCallStanza(node);
    } else if (node.tag == "ib") {
      this.onInitialBootstrap(node).catch(ex => this.errorCallback(ex));
    } else if (node.tag == "ack") {
      this.onAck(node);
    } else {
      waLog("unhandled stanza:", node.tag);
    }
  }

  /** After `<success>`: publish our prekeys so the phone (and contacts) can
   * start Signal sessions to encrypt to us — without this the phone can't send
   * us anything, so no history and no messages arrive — and announce presence
   * so the phone delivers its history sync and live messages. */
  protected async afterLogin(): Promise<void> {
    this.startKeepAlive();
    await this.uploadPreKeys();
    await this.sendActive();
    // Re-sync contact names from app-state using our persisted keys. On a fresh
    // pairing the keys haven't arrived yet (no-op); the key-share then triggers it.
    this.appState.sync().catch(ex => this.errorCallback(ex));
  }

  /** Pings the server periodically so it doesn't drop the connection as idle. */
  protected startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      this.connection?.sendIQ(new WANode("iq", { to: kServerUser, type: "get", xmlns: "w:p" }, [new WANode("ping")]))
        .catch(() => undefined); // a dead connection surfaces via the transport close handler
    }, kKeepAliveMs);
    (this.keepAliveTimer as any)?.unref?.(); // don't keep the (Node/test) event loop alive
  }

  protected stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  protected saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Persists the account config (which embeds the Signal store) a short while
   * after the ratchet state last changed, coalescing a burst of messages into
   * one write. Without this the established sessions/consumed prekeys are lost on
   * restart and the phone has to re-establish every session (point 4 / Bad MAC). */
  scheduleSave(): void {
    if (this.saveTimer) {
      return;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save().catch(ex => console.error("WhatsApp: failed to persist Signal session state:", ex));
    }, kSessionSaveMs);
    (this.saveTimer as any)?.unref?.(); // don't keep the (Node/test) event loop alive
  }

  /** We log in `passive`, so the server doesn't deliver anything until we declare
   * ourselves active. This is the step that actually starts the inbound message
   * stream (offline backlog + the phone's history sync). It must come AFTER the
   * prekey upload, so the phone can encrypt to us once it learns we're online. */
  protected async sendActive(): Promise<void> {
    if (!this.connection) {
      return;
    }
    await this.connection.sendIQ(new WANode("iq",
      { to: kServerUser, xmlns: "passive", type: "set" }, [new WANode("active")]));
  }

  /** Publishes our identity + signed prekey + one-time prekeys to the server,
   * as the WhatsApp `encrypt` IQ (raw key bytes, big-endian ids). First tops the
   * store back up to the target count (peers consume one-time prekeys as they
   * start sessions with us; the server's `<notification type=encrypt>` warns when
   * it is running low) and persists the freshly minted keys. */
  protected async uploadPreKeys(): Promise<void> {
    let store = this.signalStore;
    if (!store || !this.connection) {
      return;
    }
    if (store.replenishPreKeys().length) {
      this.scheduleSave(); // persist the new keys so a restart doesn't re-issue their ids
    }
    let signedPreKey = store.signedPreKeys.get(1)!;
    let preKeys = [...store.preKeys.values()].map(preKey => new WANode("key", {}, [
      new WANode("id", {}, bigEndian(preKey.keyID, 3)),
      new WANode("value", {}, preKey.keyPair.publicKey),
    ]));
    let response = await this.connection.sendIQ(new WANode("iq", { to: kServerUser, type: "set", xmlns: "encrypt" }, [
      new WANode("registration", {}, bigEndian(store.registrationID, 4)),
      new WANode("type", {}, new Uint8Array([kDjbType])),
      new WANode("identity", {}, store.identityKeyPair.publicKey),
      new WANode("list", {}, preKeys),
      new WANode("skey", {}, [
        new WANode("id", {}, bigEndian(signedPreKey.keyID, 3)),
        new WANode("value", {}, signedPreKey.keyPair.publicKey),
        new WANode("signature", {}, signedPreKey.signature),
      ]),
    ]));
    if (response.attrs.type == "error") {
      console.error("WhatsApp: prekey upload rejected:", nodePreview(response));
    }
  }

  /** Server-side events (e.g. the phone added a device, or asks us to top up our
   * prekeys). We must acknowledge them so the server keeps the session going. */
  protected async onNotification(node: WANode): Promise<void> {
    if (node.attrs.type == "encrypt") {
      await this.uploadPreKeys(); // the server is running low on our prekeys
    } else if (node.attrs.type == "picture") {
      // A contact changed their avatar — refetch just that one.
      await this.refetchPicture(node.jidAttr("from"))
        .catch(ex => console.error("WhatsApp: refetch picture failed:", ex));
    } else if (node.attrs.type == "w:gp2") {
      await this.onGroupNotification(node)
        .catch(ex => console.error("WhatsApp: handling a group notification failed:", ex));
    } else if (node.attrs.type == "server_sync") {
      // The phone pushed app-state changes (saved contact names live here); re-sync.
      // The initial post-link snapshot is often still empty, so without this the
      // names never load and 1:1 chats stay shown as their numeric JID.
      await this.appState.onServerSync(node)
        .catch(ex => console.error("WhatsApp: app-state server_sync failed:", ex));
    }
    await this.sendAck(node);
  }

  /** A server-initiated IQ (responses to ours are routed away by the connection).
   * Reply with a result so the server doesn't stall waiting on us. */
  protected async onServerIQ(node: WANode): Promise<void> {
    if (node.attrs.type == "get" || node.attrs.type == "set") {
      await this.connection?.sendNode(new WANode("iq",
        { to: node.attrs.from ?? kServerUser, type: "result", id: node.attrs.id }));
    }
  }

  /** A `<receipt>` about a message WE sent: usually a delivery/read marker we
   * just acknowledge, but `type="retry"` means a recipient device couldn't
   * decrypt it — re-encrypt and re-send to that device. We always ack so the
   * server stops repeating it. */
  protected async onReceipt(node: WANode): Promise<void> {
    if (node.attrs.type == "retry") {
      await this.sender.handleRetryReceipt(node, this.recentSends.get(node.attrs.id ?? ""))
        .catch(ex => console.error("WhatsApp: handling a retry receipt failed:", ex));
    }
    await this.sendAck(node);
  }

  /** The participant-list hash we sent with each group message, keyed by message
   * id, so a server ack with a DIFFERENT phash reveals our device list is stale. */
  protected sentGroupPhash = new Map<string, string>();

  /** Records the phash we sent for a group message (see {@link onAck}). */
  rememberGroupPhash(messageID: string, group: string, phash: string): void {
    this.sentGroupPhash.set(messageID, `${group}|${phash}`);
    if (this.sentGroupPhash.size > kRecentSendsMax) {
      this.sentGroupPhash.delete(this.sentGroupPhash.keys().next().value!);
    }
  }

  /** The server's ack for something we sent. For a group message it echoes the
   * server's participant-list hash; if that differs from the one we sent, a member
   * joined/left that we don't know about — drop the cached metadata so the next
   * send re-fetches the device list. */
  protected onAck(node: WANode): void {
    let id = node.attrs.id;
    let serverPhash = node.attrs.phash;
    let from = node.jidAttr("from");
    if (!id || !serverPhash || !from?.isGroup) {
      return;
    }
    let key = from.toNonDevice().toString();
    let sent = this.sentGroupPhash.get(id);
    if (sent && sent != `${key}|${serverPhash}`) {
      waLog("group: server phash differs on", from.toString(), "— device list stale, refreshing metadata");
      this.groupRoomFor(from)?.invalidateMetadata();
    }
  }

  /** Remembers a payload we just sent so a later retry receipt for it can
   * re-encrypt and re-send. Bounded — the oldest entry is dropped past the cap. */
  rememberSent(messageID: string, payload: WAMessage): void {
    this.recentSends.set(messageID, payload);
    if (this.recentSends.size > kRecentSendsMax) {
      this.recentSends.delete(this.recentSends.keys().next().value!);
    }
  }

  /** Sends a message to our OWN account as a `category="peer"` device-sync
   * message (encrypted to our phone). The on-demand history sync uses this to ask
   * the phone for older messages. @returns the message id. */
  async sendPeerMessage(payload: WAMessage): Promise<string> {
    return await this.sender.sendPeerMessage(payload);
  }

  /** Acknowledges a notification/receipt stanza (`<ack class=… id=… to=…>`). */
  protected async sendAck(node: WANode): Promise<void> {
    if (!this.connection || !node.attrs.id || !node.attrs.from) {
      return;
    }
    let attrs: Record<string, string> = { id: node.attrs.id, to: node.attrs.from, class: node.tag };
    if (node.attrs.participant) {
      attrs.participant = node.attrs.participant;
    }
    if (node.attrs.recipient) {
      attrs.recipient = node.attrs.recipient;
    }
    if (node.attrs.type) {
      attrs.type = node.attrs.type;
    }
    await this.connection.sendNode(new WANode("ack", attrs));
  }

  /** The server's post-login bootstrap (`<ib>`): the count of offline messages
   * queued for us, and any "dirty" state (account_sync, groups, …) we must clean
   * for the server to consider us synced and keep delivering. */
  protected async onInitialBootstrap(node: WANode): Promise<void> {
    for (let dirty of node.children("dirty")) {
      await this.cleanDirty(dirty.attrs.type, dirty.attrs.timestamp);
    }
  }

  protected async cleanDirty(type: string, timestamp?: string): Promise<void> {
    if (!type || !this.connection) {
      return;
    }
    let clean = new WANode("clean", timestamp ? { type, timestamp } : { type });
    await this.connection.sendIQ(new WANode("iq",
      { to: kServerUser, type: "set", xmlns: "urn:xmpp:whatsapp:dirty" }, [clean]));
  }

  /** A group sender ships a SenderKeyDistributionMessage inside the messages it
   * sends us over our 1:1 session; storing it lets us decrypt that sender's
   * subsequent group (skmsg) messages. Without this, group messages never
   * decrypt. */
  protected processSenderKeyDistribution(payload: WAMessage, sender: JID): void {
    let skdm = payload.senderKeyDistributionMessage;
    if (!skdm?.groupID || !skdm.axolotlSenderKeyDistributionMessage || !this.signalStore) {
      return;
    }
    let address = `${sender.user}.${sender.device}`;
    this.signalStore.senderKeys.set(`${skdm.groupID}|${address}`,
      processDistributionMessage(skdm.axolotlSenderKeyDistributionMessage));
  }

  /** Whether a JID is one of our own identities (our phone number or our LID) — a
   * message `from` it was sent by us, from the phone or another linked device. */
  isOwnJID(jid: JID): boolean {
    return jid.user == this.deviceJID?.user || jid.user == this.ownLID?.user;
  }

  protected async receiveMessageStanza(node: WANode): Promise<void> {
    let from = node.jidAttr("from");
    let id = node.attrs.id;
    if (!from || !id) {
      return;
    }
    let sender = from.isGroup ? node.jidAttr("participant") ?? from : from;
    let payloadBytes = await this.decryptStanza(node, from, sender);
    if (!payloadBytes) {
      if (node.child("enc")) {
        // We had ciphertext but couldn't decrypt it (desynced/half-open session).
        // Ask the phone to re-send rather than silently lose the message.
        await this.sendRetryReceipt(node);
      }
      return;
    }
    this.scheduleSave(); // decrypting advanced the ratchet (and maybe consumed a prekey) — persist it
    let rawPayload = decodeWAMessage(payloadBytes);
    let payload = WhatsAppMessage.unwrap(rawPayload);
    // Any group sender-key distribution was already stored while decrypting (a
    // group message's pairwise enc carries it); decryptStanza handles that.
    let historyNotification = payload.protocolMessage?.historySyncNotification;
    if (historyNotification) {
      await this.historySync.handleNotification(historyNotification);
      await this.sendDeliveryReceipt(node);
      return;
    }
    let keyShare = payload.protocolMessage?.appStateSyncKeyShare;
    if (keyShare) {
      this.appState.storeKeys(keyShare);
      await this.sendDeliveryReceipt(node);
      return;
    }
    // `category="peer"` messages are device-to-device sync / protocol traffic
    // (app-state, key shares, the history-sync notifications above) that the
    // phone sends our own account — NOT a conversation. Don't make a chat room
    // for them (that produced a bogus room named after our own number).
    if (node.attrs.category == "peer") {
      await this.sendDeliveryReceipt(node);
      return;
    }
    // A message we sent from another device (e.g. the phone) is fanned out to us:
    // it arrives `from` one of our own identities (number or LID) with the chat in
    // `recipient`, or wrapped in a deviceSentMessage carrying `destinationJID`. It
    // belongs in the *recipient's* room and is outgoing — not from the partner.
    let deviceSent = rawPayload.deviceSentMessage;
    let outgoing = !!deviceSent || this.isOwnJID(from);
    let chat = from;
    if (outgoing) {
      let dest = deviceSent?.destinationJID ?? node.attrs.recipient;
      chat = dest ? JID.parse(dest) : from;
    }
    // In a group, `notify` is the sender's name, not the group subject.
    let room = await this.getOrCreateRoom(chat, chat.isGroup ? undefined : node.attrs.notify);
    await room.receiveMessage(node, rawPayload, sender, outgoing);
    waLog(outgoing ? ">> sent (from another device) into" : "<< message into", "room", room.id,
      "— now", room.messages.length, "messages");
    await this.sendDeliveryReceipt(node);
  }

  /** Acknowledges a delivered message, so the server marks it delivered and
   * stops resending it. */
  protected async sendDeliveryReceipt(node: WANode): Promise<void> {
    let from = node.attrs.from;
    let id = node.attrs.id;
    if (!from || !id || !this.connection) {
      return;
    }
    let attrs: Record<string, string> = { to: from, id };
    let participant = node.attrs.participant;
    if (participant) {
      attrs.participant = participant;
    }
    await this.connection.sendNode(new WANode("receipt", attrs));
  }

  /** Per-message retry counter, so we escalate (and eventually give up) instead
   * of asking the phone to re-send the same undecryptable message forever. */
  protected retryCounts = new Map<string, number>();

  /** Asks the phone to re-send a message we couldn't decrypt (`<receipt
   * type="retry">`), the standard WhatsApp recovery for a desynced Signal
   * session. (The `<keys>` escalation that ships a fresh prekey bundle on
   * repeated failures is not built yet.) */
  protected async sendRetryReceipt(node: WANode): Promise<void> {
    let from = node.attrs.from;
    let id = node.attrs.id;
    if (!from || !id || !this.connection || !this.signalStore) {
      return;
    }
    let count = (this.retryCounts.get(id) ?? 0) + 1;
    if (count > 5) {
      console.error(`WhatsApp: giving up decrypting message ${id} from ${from} after ${count - 1} retries`);
      return;
    }
    this.retryCounts.set(id, count);
    let attrs: Record<string, string> = { id, type: "retry", to: from };
    if (node.attrs.participant) {
      attrs.participant = node.attrs.participant;
    }
    let retry = new WANode("retry", { count: String(count), id, t: node.attrs.t ?? "0", v: "1" });
    let registration = new WANode("registration", {}, bigEndian(this.signalStore.registrationID, 4));
    await this.connection.sendNode(new WANode("receipt", attrs, [retry, registration]));
  }

  /** Decrypts a message stanza's `<enc>` content. A group message can carry BOTH
   * a pairwise `<enc>` (pkmsg/msg) distributing the sender's group key AND the
   * `<enc type="skmsg">` with the actual content — so we decrypt the pairwise one
   * FIRST (storing the sender key, see {@link processSenderKeyDistribution}), then
   * the skmsg, whose plaintext is the real group message. A 1:1 message has only
   * the pairwise enc, which is itself the content. Returns the content plaintext
   * (the skmsg's for a group, else the pairwise one), or null if nothing decrypts. */
  protected async decryptStanza(node: WANode, chat: JID, sender: JID): Promise<Uint8Array | null> {
    let address = `${sender.user}.${sender.device}`;
    let pairwiseContent: Uint8Array | null = null;
    // Pass 1: pairwise encs — 1:1 content, or a group sender-key distribution that
    // must be stored before the skmsg below can decrypt.
    for (let enc of node.children("enc")) {
      let bytes = enc.contentBytes;
      let type = enc.attrs.type;
      if (!bytes || (type != "pkmsg" && type != "msg")) {
        continue;
      }
      try {
        let payload = type == "pkmsg"
          ? await decryptPreKeyMessage(this.signalStore!, address, bytes)
          : await decryptSignalMessage(this.signalStore!, address, bytes);
        this.processSenderKeyDistribution(WhatsAppMessage.unwrap(decodeWAMessage(payload)), sender);
        pairwiseContent ??= payload;
      } catch (ex) {
        waLog("decrypt", type, "failed:", (ex as any)?.message ?? ex);
      }
    }
    // Pass 2: the group ciphertext — the actual group message content.
    for (let enc of node.children("enc")) {
      let bytes = enc.contentBytes;
      if (!bytes || enc.attrs.type != "skmsg") {
        continue;
      }
      let senderKey = this.signalStore!.senderKeys.get(`${chat.toString()}|${address}`);
      if (!senderKey) {
        waLog("decrypt skmsg: no sender key yet for", `${chat.toString()}|${address}`);
        continue;
      }
      try {
        return await groupDecrypt(senderKey, bytes);
      } catch (ex) {
        waLog("decrypt skmsg failed:", (ex as any)?.message ?? ex);
      }
    }
    return pairwiseContent;
  }

  protected roomForChat(jid: JID): WhatsAppChatRoom | undefined {
    let id = jid.toNonDevice().toString();
    return this.rooms.contents.find(room => room.id == id) as WhatsAppChatRoom | undefined;
  }

  /** Returns the room for this chat, creating it (and its contact) on first
   * sight of a message from it. This is how the chat list fills in live, until
   * a full roster / history sync is wired. */
  async getOrCreateRoom(chat: JID, nameHint?: string): Promise<WhatsAppChatRoom> {
    let room = this.roomForChat(chat);
    if (room) {
      return room;
    }
    let contact = chat.isGroup
      ? await this.getOrCreateGroup(chat, nameHint)
      : this.getContact(chat, nameHint);
    room = this.roomForChat(chat); // re-check: a concurrent message may have created it
    if (room) {
      return room;
    }
    room = this.newRoom(chat.isGroup);
    room.id = chat.toNonDevice().toString();
    room.contact = contact;
    if (chat.isGroup) {
      room.name = contact.name;
    } else if (contact instanceof ChatPersonUID && !this.roster.includes(contact)) {
      this.roster.add(contact);
    }
    this.rooms.set(contact, room);
    await room.save();
    if (room instanceof WhatsAppGroupChatRoom && this.connection) {
      // Fetch the real subject/members in the background (like getContact does for
      // a 1:1 profile), so a group first seen live shows its name, not a placeholder.
      room.ensureMetadata()
        .then(() => room.save())
        .catch(ex => console.error("WhatsApp: fetching group metadata failed:", ex));
    }
    return room;
  }

  /** Finds the contact for a WhatsApp JID, or creates one in the personal
   * address book. Matches the importer's keys (WhatsApp ID, then phone number)
   * so live and imported chats share the same contacts.
   * @param pushName the sender's display name from the stanza, if known */
  protected newPersonUID(userID: string, name?: string): WhatsAppContact {
    return new WhatsAppContact(JID.parse(userID), name);
  }

  /** Contact display names from history sync, keyed by non-device JID — saved
   * address-book names (`inlineContacts`) and self-set push names (`pushnames`).
   * Used to name a 1:1 contact when nothing better (a verified name) is known. */
  readonly contactNames = new Map<string, string>();

  /** Records a contact's display name (from history sync) and applies it right away
   * to the contact if we already created one (from an earlier sync blob or a live
   * message). A verified business name, when we have it, still outranks it.
   * Called for both saved (inlineContacts) and push (pushnames) names; the caller
   * applies saved names after push names, so the saved one wins. */
  rememberContactName(jid: string | undefined, name: string | undefined): void {
    let id = sanitize.nonemptystring(jid, null);
    let displayName = sanitize.nonemptylabel(name, null);
    if (!id || !displayName) {
      return;
    }
    let address = JID.parse(id).toNonDevice().toString();
    this.contactNames.set(address, displayName);
    let contact = this.allPersonsCached.get(address)?.deref() as WhatsAppContact | undefined;
    if (contact && !contact.verifiedName) {
      contact.name = displayName;
    }
  }

  /** The ChatPersonUID for a WhatsApp JID
   * Fetches the profile (avatar, status, verified name) in the background.
   * @param name the sender's display name from the stanza, if known */
  getContact(jid: JID, name?: string): WhatsAppContact {
    let address = jid.toNonDevice().toString();
    name ??= this.contactNames.get(address); // the contact's display name, from history sync
    let isNew = !this.allPersonsCached.get(address)?.deref();
    let contact = this.getPersonUID(address, name) as WhatsAppContact;
    if (name && !contact.verifiedName && contact.name != name) {
      contact.name = name;
    }
    if (isNew && this.connection && !jid.isGroup) {
      // Fetch avatar, status, verified name.
      // Only on first sight of this contact, not on restart, otherwise we'd floor on startup.
      // We only refetch the avatar on a `picture` notification.
      contact.fetch(this.connection)
        .catch(ex => console.error(ex));
    }
    return contact;
  }

  /** Re-fetches one contact's avatar after a `picture` notification — they
   * changed or removed it — replacing whatever we had. */
  protected async refetchPicture(jid: JID | undefined): Promise<void> {
    if (!jid || !this.connection || jid.isGroup) {
      return;
    }
    let contact = this.allPersonsCached.get(jid.toNonDevice().toString())?.deref() as WhatsAppContact | undefined;
    if (!contact) {
      return; // a picture change for someone we have no chat with
    }
    await contact.fetchPicture(this.connection);
  }

  /** The chat identity for the account owner — keyed by our own JID — used to
   * attribute the messages we sent (from the phone or another device). */
  async getOwnContact(): Promise<WhatsAppContact> {
    let jid = this.deviceJID ?? this.ownLID;
    return this.ownContact ??= this.getContact(jid.toNonDevice(), appGlobal.me?.name);
  }

  /** Creates the address-book Group for a live group chat, with a placeholder
   * name. The real subject/description/members are fetched and applied by the
   * {@link WhatsAppGroupChatRoom} (see getOrCreateRoom), so a group first seen
   * live no longer shows the literal "WhatsApp group". */
  protected async getOrCreateGroup(jid: JID, subject?: string): Promise<Group> {
    let group = appGlobal.personalAddressbook.newGroup();
    group.name = subject || gt`WhatsApp group`;
    appGlobal.personalAddressbook.groups.add(group);
    await group.save();
    return group;
  }

  /** The group chat room for a group JID, if we have one — the holder of that
   * group's metadata (addressing mode + participants), which {@link WhatsAppSender}
   * needs to send. */
  groupRoomFor(jid: JID): WhatsAppGroupChatRoom | undefined {
    let room = this.roomForChat(jid);
    return room instanceof WhatsAppGroupChatRoom ? room : undefined;
  }

  /** Routes a `w:gp2` group-change notification to its room, which patches its
   * metadata and the Group in place. */
  protected async onGroupNotification(node: WANode): Promise<void> {
    let group = node.jidAttr("from");
    if (!group) {
      return;
    }
    let room = await this.getOrCreateRoom(group);
    if (room instanceof WhatsAppGroupChatRoom) {
      await room.handleNotification(node);
    }
  }

  /** Creates (or reuses) the dependent Meet account that handles WhatsApp calls. */
  protected setupMeetAccount() {
    this.meetAccount ??= appGlobal.meetAccounts.find(
      acc => acc instanceof WhatsAppMeetAccount && acc.mainAccount == this) as WhatsAppMeetAccount;
    if (this.meetAccount) {
      return;
    }
    this.meetAccount = new WhatsAppMeetAccount();
    this.meetAccount.mainAccount = this; // chatAccount derives from this
    this.meetAccount.name = this.name;
    appGlobal.meetAccounts.add(this.meetAccount);
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    let wa = json.whatsapp;
    if (wa?.noiseKey && wa?.deviceJID && wa?.signalStore) {
      this.noiseKey = KeyPair.fromPrivate(base64Decode(wa.noiseKey));
      this.advSecret = wa.advSecret ? base64Decode(wa.advSecret) : null;
      this.deviceIdentityBytes = wa.deviceIdentity ? base64Decode(wa.deviceIdentity) : null;
      this.deviceJID = JID.parse(wa.deviceJID);
      this.signalStore = SignalStore.fromJSON(wa.signalStore);
      this.appState.fromJSON(wa.appState);
    }
  }

  toConfigJSON(): any {
    let json = super.toConfigJSON();
    if (this.noiseKey && this.signalStore && this.deviceJID && this.advSecret) {
      // The durable pairing credentials (enough to log in again without
      // re-scanning) plus the live Signal session/sender-key ratchet state
      // (so we resume decrypting after a restart). {@link scheduleSave} re-writes
      // this as the ratchet advances.
      json.whatsapp = {
        noiseKey: base64Encode(this.noiseKey.privateKey),
        advSecret: base64Encode(this.advSecret),
        deviceIdentity: this.deviceIdentityBytes ? base64Encode(this.deviceIdentityBytes) : undefined,
        deviceJID: this.deviceJID.toString(),
        signalStore: this.signalStore.toJSON(),
        appState: this.appState.toJSON(),
      };
    }
    return json;
  }
}

/** How often to ping the server to keep the connection alive. */
const kKeepAliveMs = 25 * 1000;

/** Reconnect backoff after a dropped connection: first retry delay, and the cap. */
const kReconnectBaseMs = 1000;
const kReconnectMaxMs = 30 * 1000;

/** Debounce before persisting Signal ratchet state after a message changes it. */
const kSessionSaveMs = 5 * 1000;

/** How many recently-sent payloads to keep for re-sending on a retry receipt. */
const kRecentSendsMax = 200;

export class WhatsAppSetup {
  /** The 64-digit hexadecimal backup encryption key */
  decryptKeyAsHex: string | null = null;
  /** msgstore.db.crypt15: the encrypted messages */
  msgStore: File | null = null;
  /** wa.db.crypt15: the encrypted contact names */
  waDB: File | null = null;
}
