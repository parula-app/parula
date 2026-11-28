/** Sealed Sender (libsignal `sealed_sender.rs`) — hides the sender's identity
 * from the server. The recipient still learns who sent the message, via a
 * SenderCertificate inside the encrypted payload.
 *
 * Two on-wire formats, both decryptable here:
 *  - v1 (`0x11`): single-recipient KEM. Ephemeral key + AES-256-CTR encryption of
 *    the sender's identity key and the inner content, each with a 10-byte
 *    truncated HMAC. KDF salt string "UnidentifiedDelivery".
 *  - v2 (`0x22`/`0x23`): multi-recipient KEM (Barbosa randomness-reuse). One
 *    AES-256-GCM-SIV ciphertext shared across recipients; per-recipient a
 *    32-byte XOR-masked seed C and a 16-byte authentication tag AT.
 *
 * The certificate chain: a hardcoded trust root signs a ServerCertificate, which
 * signs a SenderCertificate. All signatures are XEdDSA over the serialized inner
 * certificate bytes. Public keys are serialized in the 33-byte DJB form (0x05 ‖
 * key) everywhere they feed a KDF, an agreement input, or a certificate field;
 * the lone exception is the v2 wire `e_pub`, which is the bare 32-byte key. */
import { KeyPair } from "../Crypto/KeyPair";
import { sharedSecret, djbEncode, djbDecode, xeddsaSign, xeddsaVerify } from "../Crypto/curve";
import { hkdfSHA256, hmacSHA256, bytesEqual, randomBytes, concatBytes } from "../Crypto/primitives";
import { hexToBytes } from "@noble/hashes/utils.js";
import { aesGcmSivEncrypt, aesGcmSivDecrypt } from "./aesGcmSiv";
import * as proto from "../Proto/sealedSender";
import { encode, decode } from "../Proto/codec";
import { ctr } from "@noble/ciphers/aes.js";

// --- constants ---

export const kSealedSenderV1FullVersion = 0x11;
export const kSealedSenderV2UuidFullVersion = 0x22;
export const kSealedSenderV2ServiceIdFullVersion = 0x23;

const kSaltPrefix = new TextEncoder().encode("UnidentifiedDelivery");
const kLabelR = new TextEncoder().encode("Sealed Sender v2: r (2023-08)");
const kLabelK = new TextEncoder().encode("Sealed Sender v2: K");
const kLabelDH = new TextEncoder().encode("Sealed Sender v2: DH");
const kLabelDHs = new TextEncoder().encode("Sealed Sender v2: DH-sender");

const kMessageKeyLen = 32;
const kAuthTagLen = 16;
const kPublicKeyLen = 32;

/** Server certificate IDs that were revoked; only used to test the logic. */
const kRevokedServerCertificateKeyIDs = [0xDEADC357];

/** `CiphertextMessage` kind of the inner `content`, matching the proto enum. */
export enum CiphertextType {
  PreKey = 1,
  Whisper = 2,
  SenderKey = 7,
  Plaintext = 8,
}

/** ContentHint, stored in the USMC. Default (0) is encoded as absent. */
export enum ContentHint {
  Default = 0,
  Resendable = 1,
  Implicit = 2,
}

// --- certificates ---

export interface ServerCertificate {
  keyId: number;
  /** server signing public key, 32 raw bytes */
  key: Uint8Array;
  /** serialized inner Certificate, exactly as signed */
  certificate: Uint8Array;
  /** trust-root XEdDSA signature over `certificate` */
  signature: Uint8Array;
}

export interface SenderCertificate {
  senderUuid: string;
  senderE164?: string;
  senderDeviceId: number;
  /** expiry, epoch ms */
  expiration: bigint;
  /** sender identity public key, 32 raw bytes */
  key: Uint8Array;
  signer: ServerCertificate;
  /** serialized inner Certificate, exactly as signed */
  certificate: Uint8Array;
  /** server-key XEdDSA signature over `certificate` */
  signature: Uint8Array;
}

/** The inner, signed payload that both v1 and v2 ultimately encrypt. */
export interface UnidentifiedSenderMessageContent {
  type: CiphertextType;
  sender: SenderCertificate;
  /** the already-encrypted CiphertextMessage (or a PlaintextContent) */
  content: Uint8Array;
  contentHint: ContentHint;
  groupId?: Uint8Array;
}

