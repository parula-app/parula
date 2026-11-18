/** Outbound WhatsApp messages — the encrypt-and-send half of the live protocol.
 *
 * Sending is per *device*: a contact (and we) have several linked devices, each
 * with its own Signal session, so one message fans out to many `<enc>` blobs.
 * The steps are:
 *
 *  1. Resolve the recipient's device list (usync) plus our own other devices, so
 *     a message we send also shows up on our phone.
 *  2. For every device we have no session with, fetch its prekey bundle
 *     (`<iq xmlns=encrypt type=get>`) and run X3DH (initiateSession) — the first
 *     message to a device is therefore a `pkmsg`, later ones a `msg`. A device
 *     whose one-time prekeys the server has run out of still establishes (X3DH
 *     without the one-time key).
 *  3. Encrypt the serialized `Message` protobuf once per device and assemble the
 *     `<message><participants><to jid=…><enc>…` stanza, attaching our signed
 *     `<device-identity>` whenever any `<enc>` is a `pkmsg` (the recipient needs
 *     it to trust the new session).
 *
 * The crypto and wire codecs this drives are unit-tested; this class is the
 * orchestration (mirrors WhatsAppHistorySync — a helper the account owns). It
 * reaches the connection, identity and persistence only through the small
 * surface WhatsAppAccount exposes. */
import type { WhatsAppAccount } from "./WhatsAppAccount";
import { JID, kServerUser, kServerLid } from "./Binary/JID";
import { WANode } from "./Binary/WANode";
import { PreKeyBundle } from "../Signal/Crypto/Identity";
import { initiateSession, encrypt, type EncryptedSignalMessage } from "../Signal/Crypto/SessionCipher";
import { createSenderKey, createDistributionMessage, groupEncrypt } from "../Signal/Crypto/GroupCipher";
import { sha256, base64Encode } from "../Signal/Crypto/primitives";
import { encodeWAMessage, ProtocolMessageType, type WAMessage } from "./Proto/schema";
import { uploadMedia, buildMediaMessage, mediaTypeForMIME } from "./WhatsAppMedia";
import type { Attachment } from "../../Abstract/Attachment";
import { waLog, nodeTree } from "./util";
import { assert } from "../../util/util";

/** Builds, encrypts and sends outgoing messages for one WhatsApp account. */
export class WhatsAppSender {
  protected account: WhatsAppAccount;
  /** Per-message resend counter for retry receipts, so a device that keeps
   * failing doesn't loop forever. Keyed by `${messageID}|${deviceAddress}`. */
  protected retrySends = new Map<string, number>();

  constructor(account: WhatsAppAccount) {
    this.account = account;
  }

  /** Sends a plain-text message to a chat and returns the new message id, which
   * the caller stores on the local message so receipts can match it. */
  async sendText(chat: JID, text: string): Promise<string> {
    return await this.sendMessage(chat, { conversation: text });
  }

  /** Encrypts a file, uploads it to the media CDN, and sends it as a media message
   * (image/video/audio/document, chosen by its MIME type). A `caption` rides on the
   * media message, since WhatsApp has no combined text + media. Returns the message
   * id, like {@link sendText}. */
  async sendMedia(chat: JID, attachment: Attachment, caption?: string): Promise<string> {
    let connection = this.account.connection;
    if (!connection) {
      throw new Error("WhatsApp: not connected");
    }
    assert(attachment.content, `WhatsApp: attachment "${attachment.filename}" has no content to send`);
    let bytes = new Uint8Array(await attachment.content.arrayBuffer());
    let type = mediaTypeForMIME(attachment.mimeType);
    let upload = await uploadMedia(connection, bytes, type);
    // No thumbnail/dimensions are produced yet — see MediaMeta; the wire fields and
    // builder are in place for when a generator is added.
    let payload = buildMediaMessage(type, attachment.mimeType, attachment.filename, upload, caption);
    return await this.sendMessage(chat, payload);
  }

