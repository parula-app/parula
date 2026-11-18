/** How new members are told about the group they were just added to,
 * RFC 9420 § 12.4.3.1.
 *
 *     struct {
 *       CipherSuite cipher_suite;
 *       EncryptedGroupSecrets secrets<V>;
 *       opaque encrypted_group_info<V>;
 *     } Welcome;
 *
 * One `Welcome` can serve several new members: the `GroupInfo` is encrypted once
 * symmetrically, under a key derived from the new epoch's `joiner_secret`, and
 * only the small `GroupSecrets` — the joiner secret itself and the path secret
 * for this member — is encrypted per member with HPKE, to the `init_key` of the
 * KeyPackage that was consumed.
 *
 * Note the ordering: `encrypted_group_info` is the HPKE *context* of every
 * `EncryptedGroupSecrets`, so it has to exist before the per-member ciphertexts
 * can be produced.
 *
 * Nothing in here is signed. The authenticity comes from the `GroupInfo`
 * signature inside, and from checking its `confirmation_tag` against the key
 * schedule that the joiner secret produces. */
import { GroupInfo } from "./GroupInfo";
import { PreSharedKeyID } from "../KeySchedule";
import { CipherSuite } from "../Crypto/CipherSuite";
import type { HPKECiphertext } from "../Crypto/HPKE";
import { readHPKECiphertext, writeHPKECiphertext } from "../Tree/UpdatePath";
import type { MessageKey } from "../Tree/SecretTree";
import { TLSReader, tlsParse } from "../Codec/TLSReader";
import { TLSWriter, tlsSerialize } from "../Codec/TLSWriter";
import { MLSError } from "../util";
import { bytesEqual } from "../../Signal/Crypto/primitives";

export class Welcome {
  readonly suite: CipherSuite;
  readonly secrets: EncryptedGroupSecrets[];
  readonly encryptedGroupInfo: Uint8Array;

  constructor(suite: CipherSuite, secrets: EncryptedGroupSecrets[], encryptedGroupInfo: Uint8Array) {
    this.suite = suite;
    this.secrets = secrets;
    this.encryptedGroupInfo = encryptedGroupInfo;
  }

  static read(reader: TLSReader): Welcome {
    let suite = CipherSuite.forID(reader.uint16());
    return new Welcome(suite, reader.vector(EncryptedGroupSecrets.read), reader.opaque());
  }

  static fromBytes(data: Uint8Array): Welcome {
    return tlsParse(data, Welcome.read);
  }

  writeTo(writer: TLSWriter): void {
    writer.uint16(this.suite.id)
      .vector(this.secrets, (writer, secrets) => secrets.writeTo(writer))
      .opaque(this.encryptedGroupInfo);
  }

  toBytes(): Uint8Array {
    return tlsSerialize(writer => this.writeTo(writer));
  }

  /** RFC 9420 § 12.4.3.1: our entry, found by the reference of the KeyPackage
   * we published, or null if this Welcome is not for us. */
  find(keyPackageRef: Uint8Array): EncryptedGroupSecrets | null {
    return this.secrets.find(secrets => bytesEqual(secrets.newMember, keyPackageRef)) ?? null;
  }

  /** RFC 9420 § 12.4.3.1
   * @param initPrivateKey the private half of the `init_key` of the KeyPackage
   *   that `keyPackageRef` names
   * @throws `MLSError` if this Welcome is not addressed to us */
  groupSecretsFor(keyPackageRef: Uint8Array, initPrivateKey: Uint8Array): GroupSecrets {
    let entry = this.find(keyPackageRef);
    if (!entry) {
      throw new MLSError("This Welcome does not contain group secrets for us");
    }
    return entry.decrypt(this.suite, initPrivateKey, this.encryptedGroupInfo);
  }

  /** RFC 9420 § 12.4.3.1
   * @param welcomeKey `KeySchedule.welcomeKeyAndNonce()`, derived from the
   *   joiner secret we just decrypted
   * @throws `MLSError` if the GroupInfo does not authenticate */
  decryptGroupInfo(welcomeKey: MessageKey): GroupInfo {
    try {
      return GroupInfo.fromBytes(
        this.suite.aead.open(welcomeKey.key, welcomeKey.nonce, kNoBytes, this.encryptedGroupInfo));
    } catch (ex) {
      throw new MLSError(`Welcome group info does not decrypt: ${ex?.message ?? ex}`);
    }
  }

