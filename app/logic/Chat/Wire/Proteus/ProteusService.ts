/** The layer between the app and the Proteus ratchet: fan a message out to every
 * device of every participant, survive the backend's opinion about which devices
 * those are, and decrypt what comes back.
 *
 * The unit of encryption is a device, not a user, so a conversation of N users
 * costs one ciphertext per device of theirs plus one per other device of our
 * own. The backend knows the true device list and refuses the whole message
 * whenever ours is stale; `Protocol/09` §5.4 calls that the mismatch dance, and
 * it is handled here, exactly once per send. A second refusal is an error, as
 * in the reference client, which also does not loop.
 *
 * The payload is an encoded `GenericMessage` (`Proto/messages.ts`) — bytes here,
 * because that layer is shared verbatim with MLS and belongs to neither
 * transport. Session reset is split the same way as in the reference client:
 * this class does the local half (§7 steps 1-4), the caller sends the
 * `GenericMessage{clientAction: RESET_SESSION}` from `onSendSessionReset`. */
import { ProteusStore } from "./ProteusStore";
import { ProteusSession, ProteusErrorCode } from "./ProteusSession";
import { PreKeyBundle, kPreKeyTarget, kLastResortPreKeyID } from "./PreKeyBundle";
import { QualifiedNewOtrMessage, clientIDToNumber, userIDToBytes, type OtrPriority, type QualifiedUserEntry } from "./otr";
import { encode } from "../../Signal/Proto/codec";
import { base64Decode } from "../../Signal/Crypto/primitives";
import { retryOnTransientError } from "../../../util/netUtil";
import { sanitize } from "../../../../../lib/util/sanitizeDatatypes";
import type { WireAPI } from "../WireAPI";
import type { TWireQualifiedID, TWireQualifiedUserClients, TWireMessageSendingStatus, TWireEvent } from "../TWire";

export class ProteusService {
  readonly api: WireAPI;
  readonly store: ProteusStore;
  /** Our own user, its backend, and this device */
  readonly userID: string;
  readonly domain: string;
  readonly clientID: string;

  /** Asked before we send to devices the backend reported as missing, so the
   * user can refuse to send to a new, unverified device. Returning false aborts
   * the send. */
  onClientMismatch: ((status: TWireMessageSendingStatus) => Promise<boolean>) | null = null;
  /** A peer device's identity key changed. Un-verify it and warn the user. */
  onRemoteIdentityChanged: ((device: ProteusDevice) => void) | null = null;
  /** The ratchet moved: persist `store`. Called after every encrypt and decrypt. */
  onStoreChanged: (() => Promise<void>) | null = null;
  /** Tell the peer to drop its half of a session we just reset, by sending it
   * `GenericMessage{clientAction: RESET_SESSION}` and nothing else. */
  onSendSessionReset: ((device: ProteusDevice) => Promise<void>) | null = null;

  /** Sessions we already tried to repair. Prevents a peer we cannot read from
   * costing one reset per message; cleared as soon as one of its messages
   * decrypts. */
  private repaired = new Set<string>();

  constructor(api: WireAPI, store: ProteusStore, userID: string, domain: string, clientID: string) {
    this.api = api;
    this.store = store;
    this.userID = userID;
    this.domain = domain;
    this.clientID = clientID;
  }

  /** Sends to every device of `participants`, and to our own other devices.
   * @param plaintext an encoded `GenericMessage` */
  async send(conversationID: TWireQualifiedID, participants: TWireQualifiedID[], plaintext: Uint8Array, options: ProteusSendOptions = {}): Promise<ProteusSendResult> {
    let devices = await this.devicesOf(participants);
    return await this.sendToDevices(conversationID, devices, plaintext, { mismatch: "reportAll", ...options });
  }

  /** Sends to exactly these devices and no others. Used for anything targeted at
   * one device, e.g. a session reset, where a missing-device check would be
   * wrong rather than merely noisy. */
  async sendToDevices(conversationID: TWireQualifiedID, devices: ProteusDevice[], plaintext: Uint8Array, options: ProteusSendOptions = {}): Promise<ProteusSendResult> {
    let payload = await this.encryptTo(devices, plaintext);
    let status = await this.post(conversationID, payload, options);
    if (status.sent) {
      // `failed_to_send` can be set here: one federated backend was unreachable,
      // everybody else got it. That is not a mismatch, so we do not resend.
      return { canceled: false, status };
    }
    return await this.resendAfterMismatch(conversationID, payload, plaintext, status, options);
  }