  /** Encrypts `payload` for every device of the chat partner (and our own other
   * devices) and sends it, returning the message id. The 1:1 path; group sending
   * (sender keys) is a separate, not-yet-wired flow. */
  async sendMessage(chat: JID, payload: WAMessage): Promise<string> {
    let connection = this.account.connection;
    let store = this.account.signalStore;
    if (!connection || !store) {
      throw new Error("WhatsApp: not connected");
    }
    if (chat.isGroup) {
      return await this.sendGroupMessage(chat, payload);
    }
    let messageID = WhatsAppSender.generateMessageID();
    let plaintext = encodeWAMessage(payload);
    // Our own devices receive the message wrapped in a deviceSentMessage, so the
    // phone files it under the right chat and shows it as sent by us.
    let ownPlaintext = encodeWAMessage({
      deviceSentMessage: { destinationJID: chat.toNonDevice().toString(), message: payload },
    });

    let devices = await this.recipientDevices(chat);
    waLog("send: devices for", chat.toNonDevice().toString(), "=", devices.map(device => device.toString()).join(", ") || "(none)");
    await this.establishSessions(devices);

    let encNodes: WANode[] = [];
    let anyPreKey = false;
    let recipientReached = false;
    for (let device of devices) {
      let address = this.addressFor(device);
      let own = this.account.isOwnJID(device);
      if (!store.sessions.has(address)) {
        waLog("send:   SKIP", device.toString(), own ? "(own)" : "(recipient)", "— no session");
        continue; // no session could be built for this device — skip it, not the whole send
      }
      let encrypted = await encrypt(store, address, own ? ownPlaintext : plaintext);
      anyPreKey ||= encrypted.type == "pkmsg";
      recipientReached ||= !own;
      waLog("send:   ->", device.toString(), own ? "(own)" : "(recipient)", encrypted.type);
      encNodes.push(this.participantNode(device, encrypted));
    }
    if (!recipientReached) {
      assert(recipientReached, "WhatsApp: message reached NO recipient device — it won't be delivered to " + chat.toNonDevice().toString());
    }
    if (encNodes.length) {
      this.account.scheduleSave(); // we advanced/created sessions
    }
    this.account.rememberSent(chat, messageID, payload, [chat]); // so a retry receipt can re-send
    let node = this.messageStanza(messageID, chat.toNonDevice(), encNodes, anyPreKey);
    this.applyEditAttribute(node, payload);
    await connection.sendNode(node);
    return messageID;
  }

