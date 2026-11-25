/** A change to the group that a Commit can apply, RFC 9420 § 12.1.
 *
 *     struct {
 *         ProposalType proposal_type;
 *         select (Proposal.proposal_type) {
 *             case add:                      Add;
 *             case update:                   Update;
 *             case remove:                   Remove;
 *             case psk:                      PreSharedKey;
 *             case reinit:                   ReInit;
 *             case external_init:            ExternalInit;
 *             case group_context_extensions: GroupContextExtensions;
 *         };
 *     } Proposal;
 *
 * Proposals only describe an intent; nothing changes until a Commit references
 * them, either by value or by `ProposalRef`. The RFC calls the variants `Add`,
 * `Update` and so on; we suffix them with `Proposal`, because `Add` and `Update`
 * alone are far too generic for an exported name. */
import { KeyPackage } from "./KeyPackage";
import { Extension } from "./Extension";
import { LeafNode } from "../Tree/LeafNode";
import { PreSharedKeyID } from "../KeySchedule";
import { CipherSuite } from "../Crypto/CipherSuite";
import { TLSReader, TLSParseError, tlsParse } from "../Codec/TLSReader";
import { TLSWriter, tlsSerialize } from "../Codec/TLSWriter";
import { kProtocolVersionMLS10 } from "../Tree/Capabilities";

export abstract class Proposal {
  abstract readonly type: ProposalType;

  static read(reader: TLSReader): Proposal {
    let type = reader.uint16();
    switch (type) {
      case ProposalType.Add:
        return new AddProposal(KeyPackage.read(reader));
      case ProposalType.Update:
        return new UpdateProposal(LeafNode.read(reader));
      case ProposalType.Remove:
        return new RemoveProposal(reader.uint32());
      case ProposalType.PreSharedKey:
        return new PreSharedKeyProposal(PreSharedKeyID.read(reader));
      case ProposalType.ReInit:
        return new ReInitProposal(reader.opaque(), reader.uint16(), CipherSuite.forID(reader.uint16()),
          Extension.readVector(reader));
      case ProposalType.ExternalInit:
        return new ExternalInitProposal(reader.opaque());
      case ProposalType.GroupContextExtensions:
        return new GroupContextExtensionsProposal(Extension.readVector(reader));
      default:
        throw new TLSParseError(`Unsupported MLS proposal type ${type}`);
    }
  }

  static fromBytes(data: Uint8Array): Proposal {
    return tlsParse(data, Proposal.read);
  }

  /** Writes the `proposal_type` discriminant and the selected arm. */
  writeTo(writer: TLSWriter): void {
    writer.uint16(this.type);
    this.writeBodyTo(writer);
  }

  protected abstract writeBodyTo(writer: TLSWriter): void;

  toBytes(): Uint8Array {
    return tlsSerialize(writer => this.writeTo(writer));
  }

  /** RFC 9420 § 12.4: a Commit covering such a proposal MUST populate `path`. */
  get requiresPath(): boolean {
    return kPathRequiredTypes.includes(this.type);
  }
}

/** RFC 9420 § 12.1.1: `struct { KeyPackage key_package; } Add;` */
export class AddProposal extends Proposal {
  readonly type = ProposalType.Add;
  readonly keyPackage: KeyPackage;

  constructor(keyPackage: KeyPackage) {
    super();
    this.keyPackage = keyPackage;
  }

  protected writeBodyTo(writer: TLSWriter): void {
    this.keyPackage.writeTo(writer);
  }
}

/** RFC 9420 § 12.1.2: `struct { LeafNode leaf_node; } Update;`
 * The leaf node has `leaf_node_source == update`. */
export class UpdateProposal extends Proposal {
  readonly type = ProposalType.Update;
  readonly leafNode: LeafNode;

  constructor(leafNode: LeafNode) {
    super();
    this.leafNode = leafNode;
  }

  protected writeBodyTo(writer: TLSWriter): void {
    this.leafNode.writeTo(writer);
  }
}

/** RFC 9420 § 12.1.3: `struct { uint32 removed; } Remove;`
 * `removed` is a leaf index, not a node index. */
export class RemoveProposal extends Proposal {
  readonly type = ProposalType.Remove;
  readonly removed: number;

  constructor(removed: number) {
    super();
    this.removed = removed;
  }

  protected writeBodyTo(writer: TLSWriter): void {
    writer.uint32(this.removed);
  }
}

/** RFC 9420 § 12.1.4: `struct { PreSharedKeyID psk; } PreSharedKey;` */
export class PreSharedKeyProposal extends Proposal {
  readonly type = ProposalType.PreSharedKey;
  readonly psk: PreSharedKeyID;

  constructor(psk: PreSharedKeyID) {
    super();
    this.psk = psk;
  }

  protected writeBodyTo(writer: TLSWriter): void {
    this.psk.writeTo(writer);
  }
}

