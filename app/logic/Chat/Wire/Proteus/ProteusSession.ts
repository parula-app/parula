/** One Proteus session with one remote *device*: the Axolotl / Double Ratchet,
 * as the `proteus` crate implements it.
 *
 * Shaped like `Signal/Crypto/SessionCipher.ts`, because both descend from
 * Axolotl, but every constant differs and none of the derivations are
 * interchangeable: Proteus MACs with HMAC-SHA256 over the CBOR-encoded message,
 * encrypts with legacy ChaCha20 (8-byte nonce) instead of AES-CBC, keys its
 * chains by the peer's ratchet key inside a *state* that is itself keyed by a
 * random 16-byte session tag, and derives with the info strings "handshake",
 * "dh_ratchet" and "hash_ratchet".
 *
 * A session holds several states because the peer may re-initiate at any time
 * (a session reset), and messages encrypted under the old state can still
 * arrive afterwards. `sessionTag` names the state our next outgoing message
 * uses; incoming messages name their own. */
import { ProteusIdentity, ProteusKeyPair, fingerprintOf } from "./ProteusIdentity";
import { PreKeyBundle, ProteusPreKey, CBORReader, CBORWriter, kLastResortPreKeyID } from "./PreKeyBundle";
import { hkdfSHA256, hmacSHA256, randomBytes, concatBytes, bytesEqual, base64Encode, base64Decode } from "../../Signal/Crypto/primitives";
import { chacha20orig } from "@noble/ciphers/chacha.js";
import { bytesToHex, hexToBytes } from "@noble/curves/utils.js";

export class ProteusSession {
  /** `<domain>@<userID>@<clientID>`, the key this session is stored under */
  readonly sessionID: string;
  readonly identity: ProteusIdentity;
  /** The peer device's 32-byte Ed25519 identity key. Pinned: if a later
   * PreKeyMessage carries a different one, that is a security event. */
  remoteIdentityKey: Uint8Array;
  /** Hex of the 16-byte session tag of the state that encrypts our next message */
  sessionTag: string;
  /** Session tag hex -> state. Insertion-ordered, so the first entry is the
   * oldest and the one evicted past `kMaxSessionStates`. */
  states = new Map<string, ProteusSessionState>();
  /** Set while the peer has not answered us yet. Every outgoing message is then
   * wrapped as a `PreKeyMessage`, so the peer can build its half of the session
   * even if our first message was lost. */
  pendingPreKey: { preKeyID: number, baseKey: Uint8Array } | null = null;

  constructor(sessionID: string, identity: ProteusIdentity) {
    this.sessionID = sessionID;
    this.identity = identity;
  }

  /** We initiate (we are "Alice"): we claimed the peer's prekey while it was
   * offline, so we can derive the whole first chain without it. */
  static initiate(sessionID: string, identity: ProteusIdentity, bundle: PreKeyBundle): ProteusSession {
    if (!bundle.verify()) {
      throw new ProteusError(ProteusErrorCode.InvalidSignature, "Bad signature on the prekey bundle");
    }
    let session = new ProteusSession(sessionID, identity);
    session.remoteIdentityKey = bundle.identityKey;
    let baseKey = ProteusKeyPair.generate();
    session.pendingPreKey = { preKeyID: bundle.preKeyID, baseKey: baseKey.publicKey };
    session.commit(randomBytes(kSessionTagLength), ProteusSessionState.initAsAlice(identity, baseKey, bundle));
    return session;
  }

  /** The peer initiated (we are "Bob"): the message carries everything we need,
   * plus the id of the prekey of ours that it consumed.
   * @param preKeys our prekey store; the consumed one is removed from it */
  static fromPreKeyMessage(sessionID: string, identity: ProteusIdentity, envelopeBytes: Uint8Array, preKeys: Map<number, ProteusPreKey>): { session: ProteusSession, plaintext: Uint8Array } {
    let envelope = Envelope.decode(envelopeBytes);
    let message = envelope.message;
    if (!(message instanceof PreKeyMessage)) {
      throw new ProteusError(ProteusErrorCode.InvalidMessage, "First message of a session must be a PreKeyMessage");
    }
    let preKey = preKeys.get(message.preKeyID);
    if (!preKey) {
      throw new ProteusError(ProteusErrorCode.SessionNotFound, `Our prekey ${message.preKeyID} is already gone`);
    }
    let session = new ProteusSession(sessionID, identity);
    session.remoteIdentityKey = message.identityKey;
    let state = ProteusSessionState.initAsBob(identity, preKey.keyPair, message.identityKey, message.baseKey);
    let plaintext = state.decrypt(envelope, message.cipher);
    session.commit(message.cipher.sessionTag, state);
    consumePreKey(preKeys, message.preKeyID);
    return { session, plaintext };
  }