  /** §5.4: drop the devices that no longer exist, encrypt for the ones we did
   * not know about, and send again. Once. */
  private async resendAfterMismatch(conversationID: TWireQualifiedID, payload: OtrPayload, plaintext: Uint8Array, status: TWireMessageSendingStatus, options: ProteusSendOptions): Promise<ProteusSendResult> {
    if (this.onClientMismatch && !await this.onClientMismatch(status)) {
      return { canceled: true, status };
    }
    for (let device of devicesInMap(status.deleted)) {
      payload.delete(device);
      this.store.deleteSession(device.sessionID);
    }
    let missing = devicesInMap(status.missing).filter(device => device.clientID != this.clientID);
    if (missing.length) {
      await this.encryptTo(missing, plaintext, payload);
    }
    // `redundant` needs no action: sending to a device too many is harmless.
    return { canceled: false, status: await this.post(conversationID, payload, options) };
  }

  /** Encrypts once per device, creating the sessions that do not exist yet.
   * @param payload merged into, for the mismatch resend */
  private async encryptTo(devices: ProteusDevice[], plaintext: Uint8Array, payload = new OtrPayload()): Promise<OtrPayload> {
    let unknown = devices.filter(device => !this.store.session(device.sessionID));
    if (unknown.length) {
      await this.createSessions(unknown);
    }
    for (let device of devices) {
      let session = this.store.session(device.sessionID);
      if (session) { // else the backend told us the device is gone
        payload.set(device, session.encrypt(plaintext));
      }
    }
    await this.onStoreChanged?.();
    return payload;
  }

  /** Claims one prekey per device and starts a session from it. A `null` prekey
   * means the device no longer exists, so any session we still had for it is
   * stale; users on an unreachable backend (`failed_to_list`) are simply left
   * out and tried again on the next send. */
  private async createSessions(devices: ProteusDevice[]) {
    let claimed = await retryOnTransientError(() => this.api.claimPrekeys(clientMapOf(devices)));
    let byDomain = claimed.qualified_user_client_prekeys;
    for (let domain of Object.keys(byDomain)) {
      for (let userID of Object.keys(byDomain[domain])) {
        for (let clientID of Object.keys(byDomain[domain][userID])) {
          let device = new ProteusDevice(domain, userID, clientID);
          let prekey = byDomain[domain][userID][clientID];
          if (!prekey) {
            this.store.deleteSession(device.sessionID);
            continue;
          }
          this.store.sessions.set(device.sessionID, ProteusSession.initiate(
            device.sessionID, this.store.identity, PreKeyBundle.fromBase64(prekey.key)));
        }
      }
    }
  }

  private async post(conversationID: TWireQualifiedID, payload: OtrPayload, options: ProteusSendOptions): Promise<TWireMessageSendingStatus> {
    let message: QualifiedNewOtrMessage = {
      sender: { client: clientIDToNumber(this.clientID) },
      recipients: payload.toRecipients(),
      nativePush: options.nativePush ?? true,
      transient: options.transient ?? false,
      nativePriority: options.priority,
    };
    // The backend rejects a message that names none of the four strategies.
    let users = (options.mismatchUsers ?? []).map(user => ({ id: user.id, domain: user.domain }));
    switch (options.mismatch ?? "ignoreAll") {
    case "reportAll": message.reportAll = {}; break;
    case "reportOnly": message.reportOnly = { userIDs: users }; break;
    case "ignoreOnly": message.ignoreOnly = { userIDs: users }; break;
    default: message.ignoreAll = {}; break;
    }
    // Deliberately not retried: the backend may already have accepted and
    // delivered the message, and a resend would show up twice for everybody.
    return await this.api.sendProteusMessage(conversationID, encode(QualifiedNewOtrMessage, message));
  }