  /** Sends `payload` to a group via Signal Sender Keys: one group-encrypted
   * `skmsg` for everyone, plus a per-recipient-device SenderKeyDistributionMessage
   * (SKDM) over each pairwise session so they can decrypt it. The group's
   * addressing mode (lid/pn) — from its metadata, NOT the chat server — governs
   * our own sender identity and the wire `addressing_mode`. Returns the message id. */
  async sendGroupMessage(chat: JID, payload: WAMessage): Promise<string> {
    let connection = this.account.connection;
    let store = this.account.signalStore;
    if (!connection || !store) {
      throw new Error("WhatsApp: not connected");
    }
    let room = this.account.groupRoomFor(chat);
    if (!room) {
      throw new Error("WhatsApp: no group room to send to " + chat.toString());
    }
    await room.ensureMetadata();
    let mode = room.addressingMode;
    let ownIdentity = this.ownGroupIdentity(mode);
    if (!ownIdentity) {
      throw new Error("WhatsApp: no own identity for group send");
    }
    waLog("group send: chat", chat.toString(), "mode", mode, "own", ownIdentity.toString());

    // Participants are already in the group's namespace (lid in lid mode). We're a
    // member, so our own devices come back from usync — no separate self-add.
    let participantBaseJIDs = room.participants.map(p => p.jid.toNonDevice());
    // The phash the server validates is over EVERY participant device INCLUDING
    // our own sending device (verified live); but we never encrypt to ourselves.
    let hashDevices = (await this.fetchDeviceList(participantBaseJIDs)).filter(device => device.device != 99);
    let devices = hashDevices.filter(device => !this.isThisDevice(device));
    waLog("group send: devices", devices.map(device => device.toString()).join(", ") || "(none)");

    // Our own sender-key state for the group. Keyed to match the decrypt-side
    // lookup `${group}|${user}.${device}`, so our other devices (and we after a
    // restart) can decrypt our own skmsg (spec 01 §g, 03 §4b).
    let ownStoreKey = `${chat.toNonDevice().toString()}|${ownIdentity.user}.${this.account.deviceJID!.device}`;
    let ourState = store.senderKeys.get(ownStoreKey);
    if (!ourState) {
      ourState = createSenderKey(generateSenderKeyID());
      store.senderKeys.set(ownStoreKey, ourState);
    }

    // The SKDM rides inside a Message proto, encrypted per device over its 1:1 session.
    let skdmPlaintext = encodeWAMessage({
      senderKeyDistributionMessage: {
        groupID: chat.toNonDevice().toString(),
        axolotlSenderKeyDistributionMessage: createDistributionMessage(ourState),
      },
    });
    await this.establishSessions(devices);
    let encNodes: WANode[] = [];
    let anyPreKey = false;
    let preKeyDevices: string[] = [];
    let msgDevices: string[] = [];
    for (let device of devices) {
      let address = this.addressFor(device);
      if (!store.sessions.has(address)) {
        waLog("group send:   SKIP", device.toString(), "— no session");
        continue;
      }
      let encrypted = await encrypt(store, address, skdmPlaintext);
      anyPreKey ||= encrypted.type == "pkmsg";
      (encrypted.type == "pkmsg" ? preKeyDevices : msgDevices).push(device.toString());
      encNodes.push(this.participantNode(device, encrypted));
    }
    waLog("group send: SKDM pkmsg ->", preKeyDevices.join(", ") || "(none)",
      "| msg ->", msgDevices.join(", ") || "(none)");

    let skmsg = await groupEncrypt(ourState, encodeWAMessage(payload));
    this.account.scheduleSave(); // the group ratchet advanced
    waLog("group send: skmsg", skmsg.length, "bytes");

    let phash = participantListHashV2(hashDevices);
    let stanza = this.groupMessageStanza(WhatsAppSender.generateMessageID(), chat.toNonDevice(),
      messageType(payload), mode, phash, encNodes, anyPreKey, skmsg);
    let messageID = stanza.attrs.id;
    this.account.rememberSent(chat, messageID, payload, participantBaseJIDs);
    this.account.rememberGroupPhash(messageID, chat.toNonDevice().toString(), phash);
    this.applyEditAttribute(stanza, payload);
    await connection.sendNode(stanza);
    return messageID;
  }

  /** Our own identity in a group's addressing namespace: our LID in lid mode,
   * else our phone number. (Unlike ownIdentityFor, which keys off the chat server
   * — a group's server is always g.us, so the mode comes from its metadata.) */
  protected ownGroupIdentity(mode: "lid" | "pn"): JID | null {
    let pn = this.account.deviceJID;
    let lid = this.account.ownLID;
    return mode == "lid" ? (lid ?? pn) : (pn ?? lid);
  }

  /** Clears any per-group sender-key distribution memory after a membership change
   * so the next send re-distributes. We re-distribute the sender key to every
   * current device on each send, so there's no per-device memory to clear — a stub
   * for the account's remove-handler to call. */
  resetGroupSenderKey(_group: JID): void {
  }