  /** @returns the CBOR `Envelope` that goes into `ClientEntry.text` */
  encrypt(plaintext: Uint8Array): Uint8Array {
    let state = this.states.get(this.sessionTag);
    if (!state) {
      throw new ProteusError(ProteusErrorCode.InvalidMessage, `Session ${this.sessionID} has no state ${this.sessionTag}`);
    }
    return state.encrypt(this.identity, this.pendingPreKey, hexToBytes(this.sessionTag), plaintext).encode();
  }

  /** @param preKeys our prekey store, needed if the peer re-initiated the session
   * @throws ProteusError */
  decrypt(envelopeBytes: Uint8Array, preKeys: Map<number, ProteusPreKey>): Uint8Array {
    let envelope = Envelope.decode(envelopeBytes);
    let message = envelope.message;
    if (message instanceof CipherMessage) {
      return this.decryptOnExistingState(envelope, message);
    }
    if (!bytesEqual(message.identityKey, this.remoteIdentityKey)) {
      throw new ProteusError(ProteusErrorCode.RemoteIdentityChanged,
        `The identity key of ${this.sessionID} changed`);
    }
    try {
      return this.decryptOnExistingState(envelope, message.cipher);
    } catch (ex) {
      if (ex.code != ProteusErrorCode.InvalidSignature && ex.code != ProteusErrorCode.InvalidMessage) {
        throw ex;
      }
      return this.decryptAsNewState(envelope, message, preKeys, ex);
    }
  }

  /** The peer reset the session and started over from one of our prekeys. Only
   * reached when decrypting on the state we have failed — a PreKeyMessage for a
   * session that is still healthy is just a retransmission of its first message. */
  private decryptAsNewState(envelope: Envelope, message: PreKeyMessage, preKeys: Map<number, ProteusPreKey>, previousError: Error): Uint8Array {
    let preKey = preKeys.get(message.preKeyID);
    if (!preKey) {
      throw previousError;
    }
    let state = ProteusSessionState.initAsBob(this.identity, preKey.keyPair, message.identityKey, message.baseKey);
    let plaintext = state.decrypt(envelope, message.cipher);
    this.pendingPreKey = null;
    this.commit(message.cipher.sessionTag, state);
    consumePreKey(preKeys, message.preKeyID);
    return plaintext;
  }

  private decryptOnExistingState(envelope: Envelope, cipher: CipherMessage): Uint8Array {
    let tag = bytesToHex(cipher.sessionTag);
    let existing = this.states.get(tag);
    if (!existing) {
      throw new ProteusError(ProteusErrorCode.InvalidMessage, `Session ${this.sessionID} has no state ${tag}`);
    }
    // Decrypt on a copy, so a message that fails never advances the ratchet.
    let state = existing.clone();
    let plaintext = state.decrypt(envelope, cipher);
    this.pendingPreKey = null; // the peer answered, so it has our session
    this.commit(cipher.sessionTag, state);
    return plaintext;
  }

  /** Makes `state` the current one, evicting the oldest if we hold too many. */
  private commit(sessionTag: Uint8Array, state: ProteusSessionState) {
    let tag = bytesToHex(sessionTag);
    this.states.set(tag, state);
    this.sessionTag = tag;
    if (this.states.size > kMaxSessionStates) {
      let oldest = [...this.states.keys()].find(each => each != tag);
      this.states.delete(oldest);
    }
  }

  get remoteFingerprint(): string {
    return fingerprintOf(this.remoteIdentityKey);
  }

  toJSON(): any {
    return {
      sessionID: this.sessionID,
      remoteIdentityKey: base64Encode(this.remoteIdentityKey),
      sessionTag: this.sessionTag,
      states: [...this.states.entries()].map(([tag, state]) => ({ tag, state: state.toJSON() })),
      pendingPreKey: this.pendingPreKey ? {
        preKeyID: this.pendingPreKey.preKeyID,
        baseKey: base64Encode(this.pendingPreKey.baseKey),
      } : null,
    };
  }

