/** The state that every member of a group must agree on, RFC 9420 § 8.1.
 *
 *     struct {
 *         ProtocolVersion version = mls10;
 *         CipherSuite cipher_suite;
 *         opaque group_id<V>;
 *         uint64 epoch;
 *         opaque tree_hash<V>;
 *         opaque confirmed_transcript_hash<V>;
 *         Extension extensions<V>;
 *     } GroupContext;
 *
 * It is never sent on its own. It is mixed into the key schedule, into the
 * signature of a member's `FramedContent`, into `GroupInfo`, and it is the HPKE
 * context of every `UpdatePathNode`, so two members whose views differ in any
 * field stop being able to talk to each other. Those consumers only ever need
 * the serialized form, which is why they take `toBytes()` rather than this
 * object. */
import { Extension } from "./Extension";
import { CipherSuite } from "../Crypto/CipherSuite";
import { TLSReader, tlsParse } from "../Codec/TLSReader";
import { TLSWriter, tlsSerialize } from "../Codec/TLSWriter";
import { kProtocolVersionMLS10 } from "../Tree/Capabilities";

export class GroupContext {
  readonly version: number;
  readonly suite: CipherSuite;
  readonly groupID: Uint8Array;
  epoch: bigint;
  treeHash: Uint8Array;
  confirmedTranscriptHash: Uint8Array;
  extensions: Extension[];

  constructor(suite: CipherSuite, groupID: Uint8Array, epoch: bigint, treeHash: Uint8Array,
    confirmedTranscriptHash: Uint8Array, extensions: Extension[] = [], version = kProtocolVersionMLS10) {
    this.suite = suite;
    this.groupID = groupID;
    this.epoch = epoch;
    this.treeHash = treeHash;
    this.confirmedTranscriptHash = confirmedTranscriptHash;
    this.extensions = extensions;
    this.version = version;
  }

  static read(reader: TLSReader): GroupContext {
    let version = reader.uint16();
    let suite = CipherSuite.forID(reader.uint16());
    return new GroupContext(suite, reader.opaque(), reader.uint64(), reader.opaque(), reader.opaque(),
      Extension.readVector(reader), version);
  }

  static fromBytes(data: Uint8Array): GroupContext {
    return tlsParse(data, GroupContext.read);
  }

  writeTo(writer: TLSWriter): void {
    writer.uint16(this.version).uint16(this.suite.id)
      .opaque(this.groupID).uint64(this.epoch)
      .opaque(this.treeHash).opaque(this.confirmedTranscriptHash);
    Extension.writeVector(writer, this.extensions);
  }

  toBytes(): Uint8Array {
    return tlsSerialize(writer => this.writeTo(writer));
  }

  /** The next epoch, before the commit that creates it fills in the hashes. */
  clone(): GroupContext {
    return new GroupContext(this.suite, this.groupID, this.epoch, this.treeHash, this.confirmedTranscriptHash,
      [...this.extensions], this.version);
  }
}
