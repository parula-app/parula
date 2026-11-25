/** The key schedule of one epoch, RFC 9420 § 8.
 *
 * Every epoch of a group has its own set of secrets, derived from the previous
 * epoch's `init_secret` and the `commit_secret` of the Commit that started the
 * epoch, mixed with the new `GroupContext`. Members walk the whole chain;
 * a member who joins from a Welcome is handed the `joiner_secret` and starts
 * halfway down. @see `advance()` and `fromJoinerSecret()`
 *
 * The `groupContext` parameters are the *serialized* `GroupContext` of the new
 * epoch, so that this file stays independent of `Messages/`.
 *
 * Secrets are held as plain byte arrays for the lifetime of the epoch. RFC 9420
 * § 9.2 asks for them to be deleted as soon as they are consumed, which a
 * JavaScript runtime cannot honour: it copies and moves buffers as it pleases.
 * Keeping one epoch at a time is the best we can do. */
import type { CipherSuite } from "./Crypto/CipherSuite";
import type { KeyPair } from "./Crypto/KEM";
import type { MessageKey } from "./Tree/SecretTree";
import { TLSReader } from "./Codec/TLSReader";
import { TLSWriter, tlsSerialize } from "./Codec/TLSWriter";
import { MLSError } from "./util";
import { concatBytes, randomBytes } from "../Signal/Crypto/primitives";

export class KeySchedule {
  readonly suite: CipherSuite;
  readonly joinerSecret: Uint8Array;
  readonly welcomeSecret: Uint8Array;
  readonly epochSecret: Uint8Array;
  readonly senderDataSecret: Uint8Array;
  readonly encryptionSecret: Uint8Array;
  readonly exporterSecret: Uint8Array;
  readonly externalSecret: Uint8Array;
  readonly confirmationKey: Uint8Array;
  readonly membershipKey: Uint8Array;
  readonly resumptionPSK: Uint8Array;
  readonly epochAuthenticator: Uint8Array;
  /** The init secret for the *next* epoch */
  readonly initSecret: Uint8Array;

  protected constructor(suite: CipherSuite, joinerSecret: Uint8Array, groupContext: Uint8Array, pskSecret: Uint8Array) {
    this.suite = suite;
    this.joinerSecret = joinerSecret;
    // Figure 22: Extract takes its salt from the top of the diagram and its IKM
    // from the left, i.e. `extract(joiner_secret, psk_secret)`, not the reverse.
    let memberSecret = suite.kdf.extract(joinerSecret, pskSecret);
    this.welcomeSecret = suite.deriveSecret(memberSecret, "welcome");
    this.epochSecret = suite.expandWithLabel(memberSecret, "epoch", groupContext, suite.secretLength);
    // Table 4
    this.senderDataSecret = suite.deriveSecret(this.epochSecret, "sender data");
    this.encryptionSecret = suite.deriveSecret(this.epochSecret, "encryption");
    this.exporterSecret = suite.deriveSecret(this.epochSecret, "exporter");
    this.externalSecret = suite.deriveSecret(this.epochSecret, "external");
    this.confirmationKey = suite.deriveSecret(this.epochSecret, "confirm");
    this.membershipKey = suite.deriveSecret(this.epochSecret, "membership");
    this.resumptionPSK = suite.deriveSecret(this.epochSecret, "resumption");
    this.epochAuthenticator = suite.deriveSecret(this.epochSecret, "authentication");
    this.initSecret = suite.deriveSecret(this.epochSecret, "init");
  }

  /** The normal path: previous epoch's init secret plus this commit's secret.
   * @param groupContext the serialized GroupContext of the *new* epoch */
  static advance(suite: CipherSuite, previousInitSecret: Uint8Array, commitSecret: Uint8Array,
    groupContext: Uint8Array, pskSecret: Uint8Array): KeySchedule {
    let extracted = suite.kdf.extract(previousInitSecret, commitSecret);
    let joinerSecret = suite.expandWithLabel(extracted, "joiner", groupContext, suite.secretLength);
    return new KeySchedule(suite, joinerSecret, groupContext, pskSecret);
  }