  static fromJSON(json: any, identity: ProteusIdentity): ProteusSession {
    let session = new ProteusSession(json.sessionID, identity);
    session.remoteIdentityKey = base64Decode(json.remoteIdentityKey);
    session.sessionTag = json.sessionTag;
    for (let entry of json.states ?? []) {
      session.states.set(entry.tag, ProteusSessionState.fromJSON(entry.state));
    }
    if (json.pendingPreKey) {
      session.pendingPreKey = {
        preKeyID: json.pendingPreKey.preKeyID,
        baseKey: base64Decode(json.pendingPreKey.baseKey),
      };
    }
    return session;
  }
}

/** One ratchet: a root key, the chain we send on, and the chains we have
 * received on so far (newest first, at most `kMaxRecvChains` — keeping the old
 * ones is what makes a message that arrives after the peer has already
 * ratcheted still decryptable). */
export class ProteusSessionState {
  rootKey: RootKey;
  sendChain: SendChain;
  recvChains: RecvChain[] = [];
  /** How far our send chain had got when we last ratcheted. Sent to the peer;
   * proteus does not act on the peer's value. */
  prevCounter = 0;

  /** Alice: three DHs against the prekey bundle, then one immediate DH ratchet
   * to get a send chain the peer can follow. */
  static initAsAlice(identity: ProteusIdentity, baseKey: ProteusKeyPair, bundle: PreKeyBundle): ProteusSessionState {
    let master = concatBytes(
      identity.keyPair.dh(bundle.preKeyPublic),
      baseKey.dh(bundle.identityKey),
      baseKey.dh(bundle.preKeyPublic));
    let { rootKey, chainKey } = handshakeKeys(master);
    let sendRatchet = ProteusKeyPair.generate();
    let sending = rootKey.ratchet(sendRatchet, bundle.preKeyPublic);
    let state = new ProteusSessionState();
    state.rootKey = sending.rootKey;
    state.sendChain = new SendChain(sending.chainKey, sendRatchet);
    state.recvChains = [new RecvChain(chainKey, bundle.preKeyPublic)];
    return state;
  }

  /** Bob: the mirror image. His first send chain rides on the prekey the peer
   * consumed; he has no receive chain until the peer ratchets. */
  static initAsBob(identity: ProteusIdentity, preKey: ProteusKeyPair, aliceIdentityKey: Uint8Array, aliceBaseKey: Uint8Array): ProteusSessionState {
    let master = concatBytes(
      preKey.dh(aliceIdentityKey),
      identity.keyPair.dh(aliceBaseKey),
      preKey.dh(aliceBaseKey));
    let { rootKey, chainKey } = handshakeKeys(master);
    let state = new ProteusSessionState();
    state.rootKey = rootKey;
    state.sendChain = new SendChain(chainKey, preKey);
    return state;
  }

  encrypt(identity: ProteusIdentity, pendingPreKey: { preKeyID: number, baseKey: Uint8Array } | null, sessionTag: Uint8Array, plaintext: Uint8Array): Envelope {
    let keys = this.sendChain.chainKey.messageKeys();
    let cipher = new CipherMessage(sessionTag, this.sendChain.chainKey.index, this.prevCounter,
      this.sendChain.ratchetKey.publicKey, keys.crypt(plaintext));
    let message = pendingPreKey
      ? new PreKeyMessage(pendingPreKey.preKeyID, pendingPreKey.baseKey, identity.publicKey, cipher)
      : cipher;
    let envelope = Envelope.create(keys.macKey, message);
    this.sendChain.chainKey = this.sendChain.chainKey.next();
    return envelope;
  }

  decrypt(envelope: Envelope, cipher: CipherMessage): Uint8Array {
    let chain = this.recvChains.find(each => bytesEqual(each.ratchetKey, cipher.ratchetKey));
    if (!chain) {
      this.ratchet(cipher.ratchetKey);
      chain = this.recvChains[0];
    }
    if (cipher.counter < chain.chainKey.index) {
      return chain.decryptSkipped(envelope, cipher);
    }
    if (cipher.counter > chain.chainKey.index) {
      return chain.decryptAhead(envelope, cipher);
    }
    let keys = chain.chainKey.messageKeys();
    let plaintext = keys.crypt(cipher.cipherText);
    envelope.assertMAC(keys.macKey);
    chain.chainKey = chain.chainKey.next();
    return plaintext;
  }