  /** Sends an encrypted message to our OWN account (a device-to-device "peer"
   * message): a single `<enc>` to our phone (device 0), addressed to our own JID
   * with `category="peer"`. The on-demand history-sync request reuses this. */
  async sendPeerMessage(payload: WAMessage): Promise<string> {
    let connection = this.account.connection;
    let store = this.account.signalStore;
    let self = this.account.deviceJID;
    if (!connection || !store || !self) {
      throw new Error("WhatsApp: not connected");
    }
    let phone = new JID(self.user, self.server, 0); // our phone is device 0
    await this.establishSessions([phone]);
    let address = this.addressFor(phone);
    if (!store.sessions.has(address)) {
      throw new Error("WhatsApp: cannot establish a session to our own phone");
    }
    let messageID = WhatsAppSender.generateMessageID();
    let encrypted = await encrypt(store, address, encodeWAMessage(payload));
    this.account.scheduleSave();
    let stanza = new WANode("message",
      { id: messageID, type: "text", category: "peer", to: self.toNonDevice().toString() },
      [new WANode("enc", { v: "2", type: encrypted.type }, encrypted.body)]);
    if (encrypted.type == "pkmsg") {
      this.attachDeviceIdentity(stanza);
    }
    await connection.sendNode(stanza);
    return messageID;
  }

  /** Handles an incoming `<receipt type="retry">` for a message WE sent: the peer
   * device couldn't decrypt it, and ships its current registration and (on a real
   * desync) a fresh prekey bundle inside `<keys>`. We drop the stale session,
   * re-establish from those keys (or refetch), and re-send to just that device,
   * if it belongs to a recipient or to us. The original `sent` message comes from
   * the account's recent-sends cache. Capped so a permanently-broken device can't loop. */
  async handleRetryReceipt(node: WANode, sent: { payload: WAMessage, recipients: string[] } | undefined): Promise<void> {
    let connection = this.account.connection;
    let store = this.account.signalStore;
    if (!connection || !store || !sent) {
      return;
    }
    let messageID = node.attrs.id;
    let from = node.jidAttr("from");
    if (!messageID || !from) {
      return;
    }
    // The failing device is the `participant` (multi-device fan-out) or `from`.
    let device = node.jidAttr("participant") ?? from;
    let own = this.account.isOwnJID(device);
    // Anybody else, e.g. the server, could read the message by attaching its own keys
    if (!own && !sent.recipients.includes(device.toNonDevice().toString())) {
      console.error(`WhatsApp: ignoring a retry receipt for ${messageID} from ${device.toString()}, who was not a recipient`);
      return;
    }
    let address = this.addressFor(device);
    let key = `${messageID}|${address}`;
    let count = (this.retrySends.get(key) ?? 0) + 1;
    if (count > kMaxRetrySends) {
      console.error(`WhatsApp: giving up resending ${messageID} to ${device.toString()} after ${count - 1} retries`);
      return;
    }
    this.retrySends.set(key, count);

    // Drop the stale session and re-establish: prefer the bundle the peer
    // attached to the retry, else fetch a fresh one.
    store.sessions.delete(address);
    let attached = this.parseRetryBundle(node);
    if (attached) {
      initiateSession(store, address, attached);
    } else {
      await this.establishSessions([device]);
    }
    if (!store.sessions.has(address)) {
      console.error(`WhatsApp: cannot re-establish a session to ${device.toString()} for retry`);
      return;
    }
    let plaintext = own
      ? encodeWAMessage({ deviceSentMessage: { destinationJID: from.toNonDevice().toString(), message: sent.payload } })
      : encodeWAMessage(sent.payload);
    let encrypted = await encrypt(store, address, plaintext);
    this.account.scheduleSave();
    let stanza = this.messageStanza(messageID, from.toNonDevice(), [this.participantNode(device, encrypted)], encrypted.type == "pkmsg");
    this.applyEditAttribute(stanza, sent.payload);
    await connection.sendNode(stanza);
  }

  // --- device discovery ---

