/** Hybrid Public Key Encryption, RFC 9180, base mode only.
 *
 * MLS sets up a fresh context for every ciphertext and never sends a second
 * message under the same one, so the sequence number stays 0 and the nonce is
 * the base nonce unchanged. The PSK and Auth modes are not implemented.
 *
 * The exporter interface is here because RFC 9420 § 8.3 external
 * initialization carries the new init secret through `context.export()`,
 * and not through `EncryptWithLabel`. */
import type { AEAD } from "./AEAD";
import type { KDF } from "./KDF";
import type { KEM } from "./KEM";
import { utf8 } from "../util";
import { concatBytes } from "../../Signal/Crypto/primitives";

export class HPKE {
  readonly kem: KEM;
  readonly kdf: KDF;
  readonly aead: AEAD;
  /** `suite_id = "HPKE" || I2OSP(kem_id, 2) || I2OSP(kdf_id, 2) || I2OSP(aead_id, 2)` */
  protected readonly suiteID: Uint8Array;

  constructor(kem: KEM, kdf: KDF, aead: AEAD) {
    this.kem = kem;
    this.kdf = kdf;
    this.aead = aead;
    this.suiteID = concatBytes(utf8("HPKE"), uint16(kem.id), uint16(kdf.id), uint16(aead.id));
  }

  /** RFC 9180 § 6.1 `SealBase` */
  seal(recipientPublicKey: Uint8Array, info: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): HPKECiphertext {
    let { enc, context } = this.setupBaseS(recipientPublicKey, info);
    return {
      kemOutput: enc,
      ciphertext: context.seal(aad, plaintext),
    };
  }

  /** RFC 9180 § 6.1 `OpenBase`
   * @throws if the ciphertext does not authenticate */
  open(recipientPrivateKey: Uint8Array, sealed: HPKECiphertext, info: Uint8Array, aad: Uint8Array): Uint8Array {
    let context = this.setupBaseR(sealed.kemOutput, recipientPrivateKey, info);
    return context.open(aad, sealed.ciphertext);
  }

  /** RFC 9180 § 5.1.1 `SetupBaseS` */
  setupBaseS(recipientPublicKey: Uint8Array, info: Uint8Array): { enc: Uint8Array, context: HPKEContext } {
    let { sharedSecret, enc } = this.kem.encapsulate(recipientPublicKey);
    return { enc, context: this.keySchedule(sharedSecret, info) };
  }

  /** RFC 9180 § 5.1.1 `SetupBaseR` */
  setupBaseR(enc: Uint8Array, recipientPrivateKey: Uint8Array, info: Uint8Array): HPKEContext {
    let sharedSecret = this.kem.decapsulate(enc, recipientPrivateKey);
    return this.keySchedule(sharedSecret, info);
  }

  /** RFC 9420 § 8.3 external initialization, the joiner's half: it sends the
   * `kemOutput` in an ExternalInit proposal and starts the new epoch's key
   * schedule from `initSecret`. The HPKE `info` is empty, because this is a raw
   * HPKE call and not an `EncryptWithLabel`.
   * @param externalPublicKey `external_pub`, from the group's GroupInfo */
  sendExternalInitSecret(externalPublicKey: Uint8Array): { kemOutput: Uint8Array, initSecret: Uint8Array } {
    let { enc, context } = this.setupBaseS(externalPublicKey, kNoBytes);
    return { kemOutput: enc, initSecret: context.export(kExternalInitSecret, this.kdf.hashLength) };
  }

  /** RFC 9420 § 8.3 external initialization, the group's half: every member
   * recovers the joiner's init secret from the ExternalInit proposal.
   * @param externalPrivateKey `external_priv`, `KEM.DeriveKeyPair(external_secret)` */
  receiveExternalInitSecret(externalPrivateKey: Uint8Array, kemOutput: Uint8Array): Uint8Array {
    let context = this.setupBaseR(kemOutput, externalPrivateKey, kNoBytes);
    return context.export(kExternalInitSecret, this.kdf.hashLength);
  }