  /** The peer sent under a ratchet key we have not seen: step the DH ratchet,
   * which gives us a receive chain for it and a fresh send chain of our own. */
  private ratchet(theirRatchetKey: Uint8Array) {
    let newRatchet = ProteusKeyPair.generate();
    let receiving = this.rootKey.ratchet(this.sendChain.ratchetKey, theirRatchetKey);
    let sending = receiving.rootKey.ratchet(newRatchet, theirRatchetKey);
    this.rootKey = sending.rootKey;
    this.prevCounter = this.sendChain.chainKey.index;
    this.sendChain = new SendChain(sending.chainKey, newRatchet);
    this.recvChains.unshift(new RecvChain(receiving.chainKey, theirRatchetKey));
    if (this.recvChains.length > kMaxRecvChains) {
      this.recvChains.pop();
    }
  }

  /** The JSON round trip is also how we persist, so cloning through it keeps
   * both paths honest. */
  clone(): ProteusSessionState {
    return ProteusSessionState.fromJSON(this.toJSON());
  }

  toJSON(): any {
    return {
      rootKey: base64Encode(this.rootKey.key),
      sendChain: this.sendChain.toJSON(),
      recvChains: this.recvChains.map(chain => chain.toJSON()),
      prevCounter: this.prevCounter,
    };
  }

  static fromJSON(json: any): ProteusSessionState {
    let state = new ProteusSessionState();
    state.rootKey = new RootKey(base64Decode(json.rootKey));
    state.sendChain = SendChain.fromJSON(json.sendChain);
    state.recvChains = (json.recvChains ?? []).map(each => RecvChain.fromJSON(each));
    state.prevCounter = json.prevCounter ?? 0;
    return state;
  }
}

class SendChain {
  chainKey: ChainKey;
  ratchetKey: ProteusKeyPair;

  constructor(chainKey: ChainKey, ratchetKey: ProteusKeyPair) {
    this.chainKey = chainKey;
    this.ratchetKey = ratchetKey;
  }

  toJSON(): any {
    return { chainKey: this.chainKey.toJSON(), ratchetKey: this.ratchetKey.toJSON() };
  }

  static fromJSON(json: any): SendChain {
    return new SendChain(ChainKey.fromJSON(json.chainKey), ProteusKeyPair.fromJSON(json.ratchetKey));
  }
}

class RecvChain {
  chainKey: ChainKey;
  /** The peer's 32-byte Ed25519 ratchet public key that this chain hangs off */
  ratchetKey: Uint8Array;
  /** Keys for counters we skipped, ascending, at most `kMaxCounterGap` of them.
   * A key is removed as it is used, which is what makes a replay a
   * `DuplicateMessage` rather than a second successful decrypt. */
  messageKeys: MessageKeys[] = [];

  constructor(chainKey: ChainKey, ratchetKey: Uint8Array) {
    this.chainKey = chainKey;
    this.ratchetKey = ratchetKey;
  }

  /** A message from the past: its key was staged when we ran ahead of it. */
  decryptSkipped(envelope: Envelope, cipher: CipherMessage): Uint8Array {
    if (this.messageKeys.length && this.messageKeys[0].counter > cipher.counter) {
      throw new ProteusError(ProteusErrorCode.OutdatedMessage,
        `Message ${cipher.counter} is older than every key we kept`);
    }
    let index = this.messageKeys.findIndex(each => each.counter == cipher.counter);
    if (index < 0) {
      throw new ProteusError(ProteusErrorCode.DuplicateMessage, `Message ${cipher.counter} was already decrypted`);
    }
    let keys = this.messageKeys[index];
    let plaintext = keys.crypt(cipher.cipherText);
    envelope.assertMAC(keys.macKey);
    this.messageKeys.splice(index, 1);
    return plaintext;
  }

  /** A message from the future: derive and keep the keys of the gap, so the
   * messages we skipped still decrypt when they arrive. */
  decryptAhead(envelope: Envelope, cipher: CipherMessage): Uint8Array {
    let gap = cipher.counter - this.chainKey.index;
    if (gap > kMaxCounterGap) {
      throw new ProteusError(ProteusErrorCode.TooDistantFuture, `Message ${cipher.counter} skips ${gap} messages`);
    }
    let staged: MessageKeys[] = [];
    let chainKey = this.chainKey;
    for (let i = 0; i < gap; i++) {
      staged.push(chainKey.messageKeys());
      chainKey = chainKey.next();
    }
    let keys = chainKey.messageKeys();
    let plaintext = keys.crypt(cipher.cipherText);
    envelope.assertMAC(keys.macKey);
    this.chainKey = chainKey.next();
    let excess = this.messageKeys.length + staged.length - kMaxCounterGap;
    if (excess > 0) {
      this.messageKeys.splice(0, excess);
    }
    this.messageKeys.push(...staged);
    return plaintext;
  }

