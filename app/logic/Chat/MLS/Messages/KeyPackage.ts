/** A client's offer to be added to a group, RFC 9420 § 10.
 *
 *     struct {
 *         ProtocolVersion version;
 *         CipherSuite cipher_suite;
 *         HPKEPublicKey init_key;
 *         LeafNode leaf_node;
 *         Extension extensions<V>;
 *         opaque signature<V>;   // SignWithLabel(., "KeyPackageTBS", KeyPackageTBS)
 *     } KeyPackage;
 *
 * `initKey` is a *second* HPKE key, distinct from `leafNode.encryptionKey`: it
 * only ever decrypts the `Welcome` that adds us, while the leaf's encryption key
 * is the one the ratchet tree uses afterwards. A KeyPackage is single use, and
 * `ref()` is how a `Welcome` says which one it consumed. */
import { Extension } from "./Extension";
import { LeafNode, LeafNodeSource } from "../Tree/LeafNode";
import { CipherSuite } from "../Crypto/CipherSuite";
import { TLSReader, tlsParse } from "../Codec/TLSReader";
import { TLSWriter, tlsSerialize } from "../Codec/TLSWriter";
import { kProtocolVersionMLS10 } from "../Tree/Capabilities";
import { MLSError } from "../util";
import { bytesEqual } from "../../Signal/Crypto/primitives";

export class KeyPackage {
  readonly version: number;
  readonly suite: CipherSuite;
  initKey: Uint8Array;
  leafNode: LeafNode;
  extensions: Extension[];
  signature: Uint8Array = new Uint8Array(0);

  constructor(suite: CipherSuite, initKey: Uint8Array, leafNode: LeafNode, extensions: Extension[] = [],
    version = kProtocolVersionMLS10) {
    this.suite = suite;
    this.initKey = initKey;
    this.leafNode = leafNode;
    this.extensions = extensions;
    this.version = version;
  }

  static read(reader: TLSReader): KeyPackage {
    let version = reader.uint16();
    let suite = CipherSuite.forID(reader.uint16());
    let keyPackage = new KeyPackage(suite, reader.opaque(), LeafNode.read(reader), Extension.readVector(reader),
      version);
    keyPackage.signature = reader.opaque();
    return keyPackage;
  }

  static fromBytes(data: Uint8Array): KeyPackage {
    return tlsParse(data, KeyPackage.read);
  }

  writeTo(writer: TLSWriter): void {
    this.writeContentTo(writer);
    writer.opaque(this.signature);
  }

  toBytes(): Uint8Array {
    return tlsSerialize(writer => this.writeTo(writer));
  }

  /** RFC 9420 § 10 `KeyPackageTBS`: everything above the signature. */
  protected writeContentTo(writer: TLSWriter): void {
    writer.uint16(this.version).uint16(this.suite.id).opaque(this.initKey);
    this.leafNode.writeTo(writer);
    Extension.writeVector(writer, this.extensions);
  }

  /** RFC 9420 § 10. The signature key is the leaf's, not the credential's:
   * the credential only asserts an identity for that key. */
  sign(signaturePrivateKey: Uint8Array): void {
    this.signature = this.suite.signWithLabel(signaturePrivateKey, "KeyPackageTBS", this.signatureContent());
  }

  verify(): boolean {
    return this.suite.verifyWithLabel(this.leafNode.signatureKey, "KeyPackageTBS",
      this.signatureContent(), this.signature);
  }

  protected signatureContent(): Uint8Array {
    return tlsSerialize(writer => this.writeContentTo(writer));
  }

  /** RFC 9420 § 5.2 `MakeKeyPackageRef`: how a `Welcome` addresses us.
   * The hash is the one of the KeyPackage's own cipher suite. */
  ref(suite = this.suite): Uint8Array {
    return suite.keyPackageRef(this.toBytes());
  }

  /** RFC 9420 § 10.1. `groupID` is only needed so that the leaf node signature
   * can be checked in the same call; a KeyPackage leaf does not bind to a group,
   * so any value works.
   * @throws `MLSError` naming the check that failed */
  validate(groupID: Uint8Array, now = new Date()): void {
    if (this.version != kProtocolVersionMLS10) {
      throw new MLSError(`KeyPackage for unsupported MLS version ${this.version}`);
    }
    if (this.leafNode.source != LeafNodeSource.KeyPackage) {
      throw new MLSError(`KeyPackage leaf node has source ${this.leafNode.source}, must be key_package`);
    }
    if (!this.leafNode.isValidAt(now)) {
      throw new MLSError("KeyPackage leaf node is expired or uses unsupported features");
    }
    if (!this.leafNode.verify(this.suite, groupID, 0)) {
      throw new MLSError("KeyPackage leaf node signature does not verify");
    }
    if (!this.verify()) {
      throw new MLSError("KeyPackage signature does not verify");
    }
    // RFC 9420 § 10.1: the init key must differ from the leaf's encryption key
    if (bytesEqual(this.initKey, this.leafNode.encryptionKey)) {
      throw new MLSError("KeyPackage init_key is the same as the leaf node encryption key");
    }
  }
}
