/** An intermediate node of the ratchet tree, RFC 9420 § 7.1.
 *
 *     struct {
 *         HPKEPublicKey encryption_key;
 *         opaque parent_hash<V>;
 *         uint32 unmerged_leaves<V>;
 *     } ParentNode;
 *
 * `unmergedLeaves` are the leaves below this node whose member does *not* know
 * this node's private key, because they were added after the node was last set.
 * They must stay sorted ascending, and they are what makes the resolution rules
 * of § 4.1.1 more than a blank-node walk. */
import { TLSReader } from "../Codec/TLSReader";
import { TLSWriter } from "../Codec/TLSWriter";

export class ParentNode {
  encryptionKey: Uint8Array;
  parentHash: Uint8Array;
  /** Leaf indices, ascending */
  unmergedLeaves: number[];

  constructor(encryptionKey: Uint8Array, parentHash: Uint8Array = new Uint8Array(0), unmergedLeaves: number[] = []) {
    this.encryptionKey = encryptionKey;
    this.parentHash = parentHash;
    this.unmergedLeaves = unmergedLeaves;
  }

  static read(reader: TLSReader): ParentNode {
    return new ParentNode(reader.opaque(), reader.opaque(), reader.vector(reader => reader.uint32()));
  }

  writeTo(writer: TLSWriter): void {
    writer.opaque(this.encryptionKey).opaque(this.parentHash)
      .vector(this.unmergedLeaves, (writer, leaf) => writer.uint32(leaf));
  }

  addUnmergedLeaf(leafIndex: number): void {
    if (this.unmergedLeaves.includes(leafIndex)) {
      return;
    }
    this.unmergedLeaves.push(leafIndex);
    this.unmergedLeaves.sort((a, b) => a - b);
  }

  clone(): ParentNode {
    return new ParentNode(this.encryptionKey, this.parentHash, [...this.unmergedLeaves]);
  }
}
