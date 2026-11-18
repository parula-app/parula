/** One MLS cipher suite, RFC 9420 § 5 and § 17.1.
 *
 * Everything the protocol does cryptographically goes through this class: it
 * owns the KEM, KDF, AEAD and signature scheme, and adds the MLS-specific
 * labelling that keeps the many uses of the same primitives apart
 * (`ExpandWithLabel`, `SignWithLabel`, `EncryptWithLabel`, `RefHash`).
 *
 * Suites are singletons; look one up with `CipherSuite.forID()`. */
import { AEAD, AESGCM, ChaCha20Poly1305 } from "./AEAD";
import { HPKE, type HPKECiphertext } from "./HPKE";
import { KDF } from "./KDF";
import { KEM, NISTKEM, X25519KEM, type KeyPair } from "./KEM";
import { ECDSASignature, Ed25519Signature, SignatureScheme } from "./SignatureScheme";
import { TLSWriter, tlsSerialize } from "../Codec/TLSWriter";
import { MLSError, utf8 } from "../util";
import { bytesEqual } from "../../Signal/Crypto/primitives";

export class CipherSuite {
  /** The `CipherSuite` code point, RFC 9420 § 17.1 */
  readonly id: number;
  readonly name: string;
  readonly kem: KEM;
  readonly kdf: KDF;
  readonly aead: AEAD;
  readonly signatureScheme: SignatureScheme;
  readonly hpke: HPKE;

  protected constructor(id: number, name: string, kem: KEM, kdf: KDF, aead: AEAD, signatureScheme: SignatureScheme) {
    this.id = id;
    this.name = name;
    this.kem = kem;
    this.kdf = kdf;
    this.aead = aead;
    this.signatureScheme = signatureScheme;
    this.hpke = new HPKE(kem, kdf, aead);
  }

  /** The suites of RFC 9420 § 17.1 that we implement. The X448 suites 4 and 6
   * are missing, because no deployment we talk to offers them. */
  static readonly all = [
    new CipherSuite(0x0001, "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519",
      X25519KEM.instance, KDF.hkdfSHA256, new AESGCM(16), Ed25519Signature.instance),
    new CipherSuite(0x0002, "MLS_128_DHKEMP256_AES128GCM_SHA256_P256",
      NISTKEM.p256, KDF.hkdfSHA256, new AESGCM(16), ECDSASignature.p256),
    new CipherSuite(0x0003, "MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519",
      X25519KEM.instance, KDF.hkdfSHA256, new ChaCha20Poly1305(), Ed25519Signature.instance),
    new CipherSuite(0x0005, "MLS_256_DHKEMP521_AES256GCM_SHA512_P521",
      NISTKEM.p521, KDF.hkdfSHA512, new AESGCM(32), ECDSASignature.p521),
    new CipherSuite(0x0007, "MLS_256_DHKEMP384_AES256GCM_SHA384_P384",
      NISTKEM.p384, KDF.hkdfSHA384, new AESGCM(32), ECDSASignature.p384),
  ];

  /** @throws `MLSError` for a suite we do not implement */
  static forID(id: number): CipherSuite {
    let suite = CipherSuite.all.find(suite => suite.id == id);
    if (!suite) {
      throw new MLSError(`Unsupported MLS cipher suite 0x${id.toString(16).padStart(4, "0")}`);
    }
    return suite;
  }

  /** `Nh`: the size of a secret in the key schedule */
  get secretLength(): number {
    return this.kdf.hashLength;
  }

  hash(data: Uint8Array): Uint8Array {
    return this.kdf.hash(data);
  }

  mac(key: Uint8Array, data: Uint8Array): Uint8Array {
    return this.kdf.mac(key, data);
  }

  verifyMAC(key: Uint8Array, data: Uint8Array, tag: Uint8Array): boolean {
    return bytesEqual(this.mac(key, data), tag);
  }