/** Parse a serialized ServerCertificate (does not verify the signature). */
export function deserializeServerCertificate(data: Uint8Array): ServerCertificate {
  let pb = decode(proto.ServerCertificate, data);
  if (!pb.certificate || !pb.signature) {
    throw new Error("Invalid ServerCertificate encoding");
  }
  let inner = decode(proto.ServerCertificateInner, pb.certificate);
  if (inner.id == null || !inner.key) {
    throw new Error("Invalid ServerCertificate.Certificate encoding");
  }
  return {
    keyId: inner.id,
    key: djbDecode(inner.key),
    certificate: pb.certificate,
    signature: pb.signature,
  };
}

/** Validate a ServerCertificate against the trust root. */
export function validateServerCertificate(cert: ServerCertificate, trustRoot: Uint8Array): boolean {
  if (kRevokedServerCertificateKeyIDs.includes(cert.keyId)) {
    return false;
  }
  return xeddsaVerify(trustRoot, cert.certificate, cert.signature);
}

/** libsignal's hardcoded server certificates (sealed_sender.rs KNOWN_SERVER_CERTIFICATES),
 * which a SenderCertificate may reference by id (the `signer` oneof's `id = 8`) instead
 * of embedding the whole ServerCertificate. As in libsignal, a by-id certificate must be
 * signed by one of the caller's trust roots, the same as an embedded one, because id 2
 * is signed by the staging root, and anybody can sign with the test certificate 0x7357C357. */
const kKnownServerCertificates: { id: number, certHex: string }[] = [
  { id: 2, certHex: "0a25080212210539450d63ebd0752c0fd4038b9d07a916f5e174b756d409b5ca79f4c97400631e124064c5a38b1e927497d3d4786b101a623ab34a7da3954fae126b04dba9d7a3604ed88cdc8550950f0d4a9134ceb7e19b94139151d2c3d6e1c81e9d1128aafca806" },
  { id: 3, certHex: "0a250803122105bc9d1d290be964810dfa7e94856480a3f7060d004c9762c24c575a1522353a5a1240c11ec3c401eb0107ab38f8600e8720a63169e0e2eb8a3fae24f63099f85ea319c3c1c46d3454706ae2a679d1fee690a488adda98a2290b66c906bb60295ed781" },
  { id: 0x7357C357, certHex: "0a2908d786df9a07122105847c0d2c375234f365e660955187a3735a0f7613d1609d3a6a4d8c53aeaa5a221240e0b9ebacdfc3aa2827f7924b697784d1c25e44ca05dd433e1a38dc6382eb2730d419ca9a250b1be9d5a9463e61efd6781777a91b83c97b844d014206e2829785" },
];

let gKnownServerCerts: Map<number, ServerCertificate> | null = null;

/** Resolve a known server certificate by id (the by-id `signer` form). */
function knownServerCertificate(id: number): ServerCertificate | undefined {
  if (!gKnownServerCerts) {
    gKnownServerCerts = new Map();
    for (let entry of kKnownServerCertificates) {
      gKnownServerCerts.set(entry.id, deserializeServerCertificate(hexToBytes(entry.certHex)));
    }
  }
  return gKnownServerCerts.get(id);
}

/** Parse a serialized SenderCertificate (does not verify the chain). The signer
 * ServerCertificate is either embedded (`signer.certificate`) or referenced by id
 * (`signer.id`, resolved from KNOWN_SERVER_CERTIFICATES). */
export function deserializeSenderCertificate(data: Uint8Array): SenderCertificate {
  let pb = decode(proto.SenderCertificate, data);
  if (!pb.certificate || !pb.signature) {
    throw new Error("Invalid SenderCertificate encoding");
  }
  let inner = decode(proto.SenderCertificateInner, pb.certificate);
  if (inner.senderDevice == null || inner.expires == null || !inner.identityKey) {
    throw new Error("Invalid SenderCertificate.Certificate encoding");
  }
  let senderUuid = inner.uuidString || (inner.uuidBytes ? uuidFromBytes(inner.uuidBytes) : "");
  if (!senderUuid) {
    throw new Error("SenderCertificate has no sender UUID");
  }
  let signer: ServerCertificate;
  if (inner.signerCertificate) {
    signer = deserializeServerCertificate(inner.signerCertificate);
  } else if (inner.signerId != null) {
    let known = knownServerCertificate(inner.signerId);
    if (!known) {
      throw new Error(`Unknown sealed-sender server certificate id ${inner.signerId}`);
    }
    signer = known;
  } else {
    throw new Error("SenderCertificate has no signer (neither embedded nor by id)");
  }
  return {
    senderUuid,
    senderE164: inner.senderE164 || undefined,
    senderDeviceId: inner.senderDevice,
    expiration: inner.expires,
    key: djbDecode(inner.identityKey),
    signer,
    certificate: pb.certificate,
    signature: pb.signature,
  };
}

