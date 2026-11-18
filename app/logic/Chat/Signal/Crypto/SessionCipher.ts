/** Signal pairwise session: X3DH key agreement + the Double Ratchet.
 * Implemented from the Signal specifications; constants per WhatsApp (v3). */
import { KeyPair } from "./KeyPair";
import { sharedSecret, djbEncode, djbDecode } from "./curve";
import { hkdfSHA256, hmacSHA256, aesCBCEncrypt, aesCBCDecrypt, randomBytes, concatBytes, bytesEqual, base64Encode, base64Decode } from "./primitives";
import { bytesToHex } from "@noble/curves/utils.js";
import type { SignalStore } from "./Store";
import { PreKeyBundle, verifyPreKeyBundle } from "./Identity";
import {
  serializeSignalMessage, parseSignalMessage, verifySignalMessageMAC,
  serializePreKeySignalMessage, parsePreKeySignalMessage,
  kSignalVersion, kSignalVersionV4,
} from "./messages";
import { deriveTripleRatchetKeys } from "../Encryption/SPQR/tripleRatchet";

export class SessionState {
  rootKey: Uint8Array;
  senderRatchetKeyPair: KeyPair;
  senderChainKey: Uint8Array;
  senderChainIndex = 0;
  previousCounter = 0;
  receiverChains = new Map<string, Chain>(); // ratchet pub hex -> chain
  theirRatchetKey?: Uint8Array; // 32 bytes
  skippedKeys = new Map<string, Uint8Array>(); // "ratchetHex:counter" -> messageKey
  remoteIdentityKey: Uint8Array; // 33-byte djb
  localIdentityKey: Uint8Array; // 33-byte djb
  pendingPreKey?: { preKeyID?: number, signedPreKeyID: number, baseKey: Uint8Array };
  /** PQXDH-only: the kyber prekey id + ciphertext for the first outgoing `pkmsg`
   * (set by initiatePqxdhSession; consumed by the PQXDH encrypt wrapper). Carried
   * alongside pendingPreKey and cleared once the peer confirms the session. */
  pendingKyber?: { kyberPreKeyID: number, ciphertext: Uint8Array };
  remoteRegistrationID?: number;
  /** For a session we built as the responder: the initiator's base key (33-byte
   * djb) from the `pkmsg` that established it. Lets a later `pkmsg` tell "the one
   * that set up this very session" (a duplicate) from "a different/new session"
   * (rebuild), instead of decrypting a fresh `pkmsg` against an unrelated session. */
  establishingBaseKey?: Uint8Array;

  /** Serializes the live Double Ratchet state to plain JSON, so a session can be
   * restored after a restart instead of the peer having to re-establish it. */
  toJSON(): any {
    return {
      rootKey: base64Encode(this.rootKey),
      senderRatchetKey: base64Encode(this.senderRatchetKeyPair.privateKey),
      senderChainKey: base64Encode(this.senderChainKey),
      senderChainIndex: this.senderChainIndex,
      previousCounter: this.previousCounter,
      receiverChains: [...this.receiverChains.entries()].map(([ratchet, chain]) =>
        ({ ratchet, chainKey: base64Encode(chain.chainKey), index: chain.index })),
      theirRatchetKey: this.theirRatchetKey ? base64Encode(this.theirRatchetKey) : undefined,
      skippedKeys: [...this.skippedKeys.entries()].map(([key, mk]) => ({ key, mk: base64Encode(mk) })),
      remoteIdentityKey: base64Encode(this.remoteIdentityKey),
      localIdentityKey: base64Encode(this.localIdentityKey),
      pendingPreKey: this.pendingPreKey ? {
        preKeyID: this.pendingPreKey.preKeyID,
        signedPreKeyID: this.pendingPreKey.signedPreKeyID,
        baseKey: base64Encode(this.pendingPreKey.baseKey),
      } : undefined,
      pendingKyber: this.pendingKyber ? {
        kyberPreKeyID: this.pendingKyber.kyberPreKeyID,
        ciphertext: base64Encode(this.pendingKyber.ciphertext),
      } : undefined,
      remoteRegistrationID: this.remoteRegistrationID,
      establishingBaseKey: this.establishingBaseKey ? base64Encode(this.establishingBaseKey) : undefined,
    };
  }