/**
 * RFC 9420 § 12.1.5: start a successor group, e.g. to change cipher suite.
 *
 *     struct {
 *         opaque group_id<V>;
 *         ProtocolVersion version;
 *         CipherSuite cipher_suite;
 *         Extension extensions<V>;
 *     } ReInit;
 */
export class ReInitProposal extends Proposal {
  readonly type = ProposalType.ReInit;
  readonly groupID: Uint8Array;
  readonly version: number;
  readonly suite: CipherSuite;
  readonly extensions: Extension[];

  constructor(groupID: Uint8Array, version: number, suite: CipherSuite, extensions: Extension[] = []) {
    super();
    this.groupID = groupID;
    this.version = version;
    this.suite = suite;
    this.extensions = extensions;
  }

  static forSuite(groupID: Uint8Array, suite: CipherSuite, extensions: Extension[] = []): ReInitProposal {
    return new ReInitProposal(groupID, kProtocolVersionMLS10, suite, extensions);
  }

  protected writeBodyTo(writer: TLSWriter): void {
    writer.opaque(this.groupID).uint16(this.version).uint16(this.suite.id);
    Extension.writeVector(writer, this.extensions);
  }
}

/** RFC 9420 § 12.1.6: `struct { opaque kem_output<V>; } ExternalInit;`
 * The HPKE encapsulation to the group's `external_pub`, from which an external
 * joiner and the group derive the same init secret. */
export class ExternalInitProposal extends Proposal {
  readonly type = ProposalType.ExternalInit;
  readonly kemOutput: Uint8Array;

  constructor(kemOutput: Uint8Array) {
    super();
    this.kemOutput = kemOutput;
  }

  protected writeBodyTo(writer: TLSWriter): void {
    writer.opaque(this.kemOutput);
  }
}

/** RFC 9420 § 12.1.7: `struct { Extension extensions<V>; } GroupContextExtensions;`
 * Replaces `GroupContext.extensions` wholesale, it is not a merge. */
export class GroupContextExtensionsProposal extends Proposal {
  readonly type = ProposalType.GroupContextExtensions;
  readonly extensions: Extension[];

  constructor(extensions: Extension[] = []) {
    super();
    this.extensions = extensions;
  }

  protected writeBodyTo(writer: TLSWriter): void {
    Extension.writeVector(writer, this.extensions);
  }
}

/**
 * RFC 9420 § 12.4: how a Commit names a proposal.
 *
 *     struct {
 *       ProposalOrRefType type;
 *       select (ProposalOrRef.type) {
 *         case proposal:  Proposal proposal;
 *         case reference: ProposalRef reference;
 *       };
 *     } ProposalOrRef;
 *
 * By value for the committer's own new proposals, by `MakeProposalRef` hash for
 * proposals anyone already sent in this epoch.
 */
export class ProposalOrRef {
  readonly proposal: Proposal | null;
  /** `MakeProposalRef(AuthenticatedContent)`, RFC 9420 § 5.2 */
  readonly reference: Uint8Array | null;

  protected constructor(proposal: Proposal | null, reference: Uint8Array | null) {
    this.proposal = proposal;
    this.reference = reference;
  }

  static forProposal(proposal: Proposal): ProposalOrRef {
    return new ProposalOrRef(proposal, null);
  }

  static forReference(reference: Uint8Array): ProposalOrRef {
    return new ProposalOrRef(null, reference);
  }

  static read(reader: TLSReader): ProposalOrRef {
    let type = reader.uint8();
    switch (type) {
      case ProposalOrRefType.Proposal:
        return ProposalOrRef.forProposal(Proposal.read(reader));
      case ProposalOrRefType.Reference:
        return ProposalOrRef.forReference(reader.opaque());
      default:
        throw new TLSParseError(`Unknown MLS ProposalOrRef type ${type}`);
    }
  }

  writeTo(writer: TLSWriter): void {
    if (this.proposal) {
      writer.uint8(ProposalOrRefType.Proposal);
      this.proposal.writeTo(writer);
    } else {
      writer.uint8(ProposalOrRefType.Reference).opaque(this.reference);
    }
  }
}

/** RFC 9420 § 17.4 "MLS Proposal Types" */
export enum ProposalType {
  Add = 0x0001,
  Update = 0x0002,
  Remove = 0x0003,
  PreSharedKey = 0x0004,
  ReInit = 0x0005,
  ExternalInit = 0x0006,
  GroupContextExtensions = 0x0007,
}

/** RFC 9420 § 12.4 */
export enum ProposalOrRefType {
  Proposal = 1,
  Reference = 2,
}

/** RFC 9420 § 17.4, "Path Required" column */
const kPathRequiredTypes: number[] = [
  ProposalType.Update, ProposalType.Remove, ProposalType.ExternalInit, ProposalType.GroupContextExtensions,
];
