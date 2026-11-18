/** Our own identity in MLS, RFC 9420 § 5.1.2, § 7.2 and § 10.
 *
 * One client is one device of one user: a long-lived signature key pair, the
 * credential that names it, the KeyPackages we published so that others can add
 * us, and the groups we are in. It is the only place that holds private keys
 * outside a group, and the only place that knows the policy questions the RFC
 * leaves to the application: which wire format handshakes go out in, how far
 * application messages are padded, and which pre-shared keys we have.
 *
 * Everything here is synchronous and side-effect free apart from `storage`,
 * which is how the application persists us. */
import type { MLSGroup } from "./MLSGroup";
import type { MLSStorage } from "./MLSStorage";
import { ExternalPSKID, PreSharedKeyID, PreSharedKeys, ResumptionPSKID } from "./KeySchedule";
import { Capabilities } from "./Tree/Capabilities";
import { LeafNode, LeafNodeSource } from "./Tree/LeafNode";
import { Lifetime } from "./Tree/Lifetime";
import { Credential } from "./Messages/Credential";
import { Extension } from "./Messages/Extension";
import { KeyPackage } from "./Messages/KeyPackage";
import { WireFormat } from "./Messages/Framing";
import { CipherSuite } from "./Crypto/CipherSuite";
import type { KeyPair } from "./Crypto/KEM";
import { TLSReader } from "./Codec/TLSReader";
import { tlsSerialize } from "./Codec/TLSWriter";
import { MLSError } from "./util";
import { base64Decode, base64Encode } from "../Signal/Crypto/primitives";

export class MLSClient {
  readonly suite: CipherSuite;
  readonly credential: Credential;
  readonly signatureKeyPair: KeyPair;
  /** Base64 group ID → group */
  readonly groups = new Map<string, MLSGroup>();
  /** What we tell the group we can do, RFC 9420 § 7.2 */
  capabilities = Capabilities.ours();
  /** RFC 9420 § 6: proposals and commits SHOULD be encrypted, but a delivery
   * service that has to read them needs `PublicMessage` — Wire's does, and
   * rejects an encrypted handshake. Application data is always encrypted. */
  handshakeWireFormat = WireFormat.PublicMessage;
  /** RFC 9420 § 15.1: pad application messages to a multiple of this, to hide
   * their length. 0 means no padding. */
  paddingBlockSize = 0;
  /** How long a KeyPackage we publish stays valid, RFC 9420 § 7.2 */
  keyPackageLifetimeDays = 90;
  storage: MLSStorage | null = null;
  /** Base64 `KeyPackageRef` → the private keys of a KeyPackage we published and
   * may still be welcomed with, RFC 9420 § 12.4.3.1 */
  protected readonly keyPackages = new Map<string, CreatedKeyPackage>();
  /** Base64 `psk_id` → the key the application provisioned, RFC 9420 § 8.4 */
  protected readonly externalPSKs = new Map<string, Uint8Array>();

  constructor(suite: CipherSuite, credential: Credential, signatureKeyPair: KeyPair) {
    this.suite = suite;
    this.credential = credential;
    this.signatureKeyPair = signatureKeyPair;
  }

  /** A brand-new identity, with a fresh signature key pair. */
  static create(suite: CipherSuite, credential: Credential): MLSClient {
    return new MLSClient(suite, credential, suite.generateSignatureKeyPair());
  }

  /** RFC 9420 § 10: a fresh KeyPackage to publish, plus the private keys we
   * have to keep in order to accept the Welcome that consumes it. Single use:
   * `MLSGroup.fromWelcome()` forgets it again. */
  createKeyPackage(lifetimeDays = this.keyPackageLifetimeDays, extensions: Extension[] = []): CreatedKeyPackage {
    let { leaf, encryptionKeyPair } = this.createLeafNode(LeafNodeSource.KeyPackage, lifetimeDays);
    let initKeyPair = this.suite.kem.generateKeyPair();
    let keyPackage = new KeyPackage(this.suite, initKeyPair.publicKey, leaf, extensions);
    keyPackage.sign(this.signatureKeyPair.privateKey);
    let created = { keyPackage, ref: keyPackage.ref(), initKeyPair, encryptionKeyPair };
    this.rememberKeyPackage(created);
    return created;
  }

  /** RFC 9420 § 7.2: our leaf, for a group we create, a group we join by
   * external Commit, an Update proposal, or the UpdatePath of a Commit. Every
   * one of them gets a fresh encryption key pair.
   *
   * The signature is only filled in where it can be: a `commit` leaf is signed
   * by `RatchetTree.createUpdatePath()`, which is where its parent hash is
   * computed, and an `update` leaf needs the group it will sit in. */
  createLeafNode(source: LeafNodeSource, lifetimeDays = this.keyPackageLifetimeDays,
    groupID: Uint8Array | null = null, leafIndex = 0): { leaf: LeafNode, encryptionKeyPair: KeyPair } {
    let encryptionKeyPair = this.suite.kem.generateKeyPair();
    let leaf = new LeafNode(encryptionKeyPair.publicKey, this.signatureKeyPair.publicKey,
      this.credential, this.capabilities, source);
    if (source == LeafNodeSource.KeyPackage) {
      leaf.lifetime = Lifetime.forDays(lifetimeDays);
      leaf.sign(this.suite, this.signatureKeyPair.privateKey, kNoBytes, 0);
    } else if (source == LeafNodeSource.Update) {
      leaf.sign(this.suite, this.signatureKeyPair.privateKey, groupID, leafIndex);
    }
    return { leaf, encryptionKeyPair };
  }

  /** KeyPackages we published and may still be welcomed with. */
  rememberKeyPackage(created: CreatedKeyPackage): void {
    this.keyPackages.set(base64Encode(created.ref), created);
    this.storage?.saveClient(this);
  }

