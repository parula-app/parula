/** The message that actually changes the group, RFC 9420 § 12.4.
 *
 *     struct {
 *         ProposalOrRef proposals<V>;
 *         optional<UpdatePath> path;
 *     } Commit;
 *
 * A Commit applies a list of proposals and starts a new epoch. `path` re-keys
 * the committer's direct path, which gives the new epoch forward secrecy and
 * post-compromise security; it is optional only for a Commit that contains
 * nothing but Add and PreSharedKey proposals (`Proposal.requiresPath`), and it
 * is mandatory for an empty Commit. */
import { ProposalOrRef } from "./Proposal";
import { UpdatePath } from "../Tree/UpdatePath";
import { TLSReader, tlsParse } from "../Codec/TLSReader";
import { TLSWriter, tlsSerialize } from "../Codec/TLSWriter";

export class Commit {
  readonly proposals: ProposalOrRef[];
  path: UpdatePath | null;

  constructor(proposals: ProposalOrRef[] = [], path: UpdatePath | null = null) {
    this.proposals = proposals;
    this.path = path;
  }

  static read(reader: TLSReader): Commit {
    return new Commit(reader.vector(ProposalOrRef.read), reader.optional(UpdatePath.read));
  }

  static fromBytes(data: Uint8Array): Commit {
    return tlsParse(data, Commit.read);
  }

  writeTo(writer: TLSWriter): void {
    writer.vector(this.proposals, (writer, proposal) => proposal.writeTo(writer))
      .optional(this.path, (writer, path) => path.writeTo(writer));
  }

  toBytes(): Uint8Array {
    return tlsSerialize(writer => this.writeTo(writer));
  }
}