  static fromJSON(json: any): SessionState {
    let state = new SessionState();
    state.rootKey = base64Decode(json.rootKey);
    state.senderRatchetKeyPair = KeyPair.fromPrivate(base64Decode(json.senderRatchetKey));
    state.senderChainKey = base64Decode(json.senderChainKey);
    state.senderChainIndex = json.senderChainIndex ?? 0;
    state.previousCounter = json.previousCounter ?? 0;
    for (let chain of json.receiverChains ?? []) {
      state.receiverChains.set(chain.ratchet, { chainKey: base64Decode(chain.chainKey), index: chain.index });
    }
    state.theirRatchetKey = json.theirRatchetKey ? base64Decode(json.theirRatchetKey) : undefined;
    for (let skipped of json.skippedKeys ?? []) {
      state.skippedKeys.set(skipped.key, base64Decode(skipped.mk));
    }
    state.remoteIdentityKey = base64Decode(json.remoteIdentityKey);
    state.localIdentityKey = base64Decode(json.localIdentityKey);
    if (json.pendingPreKey) {
      state.pendingPreKey = {
        preKeyID: json.pendingPreKey.preKeyID,
        signedPreKeyID: json.pendingPreKey.signedPreKeyID,
        baseKey: base64Decode(json.pendingPreKey.baseKey),
      };
    }
    if (json.pendingKyber) {
      state.pendingKyber = {
        kyberPreKeyID: json.pendingKyber.kyberPreKeyID,
        ciphertext: base64Decode(json.pendingKyber.ciphertext),
      };
    }
    state.remoteRegistrationID = json.remoteRegistrationID;
    state.establishingBaseKey = json.establishingBaseKey ? base64Decode(json.establishingBaseKey) : undefined;
    return state;
  }
}

export interface EncryptedSignalMessage {
  type: "pkmsg" | "msg";
  body: Uint8Array;
}

const kMaxSkip = 2000;
const enc = (s: string) => new TextEncoder().encode(s);
const kZero32 = new Uint8Array(32);
const kDiscontinuity = new Uint8Array(32).fill(0xFF);

interface Chain {
  chainKey: Uint8Array;
  index: number;
}

// --- key derivation ---

function deriveRootAndChain(secrets: Uint8Array): { rootKey: Uint8Array, chainKey: Uint8Array } {
  let out = hkdfSHA256(secrets, kZero32, enc("WhisperText"), 64);
  return { rootKey: out.slice(0, 32), chainKey: out.slice(32, 64) };
}

function kdfRootKey(rootKey: Uint8Array, dh: Uint8Array): { rootKey: Uint8Array, chainKey: Uint8Array } {
  let out = hkdfSHA256(dh, rootKey, enc("WhisperRatchet"), 64);
  return { rootKey: out.slice(0, 32), chainKey: out.slice(32, 64) };
}

function chainStep(chainKey: Uint8Array): { messageKey: Uint8Array, nextChainKey: Uint8Array } {
  return {
    messageKey: hmacSHA256(chainKey, new Uint8Array([1])),
    nextChainKey: hmacSHA256(chainKey, new Uint8Array([2])),
  };
}

function deriveMessageKeys(messageKey: Uint8Array): { cipherKey: Uint8Array, macKey: Uint8Array, iv: Uint8Array } {
  let out = hkdfSHA256(messageKey, kZero32, enc("WhisperMessageKeys"), 80);
  return { cipherKey: out.slice(0, 32), macKey: out.slice(32, 64), iv: out.slice(64, 80) };
}

/** Optional Signal-only triple-ratchet hooks (Docs/08). Absent (the WhatsApp /
 * OMEMO / classic-X3DH path) → `deriveMessageKeys` zero-salt derivation and no
 * `pq_ratchet` field; the on-wire SignalMessage is byte-identical to before.
 *
 * `EncryptPqr`: the session layer's SPQR `send()` output — the per-message key to
 * mix in (HKDF salt; null before SPQR's first epoch lands) and the wire blob to
 * carry as SignalMessage field 5.
 *
 * `DecryptPqr`: a callback the session layer supplies; given the incoming
 * `pq_ratchet` blob it advances its SPQR `recv()` and returns the per-message key
 * to mix. Called *before* MAC verification, matching libsignal `triple_ratchet.rs`
 * (the session layer commits its SPQR state to the store only on overall success). */
export interface EncryptPqr {
  key: Uint8Array | null;
  ratchetBytes: Uint8Array;
}
export type DecryptPqr = (ratchetBytes: Uint8Array | undefined) => Uint8Array | null;

