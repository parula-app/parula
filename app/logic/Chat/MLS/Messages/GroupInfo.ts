/** Everything a new member needs to bootstrap its group state, RFC 9420 § 12.4.3.
 *
 *     struct {
 *         GroupContext group_context;
 *         Extension extensions<V>;
 *         MAC confirmation_tag;
 *         uint32 signer;
 *         opaque signature<V>;   // SignWithLabel(., "GroupInfoTBS", GroupInfoTBS)
 *     } GroupInfo;
 *
 * It travels encrypted inside a `Welcome`, and in the clear as the
 * `mls_group_info` an external joiner commits against. `signer` is the leaf
 * index of the committer, whose leaf node holds the key that signed this. The
 * `confirmationTag` is the one from the Commit that started this epoch, which
 * is what proves to the joiner that the tree it got and the key schedule it
 * derived agree with everyone else's. */
import { GroupContext } from "./GroupContext";
import { Extension, ExtensionType } from "./Extension";
import type { CipherSuite } from "../Crypto/CipherSuite";
import { TLSReader, tlsParse } from "../Codec/TLSReader";
import { TLSWriter, tlsSerialize } from "../Codec/TLSWriter";

export class GroupInfo {
  groupContext: GroupContext;
  extensions: Extension[];
  /** `MAC(confirmation_key, confirmed_transcript_hash)` of the current epoch */
  confirmationTag: Uint8Array;
  /** Leaf index of the member that created this GroupInfo */
  signer: number;
  signature: Uint8Array = new Uint8Array(0);

  constructor(groupContext: GroupContext, extensions: Extension[], confirmationTag: Uint8Array, signer: number) {
    this.groupContext = groupContext;
    this.extensions = extensions;
    this.confirmationTag = confirmationTag;
    this.signer = signer;
  }

  get suite(): CipherSuite {
    return this.groupContext.suite;
  }

  static read(reader: TLSReader): GroupInfo {
    let groupInfo = new GroupInfo(GroupContext.read(reader), Extension.readVector(reader),
      reader.opaque(), reader.uint32());
    groupInfo.signature = reader.opaque();
    return groupInfo;
  }

  static fromBytes(data: Uint8Array): GroupInfo {
    return tlsParse(data, GroupInfo.read);
  }

  writeTo(writer: TLSWriter): void {
    this.writeContentTo(writer);
    writer.opaque(this.signature);
  }

  toBytes(): Uint8Array {
    return tlsSerialize(writer => this.writeTo(writer));
  }

  /** RFC 9420 § 12.4.3 `GroupInfoTBS`: everything above the signature. */
  protected writeContentTo(writer: TLSWriter): void {
    this.groupContext.writeTo(writer);
    Extension.writeVector(writer, this.extensions);
    writer.opaque(this.confirmationTag).uint32(this.signer);
  }

  protected signatureContent(): Uint8Array {
    return tlsSerialize(writer => this.writeContentTo(writer));
  }

  /** RFC 9420 § 12.4.3. Signed with the key of the leaf at `signer`. */
  sign(signaturePrivateKey: Uint8Array): void {
    this.signature = this.suite.signWithLabel(signaturePrivateKey, "GroupInfoTBS", this.signatureContent());
  }

  /** @param signaturePublicKey from the leaf node at `signer` in the ratchet tree */
  verify(signaturePublicKey: Uint8Array): boolean {
    return this.suite.verifyWithLabel(signaturePublicKey, "GroupInfoTBS", this.signatureContent(), this.signature);
  }

  /** RFC 9420 § 12.4.3: the confirmation tag of the current epoch, which a
   * joiner recomputes from the key schedule it derived from the Welcome. */
  computeConfirmationTag(confirmationKey: Uint8Array): Uint8Array {
    return this.suite.mac(confirmationKey, this.groupContext.confirmedTranscriptHash);
  }

  verifyConfirmationTag(confirmationKey: Uint8Array): boolean {
    return this.suite.verifyMAC(confirmationKey, this.groupContext.confirmedTranscriptHash, this.confirmationTag);
  }

  /** RFC 9420 § 12.4.3.3: the serialized `optional<Node> ratchet_tree<V>`, when
   * the sender embedded the tree instead of leaving it to the delivery service. */
  get ratchetTree(): Uint8Array | null {
    return Extension.find(this.extensions, ExtensionType.RatchetTree)?.data ?? null;
  }

  /** RFC 9420 § 12.4.3.2 `ExternalPub`: the group-wide HPKE key that an external
   * commit encrypts its `ExternalInit` to. */
  get externalPub(): Uint8Array | null {
    let extension = Extension.find(this.extensions, ExtensionType.ExternalPub);
    return extension ? new TLSReader(extension.data).opaque() : null;
  }
}