/** Validate the full chain: the signer is signed by one of `trustRoots`, the signer's
 * key signed this certificate, and it is not expired at `validationTimeMs`. */
export function validateSenderCertificate(cert: SenderCertificate, trustRoots: Uint8Array[], validationTimeMs: bigint): boolean {
  if (!trustRoots.some(trustRoot => validateServerCertificate(cert.signer, trustRoot))) {
    return false;
  }
  if (!xeddsaVerify(cert.signer.key, cert.certificate, cert.signature)) {
    return false;
  }
  if (validationTimeMs > cert.expiration) {
    return false;
  }
  return true;
}

// --- USMC (de)serialization ---

export function serializeUSMC(usmc: UnidentifiedSenderMessageContent): Uint8Array {
  return encode(proto.UnidentifiedSenderMessageContentProto, {
    type: usmc.type,
    senderCertificate: serializeSenderCertificate(usmc.sender),
    content: usmc.content,
    // Default (0) is encoded as absent (proto value 0 is reserved).
    contentHint: usmc.contentHint == ContentHint.Default ? undefined : usmc.contentHint,
    groupId: usmc.groupId && usmc.groupId.length ? usmc.groupId : undefined,
  });
}

export function deserializeUSMC(data: Uint8Array): UnidentifiedSenderMessageContent {
  let pb = decode(proto.UnidentifiedSenderMessageContentProto, data);
  if (pb.type == null || !pb.senderCertificate || !pb.content) {
    throw new Error("Invalid UnidentifiedSenderMessageContent encoding");
  }
  return {
    type: pb.type as CiphertextType,
    sender: deserializeSenderCertificate(pb.senderCertificate),
    content: pb.content,
    contentHint: (pb.contentHint ?? ContentHint.Default) as ContentHint,
    groupId: pb.groupId && pb.groupId.length ? pb.groupId : undefined,
  };
}

function serializeSenderCertificate(cert: SenderCertificate): Uint8Array {
  return encode(proto.SenderCertificate, { certificate: cert.certificate, signature: cert.signature });
}

function serializeServerCertificate(cert: ServerCertificate): Uint8Array {
  return encode(proto.ServerCertificate, { certificate: cert.certificate, signature: cert.signature });
}

// --- v1 symmetric cipher: AES-256-CTR (zero IV) + 10-byte truncated HMAC ---

const kZeroIV16 = new Uint8Array(16);

/** @returns AES-CTR(key, pt) ‖ HMAC-SHA256(macKey, ct)[..10]. */
function ctrHmacEncrypt(plaintext: Uint8Array, cipherKey: Uint8Array, macKey: Uint8Array): Uint8Array {
  let ciphertext = ctr(cipherKey, kZeroIV16).encrypt(plaintext);
  let mac = hmacSHA256(macKey, ciphertext).subarray(0, 10);
  return concatBytes(ciphertext, mac);
}

/** Verify the trailing 10-byte MAC, then AES-CTR-decrypt. */
function ctrHmacDecrypt(data: Uint8Array, cipherKey: Uint8Array, macKey: Uint8Array): Uint8Array {
  if (data.length < 10) {
    throw new Error("Sealed sender v1 ciphertext too short");
  }
  let ciphertext = data.subarray(0, data.length - 10);
  let mac = data.subarray(data.length - 10);
  if (!bytesEqual(hmacSHA256(macKey, ciphertext).subarray(0, 10), mac)) {
    throw new Error("Bad MAC on sealed sender v1 ciphertext");
  }
  return ctr(cipherKey, kZeroIV16).decrypt(ciphertext);
}

// --- v1 key derivation ---

interface EphemeralKeys { chainKey: Uint8Array; cipherKey: Uint8Array; macKey: Uint8Array; }

/** salt = "UnidentifiedDelivery" ‖ recipientPub ‖ ephemeralPub (sending order;
 * receiving swaps the two pubkeys). ikm = ECDH. 96 bytes → chain/cipher/mac.
 * Pubkeys are the 33-byte DJB form. */