  /** The joiner path: a Welcome gives us the joiner secret directly, because a
   * new member has neither the previous init secret nor the commit secret. */
  static fromJoinerSecret(suite: CipherSuite, joinerSecret: Uint8Array,
    groupContext: Uint8Array, pskSecret: Uint8Array): KeySchedule {
    return new KeySchedule(suite, joinerSecret, groupContext, pskSecret);
  }

  /** The very first epoch of a brand new group, RFC 9420 § 11: no Commit and no
   * PSK yet, so the whole epoch hangs off a random init secret. */
  static forNewGroup(suite: CipherSuite, groupContext: Uint8Array): KeySchedule {
    let zero = new Uint8Array(suite.secretLength);
    return KeySchedule.advance(suite, randomBytes(suite.secretLength), zero, groupContext, zero);
  }

  /** RFC 9420 § 12.4.3.1: the AEAD key and nonce that protect the GroupInfo in
   * a Welcome. The AAD of that encryption is empty. */
  welcomeKeyAndNonce(): MessageKey {
    return {
      key: this.suite.expandWithLabel(this.welcomeSecret, "key", kNoBytes, this.suite.aead.keyLength),
      nonce: this.suite.expandWithLabel(this.welcomeSecret, "nonce", kNoBytes, this.suite.aead.nonceLength),
    };
  }

  /** RFC 9420 § 8: the HPKE key pair whose private key the whole group holds,
   * so that an outsider can send an external Commit to `external_pub`. */
  externalKeyPair(): KeyPair {
    return this.suite.kem.deriveKeyPair(this.externalSecret);
  }

  /** RFC 9420 § 8.5 `MLS-Exporter`: a secret for use outside MLS, bound to this
   * epoch. Note the double derivation, and that the context is hashed.
   * @param label what the secret is for, e.g. "wire.com key" */
  exportSecret(label: string, context: Uint8Array, length: number): Uint8Array {
    let derived = this.suite.deriveSecret(this.exporterSecret, label);
    return this.suite.expandWithLabel(derived, "exported", this.suite.hash(context), length);
  }
}

/** The two running hashes over everything that ever happened in the group,
 * RFC 9420 § 8.2. Both are opaque values; `MLSGroup` holds them and feeds the
 * confirmed one into the `GroupContext`.
 *
 * They start as the zero-length octet string, which is why there is no state
 * here: each step is a pure function of the previous value. */
export class TranscriptHash {
  /** `Hash(interim_transcript_hash_[n-1] || ConfirmedTranscriptHashInput_[n])`.
   * @param confirmedTranscriptHashInput the serialized `ConfirmedTranscriptHashInput`,
   *   i.e. the Commit's `AuthenticatedContent` without its confirmation tag */
  static confirmed(suite: CipherSuite, interimHash: Uint8Array, confirmedTranscriptHashInput: Uint8Array): Uint8Array {
    return suite.hash(concatBytes(interimHash, confirmedTranscriptHashInput));
  }

  /** `Hash(confirmed_transcript_hash_[n] || InterimTranscriptHashInput_[n])`,
   * where the input struct is the bare `MAC confirmation_tag`, i.e. `opaque<V>`. */
  static interim(suite: CipherSuite, confirmedHash: Uint8Array, confirmationTag: Uint8Array): Uint8Array {
    return suite.hash(concatBytes(confirmedHash, tlsSerialize(writer => writer.opaque(confirmationTag))));
  }
}

/** The `psk_secret` that goes into the key schedule, RFC 9420 § 8.4. */
export class PreSharedKeys {
  /** Chains the PSKs together in the order the Commit lists them. An empty list
   * gives `KDF.Nh` zero bytes, which is the normal case: a group that injects no
   * PSK still feeds a zero `psk_secret` into the second Extract.
   * @param psks each PSK's ID as sent in the Commit, plus the key itself, which
   *   the application holds for an external PSK and `resumption_psk` provides
   *   for a resumption PSK */
  static secret(suite: CipherSuite, psks: { id: PreSharedKeyID, secret: Uint8Array }[]): Uint8Array {
    let zero = new Uint8Array(suite.secretLength);
    let pskSecret: Uint8Array = zero;
    for (let i = 0; i < psks.length; i++) {
      let extracted = suite.kdf.extract(zero, psks[i].secret);
      // PSKLabel { PreSharedKeyID id; uint16 index; uint16 count; }
      let label = tlsSerialize(writer => {
        psks[i].id.writeTo(writer);
        writer.uint16(i).uint16(psks.length);
      });
      let input = suite.expandWithLabel(extracted, "derived psk", label, suite.secretLength);
      // The prose of § 8.4 says Extract(psk_input, psk_secret), Figure 24 says
      // the opposite. `psk_secret.json` agrees with the prose.
      pskSecret = suite.kdf.extract(input, pskSecret);
    }
    return pskSecret;
  }
}

