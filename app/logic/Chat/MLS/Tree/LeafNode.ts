/** One client's appearance in the ratchet tree, RFC 9420 § 7.2.
 *
 *     struct {
 *         HPKEPublicKey encryption_key;
 *         SignaturePublicKey signature_key;
 *         Credential credential;
 *         Capabilities capabilities;
 *         LeafNodeSource leaf_node_source;
 *         select (LeafNode.leaf_node_source) {
 *             case key_package: Lifetime lifetime;
 *             case update:      struct{};
 *             case commit:      opaque parent_hash<V>;
 *         };
 *         Extension extensions<V>;
 *         opaque signature<V>;   // SignWithLabel(., "LeafNodeTBS", LeafNodeTBS)
 *     } LeafNode;
 *
 * The three sources differ in what the signature covers: a leaf that came from
 * a KeyPackage cannot bind to a group that did not exist yet, so only the
 * `update` and `commit` sources add the group ID and leaf index. Getting that
 * wrong makes every other member reject the leaf, so `signatureContent()` is
 * the single place that builds it. */
import { Capabilities } from "./Capabilities";
import { Lifetime } from "./Lifetime";
import { Credential } from "../Messages/Credential";
import { Extension } from "../Messages/Extension";
import type { CipherSuite } from "../Crypto/CipherSuite";
import { TLSReader, TLSParseError } from "../Codec/TLSReader";
import { TLSWriter, tlsSerialize } from "../Codec/TLSWriter";

export class LeafNode {
  encryptionKey: Uint8Array;
  signatureKey: Uint8Array;
  credential: Credential;
  capabilities: Capabilities;
  source: LeafNodeSource;
  /** Only for `KeyPackage` leaves */
  lifetime: Lifetime | null = null;
  /** Only for `Commit` leaves */
  parentHash: Uint8Array | null = null;
  extensions: Extension[] = [];
  signature: Uint8Array = new Uint8Array(0);

  constructor(encryptionKey: Uint8Array, signatureKey: Uint8Array, credential: Credential,
    capabilities: Capabilities, source: LeafNodeSource) {
    this.encryptionKey = encryptionKey;
    this.signatureKey = signatureKey;
    this.credential = credential;
    this.capabilities = capabilities;
    this.source = source;
  }

  static read(reader: TLSReader): LeafNode {
    let encryptionKey = reader.opaque();
    let signatureKey = reader.opaque();
    let credential = Credential.read(reader);
    let capabilities = Capabilities.read(reader);
    let source = reader.uint8();
    let leaf = new LeafNode(encryptionKey, signatureKey, credential, capabilities, source);
    if (source == LeafNodeSource.KeyPackage) {
      leaf.lifetime = Lifetime.read(reader);
    } else if (source == LeafNodeSource.Commit) {
      leaf.parentHash = reader.opaque();
    } else if (source != LeafNodeSource.Update) {
      throw new TLSParseError(`Unknown MLS leaf node source ${source}`);
    }
    leaf.extensions = Extension.readVector(reader);
    leaf.signature = reader.opaque();
    return leaf;
  }

  static fromBytes(data: Uint8Array): LeafNode {
    return LeafNode.read(new TLSReader(data));
  }

  writeTo(writer: TLSWriter): void {
    this.writeContentTo(writer);
    writer.opaque(this.signature);
  }

  toBytes(): Uint8Array {
    return tlsSerialize(writer => this.writeTo(writer));
  }

  /** Everything above the signature, i.e. the `LeafNodeTBS` prefix. */
  protected writeContentTo(writer: TLSWriter): void {
    writer.opaque(this.encryptionKey).opaque(this.signatureKey);
    this.credential.writeTo(writer);
    this.capabilities.writeTo(writer);
    writer.uint8(this.source);
    if (this.source == LeafNodeSource.KeyPackage) {
      this.lifetime.writeTo(writer);
    } else if (this.source == LeafNodeSource.Commit) {
      writer.opaque(this.parentHash);
    }
    Extension.writeVector(writer, this.extensions);
  }

  /** RFC 9420 § 7.2 `LeafNodeTBS`. `groupID` and `leafIndex` are ignored for a
   * `KeyPackage` leaf, which is signed before any group exists. */
  protected signatureContent(groupID: Uint8Array, leafIndex: number): Uint8Array {
    return tlsSerialize(writer => {
      this.writeContentTo(writer);
      if (this.source != LeafNodeSource.KeyPackage) {
        writer.opaque(groupID).uint32(leafIndex);
      }
    });
  }

  sign(suite: CipherSuite, signaturePrivateKey: Uint8Array, groupID: Uint8Array, leafIndex: number): void {
    this.signature = suite.signWithLabel(signaturePrivateKey, "LeafNodeTBS", this.signatureContent(groupID, leafIndex));
  }

  verify(suite: CipherSuite, groupID: Uint8Array, leafIndex: number): boolean {
    return suite.verifyWithLabel(this.signatureKey, "LeafNodeTBS",
      this.signatureContent(groupID, leafIndex), this.signature);
  }

  /** A copy, so that changing a leaf never mutates the one still in the tree. */
  clone(): LeafNode {
    let copy = new LeafNode(this.encryptionKey, this.signatureKey, this.credential, this.capabilities, this.source);
    copy.lifetime = this.lifetime;
    copy.parentHash = this.parentHash;
    copy.extensions = [...this.extensions];
    copy.signature = this.signature;
    return copy;
  }

  /** RFC 9420 § 7.3: the checks that do not need the group's state.
   * The lifetime is only checked for a leaf that came from a KeyPackage. */
  isValidAt(now: Date): boolean {
    if (this.source == LeafNodeSource.KeyPackage && !this.lifetime?.contains(now)) {
      return false;
    }
    // Every extension we use must be one the client says it supports
    return this.extensions.every(extension => this.capabilities.supportsExtension(extension.type)) &&
      this.capabilities.supportsCredential(this.credential.type);
  }
}

/** RFC 9420 § 7.2 */
export enum LeafNodeSource {
  KeyPackage = 1,
  Update = 2,
  Commit = 3,
}