  toJSON(): any {
    return {
      chainKey: this.chainKey.toJSON(),
      ratchetKey: base64Encode(this.ratchetKey),
      messageKeys: this.messageKeys.map(keys => keys.toJSON()),
    };
  }

  static fromJSON(json: any): RecvChain {
    let chain = new RecvChain(ChainKey.fromJSON(json.chainKey), base64Decode(json.ratchetKey));
    chain.messageKeys = (json.messageKeys ?? []).map(each => MessageKeys.fromJSON(each));
    return chain;
  }
}

/** The DH ratchet half of the derivation. */
class RootKey {
  key: Uint8Array;

  constructor(key: Uint8Array) {
    this.key = key;
  }

  ratchet(ours: ProteusKeyPair, theirs: Uint8Array): { rootKey: RootKey, chainKey: ChainKey } {
    let okm = hkdfSHA256(ours.dh(theirs), this.key, enc("dh_ratchet"), 64);
    return { rootKey: new RootKey(okm.slice(0, 32)), chainKey: new ChainKey(okm.slice(32, 64), 0) };
  }
}

/** The symmetric ratchet half: one chain key per message, one message key
 * derived from it on the side. */
class ChainKey {
  key: Uint8Array;
  /** The counter of the message this chain key encrypts */
  index: number;

  constructor(key: Uint8Array, index: number) {
    this.key = key;
    this.index = index;
  }

  next(): ChainKey {
    return new ChainKey(hmacSHA256(this.key, kChainStep), this.index + 1);
  }

  messageKeys(): MessageKeys {
    let okm = hkdfSHA256(hmacSHA256(this.key, kMessageKeyStep), kZero32, enc("hash_ratchet"), 64);
    return new MessageKeys(okm.slice(0, 32), okm.slice(32, 64), this.index);
  }

  toJSON(): any {
    return { key: base64Encode(this.key), index: this.index };
  }

  static fromJSON(json: any): ChainKey {
    return new ChainKey(base64Decode(json.key), json.index);
  }
}

/** The two keys one message uses: ChaCha20 for the body, HMAC-SHA256 over the
 * whole encoded message for the envelope's tag. */
class MessageKeys {
  cipherKey: Uint8Array;
  macKey: Uint8Array;
  counter: number;

  constructor(cipherKey: Uint8Array, macKey: Uint8Array, counter: number) {
    this.cipherKey = cipherKey;
    this.macKey = macKey;
    this.counter = counter;
  }

  /** ChaCha20 is a stream cipher, so encrypt and decrypt are the same operation.
   * The nonce is the legacy 8-byte one, and it is not random: it is the message
   * counter in the top 4 bytes and zero in the bottom 4. */
  crypt(data: Uint8Array): Uint8Array {
    let nonce = new Uint8Array(8);
    new DataView(nonce.buffer).setUint32(0, this.counter);
    return chacha20orig(this.cipherKey, nonce, data);
  }

  toJSON(): any {
    return { cipherKey: base64Encode(this.cipherKey), macKey: base64Encode(this.macKey), counter: this.counter };
  }

  static fromJSON(json: any): MessageKeys {
    return new MessageKeys(base64Decode(json.cipherKey), base64Decode(json.macKey), json.counter);
  }
}

/** What actually travels in `ClientEntry.text`: `map(3) { 0: version, 1: mac,
 * 2: bytes(the CBOR-encoded Message) }`.
 *
 * Key 2 is a byte string holding a nested CBOR document, and the MAC covers
 * exactly those bytes. So we keep them verbatim from the wire — MACing a
 * re-encoding would work right up until a peer encodes something slightly
 * differently, and then fail in a way nobody could debug. */
export class Envelope {
  version = 1;
  /** 32-byte HMAC-SHA256 tag over `messageBytes` */
  mac: Uint8Array;
  /** The CBOR `Message`, exactly as sent */
  messageBytes: Uint8Array;
  message: ProteusMessage;