  /** All the devices a 1:1 message must reach: every device of the chat partner,
   * plus our own other devices (so our phone shows the sent message), minus the
   * device we are right now.
   *
   * The whole message must use ONE addressing namespace: a `@lid` chat is queried
   * (and later addressed/encrypted) with our own LID, a phone-number chat with our
   * own number. Mixing the two in one message — e.g. our PN devices in a LID chat —
   * is rejected by the server (`<ack error="400">`). We should switch to
   * the LID identity when the recipient is on the hidden-user (LID) server. */
  protected async recipientDevices(chat: JID): Promise<JID[]> {
    let own = this.ownIdentityFor(chat);
    let queryJIDs = [chat.toNonDevice()];
    if (own) {
      queryJIDs.push(own.toNonDevice());
    }
    let devices = await this.fetchDeviceList(queryJIDs);
    return devices.filter(device => !this.isThisDevice(device));
  }

  /** Our own account JID in the same namespace as `chat`: our LID for a `@lid`
   * chat, otherwise our phone number. Falls back to whichever identity we have. */
  protected ownIdentityFor(chat: JID): JID | null {
    let pn = this.account.deviceJID;
    let lid = this.account.ownLID;
    return chat.server == kServerLid ? (lid ?? pn) : (pn ?? lid);
  }

  /** Whether a device JID is the very device we are running as (we never encrypt
   * a message to ourselves). Matches our own device by either namespace, since the
   * device index (e.g. `:8`) is shared between our phone number and our LID. */
  protected isThisDevice(device: JID): boolean {
    let self = this.account.deviceJID;
    if (!self) {
      return false;
    }
    let ownUser = device.user == self.user || device.user == this.account.ownLID?.user;
    return ownUser && device.device == self.device;
  }

  /** Sends the usync device-list query and parses the result. A `usync` IQ with a
   * `<devices>` query. Falls back to the bare users (device 0) if the server
   * returns no device list. */
  protected async fetchDeviceList(jids: JID[]): Promise<JID[]> {
    let connection = this.account.connection!;
    let response = await connection.sendIQ(this.deviceListIQ(jids));
    waLog("send: device-list response:\n" + nodeTree(response));
    let devices = this.parseDeviceList(response);
    if (!devices.length) {
      waLog("send: parsed NO devices from the usync response — falling back to bare device 0");
    }
    return devices.length ? devices : jids.map(jid => jid.toNonDevice());
  }

  /** The usync `<devices>` query IQ for the given users. */
  deviceListIQ(jids: JID[]): WANode {
    let users = jids.map(jid => new WANode("user", { jid: jid.toNonDevice().toString() }));
    return new WANode("iq", { to: kServerUser, type: "get", xmlns: "usync" }, [
      new WANode("usync", { sid: usyncSessionID(), mode: "query", last: "true", index: "0", context: "message" }, [
        new WANode("query", {}, [new WANode("devices", { version: "2" })]),
        new WANode("list", {}, users),
      ]),
    ]);
  }

  /** Parses a usync `<devices>` response into one JID per device. Reads the
   * modern `<device-list><device id=N>` shape; tolerates a flat
   * `<devices><device/>` too. The server omits absent devices, so a
   * single-device contact yields just one. Public so it can be unit-tested. */
  parseDeviceList(response: WANode): JID[] {
    let result: JID[] = [];
    // The server nests the list as <usync><result><devices><list>, not directly
    // under <usync>; tolerate the flatter shape too just in case.
    let list = response.child("usync")?.child("result")?.child("devices")?.child("list")
      ?? response.child("usync")?.child("list");
    for (let user of list?.children("user") ?? []) {
      let jid = user.attrs.jid;
      if (!jid) {
        continue;
      }
      let base = JID.parse(jid).toNonDevice();
      let deviceNodes = user.child("devices")?.child("device-list")?.children("device")
        ?? user.child("devices")?.children("device")
        ?? [];
      if (deviceNodes.length == 0) {
        result.push(base); // no list — the main device (0)
        continue;
      }
      for (let device of deviceNodes) {
        result.push(new JID(base.user, base.server, parseInt(device.attrs.id ?? "0", 10) || 0));
      }
    }
    return result;
  }