function v1EphemeralKeys(ourPriv: Uint8Array, ourPubDjb: Uint8Array, theirPub: Uint8Array, sending: boolean): EphemeralKeys {
  let theirPubDjb = djbEncode(theirPub);
  let salt = sending
    ? concatBytes(kSaltPrefix, theirPubDjb, ourPubDjb)
    : concatBytes(kSaltPrefix, ourPubDjb, theirPubDjb);
  let ikm = sharedSecret(ourPriv, theirPub);
  let out = hkdfSHA256(ikm, salt, new Uint8Array(0), 96);
  return { chainKey: out.subarray(0, 32), cipherKey: out.subarray(32, 64), macKey: out.subarray(64, 96) };
}

interface StaticKeys { cipherKey: Uint8Array; macKey: Uint8Array; }

/** salt = chainKey ‖ encryptedStatic (the ciphertext incl. its 10-byte MAC).
 * ikm = ECDH(recipientIdentity, senderIdentity). 96 bytes, first 32 discarded. */
function v1StaticKeys(ourPriv: Uint8Array, theirPub: Uint8Array, chainKey: Uint8Array, ctext: Uint8Array): StaticKeys {
  let salt = concatBytes(chainKey, ctext);
  let ikm = sharedSecret(ourPriv, theirPub);
  let out = hkdfSHA256(ikm, salt, new Uint8Array(0), 96);
  return { cipherKey: out.subarray(32, 64), macKey: out.subarray(64, 96) };
}

/** Sealed Sender v1 encrypt of a USMC to a single recipient identity key.
 * @param recipientIdentityKey 32 raw or 33-byte DJB. */
export function sealedSenderEncryptV1(
  usmc: UnidentifiedSenderMessageContent,
  ourIdentity: KeyPair,
  recipientIdentityKey: Uint8Array,
): Uint8Array {
  let recipientPub = djbDecode(recipientIdentityKey);
  let ephemeral = KeyPair.generate();
  let ephPubDjb = djbEncode(ephemeral.publicKey);

  let ephKeys = v1EphemeralKeys(ephemeral.privateKey, ephPubDjb, recipientPub, true);
  let staticCtext = ctrHmacEncrypt(djbEncode(ourIdentity.publicKey), ephKeys.cipherKey, ephKeys.macKey);

  let staticKeys = v1StaticKeys(ourIdentity.privateKey, recipientPub, ephKeys.chainKey, staticCtext);
  let messageCtext = ctrHmacEncrypt(serializeUSMC(usmc), staticKeys.cipherKey, staticKeys.macKey);

  let body = encode(proto.UnidentifiedSenderMessageV1, {
    ephemeralPublic: ephPubDjb,
    encryptedStatic: staticCtext,
    encryptedMessage: messageCtext,
  });
  return concatBytes(new Uint8Array([kSealedSenderV1FullVersion]), body);
}

function sealedSenderDecryptV1(remaining: Uint8Array, ourIdentity: KeyPair): UnidentifiedSenderMessageContent {
  let pb = decode(proto.UnidentifiedSenderMessageV1, remaining);
  if (!pb.ephemeralPublic || !pb.encryptedStatic || !pb.encryptedMessage) {
    throw new Error("Invalid sealed sender v1 message");
  }
  let ephemeralPub = djbDecode(pb.ephemeralPublic);
  let ourPubDjb = djbEncode(ourIdentity.publicKey);

  let ephKeys = v1EphemeralKeys(ourIdentity.privateKey, ourPubDjb, ephemeralPub, false);
  let staticKeyBytes = ctrHmacDecrypt(pb.encryptedStatic, ephKeys.cipherKey, ephKeys.macKey);
  let senderStaticKey = djbDecode(staticKeyBytes);

  let staticKeys = v1StaticKeys(ourIdentity.privateKey, senderStaticKey, ephKeys.chainKey, pb.encryptedStatic);
  let messageBytes = ctrHmacDecrypt(pb.encryptedMessage, staticKeys.cipherKey, staticKeys.macKey);

  let usmc = deserializeUSMC(messageBytes);
  // The recovered sender static key must equal the key in the SenderCertificate.
  if (!bytesEqual(senderStaticKey, usmc.sender.key)) {
    throw new Error("Sealed sender v1: sender certificate key does not match message key");
  }
  return usmc;
}

// --- v2 key derivation ---

interface V2Keys { e: KeyPair; k: Uint8Array; }