/** Picks the triple-ratchet derivation (SPQR key as HKDF salt) when a `pqrKey` is
 * given, else the classic zero-salt derivation. The two are bit-identical when
 * `pqrKey` is null, so a triple-ratchet session before its first epoch — and any
 * classic session — derive exactly the legacy keys. */
function deriveKeys(messageKey: Uint8Array, pqrKey: Uint8Array | null | undefined): { cipherKey: Uint8Array, macKey: Uint8Array, iv: Uint8Array } {
  return pqrKey === undefined ? deriveMessageKeys(messageKey) : deriveTripleRatchetKeys(messageKey, pqrKey);
}

// --- plaintext padding (WhatsApp: 1..15 trailing bytes, each = the count) ---

export function padPlaintext(plaintext: Uint8Array): Uint8Array {
  let pad = randomBytes(1)[0] & 0x0F;
  if (pad == 0) {
    pad = 0x0F;
  }
  let out = new Uint8Array(plaintext.length + pad);
  out.set(plaintext);
  out.fill(pad, plaintext.length);
  return out;
}

export function unpadPlaintext(padded: Uint8Array): Uint8Array {
  let pad = padded[padded.length - 1];
  if (pad == 0 || pad > padded.length) {
    return padded;
  }
  return padded.subarray(0, padded.length - pad);
}

// --- session setup ---

/** Starts a session as the initiator (Alice), from the peer's prekey bundle. */
export function initiateSession(store: SignalStore, address: string, bundle: PreKeyBundle): SessionState {
  if (!verifyPreKeyBundle(bundle)) {
    throw new Error("Invalid signed prekey signature in bundle");
  }
  let baseKey = KeyPair.generate(); // EK_a
  let secrets = [kDiscontinuity,
    sharedSecret(store.identityKeyPair.privateKey, bundle.signedPreKeyPublic), // DH1
    sharedSecret(baseKey.privateKey, bundle.identityKey), // DH2
    sharedSecret(baseKey.privateKey, bundle.signedPreKeyPublic)]; // DH3
  if (bundle.preKeyPublic) {
    secrets.push(sharedSecret(baseKey.privateKey, bundle.preKeyPublic)); // DH4
  }
  let { rootKey: rk0, chainKey: ck0 } = deriveRootAndChain(concatBytes(...secrets));
  let sendingRatchet = KeyPair.generate(); // DHs
  let sending = kdfRootKey(rk0, sharedSecret(sendingRatchet.privateKey, bundle.signedPreKeyPublic));

  let state = new SessionState();
  state.rootKey = sending.rootKey;
  state.senderRatchetKeyPair = sendingRatchet;
  state.senderChainKey = sending.chainKey;
  state.receiverChains.set(bytesToHex(bundle.signedPreKeyPublic), { chainKey: ck0, index: 0 });
  state.theirRatchetKey = bundle.signedPreKeyPublic;
  state.remoteIdentityKey = djbEncode(bundle.identityKey);
  state.localIdentityKey = djbEncode(store.identityKeyPair.publicKey);
  state.remoteRegistrationID = bundle.registrationID;
  state.pendingPreKey = { preKeyID: bundle.preKeyID, signedPreKeyID: bundle.signedPreKeyID, baseKey: djbEncode(baseKey.publicKey) };
  store.sessions.set(address, state);
  store.saveIdentity(address, bundle.identityKey);
  return state;
}

/** Starts a session as the responder (Bob), from an incoming PreKeySignalMessage. */
function createSessionFromPreKey(store: SignalStore, address: string, data: Uint8Array): SessionState {
  let pkmsg = parsePreKeySignalMessage(data);
  let signedPreKey = store.signedPreKeys.get(pkmsg.signedPreKeyID);
  if (!signedPreKey) {
    throw new Error(`Unknown signed prekey ${pkmsg.signedPreKeyID}`);
  }
  let oneTime = pkmsg.preKeyID != null ? store.preKeys.get(pkmsg.preKeyID) : undefined;
  let theirIdentity = djbDecode(pkmsg.identityKey);
  let theirBaseKey = djbDecode(pkmsg.baseKey);
  let secrets = [kDiscontinuity,
    sharedSecret(signedPreKey.keyPair.privateKey, theirIdentity), // DH1
    sharedSecret(store.identityKeyPair.privateKey, theirBaseKey), // DH2
    sharedSecret(signedPreKey.keyPair.privateKey, theirBaseKey)]; // DH3
  if (oneTime) {
    secrets.push(sharedSecret(oneTime.keyPair.privateKey, theirBaseKey)); // DH4
  }
  let { rootKey, chainKey } = deriveRootAndChain(concatBytes(...secrets));

  let state = new SessionState();
  state.rootKey = rootKey;
  state.senderRatchetKeyPair = signedPreKey.keyPair; // Bob's initial ratchet = SPK
  state.senderChainKey = chainKey;
  state.remoteIdentityKey = pkmsg.identityKey;
  state.localIdentityKey = djbEncode(store.identityKeyPair.publicKey);
  state.establishingBaseKey = pkmsg.baseKey;
  store.sessions.set(address, state);
  // The one-time prekey is consumed, and the identity key saved, by the caller
  // only after the inner SignalMessage MAC verifies — otherwise a failed/duplicate
  // pkmsg would burn the prekey and no retry could ever establish the session.
  return state;
}