  // --- session establishment ---

  /** Ensures we have a Signal session for each device, fetching prekey bundles
   * and running X3DH for the ones we don't. An existing session is reused (we do
   * NOT re-initiate mid-conversation). A device whose bundle the server can't
   * supply is skipped — the caller drops it rather than failing the whole send. */
  protected async establishSessions(devices: JID[]): Promise<void> {
    let store = this.account.signalStore!;
    let missing = devices.filter(device => !store.sessions.has(this.addressFor(device)));
    if (missing.length == 0) {
      return;
    }
    let bundles = await this.fetchPreKeyBundles(missing);
    for (let device of missing) {
      let bundle = bundles.get(this.addressFor(device));
      if (!bundle) {
        console.error(`WhatsApp: no prekey bundle for ${device.toString()} — skipping that device`);
        continue;
      }
      try {
        initiateSession(store, this.addressFor(device), bundle);
      } catch (ex) {
        console.error(`WhatsApp: cannot start a session with ${device.toString()}:`, ex);
      }
    }
  }

  /** Sends one `<iq xmlns=encrypt type=get>` for the given devices and parses the
   * bundles, keyed by device address. */
  protected async fetchPreKeyBundles(devices: JID[]): Promise<Map<string, PreKeyBundle | undefined>> {
    let connection = this.account.connection!;
    let response = await connection.sendIQ(this.preKeyBundleIQ(devices));
    waLog("send: prekey response:\n" + nodeTree(response));
    return this.parsePreKeyBundles(response);
  }

  /** The prekey-fetch IQ for the given devices (`<iq xmlns=encrypt type=get>`
   * with a `<key>` of `<user jid=…>`s). */
  preKeyBundleIQ(devices: JID[]): WANode {
    let users = devices.map(device => new WANode("user", { jid: device.toString(), reason: "identity" }));
    return new WANode("iq", { to: kServerUser, type: "get", xmlns: "encrypt" }, [
      new WANode("key", {}, users),
    ]);
  }

  /** Parses a `<iq xmlns=encrypt>` prekey response into a bundle per device,
   * keyed by store address. A `<user type="error">` (server out of that user's
   * keys, or unknown user) maps to undefined. The one-time `<key>` is optional.
   * Public so it can be unit-tested. */
  parsePreKeyBundles(response: WANode): Map<string, PreKeyBundle | undefined> {
    let result = new Map<string, PreKeyBundle | undefined>();
    let list = response.child("list");
    for (let user of list?.children("user") ?? []) {
      let jid = user.attrs.jid;
      if (!jid) {
        continue;
      }
      let address = this.addressFor(JID.parse(jid));
      if (user.attrs.type == "error" || user.child("error")) {
        waLog("send:   prekey", jid, "ERROR — server has no keys for this device");
        result.set(address, undefined);
      } else {
        let bundle = this.bundleFromNode(user) ?? undefined;
        waLog("send:   prekey", jid, bundle ? "OK" : "UNPARSEABLE");
        result.set(address, bundle);
      }
    }
    return result;
  }

  /** Reads the prekey bundle a peer attaches to a `<receipt type=retry>` when its
   * session is broken: the same shape as a fetched
   * `<user>`, under `<keys>`. Null if the receipt carries no fresh keys. */
  parseRetryBundle(node: WANode): PreKeyBundle | null {
    let keys = node.child("keys");
    return keys ? this.bundleFromNode(keys) : null;
  }