  static create(macKey: Uint8Array, message: ProteusMessage): Envelope {
    let envelope = new Envelope();
    let cbor = new CBORWriter();
    encodeMessage(cbor, message);
    envelope.messageBytes = cbor.finish();
    envelope.mac = hmacSHA256(macKey, envelope.messageBytes);
    envelope.message = message;
    return envelope;
  }

  static decode(data: Uint8Array): Envelope {
    let cbor = new CBORReader(data);
    let envelope = new Envelope();
    for (let key of cbor.mapKeys()) {
      switch (key) {
      case 0: envelope.version = cbor.uint(); break;
      case 1: envelope.mac = cbor.wrapped(1); break;
      case 2: envelope.messageBytes = cbor.bytes(); break;
      default: cbor.skip(); break;
      }
    }
    if (envelope.version != 1) {
      throw new ProteusError(ProteusErrorCode.InvalidMessage, `Unsupported envelope version ${envelope.version}`);
    }
    if (envelope.mac?.length != 32 || !envelope.messageBytes) {
      throw new ProteusError(ProteusErrorCode.InvalidMessage, "Envelope is missing its MAC or its message");
    }
    envelope.message = decodeMessage(new CBORReader(envelope.messageBytes));
    return envelope;
  }

  encode(): Uint8Array {
    let cbor = new CBORWriter();
    cbor.map(3);
    cbor.uint(0).uint(this.version);
    cbor.uint(1).map(1).uint(0).bytes(this.mac);
    cbor.uint(2).bytes(this.messageBytes);
    return cbor.finish();
  }

  /** @throws ProteusError InvalidSignature. Always called after decryption and
   * before the plaintext is handed on, as proteus does. */
  assertMAC(macKey: Uint8Array) {
    if (!bytesEqual(hmacSHA256(macKey, this.messageBytes), this.mac)) {
      throw new ProteusError(ProteusErrorCode.InvalidSignature, "Bad MAC on the Proteus envelope");
    }
  }
}

/** The first message of a session, carrying everything the peer needs to build
 * its half: `map(4) { 0: prekey_id, 1: base_key, 2: identity_key, 3: cipher }` */
export class PreKeyMessage {
  /** Which of the receiver's prekeys we consumed */
  preKeyID: number;
  /** Our ephemeral base key, 32-byte Ed25519 */
  baseKey: Uint8Array;
  /** Our long-term identity, 32-byte Ed25519 */
  identityKey: Uint8Array;
  cipher: CipherMessage;

  constructor(preKeyID: number, baseKey: Uint8Array, identityKey: Uint8Array, cipher: CipherMessage) {
    this.preKeyID = preKeyID;
    this.baseKey = baseKey;
    this.identityKey = identityKey;
    this.cipher = cipher;
  }

  encode(cbor: CBORWriter) {
    cbor.map(4);
    cbor.uint(0).uint(this.preKeyID);
    cbor.uint(1).map(1).uint(0).bytes(this.baseKey);
    cbor.uint(2).map(1).uint(0).map(1).uint(0).bytes(this.identityKey);
    cbor.uint(3);
    this.cipher.encode(cbor);
  }

  static decode(cbor: CBORReader): PreKeyMessage {
    let message = new PreKeyMessage(0, null, null, null);
    for (let key of cbor.mapKeys()) {
      switch (key) {
      case 0: message.preKeyID = cbor.uint(); break;
      case 1: message.baseKey = cbor.wrapped(1); break;
      case 2: message.identityKey = cbor.wrapped(2); break;
      case 3: message.cipher = CipherMessage.decode(cbor); break;
      default: cbor.skip(); break;
      }
    }
    if (message.baseKey?.length != 32 || message.identityKey?.length != 32 || !message.cipher) {
      throw new ProteusError(ProteusErrorCode.InvalidMessage, "Incomplete PreKeyMessage");
    }
    return message;
  }
}

/** One ratcheted message:
 * `map(5) { 0: session_tag, 1: counter, 2: prev_counter, 3: ratchet_key, 4: ciphertext }` */
export class CipherMessage {
  /** 16 random bytes naming the session state this belongs to */
  sessionTag: Uint8Array;
  /** Our index in the current send chain */
  counter: number;
  /** How far the previous send chain got */
  prevCounter: number;
  /** Our current ratchet public key, 32-byte Ed25519 */
  ratchetKey: Uint8Array;
  cipherText: Uint8Array;