  /** RFC 9180 § 5.1 `KeySchedule` for `mode_base`, so with an empty PSK. */
  protected keySchedule(sharedSecret: Uint8Array, info: Uint8Array): HPKEContext {
    let pskIDHash = this.labeledExtract(kNoBytes, "psk_id_hash", kNoBytes);
    let infoHash = this.labeledExtract(kNoBytes, "info_hash", info);
    let scheduleContext = concatBytes(new Uint8Array([kModeBase]), pskIDHash, infoHash);
    let secret = this.labeledExtract(sharedSecret, "secret", kNoBytes);
    return new HPKEContext(this,
      this.labeledExpand(secret, "key", scheduleContext, this.aead.keyLength),
      this.labeledExpand(secret, "base_nonce", scheduleContext, this.aead.nonceLength),
      this.labeledExpand(secret, "exp", scheduleContext, this.kdf.hashLength));
  }

  /** RFC 9180 § 4 `LabeledExtract` */
  protected labeledExtract(salt: Uint8Array, label: string, ikm: Uint8Array): Uint8Array {
    return this.kdf.extract(salt, concatBytes(kHPKEVersion, this.suiteID, utf8(label), ikm));
  }

  /** RFC 9180 § 4 `LabeledExpand`. Public because `HPKEContext` exports with it. */
  labeledExpand(prk: Uint8Array, label: string, info: Uint8Array, length: number): Uint8Array {
    return this.kdf.expand(prk, concatBytes(uint16(length), kHPKEVersion, this.suiteID, utf8(label), info), length);
  }
}

/** RFC 9180 § 5.1 `Context<ROLE>`: one set-up HPKE encryption, from either end.
 * The sequence number is not implemented, see the file header, so `seal()` and
 * `open()` are single use. */
export class HPKEContext {
  readonly key: Uint8Array;
  readonly baseNonce: Uint8Array;
  protected readonly hpke: HPKE;
  protected readonly exporterSecret: Uint8Array;

  constructor(hpke: HPKE, key: Uint8Array, baseNonce: Uint8Array, exporterSecret: Uint8Array) {
    this.hpke = hpke;
    this.key = key;
    this.baseNonce = baseNonce;
    this.exporterSecret = exporterSecret;
  }

  /** RFC 9180 § 5.2 `ContextS.Seal`, at sequence number 0 */
  seal(aad: Uint8Array, plaintext: Uint8Array): Uint8Array {
    return this.hpke.aead.seal(this.key, this.baseNonce, aad, plaintext);
  }

  /** RFC 9180 § 5.2 `ContextR.Open`, at sequence number 0
   * @throws if the ciphertext does not authenticate */
  open(aad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    return this.hpke.aead.open(this.key, this.baseNonce, aad, ciphertext);
  }

  /** RFC 9180 § 5.3 `Context.Export`:
   * `LabeledExpand(exporter_secret, "sec", exporter_context, L)`.
   * @param exporterContext a complete context string, not an MLS label */
  export(exporterContext: Uint8Array, length: number): Uint8Array {
    return this.hpke.labeledExpand(this.exporterSecret, "sec", exporterContext, length);
  }
}

/** RFC 9420 § 6.3.1: what MLS puts on the wire for one HPKE encryption. */
export interface HPKECiphertext {
  kemOutput: Uint8Array;
  ciphertext: Uint8Array;
}

const kHPKEVersion = utf8("HPKE-v1");
/** RFC 9180 § 5.1, Table 1 */
const kModeBase = 0x00;
/** RFC 9420 § 8.3. A complete exporter context, already carrying the
 * "MLS 1.0 " prefix, so it must not go through `ExpandWithLabel`. */
const kExternalInitSecret = utf8("MLS 1.0 external init secret");
const kNoBytes = new Uint8Array(0);

function uint16(value: number): Uint8Array {
  return new Uint8Array([value >> 8 & 0xFF, value & 0xFF]);
}
