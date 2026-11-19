/** Signal PQXDH: the post-quantum X3DH that establishes a pairwise session.
 *
 * Identical to the classic X3DH in {@link initiateSession} except for two
 * things, both verified against libsignal `pqxdh.rs` / `ratchet.rs`:
 *  1. One extra secret — an ML-KEM-1024 (Kyber) shared secret — is appended as
 *     the LAST secret, after all the EC DH secrets (after the optional one-time
 *     prekey DH), before the root-key KDF.
 *  2. The KDF info label is `WhisperText_X25519_SHA-256_CRYSTALS-KYBER-1024`
 *     instead of classic X3DH's `WhisperText`, and the KDF emits 96 bytes
 *     (root key, chain key, and a 32-byte initial post-quantum-ratchet key for
 *     the SPQR layer) rather than 64.
 *
 * The initiator encapsulates to the recipient's Kyber prekey and carries the
 * resulting ciphertext (plus the kyber prekey id) in the first `pkmsg`; the
 * recipient decapsulates with their Kyber prekey to recover the same secret.
 *
 * Everything after session establishment — the Double Ratchet for ongoing
 * messages — is unchanged, so this module produces a {@link SessionState} that
 * {@link SessionCipher.encrypt} / {@link decryptSignalMessage} drive as usual.
 *
 * The 32-byte `pqrKey` (the SPQR seed) is derived here and surfaced as a clean
 * boundary for the separate SPQR continuous-ratchet layer; this module itself
 * does not run SPQR. */
import { KeyPair } from "../Crypto/KeyPair";
import { sharedSecret, djbEncode, djbDecode, xeddsaSign, xeddsaVerify } from "../Crypto/curve";
import { hkdfSHA256, concatBytes, bytesEqual } from "../Crypto/primitives";
import { bytesToHex } from "@noble/curves/utils.js";
import type { SignalStore } from "../Crypto/Store";
import { PreKeyBundle, verifyPreKeyBundle } from "../Crypto/Identity";
import { SessionState, encrypt, decryptSignalMessage, type DecryptPqr, type EncryptPqr } from "../Crypto/SessionCipher";
import { kSignalVersionV4 } from "../Crypto/messages";
import { ProtoWriter, readProto, getBytes, getInt } from "../Proto/ProtobufLite";
import { KyberKeyPair, kyberEncapsulate, kKyberPublicKeyLength } from "./kyber";

const enc = (s: string) => new TextEncoder().encode(s);
const kZero32 = new Uint8Array(32);
const kDiscontinuity = new Uint8Array(32).fill(0xFF);
/** PQXDH KDF info — differs from classic X3DH's `WhisperText`. */
const kPqxdhLabel = "WhisperText_X25519_SHA-256_CRYSTALS-KYBER-1024";

/** A recipient's Kyber (ML-KEM-1024) prekey, the post-quantum half of a
 * PQXDH-capable {@link PreKeyBundle}. Published and signed like a signed prekey. */
export class KyberPreKeyBundle {
  keyID: number;
  publicKey: Uint8Array; // 1568-byte ML-KEM public key
  /** XEdDSA signature over the public key, by the identity key. */
  signature: Uint8Array;

  constructor(keyID: number, publicKey: Uint8Array, signature: Uint8Array) {
    this.keyID = keyID;
    this.publicKey = publicKey;
    this.signature = signature;
  }
}

/** Derives the PQXDH root/chain/pqr keys from the concatenated secrets.
 * Mirrors `HandshakeKeys::derive` in pqxdh.rs (HKDF-SHA256, salt None, 96 bytes). */
function derivePqxdhKeys(secrets: Uint8Array): { rootKey: Uint8Array, chainKey: Uint8Array, pqrKey: Uint8Array } {
  let out = hkdfSHA256(secrets, kZero32, enc(kPqxdhLabel), 96);
  return { rootKey: out.slice(0, 32), chainKey: out.slice(32, 64), pqrKey: out.slice(64, 96) };
}

function kdfRootKey(rootKey: Uint8Array, dh: Uint8Array): { rootKey: Uint8Array, chainKey: Uint8Array } {
  let out = hkdfSHA256(dh, rootKey, enc("WhisperRatchet"), 64);
  return { rootKey: out.slice(0, 32), chainKey: out.slice(32, 64) };
}

/** Result of establishing a PQXDH session as the initiator: the live
 * {@link SessionState} (already stored), plus the SPQR seed for the optional
 * post-quantum-ratchet layer. The kyber ciphertext + ids ride in the first
 * outgoing `pkmsg` (see {@link encryptPqxdh}); they are also stashed on the
 * state's {@link SessionState.pendingKyber}. */
export interface PqxdhInitiateResult {
  state: SessionState;
  /** 32-byte initial post-quantum-ratchet (SPQR) key. */
  pqrKey: Uint8Array;
}

