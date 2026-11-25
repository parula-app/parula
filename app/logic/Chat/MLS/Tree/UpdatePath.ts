/** The new key material that a Commit hands to the rest of the group, RFC 9420 § 7.6.
 *
 *     struct {
 *         HPKEPublicKey encryption_key;
 *         HPKECiphertext encrypted_path_secret<V>;
 *     } UpdatePathNode;
 *
 *     struct {
 *         LeafNode leaf_node;
 *         UpdatePathNode nodes<V>;
 *     } UpdatePath;
 *
 * `nodes` runs leaf to root, in the same order as the committer's *filtered*
 * direct path, and each node carries one ciphertext per member of the
 * resolution of its copath child. That vector is legitimately empty when the
 * only thing in that resolution is a member added by the same Commit: those
 * get their path secret in the Welcome instead. @see `RatchetTree` */
import { LeafNode } from "./LeafNode";
import type { HPKECiphertext } from "../Crypto/HPKE";
import { TLSReader, tlsParse } from "../Codec/TLSReader";
import { TLSWriter, tlsSerialize } from "../Codec/TLSWriter";

export class UpdatePath {
  /** The committer's new leaf, with `leaf_node_source == commit` */
  readonly leafNode: LeafNode;
  /** Lowest node of the filtered direct path first, the root last */
  readonly nodes: UpdatePathNode[];

  constructor(leafNode: LeafNode, nodes: UpdatePathNode[]) {
    this.leafNode = leafNode;
    this.nodes = nodes;
  }

  static read(reader: TLSReader): UpdatePath {
    return new UpdatePath(LeafNode.read(reader), reader.vector(UpdatePathNode.read));
  }

  static fromBytes(data: Uint8Array): UpdatePath {
    return tlsParse(data, UpdatePath.read);
  }

  writeTo(writer: TLSWriter): void {
    this.leafNode.writeTo(writer);
    writer.vector(this.nodes, (writer, node) => node.writeTo(writer));
  }

  toBytes(): Uint8Array {
    return tlsSerialize(writer => this.writeTo(writer));
  }
}

export class UpdatePathNode {
  readonly encryptionKey: Uint8Array;
  /** One per node of the resolution of the copath child, in resolution order */
  readonly encryptedPathSecrets: HPKECiphertext[];

  constructor(encryptionKey: Uint8Array, encryptedPathSecrets: HPKECiphertext[]) {
    this.encryptionKey = encryptionKey;
    this.encryptedPathSecrets = encryptedPathSecrets;
  }

  static read(reader: TLSReader): UpdatePathNode {
    return new UpdatePathNode(reader.opaque(), reader.vector(readHPKECiphertext));
  }

  writeTo(writer: TLSWriter): void {
    writer.opaque(this.encryptionKey).vector(this.encryptedPathSecrets, writeHPKECiphertext);
  }
}

/** RFC 9420 § 6.3.1 `HPKECiphertext`. It is a plain pair of byte strings that
 * `Crypto/HPKE` produces and consumes, so it has no class of its own; these
 * two functions are its serialization, for here and for `Welcome`. */
export function readHPKECiphertext(reader: TLSReader): HPKECiphertext {
  return { kemOutput: reader.opaque(), ciphertext: reader.opaque() };
}

export function writeHPKECiphertext(writer: TLSWriter, sealed: HPKECiphertext): void {
  writer.opaque(sealed.kemOutput).opaque(sealed.ciphertext);
}
