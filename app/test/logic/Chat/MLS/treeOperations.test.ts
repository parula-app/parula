/** The official MLS interop test vectors for applying one proposal to a tree,
 * from <https://github.com/mlswg/mls-implementations> `test-vectors/`.
 *
 * Add, Update and Remove each rearrange the tree in their own way (RFC 9420
 * § 12.1.1 – § 12.1.3), and the vectors compare the serialized tree afterwards,
 * so an unmerged leaf that we forgot to record or a right edge we forgot to
 * truncate shows up immediately.
 *
 * `Messages/Proposal.ts` is another module's file, so the few bytes of the
 * proposal that name the operation are read here by hand rather than parsed. */
import { RatchetTree } from "../../../../logic/Chat/MLS/Tree/RatchetTree";
import { LeafNode } from "../../../../logic/Chat/MLS/Tree/LeafNode";
import { CipherSuite } from "../../../../logic/Chat/MLS/Crypto/CipherSuite";
import { TLSReader } from "../../../../logic/Chat/MLS/Codec/TLSReader";
import treeOperations from "./vectors/tree-operations.json";
import { expect, test } from "vitest";

treeOperations.forEach((vector, index) => {
  let suite = CipherSuite.all.find(suite => suite.id == vector.cipher_suite);
  if (!suite) {
    return;
  }
  test(`${proposalName(vector.proposal)} by leaf ${vector.proposal_sender} in vector ${index}`, () => {
    let tree = RatchetTree.fromBytes(suite, hex(vector.tree_before));
    expect(bytes(tree.treeHash())).toBe(vector.tree_hash_before);

    applyProposal(tree, hex(vector.proposal), vector.proposal_sender);

    expect(bytes(tree.toBytes())).toBe(vector.tree_after);
    expect(bytes(tree.treeHash())).toBe(vector.tree_hash_after);
  });
});

/** RFC 9420 § 12.1: `ProposalType proposal_type` and then the variant. */
function applyProposal(tree: RatchetTree, proposal: Uint8Array, sender: number): void {
  let reader = new TLSReader(proposal);
  let type = reader.uint16();
  if (type == kProposalTypeAdd) {
    // KeyPackage: version, cipher_suite, init_key, then the leaf node we want
    reader.uint16();
    reader.uint16();
    reader.opaque();
    tree.addLeaf(LeafNode.read(reader));
  } else if (type == kProposalTypeUpdate) {
    tree.updateLeaf(sender, LeafNode.read(reader));
  } else if (type == kProposalTypeRemove) {
    tree.removeLeaf(reader.uint32());
  } else {
    throw new Error(`Proposal type ${type} is not one of the three that change the tree`);
  }
}

function proposalName(proposal: string): string {
  return ["", "Add", "Update", "Remove"][parseInt(proposal.substring(0, 4), 16)];
}

/** RFC 9420 § 17.4 "MLS Proposal Types" */
const kProposalTypeAdd = 0x0001;
const kProposalTypeUpdate = 0x0002;
const kProposalTypeRemove = 0x0003;

function hex(text: string): Uint8Array {
  let out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(text.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytes(data: Uint8Array): string {
  return [...data].map(b => b.toString(16).padStart(2, "0")).join("");
}
