/** The official MLS interop test vectors for the array-based tree of
 * RFC 9420 Appendix C, from <https://github.com/mlswg/mls-implementations>
 * `test-vectors/`. They pin the index arithmetic that every other tree
 * operation stands on: a wrong `parent()` silently encrypts a path secret to
 * the wrong subtree, which no signature check would catch.
 *
 * A `null` in a vector's array means the operation is undefined there — the
 * children of a leaf, the parent or sibling of the root — and our methods
 * throw for those. */
import { RatchetTree } from "../../../../logic/Chat/MLS/Tree/RatchetTree";
import { LeafNode, LeafNodeSource } from "../../../../logic/Chat/MLS/Tree/LeafNode";
import { Capabilities } from "../../../../logic/Chat/MLS/Tree/Capabilities";
import { BasicCredential } from "../../../../logic/Chat/MLS/Messages/Credential";
import { CipherSuite } from "../../../../logic/Chat/MLS/Crypto/CipherSuite";
import treeMath from "./vectors/tree-math.json";
import { expect, test } from "vitest";

for (let vector of treeMath) {
  test(`tree math for ${vector.n_leaves} leaves`, () => {
    let tree = treeWithLeaves(vector.n_leaves);
    expect(tree.leafCount).toBe(vector.n_leaves);
    expect(tree.nodeCount).toBe(vector.n_nodes);
    expect(tree.rootIndex).toBe(vector.root);

    for (let nodeIndex = 0; nodeIndex < vector.n_nodes; nodeIndex++) {
      expectResult(vector.left[nodeIndex], () => tree.leftChild(nodeIndex));
      expectResult(vector.right[nodeIndex], () => tree.rightChild(nodeIndex));
      expectResult(vector.parent[nodeIndex], () => tree.parentOf(nodeIndex));
      expectResult(vector.sibling[nodeIndex], () => tree.siblingOf(nodeIndex));
    }
  });
}

test("direct path, copath and common ancestor of the RFC 9420 § 4.1.2 example tree", () => {
  let tree = treeWithLeaves(8);
  // Figure 11: leaf A = 0, direct path T=1, U=3, W=7, copath B=2, V=5, Y=11
  expect(tree.directPath(0)).toEqual([1, 3, 7]);
  expect(tree.copath(0)).toEqual([2, 5, 11]);
  expect(tree.directPath(12)).toEqual([13, 11, 7]);
  expect(tree.copath(12)).toEqual([14, 9, 3]);
  expect(tree.directPath(7)).toEqual([]);
  expect(tree.copath(7)).toEqual([]);

  expect(tree.commonAncestor(0, 2)).toBe(1);
  expect(tree.commonAncestor(0, 4)).toBe(3);
  expect(tree.commonAncestor(0, 12)).toBe(7);
  expect(tree.commonAncestor(1, 3)).toBe(3);
  expect(tree.commonAncestor(3, 1)).toBe(3);
  expect(tree.commonAncestor(9, 9)).toBe(9);
});

/** A tree of blank parents with a member at every leaf, which is all the
 * geometry cares about. */
function treeWithLeaves(leafCount: number): RatchetTree {
  let tree = new RatchetTree(CipherSuite.all[0]);
  for (let i = 0; i < leafCount; i++) {
    tree.addLeaf(new LeafNode(new Uint8Array(0), new Uint8Array(0),
      BasicCredential.fromString(`member${i}`), Capabilities.ours(), LeafNodeSource.KeyPackage));
  }
  return tree;
}

function expectResult(expected: number | null, compute: () => number): void {
  if (expected == null) {
    expect(compute).toThrow();
  } else {
    expect(compute()).toBe(expected);
  }
}
