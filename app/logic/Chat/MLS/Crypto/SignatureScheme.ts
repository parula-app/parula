/** The signature half of an MLS cipher suite, RFC 9420 § 5.1.2.
 *
 * The scheme signs the raw bytes handed to it; the `SignContent` framing with
 * the "MLS 1.0 " label lives in `CipherSuite.signWithLabel()`.
 *
 * Encoding follows RFC 8446: EdDSA signatures are R || S, ECDSA signatures are
 * DER. ECDSA here must accept high-S signatures, which other MLS
 * implementations produce and TLS does not forbid. */
import { fullWidthScalar, type KeyPair } from "./KEM";
import { p256, p384, p521 } from "@noble/curves/nist.js";
import { ed25519 } from "@noble/curves/ed25519.js";

export abstract class SignatureScheme {
  /** The TLS `SignatureScheme` code point, RFC 8446 § 4.2.3 */
  abstract readonly id: number;
  /** The length of a serialized public key, for validation */
  abstract readonly publicKeyLength: number;

  abstract generateKeyPair(): KeyPair;
  abstract publicKeyFor(privateKey: Uint8Array): Uint8Array;
  abstract sign(privateKey: Uint8Array, message: Uint8Array): Uint8Array;
  abstract verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean;
}

/** EdDSA over Curve25519. Its private key is a seed, not a scalar, so no
 * implementation strips leading zero bytes off it and a key of any other length
 * is simply invalid — unlike the ECDSA scalars below. */
export class Ed25519Signature extends SignatureScheme {
  readonly id = 0x0807;
  readonly publicKeyLength = 32;

  static readonly instance = new Ed25519Signature();

  generateKeyPair(): KeyPair {
    let privateKey = ed25519.utils.randomSecretKey();
    return { privateKey, publicKey: ed25519.getPublicKey(privateKey) };
  }

  publicKeyFor(privateKey: Uint8Array): Uint8Array {
    return ed25519.getPublicKey(privateKey);
  }

  sign(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
    return ed25519.sign(message, privateKey);
  }

  verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
    try {
      return ed25519.verify(signature, message, publicKey);
    } catch (ex) {
      return false; // Malformed signature or public key
    }
  }
}

/** ECDSA over a NIST curve, with the curve's matching SHA-2 hash. */
export class ECDSASignature extends SignatureScheme {
  readonly id: number;
  readonly publicKeyLength: number;
  /** `Nsk`: the full width of the private scalar, = the coordinate length */
  readonly privateKeyLength: number;
  protected readonly curve: typeof p256;

  protected constructor(id: number, curve: typeof p256, coordinateLength: number) {
    super();
    this.id = id;
    this.curve = curve;
    this.publicKeyLength = 1 + 2 * coordinateLength;
    this.privateKeyLength = coordinateLength;
  }

  static readonly p256 = new ECDSASignature(0x0403, p256, 32);
  static readonly p384 = new ECDSASignature(0x0503, p384, 48);
  static readonly p521 = new ECDSASignature(0x0603, p521, 66);

  generateKeyPair(): KeyPair {
    let privateKey = this.curve.utils.randomSecretKey();
    return { privateKey, publicKey: this.publicKeyFor(privateKey) };
  }

  publicKeyFor(privateKey: Uint8Array): Uint8Array {
    return this.curve.getPublicKey(fullWidthScalar(privateKey, this.privateKeyLength), false);
  }

  sign(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
    return this.curve.sign(message, fullWidthScalar(privateKey, this.privateKeyLength),
      { format: "der", lowS: false });
  }

  verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
    try {
      return this.curve.verify(signature, message, publicKey, { format: "der", lowS: false });
    } catch (ex) {
      return false; // Malformed DER, or a point not on the curve
    }
  }
}