// --- encrypt / decrypt ---

export async function encrypt(store: SignalStore, address: string, plaintext: Uint8Array, pad = true, pqr?: EncryptPqr): Promise<EncryptedSignalMessage> {
  let state = store.sessions.get(address);
  if (!state) {
    throw new Error(`No session for ${address}`);
  }
  let { messageKey, nextChainKey } = chainStep(state.senderChainKey);
  let counter = state.senderChainIndex;
  state.senderChainKey = nextChainKey;
  state.senderChainIndex++;
  let keys = deriveKeys(messageKey, pqr ? pqr.key : undefined);
  // WhatsApp adds its own 1..15-byte padding; OMEMO (`pad` false) relies solely
  // on the AES-CBC PKCS#7 padding, matching upstream libsignal.
  let ciphertext = await aesCBCEncrypt(keys.cipherKey, keys.iv, pad ? padPlaintext(plaintext) : plaintext);
  let signal = serializeSignalMessage({
    ratchetKey: djbEncode(state.senderRatchetKeyPair.publicKey),
    counter, previousCounter: state.previousCounter, ciphertext,
    pqRatchet: pqr?.ratchetBytes,
    // SPQR-bearing 1:1 messages declare version 4 so the peer applies the SPQR key mix.
  }, keys.macKey, state.localIdentityKey, state.remoteIdentityKey, pqr ? kSignalVersionV4 : kSignalVersion);
  if (state.pendingPreKey) {
    let body = serializePreKeySignalMessage({
      registrationID: store.registrationID,
      preKeyID: state.pendingPreKey.preKeyID,
      signedPreKeyID: state.pendingPreKey.signedPreKeyID,
      baseKey: state.pendingPreKey.baseKey,
      identityKey: state.localIdentityKey,
      message: signal,
    });
    return { type: "pkmsg", body };
  }
  return { type: "msg", body: signal };
}

/** Decrypts a `pkmsg` (PreKeySignalMessage), (re)establishing the session from
 * the message's own X3DH keys unless we already hold the very session it set up.
 *
 * A `pkmsg` always carries everything needed to build the responder session, so
 * "we already have a session for this address" is NOT a reason to skip the X3DH:
 * if that session is one WE initiated (we sent first), or an older one from a
 * different `pkmsg`, decrypting this message against it gives a guaranteed Bad
 * MAC. We rebuild whenever the incoming base key differs from the one that
 * established our current session (matching libsignal's session-collision
 * handling). The peer resends the *same* session's `pkmsg` (same base key, with
 * its own device-identity) until we reply, so a matching base key means "more on
 * the responder session we already have" — decrypt it on that, don't rebuild.
 *
 * If a rebuilt session fails to decrypt, it's rolled back (and the one-time
 * prekey left intact) so a later message or peer retry can establish cleanly. */
export async function decryptPreKeyMessage(store: SignalStore, address: string, data: Uint8Array, pad = true, pqr?: DecryptPqr): Promise<Uint8Array> {
  let pkmsg = parsePreKeySignalMessage(data);
  let previous = store.sessions.get(address);
  let sameSession = !!previous?.establishingBaseKey && bytesEqual(previous.establishingBaseKey, pkmsg.baseKey);
  if (!sameSession) {
    createSessionFromPreKey(store, address, data); // overwrites any unrelated session at this address
  }
  try {
    let plaintext = await decryptSignalMessage(store, address, pkmsg.message, pad, pqr);
    if (!sameSession) {
      store.saveIdentity(address, djbDecode(pkmsg.identityKey)); // after the MAC: a forged pkmsg must not replace the known key
    }
    if (!sameSession && pkmsg.preKeyID != null) {
      store.preKeys.delete(pkmsg.preKeyID); // confirmed: consume the one-time prekey
    }
    return plaintext;
  } catch (ex) {
    if (!sameSession) {
      // Restore whatever session we displaced (e.g. our own pending outbound one),
      // so a failed rebuild doesn't also destroy a working session.
      if (previous) {
        store.sessions.set(address, previous);
      } else {
        store.sessions.delete(address);
      }
    }
    throw ex;
  }
}