  /** Every device of every participant, minus this one.
   * Our own other devices belong in the list: that is how they see what we sent. */
  private async devicesOf(participants: TWireQualifiedID[]): Promise<ProteusDevice[]> {
    let byDomain = await retryOnTransientError(() => this.api.listUserClients(participants));
    let devices: ProteusDevice[] = [];
    for (let domain of Object.keys(byDomain)) {
      for (let userID of Object.keys(byDomain[domain])) {
        for (let client of byDomain[domain][userID]) {
          if (client.id != this.clientID) {
            devices.push(new ProteusDevice(domain, userID, client.id));
          }
        }
      }
    }
    return devices;
  }

  /** Decrypts one `conversation.otr-message-add` event. Its fields are raw
   * server JSON — `TWireEvent` is the one shape `WireAPI` does not sanitize.
   * @returns the encoded `GenericMessage`
   * @throws ProteusError. `DuplicateMessage` is normal — the notification stream
   *   replays — and the caller should drop the event silently. The others mean
   *   the user sees "you cannot read this message"; the session behind them has
   *   already been reset here, so the peer's next message will work. */
  async decryptEvent(event: TWireEvent): Promise<Uint8Array> {
    let sender = new ProteusDevice(
      sanitize.nonemptystring(event.qualified_from?.domain ?? this.domain),
      sanitize.nonemptystring(event.qualified_from?.id ?? event.from),
      sanitize.nonemptystring(event.data?.sender));
    let envelope = base64Decode(sanitize.nonemptystring(event.data?.text));
    try {
      let plaintext = this.decryptFrom(sender, envelope);
      await this.onStoreChanged?.();
      this.repaired.delete(sender.sessionID);
      return plaintext;
    } catch (ex) {
      await this.recover(sender, ex);
      throw ex;
    }
  }

  private decryptFrom(sender: ProteusDevice, envelope: Uint8Array): Uint8Array {
    let session = this.store.session(sender.sessionID);
    if (session) {
      return session.decrypt(envelope, this.store.preKeys);
    }
    // No session yet, so this must be the peer's opening PreKeyMessage.
    let created = ProteusSession.fromPreKeyMessage(sender.sessionID, this.store.identity, envelope, this.store.preKeys);
    this.store.sessions.set(sender.sessionID, created.session);
    return created.plaintext;
  }

  /** One repair attempt per broken session, not one per undecryptable message. */
  private async recover(sender: ProteusDevice, ex: any) {
    if (!kRecoverableErrors.includes(ex?.code) || this.repaired.has(sender.sessionID)) {
      return;
    }
    try {
      await this.resetSession(sender);
      this.repaired.add(sender.sessionID);
    } catch (repairEx) {
      // The caller needs the decryption error, not this one. Leaving the
      // session unmarked lets the next message from it try the repair again.
      console.error(`Could not reset the Proteus session ${sender.sessionID}`, repairEx);
    }
  }

  /** §7: throw our half of the session away and build a new one from a freshly
   * claimed prekey, so our next message re-establishes it. This is also the only
   * place that can tell whether the peer's identity key changed while we were
   * not looking, which is the security-relevant part of the whole flow. */
  async resetSession(device: ProteusDevice) {
    let before = this.store.session(device.sessionID)?.remoteFingerprint;
    this.store.deleteSession(device.sessionID);
    await this.createSessions([device]);
    await this.onStoreChanged?.();
    let after = this.store.session(device.sessionID)?.remoteFingerprint;
    if (before && after && before != after) {
      this.onRemoteIdentityChanged?.(device);
    }
    await this.onSendSessionReset?.(device);
  }

  /** §4.4: the server hands our prekeys out one per new session, so it runs dry.
   * Top it back up once it is down to half. The last-resort key is always in the
   * remaining list and is never consumed, so it does not count. */
  async replenishPreKeys(target = kPreKeyTarget) {
    let remaining = await retryOnTransientError(() => this.api.getRemainingPrekeyIDs(this.clientID));
    let oneTime = remaining.filter(prekeyID => prekeyID != kLastResortPreKeyID).length;
    let fresh = this.store.replenishPreKeys(oneTime, target);
    if (!fresh.length) {
      return;
    }
    await this.api.uploadPrekeys(this.clientID, fresh.map(preKey => preKey.toJSONForServer(this.store.identity)));
    await this.onStoreChanged?.();
  }
}

