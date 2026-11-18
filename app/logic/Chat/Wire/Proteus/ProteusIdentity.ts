/** Our long-term Proteus identity: one Ed25519 key pair, generated once when the
 * device is registered and kept for the life of the device.
 *
 * Every session handshake authenticates it, and peers pin it: if we ever lose it
 * and generate a new one, every peer that already has a session with us reports
 * `RemoteIdentityChanged` and shows a security warning. So it is persisted with
 * the account config, next to the client ID it belongs to. */
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/curves/utils.js";
import { sharedSecret } from "../../Signal/Crypto/curve";
import { base64Encode, base64Decode } from "../../Signal/Crypto/primitives";

export class ProteusIdentity {
  keyPair: ProteusKeyPair;

  constructor(keyPair: ProteusKeyPair) {
    this.keyPair = keyPair;
  }

  static createNew(): ProteusIdentity {
    return new ProteusIdentity(ProteusKeyPair.generate());
  }

  /** 32-byte Ed25519 public key, as it travels in prekey bundles and messages */
  get publicKey(): Uint8Array {
    return this.keyPair.publicKey;
  }

  /** What the user compares out of band to verify a device. */
  get fingerprint(): string {
    return fingerprintOf(this.keyPair.publicKey);
  }

  toJSON(): any {
    return { secretKey: base64Encode(this.keyPair.secretKey) };
  }

  static fromJSON(json: any): ProteusIdentity {
    return new ProteusIdentity(ProteusKeyPair.fromSecret(base64Decode(json.secretKey)));
  }
}

/** An Ed25519 key pair, which is what Proteus stores and puts on the wire — for
 * identities, prekeys and ratchet keys alike. Diffie-Hellman is X25519 though,
 * so `dh()` maps both sides to Montgomery form first: the private key by the
 * standard SHA-512 clamp of the seed, the peer's public key by the birational
 * map from the Edwards curve. Getting either wrong is a silent interop failure,
 * so both come from @noble rather than being open-coded here. */
export class ProteusKeyPair {
  /** 32-byte Ed25519 seed */
  secretKey: Uint8Array;
  /** 32-byte Ed25519 public key */
  publicKey: Uint8Array;

  constructor(secretKey: Uint8Array, publicKey: Uint8Array) {
    this.secretKey = secretKey;
    this.publicKey = publicKey;
  }

  static generate(): ProteusKeyPair {
    let keys = ed25519.keygen();
    return new ProteusKeyPair(keys.secretKey, keys.publicKey);
  }

  static fromSecret(secretKey: Uint8Array): ProteusKeyPair {
    return new ProteusKeyPair(secretKey, ed25519.getPublicKey(secretKey));
  }

  /** X25519 DH against a peer's *Ed25519* public key.
   * @returns the 32-byte shared secret
   * @throws if the peer key is all zero or otherwise not a usable curve point */
  dh(peerPublicKey: Uint8Array): Uint8Array {
    return sharedSecret(ed25519.utils.toMontgomerySecret(this.secretKey),
      ed25519.utils.toMontgomery(peerPublicKey));
  }

  /** Ed25519 signature, used for the optional prekey bundle signature. */
  sign(message: Uint8Array): Uint8Array {
    return ed25519.sign(message, this.secretKey);
  }

  static verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
    try {
      return ed25519.verify(signature, message, publicKey);
    } catch (ex) {
      return false;
    }
  }

  toJSON(): any {
    return base64Encode(this.secretKey);
  }

  static fromJSON(json: any): ProteusKeyPair {
    return ProteusKeyPair.fromSecret(base64Decode(json));
  }
}

/** The lowercase hex of an Ed25519 public key, which is how Wire shows a device
 * fingerprint. */
export function fingerprintOf(publicKey: Uint8Array): string {
  return bytesToHex(publicKey);
}