/** Decrypts a `msg` (SignalMessage) on an existing session. */
export async function decryptSignalMessage(store: SignalStore, address: string, data: Uint8Array, pad = true, pqr?: DecryptPqr): Promise<Uint8Array> {
  let state = store.sessions.get(address);
  if (!state) {
    throw new Error(`No session for ${address}`);
  }
  let parsed = parseSignalMessage(data);
  let theirRatchet = djbDecode(parsed.ratchetKey);
  if (!state.theirRatchetKey || !bytesEqual(state.theirRatchetKey, theirRatchet)) {
    if (state.theirRatchetKey) {
      skipReceiverKeys(state, bytesToHex(state.theirRatchetKey), parsed.previousCounter);
    }
    dhRatchet(state, theirRatchet);
  }
  let messageKey = getReceiverMessageKey(state, theirRatchet, parsed.counter);
  let pqrKey = pqr ? pqr(parsed.pqRatchet) : undefined;
  let keys = deriveKeys(messageKey, pqrKey);
  if (!verifySignalMessageMAC(parsed, keys.macKey, state.remoteIdentityKey, state.localIdentityKey)) {
    throw new Error("Bad MAC on SignalMessage");
  }
  let decrypted = await aesCBCDecrypt(keys.cipherKey, keys.iv, parsed.ciphertext);
  let plaintext = pad ? unpadPlaintext(decrypted) : decrypted;
  state.pendingPreKey = undefined; // the session is now confirmed by the peer
  state.pendingKyber = undefined;
  return plaintext;
}

function dhRatchet(state: SessionState, theirRatchet: Uint8Array) {
  state.previousCounter = state.senderChainIndex;
  let receiving = kdfRootKey(state.rootKey, sharedSecret(state.senderRatchetKeyPair.privateKey, theirRatchet));
  state.receiverChains.set(bytesToHex(theirRatchet), { chainKey: receiving.chainKey, index: 0 });
  state.theirRatchetKey = theirRatchet;
  state.senderRatchetKeyPair = KeyPair.generate();
  let sending = kdfRootKey(receiving.rootKey, sharedSecret(state.senderRatchetKeyPair.privateKey, theirRatchet));
  state.rootKey = sending.rootKey;
  state.senderChainKey = sending.chainKey;
  state.senderChainIndex = 0;
}

function getReceiverMessageKey(state: SessionState, ratchet: Uint8Array, counter: number): Uint8Array {
  let ratchetHex = bytesToHex(ratchet);
  let skipKey = `${ratchetHex}:${counter}`;
  if (state.skippedKeys.has(skipKey)) {
    let mk = state.skippedKeys.get(skipKey)!;
    state.skippedKeys.delete(skipKey);
    return mk;
  }
  let chain = state.receiverChains.get(ratchetHex);
  if (!chain) {
    throw new Error("No receiver chain for ratchet key");
  }
  if (counter < chain.index) {
    throw new Error("Duplicate or too-old message");
  }
  if (counter - chain.index > kMaxSkip) {
    throw new Error("Too many skipped messages");
  }
  while (chain.index < counter) {
    let { messageKey, nextChainKey } = chainStep(chain.chainKey);
    state.skippedKeys.set(`${ratchetHex}:${chain.index}`, messageKey);
    chain.chainKey = nextChainKey;
    chain.index++;
  }
  let { messageKey, nextChainKey } = chainStep(chain.chainKey);
  chain.chainKey = nextChainKey;
  chain.index++;
  return messageKey;
}

function skipReceiverKeys(state: SessionState, ratchetHex: string, untilCounter: number) {
  let chain = state.receiverChains.get(ratchetHex);
  if (!chain) {
    return;
  }
  while (chain.index < untilCounter && untilCounter - chain.index <= kMaxSkip) {
    let { messageKey, nextChainKey } = chainStep(chain.chainKey);
    state.skippedKeys.set(`${ratchetHex}:${chain.index}`, messageKey);
    chain.chainKey = nextChainKey;
    chain.index++;
  }
}