  /** RFC 9420 § 8 `ExpandWithLabel` */
  expandWithLabel(secret: Uint8Array, label: string, context: Uint8Array, length: number): Uint8Array {
    let kdfLabel = tlsSerialize(writer => writer
      .uint16(length)
      .opaque(utf8(kMLSLabelPrefix + label))
      .opaque(context));
    return this.kdf.expand(secret, kdfLabel, length);
  }

  /** RFC 9420 § 8 `DeriveSecret` */
  deriveSecret(secret: Uint8Array, label: string): Uint8Array {
    return this.expandWithLabel(secret, label, kNoBytes, this.secretLength);
  }

  /** RFC 9420 § 9.1 `DeriveTreeSecret`. The generation is a big-endian uint32. */
  deriveTreeSecret(secret: Uint8Array, label: string, generation: number, length: number): Uint8Array {
    return this.expandWithLabel(secret, label, tlsSerialize(writer => writer.uint32(generation)), length);
  }

  /** RFC 9420 § 5.1.2 `SignWithLabel` */
  signWithLabel(privateKey: Uint8Array, label: string, content: Uint8Array): Uint8Array {
    return this.signatureScheme.sign(privateKey, this.signContent(label, content));
  }

  /** RFC 9420 § 5.1.2 `VerifyWithLabel` */
  verifyWithLabel(publicKey: Uint8Array, label: string, content: Uint8Array, signature: Uint8Array): boolean {
    return this.signatureScheme.verify(publicKey, this.signContent(label, content), signature);
  }

  /** RFC 9420 § 5.1.3 `EncryptWithLabel` */
  encryptWithLabel(publicKey: Uint8Array, label: string, context: Uint8Array, plaintext: Uint8Array): HPKECiphertext {
    return this.hpke.seal(publicKey, this.encryptContext(label, context), kNoBytes, plaintext);
  }

  /** RFC 9420 § 5.1.3 `DecryptWithLabel`
   * @throws if the ciphertext does not authenticate */
  decryptWithLabel(privateKey: Uint8Array, label: string, context: Uint8Array, sealed: HPKECiphertext): Uint8Array {
    return this.hpke.open(privateKey, sealed, this.encryptContext(label, context), kNoBytes);
  }

  /** RFC 9420 § 5.2 `MakeKeyPackageRef`: identifies a KeyPackage in a Welcome. */
  keyPackageRef(keyPackage: Uint8Array): Uint8Array {
    return this.refHash("MLS 1.0 KeyPackage Reference", keyPackage);
  }

  /** RFC 9420 § 5.2 `MakeProposalRef`: identifies a Proposal in a Commit.
   * @param authenticatedContent the framed Proposal, not the bare Proposal */
  proposalRef(authenticatedContent: Uint8Array): Uint8Array {
    return this.refHash("MLS 1.0 Proposal Reference", authenticatedContent);
  }

  /** RFC 9420 § 5.2 `RefHash`. The label already carries its "MLS 1.0 " prefix. */
  protected refHash(label: string, value: Uint8Array): Uint8Array {
    return this.hash(tlsSerialize(writer => writer.opaque(utf8(label)).opaque(value)));
  }

  /** RFC 9420 § 5.1.2 `SignContent` */
  protected signContent(label: string, content: Uint8Array): Uint8Array {
    return tlsSerialize(writer => writer.opaque(utf8(kMLSLabelPrefix + label)).opaque(content));
  }

  /** RFC 9420 § 5.1.3 `EncryptContext` */
  protected encryptContext(label: string, context: Uint8Array): Uint8Array {
    return tlsSerialize(writer => writer.opaque(utf8(kMLSLabelPrefix + label)).opaque(context));
  }

  /** A fresh signature key pair for a new client identity. */
  generateSignatureKeyPair(): KeyPair {
    return this.signatureScheme.generateKeyPair();
  }

  writeTo(writer: TLSWriter): void {
    writer.uint16(this.id);
  }
}

/** RFC 9420 § 5.1.2: every MLS label is prefixed, to keep the protocol's
 * signatures and key derivations apart from any other use of the same keys. */
const kMLSLabelPrefix = "MLS 1.0 ";
const kNoBytes = new Uint8Array(0);