/** One remote device. Sessions are keyed by its string form, as Wire does. */
export class ProteusDevice {
  readonly domain: string;
  readonly userID: string;
  /** The backend's client ID: a lowercase hex string */
  readonly clientID: string;

  constructor(domain: string, userID: string, clientID: string) {
    this.domain = domain;
    this.userID = userID;
    this.clientID = clientID;
  }

  get sessionID(): string {
    return `${this.domain}@${this.userID}@${this.clientID}`;
  }

  /** Also accepts the legacy, pre-federation `<userID>@<clientID>` form. */
  static parse(sessionID: string): ProteusDevice {
    let parts = sessionID.split("@");
    let clientID = parts.pop();
    let userID = parts.pop();
    return new ProteusDevice(parts.pop() ?? "", userID, clientID);
  }
}

/** The per-device ciphertexts of one message, keyed by session ID so that the
 * mismatch handling can add and remove single devices before we send again. */
class OtrPayload {
  private ciphertexts = new Map<string, Uint8Array>();

  set(device: ProteusDevice, ciphertext: Uint8Array) {
    this.ciphertexts.set(device.sessionID, ciphertext);
  }

  delete(device: ProteusDevice) {
    this.ciphertexts.delete(device.sessionID);
  }

  /** Regrouped into `QualifiedNewOtrMessage.recipients`: domain, then user, then
   * device. */
  toRecipients(): QualifiedUserEntry[] {
    let byDomain = new Map<string, Map<string, { client: { client: bigint }, text: Uint8Array }[]>>();
    for (let [sessionID, ciphertext] of this.ciphertexts) {
      let device = ProteusDevice.parse(sessionID);
      let byUser = byDomain.get(device.domain);
      if (!byUser) {
        byUser = new Map();
        byDomain.set(device.domain, byUser);
      }
      let clients = byUser.get(device.userID);
      if (!clients) {
        clients = [];
        byUser.set(device.userID, clients);
      }
      clients.push({ client: { client: clientIDToNumber(device.clientID) }, text: ciphertext });
    }
    return [...byDomain.entries()].map(([domain, byUser]) => ({
      domain,
      entries: [...byUser.entries()].map(([userID, clients]) => ({
        user: { uuid: userIDToBytes(userID) },
        clients,
      })),
    }));
  }
}

export interface ProteusSendOptions {
  /** Wake the recipient's device. False for confirmations and other silent traffic. */
  nativePush?: boolean;
  /** Deliver now, but do not keep in the notification stream */
  transient?: boolean;
  priority?: OtrPriority;
  /** Which missing devices the backend should refuse to send without */
  mismatch?: "reportAll" | "ignoreAll" | "reportOnly" | "ignoreOnly";
  /** The users `reportOnly` / `ignoreOnly` apply to */
  mismatchUsers?: TWireQualifiedID[];
}

export interface ProteusSendResult {
  /** The user declined to send to a newly appeared device */
  canceled: boolean;
  /** The backend's answer. `failed_to_send` may be set even when it went out:
   * a federated backend we could not reach. */
  status: TWireMessageSendingStatus;
}

function devicesInMap(clients: TWireQualifiedUserClients): ProteusDevice[] {
  let devices: ProteusDevice[] = [];
  for (let domain of Object.keys(clients ?? {})) {
    for (let userID of Object.keys(clients[domain] ?? {})) {
      for (let clientID of clients[domain][userID] ?? []) {
        devices.push(new ProteusDevice(domain, userID, clientID));
      }
    }
  }
  return devices;
}

function clientMapOf(devices: ProteusDevice[]): TWireQualifiedUserClients {
  let map: TWireQualifiedUserClients = {};
  for (let device of devices) {
    map[device.domain] ??= {};
    map[device.domain][device.userID] ??= [];
    map[device.domain][device.userID].push(device.clientID);
  }
  return map;
}

/** Decryption failures a session reset can plausibly fix. A `DuplicateMessage`
 * or a `TooDistantFuture` cannot, and resetting on those would throw away a
 * session that still works. */
const kRecoverableErrors = [
  ProteusErrorCode.SessionNotFound,
  ProteusErrorCode.InvalidMessage,
  ProteusErrorCode.InvalidSignature,
  ProteusErrorCode.RemoteIdentityChanged,
];