/**
 * Which pre-shared key to inject, RFC 9420 § 8.4.
 *
 *     struct {
 *       PSKType psktype;
 *       select (PreSharedKeyID.psktype) {
 *         case external:
 *           opaque psk_id<V>;
 *         case resumption:
 *           ResumptionPSKUsage usage;
 *           opaque psk_group_id<V>;
 *           uint64 psk_epoch;
 *       };
 *       opaque psk_nonce<V>;
 *     } PreSharedKeyID;
 *
 * It lives here, next to the only computation that looks inside it;
 * `Messages/Proposal.ts` imports it for the PreSharedKey proposal.
 */
export abstract class PreSharedKeyID {
  abstract readonly type: PSKType;
  /** A fresh random value of `KDF.Nh` bytes for each injection, so that using
   * the same PSK twice still feeds different bytes into the key schedule. */
  readonly nonce: Uint8Array;

  constructor(nonce: Uint8Array) {
    this.nonce = nonce;
  }

  static read(reader: TLSReader): PreSharedKeyID {
    let type = reader.uint8();
    switch (type) {
      case PSKType.External:
        return new ExternalPSKID(reader.opaque(), reader.opaque());
      case PSKType.Resumption: {
        let usage = reader.uint8();
        let groupID = reader.opaque();
        let epoch = reader.uint64();
        return new ResumptionPSKID(usage, groupID, epoch, reader.opaque());
      }
      default:
        throw new MLSError(`Unknown MLS PSK type ${type}`);
    }
  }

  writeTo(writer: TLSWriter): void {
    writer.uint8(this.type);
    this.writeVariant(writer);
    writer.opaque(this.nonce);
  }

  toBytes(): Uint8Array {
    return tlsSerialize(writer => this.writeTo(writer));
  }

  protected abstract writeVariant(writer: TLSWriter): void;
}

/** A key the application provisioned out of band, RFC 9420 § 8.4 */
export class ExternalPSKID extends PreSharedKeyID {
  readonly type = PSKType.External;
  /** How the application names the key */
  readonly pskID: Uint8Array;

  constructor(pskID: Uint8Array, nonce: Uint8Array) {
    super(nonce);
    this.pskID = pskID;
  }

  protected writeVariant(writer: TLSWriter): void {
    writer.opaque(this.pskID);
  }
}

/** The `resumption_psk` of an earlier epoch, RFC 9420 § 8.6, which proves that
 * the sender was a member of that epoch. */
export class ResumptionPSKID extends PreSharedKeyID {
  readonly type = PSKType.Resumption;
  readonly usage: ResumptionPSKUsage;
  readonly groupID: Uint8Array;
  readonly epoch: bigint;

  constructor(usage: ResumptionPSKUsage, groupID: Uint8Array, epoch: bigint, nonce: Uint8Array) {
    super(nonce);
    this.usage = usage;
    this.groupID = groupID;
    this.epoch = epoch;
  }

  protected writeVariant(writer: TLSWriter): void {
    writer.uint8(this.usage).opaque(this.groupID).uint64(this.epoch);
  }
}

/** RFC 9420 § 17.7 "MLS PSK Types" */
export enum PSKType {
  External = 1,
  Resumption = 2,
}

/** RFC 9420 § 8.4: why a resumption PSK is being used */
export enum ResumptionPSKUsage {
  Application = 1,
  Reinit = 2,
  Branch = 3,
}

const kNoBytes = new Uint8Array(0);