  /** Builds a {@link PreKeyBundle} from a `<user>` (or `<keys>`) node:
   * `<registration>` (4B BE), `<identity>` (32B), `<skey>{id 3B,value 32B,
   * signature 64B}`, and the optional one-time `<key>{id 3B,value 32B}` — which
   * is absent when the server has run out of that user's one-time prekeys.
   * Returns null when a required field is missing. */
  protected bundleFromNode(node: WANode): PreKeyBundle | null {
    let identity = node.child("identity")?.contentBytes;
    let registration = node.child("registration")?.contentBytes;
    let skey = node.child("skey");
    let skeyValue = skey?.child("value")?.contentBytes;
    let skeySignature = skey?.child("signature")?.contentBytes;
    if (!identity || !registration || !skeyValue || !skeySignature) {
      return null;
    }
    let bundle = new PreKeyBundle();
    bundle.registrationID = readBigEndian(registration);
    bundle.identityKey = identity;
    bundle.signedPreKeyID = readBigEndian(skey!.child("id")?.contentBytes ?? new Uint8Array());
    bundle.signedPreKeyPublic = skeyValue;
    bundle.signedPreKeySignature = skeySignature;
    let oneTime = node.child("key");
    let oneTimeValue = oneTime?.child("value")?.contentBytes;
    if (oneTime && oneTimeValue) {
      bundle.preKeyID = readBigEndian(oneTime.child("id")?.contentBytes ?? new Uint8Array());
      bundle.preKeyPublic = oneTimeValue;
    }
    return bundle;
  }

  // --- stanza assembly ---

  /** Tags an outgoing `<message>` so the peer (and our own other devices) apply it
   * to an *existing* message rather than show it as new: `edit="7"` sender revoke
   * or `"8"` admin revoke for a delete-for-everyone, `"1"` for an edit. Without it
   * the `protocolMessage` is ignored and nothing disappears or changes. */
  protected applyEditAttribute(node: WANode, payload: WAMessage): void {
    let key = payload.protocolMessage?.key;
    if (!key) {
      return;
    }
    if (payload.protocolMessage!.type == ProtocolMessageType.Revoke) {
      node.attrs.edit = key.fromMe ? "7" : "8";
    } else if (payload.protocolMessage!.type == ProtocolMessageType.MessageEdit) {
      node.attrs.edit = "1";
    } else {
      return;
    }
    // Each <enc> of an edit/revoke is flagged `decrypt-fail="hide"` (matching
    // WhatsApp Web / whatsmeow), so a device that never saw the original doesn't
    // surface a decryption-error placeholder for the in-place change.
    for (let enc of encChildren(node)) {
      enc.attrs["decrypt-fail"] = "hide";
    }
    waLog("send: edit/revoke wire node (key.id=" + key.id + ", edit=" + node.attrs.edit + "):\n" + nodeTree(node));
  }

  /** The outgoing `<message>` envelope: the per-device `<enc>` nodes wrapped in
   * `<participants>`, with our `<device-identity>` attached when any enc is a
   * pkmsg (so the recipient can verify the freshly-built session). */
  protected messageStanza(messageID: string, chat: JID, encNodes: WANode[], withDeviceIdentity: boolean): WANode {
    let stanza = new WANode("message", { id: messageID, type: "text", to: chat.toString() },
      [new WANode("participants", {}, encNodes)]);
    if (withDeviceIdentity) {
      this.attachDeviceIdentity(stanza);
    }
    return stanza;
  }

  /** The outgoing group `<message>`: the per-device SKDM `<enc>`s in
   * `<participants>`, our `<device-identity>` when any SKDM was a pkmsg, then the
   * group ciphertext as `<enc type="skmsg">`. Child order is participants →
   * device-identity → skmsg. NO deviceSentMessage for groups. */
  protected groupMessageStanza(messageID: string, chat: JID, type: string, mode: "lid" | "pn",
    phash: string, encNodes: WANode[], withDeviceIdentity: boolean, skmsg: Uint8Array): WANode {
    let stanza = new WANode("message",
      { id: messageID, type, to: chat.toString(), addressing_mode: mode, phash },
      [new WANode("participants", {}, encNodes)]);
    if (withDeviceIdentity) {
      this.attachDeviceIdentity(stanza);
    }
    (stanza.content as WANode[]).push(new WANode("enc", { v: "2", type: "skmsg" }, skmsg));
    return stanza;
  }