  constructor(sessionTag: Uint8Array, counter: number, prevCounter: number, ratchetKey: Uint8Array, cipherText: Uint8Array) {
    this.sessionTag = sessionTag;
    this.counter = counter;
    this.prevCounter = prevCounter;
    this.ratchetKey = ratchetKey;
    this.cipherText = cipherText;
  }

  encode(cbor: CBORWriter) {
    cbor.map(5);
    cbor.uint(0).bytes(this.sessionTag);
    cbor.uint(1).uint(this.counter);
    cbor.uint(2).uint(this.prevCounter);
    cbor.uint(3).map(1).uint(0).bytes(this.ratchetKey);
    cbor.uint(4).bytes(this.cipherText);
  }

  static decode(cbor: CBORReader): CipherMessage {
    let message = new CipherMessage(null, 0, 0, null, null);
    for (let key of cbor.mapKeys()) {
      switch (key) {
      case 0: message.sessionTag = cbor.bytes(); break;
      case 1: message.counter = cbor.uint(); break;
      case 2: message.prevCounter = cbor.uint(); break;
      case 3: message.ratchetKey = cbor.wrapped(1); break;
      case 4: message.cipherText = cbor.bytes(); break;
      default: cbor.skip(); break;
      }
    }
    if (message.sessionTag?.length != kSessionTagLength || message.ratchetKey?.length != 32 || !message.cipherText) {
      throw new ProteusError(ProteusErrorCode.InvalidMessage, "Incomplete CipherMessage");
    }
    return message;
  }
}

/** A `Message` is a type tag *followed by* a body, with nothing around the two:
 * no array header, no map. The two CBOR items simply sit next to each other in
 * the byte string that the envelope carries. */
export type ProteusMessage = CipherMessage | PreKeyMessage;

function encodeMessage(cbor: CBORWriter, message: ProteusMessage) {
  cbor.uint(message instanceof PreKeyMessage ? kMessageTagKeyed : kMessageTagPlain);
  message.encode(cbor);
}

function decodeMessage(cbor: CBORReader): ProteusMessage {
  let tag = cbor.uint();
  if (tag == kMessageTagPlain) {
    return CipherMessage.decode(cbor);
  }
  if (tag == kMessageTagKeyed) {
    return PreKeyMessage.decode(cbor);
  }
  throw new ProteusError(ProteusErrorCode.InvalidMessage, `Unknown Proteus message type ${tag}`);
}

/** HKDF over the concatenated triple DH, for both the Alice and the Bob side. */
function handshakeKeys(master: Uint8Array): { rootKey: RootKey, chainKey: ChainKey } {
  let okm = hkdfSHA256(master, kZero32, enc("handshake"), 64);
  return { rootKey: new RootKey(okm.slice(0, 32)), chainKey: new ChainKey(okm.slice(32, 64), 0) };
}

/** The last-resort prekey is handed out over and over, so it is never removed. */
function consumePreKey(preKeys: Map<number, ProteusPreKey>, preKeyID: number) {
  if (preKeyID != kLastResortPreKeyID) {
    preKeys.delete(preKeyID);
  }
}

/** The codes the reference client surfaces to the app. `DuplicateMessage` is a
 * normal condition - the notification stream replays. `RemoteIdentityChanged`
 * is the security-relevant one. */
export enum ProteusErrorCode {
  SessionNotFound = 102,
  InvalidMessage = 201,
  RemoteIdentityChanged = 204,
  OutdatedMessage = 206,
  InvalidSignature = 207,
  DuplicateMessage = 209,
  TooDistantFuture = 212,
  PreKeyMessageUnMatchedSignature = 406,
  Unknown = 999,
}

export class ProteusError extends Error {
  readonly code: ProteusErrorCode;

  constructor(code: ProteusErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const enc = (text: string) => new TextEncoder().encode(text);
const kZero32 = new Uint8Array(32);
/** The literal one-byte strings "1" and "0", i.e. 0x31 and 0x30 - not 1 and 0. */
const kChainStep = enc("1");
const kMessageKeyStep = enc("0");
const kMessageTagPlain = 1;
const kMessageTagKeyed = 2;
const kSessionTagLength = 16;
/** How far ahead of our chain a message may be before we refuse to derive the
 * keys of the gap. */
const kMaxCounterGap = 1000;
const kMaxRecvChains = 5;
const kMaxSessionStates = 100;