/** Starts a PQXDH session as the initiator (Alice), from the peer's prekey
 * bundle + their Kyber prekey. Classic X3DH plus one ML-KEM secret.
 *
 * `pendingKyber` is set on the resulting state so the first outgoing `pkmsg`
 * (built by {@link encryptPqxdh}) carries the kyber ciphertext and ids. */
export function initiatePqxdhSession(store: SignalStore, address: string, bundle: PreKeyBundle, kyberPreKey: KyberPreKeyBundle): PqxdhInitiateResult {
  if (!verifyPreKeyBundle(bundle)) {
    throw new Error("Invalid signed prekey signature in bundle");
  }
  if (!verifyKyberPreKey(bundle.identityKey, kyberPreKey)) {
    throw new Error("Invalid kyber prekey signature in bundle");
  }
  if (kyberPreKey.publicKey.length != kKyberPublicKeyLength) {
    throw new Error("Bad kyber prekey length");
  }
  let baseKey = KeyPair.generate(); // EK_a
  let secrets = [kDiscontinuity,
    sharedSecret(store.identityKeyPair.privateKey, bundle.signedPreKeyPublic), // DH1
    sharedSecret(baseKey.privateKey, bundle.identityKey), // DH2
    sharedSecret(baseKey.privateKey, bundle.signedPreKeyPublic)]; // DH3
  if (bundle.preKeyPublic) {
    secrets.push(sharedSecret(baseKey.privateKey, bundle.preKeyPublic)); // DH4
  }
  // ML-KEM encapsulation is the LAST secret, after all the EC DHs.
  let { cipherText: kyberCiphertext, sharedSecret: kemSecret } = kyberEncapsulate(kyberPreKey.publicKey);
  secrets.push(kemSecret);

  let { rootKey: rk0, chainKey: ck0, pqrKey } = derivePqxdhKeys(concatBytes(...secrets));
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
  state.pendingKyber = { kyberPreKeyID: kyberPreKey.keyID, ciphertext: kyberCiphertext };
  store.sessions.set(address, state);
  store.saveIdentity(address, bundle.identityKey);
  return { state, pqrKey };
}

/** Encrypts to a PQXDH-established session. Identical to
 * {@link SessionCipher.encrypt}, but while the session is still pending (peer
 * has not replied) the `pkmsg` it emits is upgraded to carry the kyber prekey id
 * and ciphertext. Once the peer replies (pendingPreKey cleared by the ratchet),
 * subsequent messages are plain `msg`s — use {@link SessionCipher.encrypt}.
 * @param pqr optional SPQR send output (triple ratchet) — mixed into the message
 *   keys + carried as the inner SignalMessage's `pq_ratchet` (Docs/08). */
export async function encryptPqxdh(store: SignalStore, address: string, plaintext: Uint8Array, pad = true, pqr?: EncryptPqr): Promise<{ type: "pkmsg" | "msg", body: Uint8Array }> {
  let state = store.sessions.get(address);
  if (!state) {
    throw new Error(`No session for ${address}`);
  }
  let kyber = state.pendingKyber;
  let result = await encrypt(store, address, plaintext, pad, pqr);
  if (result.type != "pkmsg" || !kyber) {
    return result;
  }
  // Re-wrap the classic pkmsg with the kyber fields. The inner SignalMessage and
  // all classic fields are reused verbatim from the SessionCipher's pkmsg.
  let classic = parsePqPreKeyMessage(result.body);
  let body = serializePqPreKeyMessage({
    registrationID: classic.registrationID,
    preKeyID: classic.preKeyID,
    signedPreKeyID: classic.signedPreKeyID,
    kyberPreKeyID: kyber.kyberPreKeyID,
    kyberCiphertext: kyber.ciphertext,
    baseKey: classic.baseKey,
    identityKey: classic.identityKey,
    message: classic.message,
  });
  return { type: "pkmsg", body };
}

/** Starts a PQXDH session as the responder (Bob), from an incoming
 * kyber-carrying `pkmsg`, then decrypts the inner message.
 *
 * Mirrors {@link SessionCipher.decryptPreKeyMessage}'s session-collision and
 * one-time-prekey handling, but adds the ML-KEM decapsulation and the PQXDH
 * KDF. The one-time prekey is consumed only after the inner MAC verifies.
 *
 * @param ourKyberKeyPair our Kyber prekey matching `kyber_pre_key_id`.
 * @param pqr optional SPQR recv callback (triple ratchet, Docs/08) — mixed into
 *   the inner message keys. Absent → classic PQXDH+Double-Ratchet only.
 * @param onEstablish when a NEW responder session is built (not a duplicate of
 *   the existing one), called with the recovered 32-byte `pqrKey` so the caller
 *   can seed its SPQR responder state before the inner decrypt runs. */