/** HKDF(None, M) expanded into the ephemeral key pair (LABEL_R) and the
 * AES-GCM-SIV content key (LABEL_K). */
function v2DeriveKeys(m: Uint8Array): V2Keys {
  let r = hkdfSHA256(m, new Uint8Array(0), kLabelR, 32);
  let k = hkdfSHA256(m, new Uint8Array(0), kLabelK, 32);
  return { e: KeyPair.fromPrivate(r), k };
}

/** mask = HKDF(None, DH(ours,theirs) ‖ ourPub ‖ theirPub).expand(LABEL_DH, 32),
 * then result = mask XOR input. Sending vs receiving swap the two pubkeys.
 * Pubkeys are 33-byte DJB. */
function v2ApplyAgreementXor(ourKeys: KeyPair, theirPub: Uint8Array, sending: boolean, input: Uint8Array): Uint8Array {
  let agreement = sharedSecret(ourKeys.privateKey, theirPub);
  let ourPubDjb = djbEncode(ourKeys.publicKey);
  let theirPubDjb = djbEncode(theirPub);
  let ikm = sending
    ? concatBytes(agreement, ourPubDjb, theirPubDjb)
    : concatBytes(agreement, theirPubDjb, ourPubDjb);
  let mask = hkdfSHA256(ikm, new Uint8Array(0), kLabelDH, 32);
  let out = new Uint8Array(kMessageKeyLen);
  for (let i = 0; i < kMessageKeyLen; i++) {
    out[i] = mask[i] ^ input[i];
  }
  return out;
}

/** AT = HKDF(None, DH(ourIdentity,theirIdentity) ‖ E.pub ‖ C ‖ ourPub ‖ theirPub)
 * .expand(LABEL_DH_S, 16). Sending vs receiving swap the last two pubkeys. */
function v2ComputeAuthTag(
  ourIdentity: KeyPair, theirIdentityPub: Uint8Array, sending: boolean,
  ephemeralPub: Uint8Array, encryptedMessageKey: Uint8Array,
): Uint8Array {
  let agreement = sharedSecret(ourIdentity.privateKey, theirIdentityPub);
  let ourPubDjb = djbEncode(ourIdentity.publicKey);
  let theirPubDjb = djbEncode(theirIdentityPub);
  let ikm = sending
    ? concatBytes(agreement, djbEncode(ephemeralPub), encryptedMessageKey, ourPubDjb, theirPubDjb)
    : concatBytes(agreement, djbEncode(ephemeralPub), encryptedMessageKey, theirPubDjb, ourPubDjb);
  return hkdfSHA256(ikm, new Uint8Array(0), kLabelDHs, kAuthTagLen);
}

const kZeroNonce12 = new Uint8Array(12);

export interface V2Recipient {
  /** recipient identity public key, 32 raw or 33-byte DJB */
  identityKey: Uint8Array;
  /** 17-byte ServiceId fixed-width binary (1 prefix byte ‖ 16 UUID). */
  serviceId: Uint8Array;
  /** the recipient's devices and their 14-bit registration ids */
  devices: { deviceId: number; registrationId: number }[];
}

/** A v2 SentMessage (multi-recipient, server-bound) plus the helper to split it
 * into the per-recipient ReceivedMessage the server would deliver. */
export interface V2SentMessage {
  /** the full SentMessage blob, version byte 0x23 */
  serialized: Uint8Array;
  /** the shared `E.pub ‖ ciphertext` suffix, for fan-out */
  sharedBytes: Uint8Array;
  /** per-recipient `C ‖ AT`, keyed by recipient index */
  recipientKeyMaterial: Uint8Array[];
}

/** Sealed Sender v2 multi-recipient encrypt.
 * @returns the SentMessage blob (version 0x23) and fan-out material. The single
 * AES-GCM-SIV ciphertext is shared; per-recipient we ship only C (32) + AT (16). */