  keyPackageForRef(ref: Uint8Array): CreatedKeyPackage | null {
    return this.keyPackages.get(base64Encode(ref)) ?? null;
  }

  /** A KeyPackage is single use, RFC 9420 § 10: once a Welcome consumed it, its
   * init key must never decrypt a second Welcome. */
  forgetKeyPackage(ref: Uint8Array): void {
    this.keyPackages.delete(base64Encode(ref));
    this.storage?.saveClient(this);
  }

  get unusedKeyPackages(): CreatedKeyPackage[] {
    return [...this.keyPackages.values()];
  }

  /** A key the application provisioned out of band, RFC 9420 § 8.4, which a
   * `PreSharedKey` proposal can then inject into the key schedule. */
  addExternalPSK(pskID: Uint8Array, secret: Uint8Array): void {
    this.externalPSKs.set(base64Encode(pskID), secret);
    this.storage?.saveClient(this);
  }

  /** RFC 9420 § 8.4: the `psk_secret` for the PSKs a Commit or a Welcome names.
   * @throws `MLSError` for a PSK we do not have, which invalidates the Commit */
  pskSecret(psks: readonly PreSharedKeyID[]): Uint8Array {
    return PreSharedKeys.secret(this.suite, psks.map(id => ({ id, secret: this.psk(id) })));
  }

  group(groupID: Uint8Array): MLSGroup | null {
    return this.groups.get(base64Encode(groupID)) ?? null;
  }

  addGroup(group: MLSGroup): void {
    this.groups.set(base64Encode(group.groupID), group);
    this.storage?.saveGroup(group);
  }

  removeGroup(group: MLSGroup): void {
    this.groups.delete(base64Encode(group.groupID));
    this.storage?.deleteGroup(group);
  }

  toJSON(): any {
    return {
      cipherSuite: this.suite.id,
      credential: base64Encode(tlsSerialize(writer => this.credential.writeTo(writer))),
      capabilities: base64Encode(tlsSerialize(writer => this.capabilities.writeTo(writer))),
      signaturePrivateKey: base64Encode(this.signatureKeyPair.privateKey),
      signaturePublicKey: base64Encode(this.signatureKeyPair.publicKey),
      handshakeWireFormat: this.handshakeWireFormat,
      paddingBlockSize: this.paddingBlockSize,
      keyPackages: this.unusedKeyPackages.map(created => ({
        keyPackage: base64Encode(created.keyPackage.toBytes()),
        initPrivateKey: base64Encode(created.initKeyPair.privateKey),
        encryptionPrivateKey: base64Encode(created.encryptionKeyPair.privateKey),
      })),
      externalPSKs: [...this.externalPSKs].map(([pskID, secret]) => ({ pskID, secret: base64Encode(secret) })),
    };
  }

  /** The groups are not part of this: the application restores them one by one
   * with `MLSGroup.fromJSON(client, json)`, which registers them here. */
  static fromJSON(json: any): MLSClient {
    let suite = CipherSuite.forID(json.cipherSuite);
    let credential = Credential.read(new TLSReader(base64Decode(json.credential)));
    let client = new MLSClient(suite, credential, {
      privateKey: base64Decode(json.signaturePrivateKey),
      publicKey: base64Decode(json.signaturePublicKey),
    });
    client.capabilities = Capabilities.read(new TLSReader(base64Decode(json.capabilities)));
    client.handshakeWireFormat = json.handshakeWireFormat ?? WireFormat.PublicMessage;
    client.paddingBlockSize = json.paddingBlockSize ?? 0;
    for (let saved of json.keyPackages ?? []) {
      let keyPackage = KeyPackage.fromBytes(base64Decode(saved.keyPackage));
      let encryptionPrivateKey = base64Decode(saved.encryptionPrivateKey);
      let initPrivateKey = base64Decode(saved.initPrivateKey);
      client.keyPackages.set(base64Encode(keyPackage.ref()), {
        keyPackage,
        ref: keyPackage.ref(),
        initKeyPair: { privateKey: initPrivateKey, publicKey: keyPackage.initKey },
        encryptionKeyPair: { privateKey: encryptionPrivateKey, publicKey: keyPackage.leafNode.encryptionKey },
      });
    }
    for (let saved of json.externalPSKs ?? []) {
      client.externalPSKs.set(saved.pskID, base64Decode(saved.secret));
    }
    return client;
  }

  /** RFC 9420 § 8.4: the key behind one `PreSharedKeyID`.
   * @throws `MLSError` if we do not have it */
  protected psk(id: PreSharedKeyID): Uint8Array {
    if (id instanceof ExternalPSKID) {
      let secret = this.externalPSKs.get(base64Encode(id.pskID));
      if (!secret) {
        throw new MLSError(`We do not have the external PSK ${base64Encode(id.pskID)}`);
      }
      return secret;
    }
    if (!(id instanceof ResumptionPSKID)) {
      throw new MLSError(`Unsupported MLS PSK type ${id.type}`);
    }
    let secret = this.group(id.groupID)?.resumptionPSK(id.epoch);
    if (!secret) {
      throw new MLSError(`We do not have the resumption PSK of epoch ${id.epoch}`);
    }
    return secret;
  }
}

/** A KeyPackage we published, with everything we must keep to use it, RFC 9420
 * § 10. Both key pairs are needed: the init key decrypts the Welcome, the
 * encryption key is the one our leaf then has in the ratchet tree. */
export interface CreatedKeyPackage {
  keyPackage: KeyPackage;
  /** `MakeKeyPackageRef(keyPackage)`, how a Welcome addresses us */
  ref: Uint8Array;
  initKeyPair: KeyPair;
  encryptionKeyPair: KeyPair;
}

const kNoBytes = new Uint8Array(0);