export async function decryptPqxdhPreKeyMessage(store: SignalStore, address: string, data: Uint8Array, ourKyberKeyPair: KyberKeyPair, pad = true, pqr?: DecryptPqr, onEstablish?: (pqrKey: Uint8Array) => void): Promise<Uint8Array> {
  let pkmsg = parsePqPreKeyMessage(data);
  if (pkmsg.kyberCiphertext == null) {
    throw new Error("PreKeySignalMessage has no kyber ciphertext");
  }
  let previous = store.sessions.get(address);
  let sameSession = !!previous?.establishingBaseKey && bytesEqual(previous.establishingBaseKey, pkmsg.baseKey);
  if (!sameSession) {
    let { pqrKey } = createPqxdhSessionFromPreKey(store, address, pkmsg, ourKyberKeyPair);
    onEstablish?.(pqrKey);
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
      if (previous) {
        store.sessions.set(address, previous);
      } else {
        store.sessions.delete(address);
      }
    }
    throw ex;
  }
}

/** Builds the responder {@link SessionState} from a parsed kyber `pkmsg`,
 * decapsulating the ML-KEM secret with our Kyber prekey. Also returns the 32-byte
 * `pqrKey` (the SPQR seed) so the responder can seed its triple ratchet. */
function createPqxdhSessionFromPreKey(store: SignalStore, address: string, pkmsg: PqPreKeyMessageFields, ourKyberKeyPair: KyberKeyPair): { state: SessionState, pqrKey: Uint8Array } {
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
  // ML-KEM decapsulation is the LAST secret, matching the initiator.
  let kemSecret = ourKyberKeyPair.decapsulate(pkmsg.kyberCiphertext!);
  secrets.push(kemSecret);

  let { rootKey, chainKey, pqrKey } = derivePqxdhKeys(concatBytes(...secrets));

  let state = new SessionState();
  state.rootKey = rootKey;
  state.senderRatchetKeyPair = signedPreKey.keyPair; // Bob's initial ratchet = SPK
  state.senderChainKey = chainKey;
  state.remoteIdentityKey = pkmsg.identityKey;
  state.localIdentityKey = djbEncode(store.identityKeyPair.publicKey);
  state.establishingBaseKey = pkmsg.baseKey;
  store.sessions.set(address, state);
  return { state, pqrKey };
}

// --- PreKeySignalMessage with kyber fields (wire fields 7, 8) ---

export interface PqPreKeyMessageFields {
  registrationID: number;
  preKeyID?: number;
  signedPreKeyID: number;
  kyberPreKeyID?: number;
  kyberCiphertext?: Uint8Array; // 1568-byte ML-KEM ciphertext
  baseKey: Uint8Array; // 33-byte djb-encoded
  identityKey: Uint8Array; // 33-byte djb-encoded
  message: Uint8Array; // a serialized SignalMessage
}

/** Serializes a PreKeySignalMessage incl. the kyber fields (7 = kyber_pre_key_id,
 * 8 = kyber_ciphertext). Identical to the classic wrapper otherwise. */
export function serializePqPreKeyMessage(fields: PqPreKeyMessageFields): Uint8Array {
  let proto = new ProtoWriter()
    .varint(5, fields.registrationID)
    .varint(1, fields.preKeyID)
    .varint(6, fields.signedPreKeyID)
    .varint(7, fields.kyberPreKeyID)
    .bytes(8, fields.kyberCiphertext)
    .bytes(2, fields.baseKey)
    .bytes(3, fields.identityKey)
    .bytes(4, fields.message)
    .finish();
  return concatBytes(new Uint8Array([kSignalVersionV4]), proto); // PQXDH pkmsg is version 4
}

export function parsePqPreKeyMessage(data: Uint8Array): PqPreKeyMessageFields {
  let fields = readProto(data.subarray(1));
  return {
    registrationID: getInt(fields, 5) ?? 0,
    preKeyID: getInt(fields, 1),
    signedPreKeyID: getInt(fields, 6) ?? 0,
    kyberPreKeyID: getInt(fields, 7),
    kyberCiphertext: getBytes(fields, 8),
    baseKey: getBytes(fields, 2)!,
    identityKey: getBytes(fields, 3)!,
    message: getBytes(fields, 4)!,
  };
}

// --- Kyber prekey signing/verification ---

/** libsignal-serialized Kyber public key: type byte 0x08 (KeyType::Kyber1024) ‖ raw
 * 1568-byte ML-KEM key. The prekey signature is over THIS form (not the raw key), so
 * both sign and verify re-frame; matches `keysJSON.serializeKyberPublicKey` on publish. */
function serializeKyberKey(publicKey: Uint8Array): Uint8Array {
  let out = new Uint8Array(1 + publicKey.length);
  out[0] = 0x08;
  out.set(publicKey, 1);
  return out;
}

/** Signs a Kyber prekey with the identity key (XEdDSA), over the serialized key. */
export function signKyberPreKey(identityPrivateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return xeddsaSign(identityPrivateKey, serializeKyberKey(publicKey));
}

/** Verifies a Kyber prekey's signature against the bundle's identity key. */
export function verifyKyberPreKey(identityKey: Uint8Array, kyberPreKey: KyberPreKeyBundle): boolean {
  return xeddsaVerify(identityKey, serializeKyberKey(kyberPreKey.publicKey), kyberPreKey.signature);
}