  /** One `<to jid=…><enc v=2 type=…>…</enc></to>` participant node. */
  protected participantNode(device: JID, encrypted: EncryptedSignalMessage): WANode {
    return new WANode("to", { jid: device.toString() }, [
      new WANode("enc", { v: "2", type: encrypted.type }, encrypted.body),
    ]);
  }

  /** Appends our signed `<device-identity>` (the account-signed ADV identity from
   * pairing) to a stanza. The recipient needs it to trust a new (`pkmsg`)
   * session; omitted for a plain `msg` on an established session. */
  protected attachDeviceIdentity(stanza: WANode): void {
    let identity = this.account.deviceIdentityBytes;
    assert(identity, "WhatsApp: no device-identity for an outgoing prekey message — recipients will reject it; re-pair this device"); // Otherwise the recipient can't verify this companion device and drops our prekey
    if (Array.isArray(stanza.content)) {
      stanza.content.push(new WANode("device-identity", {}, identity));
    }
  }

  /** The per-device Signal store address, e.g. `49123.5`, matching how
   * decryptStanza and the store key sessions. */
  protected addressFor(device: JID): string {
    return `${device.user}.${device.device}`;
  }

  /** A WhatsApp message id: `"3EB0"` + uppercase random hex */
  static generateMessageID(): string {
    return "3EB0" + randomHex(8);
  }
}


/** All `<enc>` descendant nodes of a message stanza (the per-device ciphertexts
 * under `<participants><to>`, plus a group `<enc type=skmsg>`). */
function encChildren(node: WANode): WANode[] {
  let result: WANode[] = [];
  if (Array.isArray(node.content)) {
    for (let child of node.content) {
      if (child.tag == "enc") {
        result.push(child);
      }
      result.push(...encChildren(child));
    }
  }
  return result;
}

/** The `<message type>` attr from the payload: "media" for any media content,
 * else "text" (the only two we send). */
function messageType(payload: WAMessage): string {
  if (payload.imageMessage || payload.videoMessage || payload.audioMessage
    || payload.documentMessage || payload.stickerMessage) {
    return "media";
  }
  return "text";
}

/** The participant-list hash the server validates a group send against:
 * `"2:" + base64(sha256(sorted ADStrings joined "")[:6])`, standard alphabet, no
 * padding. ADString = `${user}.0:${device}@${server}` (raw agent 0). The hashed
 * set is EVERY participant device including our own sending device — verified
 * byte-exact against the live server's returned phash for two sends. */
function participantListHashV2(devices: JID[]): string {
  let adStrings = devices.map(device => `${device.user}.0:${device.device}@${device.server}`).sort();
  waLog("group send: phash over", adStrings.join(" | "));
  let digest = sha256(new TextEncoder().encode(adStrings.join("")));
  let base64 = base64Encode(digest.slice(0, 6)).replace(/=+$/, ""); // raw-std, no padding
  return "2:" + base64;
}

/** A random sender-key id (a small non-negative int, like Signal's keyhelper). */
function generateSenderKeyID(): number {
  let bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) & 0x7FFFFFFF;
}

/** A random session id for a usync query, as the client tags each batch with. */
function usyncSessionID(): string {
  return randomHex(8).toLowerCase();
}

/** `count` random bytes as uppercase hex. */
function randomHex(count: number): string {
  let bytes = new Uint8Array(count);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Decodes a big-endian unsigned integer (the inverse of util.ts bigEndian, used
 * for the registration and key ids the server sends in a prekey bundle). */
function readBigEndian(bytes: Uint8Array): number {
  let value = 0;
  for (let b of bytes) {
    value = value * 256 + b;
  }
  return value;
}

/** How many times we'll re-send one message to a device on retry receipts. */
const kMaxRetrySends = 5;