export function sealedSenderEncryptV2(
  usmc: UnidentifiedSenderMessageContent,
  ourIdentity: KeyPair,
  recipients: V2Recipient[],
): V2SentMessage {
  let m = randomBytes(kMessageKeyLen);
  let keys = v2DeriveKeys(m);
  let ePub = keys.e.publicKey;

  let ciphertext = aesGcmSivEncrypt(keys.k, kZeroNonce12, serializeUSMC(usmc));

  // version byte
  let head: number[] = [kSealedSenderV2ServiceIdFullVersion];
  // recipient count as a protobuf varint
  pushVarint(head, recipients.length);

  let body: number[] = [];
  let recipientKeyMaterial: Uint8Array[] = [];
  for (let r of recipients) {
    let theirPub = djbDecode(r.identityKey);
    if (r.serviceId.length != 17) {
      throw new Error("v2 recipient serviceId must be 17 bytes (ServiceId fixed-width binary)");
    }
    for (let b of r.serviceId) {
      body.push(b);
    }
    for (let i = 0; i < r.devices.length; i++) {
      let d = r.devices[i];
      body.push(d.deviceId & 0xFF);
      let regId = d.registrationId & 0x3FFF;
      if (i < r.devices.length - 1) {
        regId |= 0x8000;
      }
      body.push((regId >> 8) & 0xFF);
      body.push(regId & 0xFF);
    }
    let c = v2ApplyAgreementXor(keys.e, theirPub, true, m);
    let at = v2ComputeAuthTag(ourIdentity, theirPub, true, ePub, c);
    for (let b of c) {
      body.push(b);
    }
    for (let b of at) {
      body.push(b);
    }
    recipientKeyMaterial.push(concatBytes(c, at));
  }

  let sharedBytes = concatBytes(ePub, ciphertext);
  let serialized = concatBytes(Uint8Array.from(head), Uint8Array.from(body), sharedBytes);
  return { serialized, sharedBytes, recipientKeyMaterial };
}

/** Build the per-recipient ReceivedMessage (version 0x22) the server hands a
 * recipient: `0x22 ‖ C ‖ AT ‖ E.pub ‖ ciphertext`. */
export function v2ReceivedMessageForRecipient(sent: V2SentMessage, recipientIndex: number): Uint8Array {
  return concatBytes(
    new Uint8Array([kSealedSenderV2UuidFullVersion]),
    sent.recipientKeyMaterial[recipientIndex],
    sent.sharedBytes,
  );
}

/** Encrypt a v2 message for a single recipient and return its ReceivedMessage
 * directly (the common 1:1 sealed-sender path). */
export function sealedSenderEncryptV2Single(
  usmc: UnidentifiedSenderMessageContent,
  ourIdentity: KeyPair,
  recipient: V2Recipient,
): Uint8Array {
  let sent = sealedSenderEncryptV2(usmc, ourIdentity, [recipient]);
  return v2ReceivedMessageForRecipient(sent, 0);
}

function sealedSenderDecryptV2(remaining: Uint8Array, ourIdentity: KeyPair): UnidentifiedSenderMessageContent {
  // ReceivedMessage prefix: C(32) ‖ AT(16) ‖ E.pub(32) ‖ ciphertext.
  if (remaining.length < kMessageKeyLen + kAuthTagLen + kPublicKeyLen) {
    throw new Error("Sealed sender v2 message too short");
  }
  let c = remaining.subarray(0, kMessageKeyLen);
  let at = remaining.subarray(kMessageKeyLen, kMessageKeyLen + kAuthTagLen);
  let ephemeralPub = remaining.subarray(kMessageKeyLen + kAuthTagLen, kMessageKeyLen + kAuthTagLen + kPublicKeyLen);
  let ciphertext = remaining.subarray(kMessageKeyLen + kAuthTagLen + kPublicKeyLen);

  let m = v2ApplyAgreementXor(ourIdentity, ephemeralPub, false, c);
  let keys = v2DeriveKeys(m);
  if (!bytesEqual(keys.e.publicKey, ephemeralPub)) {
    throw new Error("Sealed sender v2: derived ephemeral key did not match message");
  }

  let messageBytes = aesGcmSivDecrypt(keys.k, kZeroNonce12, ciphertext);
  let usmc = deserializeUSMC(messageBytes);

  let expectedAt = v2ComputeAuthTag(ourIdentity, usmc.sender.key, false, ephemeralPub, c);
  if (!bytesEqual(at, expectedAt)) {
    throw new Error("Sealed sender v2: sender certificate key does not match authentication tag");
  }
  return usmc;
}

/** Decrypt a sealed-sender blob (v1 or v2) to its USMC, without validating the
 * sender certificate against a trust root. */
