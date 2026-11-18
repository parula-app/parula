/** The official MLS interop test vectors for TreeKEM, from
 * <https://github.com/mlswg/mls-implementations> `test-vectors/`, trimmed to
 * the cipher suites we implement.
 *
 * Each entry is one group state plus a set of UpdatePaths, one per member.
 * For every UpdatePath we check both halves of RFC 9420 § 7.5: merging it
 * gives the tree that everybody else also computes (`tree_hash_after`), and
 * every member it was addressed to recovers the same `commit_secret` from the
 * single path secret that was encrypted to it.
 *
 * The HPKE context is the *provisional* GroupContext of § 12.4.1: the new tree
 * hash, but the *old* confirmed transcript hash. `Messages/GroupContext.ts` is
 * another module's file, so it is serialized here by hand.
 *
 * The vectors cannot pin `createUpdatePath()`, whose path secrets are fresh
 * random, so the last test drives one of our own update paths through every
 * other member instead. */
import { RatchetTree } from "../../../../logic/Chat/MLS/Tree/RatchetTree";
import { UpdatePath } from "../../../../logic/Chat/MLS/Tree/UpdatePath";
import { LeafNode, LeafNodeSource } from "../../../../logic/Chat/MLS/Tree/LeafNode";
import { Capabilities } from "../../../../logic/Chat/MLS/Tree/Capabilities";
import { Lifetime } from "../../../../logic/Chat/MLS/Tree/Lifetime";
import { BasicCredential } from "../../../../logic/Chat/MLS/Messages/Credential";
import { CipherSuite } from "../../../../logic/Chat/MLS/Crypto/CipherSuite";
import { tlsSerialize } from "../../../../logic/Chat/MLS/Codec/TLSWriter";
import treekem from "./vectors/treekem.json";
import { expect, test } from "vitest";

treekem.forEach((vector, index) => {
  let suite = CipherSuite.all.find(suite => suite.id == vector.cipher_suite);
  if (!suite) {
    return;
  }
  let groupID = hex(vector.group_id);
  let confirmedTranscriptHash = hex(vector.confirmed_transcript_hash);
  let context = (treeHash: Uint8Array) => groupContext(suite, groupID, vector.epoch, treeHash, confirmedTranscriptHash);

  test(`update paths of vector ${index}, ${vector.leaves_private.length} members, for ${suite.name}`, () => {
    let tree = RatchetTree.fromBytes(suite, hex(vector.ratchet_tree));
    expect(tree.verifyParentHashes()).toBe(true);
    expect(tree.verifyLeaves(groupID)).toBe(true);

    for (let update of vector.update_paths) {
      let updatePath = UpdatePath.fromBytes(hex(update.update_path));

      let merged = tree.clone();
      merged.mergeUpdatePath(update.sender, updatePath);
      expect(bytes(merged.treeHash())).toBe(update.tree_hash_after);
      expect(merged.verifyParentHashes()).toBe(true);

      for (let member of vector.leaves_private) {
        let pathSecret = update.path_secrets[member.index];
        if (!pathSecret) {   // the committer itself, or a blank leaf
          continue;
        }
        let ourTree = tree.clone();
        let ourPrivateKeys = privateKeysOf(suite, member);
        let commitSecret = ourTree.applyUpdatePath(update.sender, updatePath,
          context(merged.treeHash()), member.index, ourPrivateKeys);
        expect(bytes(commitSecret)).toBe(update.commit_secret);
        expect(bytes(ourTree.treeHash())).toBe(update.tree_hash_after);
        // The path secret we decrypted, pinned through the node key pair it derives
        expect(bytes(ourPrivateKeys.get(intersection(ourTree, update.sender, member.index))))
          .toBe(bytes(nodePrivateKey(suite, hex(pathSecret))));
      }
    }
  });

  test(`our own update path in vector ${index} for ${suite.name}`, () => {
    let tree = RatchetTree.fromBytes(suite, hex(vector.ratchet_tree));
    let committer = vector.leaves_private[0];
    let ourTree = tree.clone();
    let newLeaf = ourTree.leaf(committer.index).clone();
    newLeaf.encryptionKey = suite.kem.generateKeyPair().publicKey;
    let created = ourTree.createUpdatePath(committer.index, groupID, hex(committer.signature_priv), newLeaf, context);

    // Everyone we send this to will run these two checks before they trust it
    expect(ourTree.verifyParentHashes()).toBe(true);
    expect(ourTree.verifyLeaves(groupID)).toBe(true);
    expect(created.updatePath.nodes.length).toBe(ourTree.filteredDirectPath(committer.index).length);

    for (let member of vector.leaves_private) {
      if (member.index == committer.index) {
        continue;
      }
      let theirTree = tree.clone();
      let theirPrivateKeys = privateKeysOf(suite, member);
      let commitSecret = theirTree.applyUpdatePath(committer.index, created.updatePath,
        context(ourTree.treeHash()), member.index, theirPrivateKeys);
      expect(bytes(commitSecret)).toBe(bytes(created.commitSecret));
      expect(bytes(theirTree.treeHash())).toBe(bytes(ourTree.treeHash()));
      // What we would have put into their GroupSecrets is what they end up with
      expect(bytes(theirPrivateKeys.get(intersection(theirTree, committer.index, member.index))))
        .toBe(bytes(nodePrivateKey(suite, created.pathSecrets.get(member.index))));
    }
  });
});

