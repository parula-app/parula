/** The official MLS interop test vectors for a parsed ratchet tree, from
 * <https://github.com/mlswg/mls-implementations> `test-vectors/`, trimmed to
 * the cipher suites we implement.
 *
 * This is what a client has to get right when it joins a group and is handed
 * somebody else's tree: the tree hash of every node (RFC 9420 § 7.8), the
 * resolution of every node (§ 4.1.1), and the two signature chains that make
 * the tree trustworthy — each member's leaf signature (§ 7.3) and the parent
 * hashes that tie every non-blank parent node back to a leaf (§ 7.9.2). */
import { RatchetTree } from "../../../../logic/Chat/MLS/Tree/RatchetTree";
import { CipherSuite } from "../../../../logic/Chat/MLS/Crypto/CipherSuite";
import treeValidation from "./vectors/tree-validation.json";
import { expect, test } from "vitest";

treeValidation.forEach((vector, index) => {
  let suite = CipherSuite.all.find(suite => suite.id == vector.cipher_suite);
  if (!suite) {
    return;
  }
  test(`tree ${index} with ${vector.tree_hashes.length} nodes for ${suite.name}`, () => {
    let tree = RatchetTree.fromBytes(suite, hex(vector.tree));
    expect(tree.nodeCount).toBe(vector.tree_hashes.length);
    expect(bytes(tree.toBytes())).toBe(vector.tree);

    vector.tree_hashes.forEach((expected, nodeIndex) =>
      expect(bytes(tree.treeHash(nodeIndex))).toBe(expected));
    expect(bytes(tree.treeHash())).toBe(vector.tree_hashes[tree.rootIndex]);

    vector.resolutions.forEach((expected, nodeIndex) =>
      expect(tree.resolution(nodeIndex)).toEqual(expected));

    expect(tree.verifyParentHashes()).toBe(true);
    expect(tree.verifyLeaves(hex(vector.group_id))).toBe(true);
  });
});

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