export function sealedSenderDecryptToUSMC(ciphertext: Uint8Array, ourIdentity: KeyPair): UnidentifiedSenderMessageContent {
  if (ciphertext.length == 0) {
    throw new Error("Sealed sender message was empty");
  }
  let version = ciphertext[0] >> 4;
  let remaining = ciphertext.subarray(1);
  if (version == 0 || version == 1) {
    return sealedSenderDecryptV1(remaining, ourIdentity);
  }
  if (version == 2) {
    return sealedSenderDecryptV2(remaining, ourIdentity);
  }
  throw new Error(`Unknown sealed sender version ${version}`);
}

export interface SealedSenderResult {
  sender: SenderCertificate;
  /** the inner CiphertextMessage `content`; decrypt it with `type`'s cipher */
  content: Uint8Array;
  type: CiphertextType;
  contentHint: ContentHint;
  groupId?: Uint8Array;
}

/** Decrypt a sealed-sender blob (v1 or v2) and validate the sender certificate
 * chain against `trustRoots`. Returns the sender info plus the still-encrypted
 * inner CiphertextMessage `content` (to be handed to the Double-Ratchet /
 * sender-key layer per `type`). */
export function sealedSenderDecrypt(
  ciphertext: Uint8Array,
  ourIdentity: KeyPair,
  trustRoots: Uint8Array[],
  validationTimeMs: bigint,
): SealedSenderResult {
  let usmc = sealedSenderDecryptToUSMC(ciphertext, ourIdentity);
  if (!validateSenderCertificate(usmc.sender, trustRoots, validationTimeMs)) {
    throw new Error("Sealed sender: trust root validation failed");
  }
  return {
    sender: usmc.sender,
    content: usmc.content,
    type: usmc.type,
    contentHint: usmc.contentHint,
    groupId: usmc.groupId,
  };
}

// --- unidentified-access key ---

/** The unidentified access key the recipient publishes a commitment for, so the
 * server can authorize sealed-sender delivery without learning the sender.
 *   accessKey = AES-256-GCM(key=profileKey, iv=0¹², pt=0¹⁶)[:16]
 * i.e. the first 16 bytes of the ciphertext (the GCM tag is discarded). */
export async function deriveUnidentifiedAccessKey(profileKey: Uint8Array): Promise<Uint8Array> {
  let key = await globalThis.crypto.subtle.importKey("raw", profileKey as BufferSource, "AES-GCM", false, ["encrypt"]);
  let out = new Uint8Array(await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: kZeroNonce12 as BufferSource, tagLength: 128 },
    key,
    new Uint8Array(16) as BufferSource,
  ));
  return out.subarray(0, 16);
}

// --- certificate construction (used by tests; mirrors libsignal's `::new`) ---

/** Create + sign a ServerCertificate with the trust-root private key (XEdDSA). */
export function newServerCertificate(keyId: number, serverKey: Uint8Array, trustRootPriv: Uint8Array): ServerCertificate {
  let certificate = encode(proto.ServerCertificateInner, { id: keyId, key: djbEncode(djbDecode(serverKey)) });
  let signature = xeddsaSign(trustRootPriv, certificate);
  return { keyId, key: djbDecode(serverKey), certificate, signature };
}

export interface NewSenderCertificateArgs {
  senderUuid: string;
  senderE164?: string;
  senderIdentityKey: Uint8Array;
  senderDeviceId: number;
  expiration: bigint;
  signer: ServerCertificate;
  signerPriv: Uint8Array;
}

/** Create + sign a SenderCertificate with the server signing private key. */
export function newSenderCertificate(args: NewSenderCertificateArgs): SenderCertificate {
  let certificate = encode(proto.SenderCertificateInner, {
    senderE164: args.senderE164,
    senderDevice: args.senderDeviceId,
    expires: args.expiration,
    identityKey: djbEncode(djbDecode(args.senderIdentityKey)),
    signerCertificate: serializeServerCertificate(args.signer),
    uuidString: args.senderUuid,
  });
  let signature = xeddsaSign(args.signerPriv, certificate);
  return {
    senderUuid: args.senderUuid,
    senderE164: args.senderE164,
    senderDeviceId: args.senderDeviceId,
    expiration: args.expiration,
    key: djbDecode(args.senderIdentityKey),
    signer: args.signer,
    certificate,
    signature,
  };
}

// --- helpers ---

function pushVarint(out: number[], value: number) {
  while (value > 0x7F) {
    out.push((value & 0x7F) | 0x80);
    value >>>= 7;
  }
  out.push(value);
}

function uuidFromBytes(b: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < 16; i++) {
    hex += b[i].toString(16).padStart(2, "0");
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