/** RFC 9420 § 12.4.1: a member that the same Commit adds must be left out of
 * the resolutions we encrypt to, because it gets its path secret in the
 * Welcome instead. A node whose resolution is only that new member therefore
 * sends no ciphertext at all, which is legal and must not be mistaken for an
 * error. The vectors have no Commit that adds anybody, so this one is built by
 * hand: two members, one joiner into the new right half of the tree. */
test("a leaf added by the same commit is excluded from the resolutions", () => {
  let vector = treekem[0];
  let suite = CipherSuite.all.find(suite => suite.id == vector.cipher_suite);
  let groupID = hex(vector.group_id);
  let context = (treeHash: Uint8Array) =>
    groupContext(suite, groupID, vector.epoch, treeHash, hex(vector.confirmed_transcript_hash));
  let committer = vector.leaves_private[0];
  let member = vector.leaves_private[1];
  let joiner = 2;

  let tree = RatchetTree.fromBytes(suite, hex(vector.ratchet_tree));
  expect(tree.addLeaf(joinerLeaf(suite, groupID, joiner))).toBe(joiner);

  let ourTree = tree.clone();
  let newLeaf = ourTree.leaf(committer.index).clone();
  newLeaf.encryptionKey = suite.kem.generateKeyPair().publicKey;
  let created = ourTree.createUpdatePath(committer.index, groupID, hex(committer.signature_priv),
    newLeaf, context, [joiner]);
  expect(created.updatePath.nodes.length).toBe(2);
  expect(created.updatePath.nodes[0].encryptedPathSecrets.length).toBe(1);
  expect(created.updatePath.nodes[1].encryptedPathSecrets.length).toBe(0);
  // The joiner's Welcome carries the path secret of the node it could not be sent
  expect(bytes(suite.kem.deriveKeyPair(suite.deriveSecret(created.pathSecrets.get(joiner), "node")).publicKey))
    .toBe(bytes(created.updatePath.nodes[1].encryptionKey));

  let theirTree = tree.clone();
  let theirPrivateKeys = privateKeysOf(suite, member);
  let commitSecret = theirTree.applyUpdatePath(committer.index, created.updatePath,
    context(ourTree.treeHash()), member.index, theirPrivateKeys, [joiner]);
  expect(bytes(commitSecret)).toBe(bytes(created.commitSecret));
  expect(bytes(theirTree.treeHash())).toBe(bytes(ourTree.treeHash()));
});

function joinerLeaf(suite: CipherSuite, groupID: Uint8Array, leafIndex: number): LeafNode {
  let signatureKeyPair = suite.generateSignatureKeyPair();
  let leaf = new LeafNode(suite.kem.generateKeyPair().publicKey, signatureKeyPair.publicKey,
    BasicCredential.fromString("joiner@example.com"), Capabilities.ours(), LeafNodeSource.KeyPackage);
  leaf.lifetime = Lifetime.forDays(30);
  leaf.sign(suite, signatureKeyPair.privateKey, groupID, leafIndex);
  return leaf;
}

/** RFC 9420 § 8.1 `GroupContext`, with no extensions. */
function groupContext(suite: CipherSuite, groupID: Uint8Array, epoch: number,
  treeHash: Uint8Array, confirmedTranscriptHash: Uint8Array): Uint8Array {
  return tlsSerialize(writer => writer
    .uint16(1)   // ProtocolVersion mls10
    .uint16(suite.id)
    .opaque(groupID)
    .uint64(epoch)
    .opaque(treeHash)
    .opaque(confirmedTranscriptHash)
    .vector([], () => undefined));
}

/** Node index → HPKE private key, as the member at that leaf holds them:
 * its own leaf key plus one derived key per path secret it was ever sent. */
function privateKeysOf(suite: CipherSuite, member: { index: number, encryption_priv: string,
  path_secrets: { node: number, path_secret: string }[] }): Map<number, Uint8Array> {
  let keys = new Map<number, Uint8Array>([[member.index * 2, hex(member.encryption_priv)]]);
  for (let known of member.path_secrets) {
    keys.set(known.node, nodePrivateKey(suite, hex(known.path_secret)));
  }
  return keys;
}

/** RFC 9420 § 7.4: `DeriveKeyPair(DeriveSecret(path_secret, "node"))` */
function nodePrivateKey(suite: CipherSuite, pathSecret: Uint8Array): Uint8Array {
  return suite.kem.deriveKeyPair(suite.deriveSecret(pathSecret, "node")).privateKey;
}

/** The lowest node of the committer's filtered direct path that is above us,
 * i.e. the one whose path secret we should have recovered. */
function intersection(tree: RatchetTree, senderLeafIndex: number, ourLeafIndex: number): number {
  let ours = tree.directPath(ourLeafIndex * 2);
  return tree.filteredDirectPath(senderLeafIndex).find(nodeIndex => ours.includes(nodeIndex));
}

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