  /** RFC 9420 § 12.4.3.1. Do this first: the result is the HPKE context that
   * `EncryptedGroupSecrets.encrypt()` needs. */
  static encryptGroupInfo(suite: CipherSuite, groupInfo: GroupInfo, welcomeKey: MessageKey): Uint8Array {
    return suite.aead.seal(welcomeKey.key, welcomeKey.nonce, kNoBytes, groupInfo.toBytes());
  }
}

/**
 * RFC 9420 § 12.4.3.1: the group secrets for one new member.
 *
 *     struct {
 *       KeyPackageRef new_member;
 *       HPKECiphertext encrypted_group_secrets;
 *     } EncryptedGroupSecrets;
 */
export class EncryptedGroupSecrets {
  /** `MakeKeyPackageRef()` of the KeyPackage this consumed */
  readonly newMember: Uint8Array;
  readonly encryptedGroupSecrets: HPKECiphertext;

  constructor(newMember: Uint8Array, encryptedGroupSecrets: HPKECiphertext) {
    this.newMember = newMember;
    this.encryptedGroupSecrets = encryptedGroupSecrets;
  }

  static read(reader: TLSReader): EncryptedGroupSecrets {
    return new EncryptedGroupSecrets(reader.opaque(), readHPKECiphertext(reader));
  }

  writeTo(writer: TLSWriter): void {
    writer.opaque(this.newMember);
    writeHPKECiphertext(writer, this.encryptedGroupSecrets);
  }

  /** RFC 9420 § 12.4.3.1:
   * `EncryptWithLabel(init_key, "Welcome", encrypted_group_info, group_secrets)` */
  static encrypt(suite: CipherSuite, keyPackageRef: Uint8Array, initKey: Uint8Array,
    encryptedGroupInfo: Uint8Array, secrets: GroupSecrets): EncryptedGroupSecrets {
    return new EncryptedGroupSecrets(keyPackageRef,
      suite.encryptWithLabel(initKey, "Welcome", encryptedGroupInfo, secrets.toBytes()));
  }

  /** @throws `MLSError` if the ciphertext does not authenticate */
  decrypt(suite: CipherSuite, initPrivateKey: Uint8Array, encryptedGroupInfo: Uint8Array): GroupSecrets {
    try {
      return GroupSecrets.fromBytes(suite.decryptWithLabel(initPrivateKey, "Welcome", encryptedGroupInfo,
        this.encryptedGroupSecrets));
    } catch (ex) {
      throw new MLSError(`Welcome group secrets do not decrypt: ${ex?.message ?? ex}`);
    }
  }
}

/**
 * RFC 9420 § 12.4.3.1: what one new member needs to enter the new epoch.
 *
 *     struct {
 *       opaque joiner_secret<V>;
 *       optional<PathSecret> path_secret;
 *       PreSharedKeyID psks<V>;
 *     } GroupSecrets;
 *
 * `PathSecret` is the one-field wrapper `struct { opaque path_secret<V>; }`, so
 * `pathSecret` here holds the secret itself and the `optional<>` presence octet
 * is written around it. It is the path secret of the lowest node that is in the
 * direct path of both the committer and this new member, and it is absent when
 * the Commit carried no `UpdatePath`.
 */
export class GroupSecrets {
  readonly joinerSecret: Uint8Array;
  readonly pathSecret: Uint8Array | null;
  readonly psks: PreSharedKeyID[];

  constructor(joinerSecret: Uint8Array, pathSecret: Uint8Array | null = null, psks: PreSharedKeyID[] = []) {
    this.joinerSecret = joinerSecret;
    this.pathSecret = pathSecret;
    this.psks = psks;
  }

  static read(reader: TLSReader): GroupSecrets {
    return new GroupSecrets(reader.opaque(), reader.optional(reader => reader.opaque()),
      reader.vector(PreSharedKeyID.read));
  }

  static fromBytes(data: Uint8Array): GroupSecrets {
    return tlsParse(data, GroupSecrets.read);
  }

  writeTo(writer: TLSWriter): void {
    writer.opaque(this.joinerSecret)
      .optional(this.pathSecret, (writer, secret) => writer.opaque(secret))
      .vector(this.psks, (writer, psk) => psk.writeTo(writer));
  }

  toBytes(): Uint8Array {
    return tlsSerialize(writer => this.writeTo(writer));
  }
}

const kNoBytes = new Uint8Array(0);
