/** The group's ratchet tree, RFC 9420 § 4.1 and § 7.
 *
 * The tree is a perfect binary tree with 2^d leaves, held in the flat array of
 * RFC 9420 Appendix C: member `i` lives at node index `2 * i`, parents are the
 * odd indices, and every relationship between nodes is index arithmetic rather
 * than pointers. A `null` entry is a *blank* node: no key, no owner.
 *
 * Three things about the tree are subtle, and every one of them is a silent
 * interop failure when it is wrong:
 *
 * - The *resolution* of a node (§ 4.1.1) is not just "the nearest non-blank
 *   descendants": a non-blank node is followed by its unmerged leaves, the
 *   members that joined after the node was last re-keyed and therefore do not
 *   know its private key. Encrypting to a node means encrypting to its whole
 *   resolution.
 * - The *filtered* direct path (§ 4.1.2) drops the nodes whose copath child has
 *   an empty resolution, because encrypting to them would be encrypting to
 *   ourselves. TreeKEM only ever re-keys the filtered path.
 * - *Parent hashes* (§ 7.9) chain from the root down to a leaf, so that a
 *   member's leaf signature covers every key it introduced into the tree.
 *
 * Everything here is synchronous, and no method knows anything about the group
 * beyond what it is handed: the group context and the group ID arrive as bytes,
 * so that `Tree/` stays independent of `Messages/`. */
import { LeafNode, LeafNodeSource } from "./LeafNode";
import { ParentNode } from "./ParentNode";
import { UpdatePath, UpdatePathNode } from "./UpdatePath";
import type { CipherSuite } from "../Crypto/CipherSuite";
import type { HPKECiphertext } from "../Crypto/HPKE";
import { TLSReader, TLSParseError, tlsParse } from "../Codec/TLSReader";
import { TLSWriter, tlsSerialize } from "../Codec/TLSWriter";
import { MLSError } from "../util";
import { bytesEqual, randomBytes } from "../../Signal/Crypto/primitives";

export class RatchetTree {
  readonly suite: CipherSuite;
  /** Node index → node, `null` for a blank node. Length `2 * leafCount - 1`. */
  protected nodes: (TreeNode | null)[] = [];
  /** Node index → tree hash. Dropped wholesale whenever the tree changes. */
  protected treeHashes = new Map<number, Uint8Array>();

  constructor(suite: CipherSuite) {
    this.suite = suite;
  }

  /** One member, at leaf 0 */
  static withLeaf(suite: CipherSuite, leaf: LeafNode): RatchetTree {
    let tree = new RatchetTree(suite);
    tree.nodes = [leaf];
    return tree;
  }

  /** The `ratchet_tree` extension body, RFC 9420 § 12.4.3.3:
   * `optional<Node> ratchet_tree<V>`, in the array order of Appendix C, with
   * the blanks after the last non-blank node left out. */
  static fromBytes(suite: CipherSuite, data: Uint8Array): RatchetTree {
    let tree = new RatchetTree(suite);
    tree.nodes = tlsParse(data, reader => reader.vector(reader => reader.optional(readNode)));
    if (!tree.nodes.length || !tree.nodes[tree.nodes.length - 1]) {
      throw new TLSParseError("The ratchet tree is empty or ends in a blank node");
    }
    for (let nodeIndex = 0; nodeIndex < tree.nodes.length; nodeIndex++) {
      let node = tree.nodes[nodeIndex];
      if (node && (node instanceof LeafNode) != (nodeIndex % 2 == 0)) {
        throw new TLSParseError(`Ratchet tree node ${nodeIndex} is of the wrong type for its position`);
      }
    }
    // "extend the tree to the right until it has a length of the form 2^(d+1) - 1"
    let leafCount = 1;
    while (2 * leafCount - 1 < tree.nodes.length) {
      leafCount *= 2;
    }
    while (tree.nodes.length < 2 * leafCount - 1) {
      tree.nodes.push(null);
    }
    return tree;
  }

  toBytes(): Uint8Array {
    let last = this.nodes.length - 1;
    while (last >= 0 && !this.nodes[last]) {
      last--;
    }
    return tlsSerialize(writer => writer.vector(this.nodes.slice(0, last + 1),
      (writer, node) => writer.optional(node, writeNode)));
  }

  /** Leaf slots, including the blank ones */
  get leafCount(): number {
    return this.nodes.length ? (this.nodes.length + 1) / 2 : 0;
  }

  get nodeCount(): number {
    return this.nodes.length;
  }

  /** Leaves that hold a member */
  get memberCount(): number {
    return this.memberLeafIndices().length;
  }

  get rootIndex(): number {
    return (1 << log2(this.nodes.length)) - 1;
  }

  leaf(leafIndex: number): LeafNode | null {
    let node = this.nodes[leafIndex * 2];
    return node instanceof LeafNode ? node : null;
  }

  parentNode(nodeIndex: number): ParentNode | null {
    let node = this.nodes[nodeIndex];
    return node instanceof ParentNode ? node : null;
  }

  memberLeafIndices(): number[] {
    let indices: number[] = [];
    for (let leafIndex = 0; leafIndex < this.leafCount; leafIndex++) {
      if (this.leaf(leafIndex)) {
        indices.push(leafIndex);
      }
    }
    return indices;
  }

  /** RFC 9420 Appendix C: leaves are level 0, their parents level 1, and so on. */
  level(nodeIndex: number): number {
    if ((nodeIndex & 0x01) == 0) {
      return 0;
    }
    let k = 0;
    while ((nodeIndex >> k & 0x01) == 1) {
      k++;
    }
    return k;
  }

  /** @throws `MLSError` for a leaf, which has no children */
  leftChild(nodeIndex: number): number {
    return nodeIndex ^ (0x01 << (this.parentLevel(nodeIndex) - 1));
  }

  /** @throws `MLSError` for a leaf, which has no children */
  rightChild(nodeIndex: number): number {
    return nodeIndex ^ (0x03 << (this.parentLevel(nodeIndex) - 1));
  }

  /** @throws `MLSError` for the root, which has no parent */
  parentOf(nodeIndex: number): number {
    if (nodeIndex == this.rootIndex) {
      throw new MLSError(`Node ${nodeIndex} is the root and has no parent`);
    }
    let k = this.level(nodeIndex);
    let bit = nodeIndex >> (k + 1) & 0x01;
    return (nodeIndex | 1 << k) ^ (bit << (k + 1));
  }

  /** The other child of our parent. @throws `MLSError` for the root */
  siblingOf(nodeIndex: number): number {
    let parent = this.parentOf(nodeIndex);
    return nodeIndex < parent ? this.rightChild(parent) : this.leftChild(parent);
  }

  /** Leaf → root, excluding the node itself. Empty for the root. */
  directPath(nodeIndex: number): number[] {
    let root = this.rootIndex;
    let path: number[] = [];
    while (nodeIndex != root) {
      nodeIndex = this.parentOf(nodeIndex);
      path.push(nodeIndex);
    }
    return path;
  }

  /** The siblings of the node and of every node on its direct path below the
   * root, i.e. the subtrees that a path secret has to be encrypted to. */
  copath(nodeIndex: number): number[] {
    if (nodeIndex == this.rootIndex) {
      return [];
    }
    let path = [nodeIndex, ...this.directPath(nodeIndex)];
    path.pop();
    return path.map(node => this.siblingOf(node));
  }

  /** RFC 9420 Appendix C `common_ancestor_direct`: the lowest node that has
   * both `a` and `b` below it. Pure arithmetic, no tree lookups. */
  commonAncestor(a: number, b: number): number {
    let levelA = this.level(a) + 1;
    let levelB = this.level(b) + 1;
    if (levelA <= levelB && a >> levelB == b >> levelB) {
      return b;
    }
    if (levelB <= levelA && a >> levelA == b >> levelA) {
      return a;
    }
    let k = 0;
    while (a != b) {
      a >>= 1;
      b >>= 1;
      k++;
    }
    return (a << k) + (1 << (k - 1)) - 1;
  }

  /** RFC 9420 § 4.1.1: the non-blank nodes that together cover every non-blank
   * descendant, depth-first and left-first, each one followed by its unmerged
   * leaves in ascending order. Encrypting to a node means encrypting to each
   * node of its resolution. */
  resolution(nodeIndex: number): number[] {
    let node = this.nodes[nodeIndex];
    if (node) {
      return node instanceof ParentNode
        ? [nodeIndex, ...node.unmergedLeaves.map(leafIndex => leafIndex * 2)]
        : [nodeIndex];
    }
    if (this.level(nodeIndex) == 0) {
      return [];
    }
    return [...this.resolution(this.leftChild(nodeIndex)), ...this.resolution(this.rightChild(nodeIndex))];
  }

  /** RFC 9420 § 4.1.2: the direct path without the nodes whose copath child
   * has an empty resolution. Those need no key pair of their own, because
   * encrypting to them would be encrypting to their other child. */
  filteredDirectPath(leafIndex: number): number[] {
    let direct = this.directPath(leafIndex * 2);
    let copath = this.copath(leafIndex * 2);
    return direct.filter((node, i) => this.resolution(copath[i]).length > 0);
  }

  /** RFC 9420 § 12.1.1: the leftmost blank leaf, or a new leaf at the right
   * edge, extending the tree. The new member does not know the private keys
   * above it, so it becomes an unmerged leaf of every non-blank ancestor. */
  addLeaf(leaf: LeafNode): number {
    let leafIndex = 0;
    while (leafIndex < this.leafCount && this.leaf(leafIndex)) {
      leafIndex++;
    }
    if (leafIndex == this.leafCount) {
      this.extend();
    }
    this.nodes[leafIndex * 2] = leaf;
    for (let nodeIndex of this.directPath(leafIndex * 2)) {
      this.parentNode(nodeIndex)?.addUnmergedLeaf(leafIndex);
    }
    this.changed();
    return leafIndex;
  }

  /** RFC 9420 § 12.1.3: blanks the leaf and its direct path, then drops the
   * right half of the tree for as long as it holds no member at all. */
  removeLeaf(leafIndex: number): void {
    this.nodes[leafIndex * 2] = null;
    this.blankDirectPath(leafIndex);
    while (this.leafCount > 1 && !this.hasMemberInRightHalf()) {
      this.nodes.length = (this.nodes.length - 1) / 2;
    }
    this.changed();
  }

  /** RFC 9420 § 12.1.2: the new leaf knows none of the keys above it, so its
   * whole direct path is blanked rather than merged. */
  updateLeaf(leafIndex: number, leaf: LeafNode): void {
    this.nodes[leafIndex * 2] = leaf;
    this.blankDirectPath(leafIndex);
  }

  blankDirectPath(leafIndex: number): void {
    for (let nodeIndex of this.directPath(leafIndex * 2)) {
      this.nodes[nodeIndex] = null;
    }
    this.changed();
  }

  /** RFC 9420 § 7.8 `TreeHashInput`: a commitment to the whole subtree below
   * `nodeIndex`. The root's hash is what the GroupContext carries. */
  treeHash(nodeIndex = this.rootIndex): Uint8Array {
    let cached = this.treeHashes.get(nodeIndex);
    if (cached) {
      return cached;
    }
    let hash = this.hashSubtree(nodeIndex, null);
    this.treeHashes.set(nodeIndex, hash);
    return hash;
  }

  /** RFC 9420 § 7.9 `ParentHashInput`: the parent hash of `parentIndex` as
   * seen from its other child, which is the value the node below it stores in
   * its own `parent_hash` field. */
  parentHash(parentIndex: number, siblingIndex: number): Uint8Array {
    let parent = this.parentNode(parentIndex);
    if (!parent) {
      throw new MLSError(`Node ${parentIndex} is blank and has no parent hash`);
    }
    return this.suite.hash(tlsSerialize(writer => writer
      .opaque(parent.encryptionKey)
      .opaque(parent.parentHash)
      .opaque(this.originalTreeHash(siblingIndex, parent.unmergedLeaves))));
  }

  /** RFC 9420 § 7.9.2: every non-blank parent node must be reachable from a
   * leaf by a chain of parent hashes. Without this check, an insider could
   * plant a node whose private key it knows above members it has no business
   * reading, i.e. break the tree invariant of § 4.2. */
  verifyParentHashes(): boolean {
    for (let nodeIndex = 1; nodeIndex < this.nodes.length; nodeIndex += 2) {
      if (this.parentNode(nodeIndex) && !this.hasParentHashChild(nodeIndex)) {
        return false;
      }
    }
    return true;
  }

  /** RFC 9420 § 7.3: each member's leaf must be signed for this group and for
   * the leaf index it sits at. Pass `now` to also check the lifetime of the
   * leaves that came from a KeyPackage. */
  verifyLeaves(groupID: Uint8Array, now?: Date): boolean {
    return this.memberLeafIndices().every(leafIndex => {
      let leaf = this.leaf(leafIndex);
      return leaf.verify(this.suite, groupID, leafIndex) && (!now || leaf.isValidAt(now));
    });
  }

  /**
   * TreeKEM, RFC 9420 § 7.5 and § 12.4.1: re-keys our filtered direct path and
   * encrypts each new path secret to the members that need it. Call this after
   * the commit's proposals have been applied to the tree, so that a member
   * added by the same commit keeps its ancestor out of the filter, and name
   * that member in `excludeLeaves` so that we do not encrypt to a key it has
   * not proven it holds — it gets its path secret in the Welcome instead. A
   * node whose whole resolution is excluded that way ends up with an empty
   * `encrypted_path_secret` vector, which is legal.
   *
   * The HPKE context is the *provisional* GroupContext of § 12.4.1: the new
   * epoch and the new tree hash, but the *old* confirmed transcript hash. Its
   * tree hash can only be computed once the new keys and the re-signed leaf
   * are in the tree, which is why `provisionalGroupContext` is a callback that
   * we hand that hash to, rather than plain bytes.
   */
  createUpdatePath(leafIndex: number, groupID: Uint8Array, signaturePrivateKey: Uint8Array, newLeaf: LeafNode,
    provisionalGroupContext: (treeHash: Uint8Array) => Uint8Array, excludeLeaves: number[] = []): CreatedUpdatePath {
    let path = this.filteredDirectPath(leafIndex);
    this.blankDirectPath(leafIndex);

    let pathSecrets: Uint8Array[] = [];
    let privateKeys = new Map<number, Uint8Array>();
    let secret = randomBytes(this.suite.secretLength);
    for (let nodeIndex of path) {
      secret = this.suite.deriveSecret(secret, "path");
      pathSecrets.push(secret);
      let keyPair = this.suite.kem.deriveKeyPair(this.suite.deriveSecret(secret, "node"));
      privateKeys.set(nodeIndex, keyPair.privateKey);
      this.nodes[nodeIndex] = new ParentNode(keyPair.publicKey);
    }
    let commitSecret = this.suite.deriveSecret(secret, "path");
    this.changed();

    newLeaf.source = LeafNodeSource.Commit;
    newLeaf.parentHash = this.fillParentHashes(leafIndex, path);
    newLeaf.sign(this.suite, signaturePrivateKey, groupID, leafIndex);
    this.nodes[leafIndex * 2] = newLeaf;
    this.changed();

    let groupContext = provisionalGroupContext(this.treeHash());
    let excluded = new Set(excludeLeaves.map(leaf => leaf * 2));
    let updatePath = new UpdatePath(newLeaf, path.map((nodeIndex, i) => {
      let recipients = this.resolution(this.copathChild(nodeIndex, leafIndex))
        .filter(node => !excluded.has(node));
      return new UpdatePathNode(this.parentNode(nodeIndex).encryptionKey,
        recipients.map(node => this.suite.encryptWithLabel(
          this.encryptionKeyOf(node), "UpdatePathNode", groupContext, pathSecrets[i])));
    }));
    return { updatePath, commitSecret, privateKeys, pathSecrets: this.pathSecretsPerMember(leafIndex, path, pathSecrets) };
  }

  /**
   * RFC 9420 § 7.5: merges someone else's UpdatePath and recovers the commit
   * secret from the one path secret that was encrypted to us.
   *
   * `groupContext` is the same *provisional* GroupContext the committer used,
   * so it holds the tree hash of the tree *after* this path is applied and the
   * *old* confirmed transcript hash. Get that hash by calling
   * `mergeUpdatePath()` on a clone first. `excludeLeaves` must name the same
   * leaves the committer excluded, i.e. the members its commit adds; otherwise
   * the resolutions differ and we pick the wrong ciphertext.
   *
   * `ourPrivateKeys` maps node index → our HPKE private key. It is updated in
   * place: the keys of the nodes the commit re-keyed are replaced by the ones
   * we derive here, and the ones it blanked are dropped.
   *
   * @returns `commit_secret`
   * @throws `MLSError` if nothing was encrypted to us, or if a derived public
   *   key does not match the one in the path
   */
  applyUpdatePath(senderLeafIndex: number, path: UpdatePath, groupContext: Uint8Array,
    ourLeafIndex: number, ourPrivateKeys: Map<number, Uint8Array>, excludeLeaves: number[] = []): Uint8Array {
    let filtered = this.filteredDirectPath(senderLeafIndex);
    this.checkPathLength(senderLeafIndex, filtered, path);
    let position = filtered.findIndex(nodeIndex => this.isInSubtree(ourLeafIndex * 2, nodeIndex));
    if (position < 0) {
      throw new MLSError(`Leaf ${ourLeafIndex} is not below any node of the UpdatePath of leaf ${senderLeafIndex}`);
    }
    let recipient = this.recipientOf(path.nodes[position],
      this.copathChild(filtered[position], senderLeafIndex), ourLeafIndex, ourPrivateKeys, excludeLeaves);
    let secret = this.suite.decryptWithLabel(recipient.privateKey, "UpdatePathNode", groupContext, recipient.sealed);

    this.mergeUpdatePath(senderLeafIndex, path);
    for (let nodeIndex of this.directPath(senderLeafIndex * 2)) {
      ourPrivateKeys.delete(nodeIndex);
    }
    for (let i = position; i < filtered.length; i++) {
      let keyPair = this.suite.kem.deriveKeyPair(this.suite.deriveSecret(secret, "node"));
      if (!bytesEqual(keyPair.publicKey, path.nodes[i].encryptionKey)) {
        throw new MLSError(`The UpdatePath key for node ${filtered[i]} does not match the path secret we decrypted`);
      }
      ourPrivateKeys.set(filtered[i], keyPair.privateKey);
      secret = this.suite.deriveSecret(secret, "path");
    }
    return secret;
  }

  /** RFC 9420 § 7.5: puts the committer's new public keys and leaf into the
   * tree. Needs no key material, so a member the commit did not re-key for,
   * and anyone rebuilding the tree from a GroupInfo, can do it too.
   * @throws `MLSError` if the leaf does not carry the parent hash of its own
   *   path, which is the check of § 7.9.2 for a Commit */
  mergeUpdatePath(senderLeafIndex: number, path: UpdatePath): void {
    let filtered = this.filteredDirectPath(senderLeafIndex);
    this.checkPathLength(senderLeafIndex, filtered, path);
    this.blankDirectPath(senderLeafIndex);
    filtered.forEach((nodeIndex, i) => {
      this.nodes[nodeIndex] = new ParentNode(path.nodes[i].encryptionKey);
    });
    this.changed();
    let leafParentHash = this.fillParentHashes(senderLeafIndex, filtered);
    if (!bytesEqual(leafParentHash, path.leafNode.parentHash ?? kNoBytes)) {
      throw new MLSError(`The new leaf of committer ${senderLeafIndex} does not carry the parent hash of its own UpdatePath`);
    }
    this.nodes[senderLeafIndex * 2] = path.leafNode;
    this.changed();
  }

  clone(): RatchetTree {
    let copy = new RatchetTree(this.suite);
    copy.nodes = this.nodes.map(node => node?.clone() ?? null);
    copy.treeHashes = new Map(this.treeHashes);
    return copy;
  }

  /** RFC 9420 § 7.8, with `blanked` leaves treated as blank and removed from
   * every `unmerged_leaves` below, which is what § 7.9 needs for the
   * `original_sibling_tree_hash`. */
  protected hashSubtree(nodeIndex: number, blanked: Set<number> | null): Uint8Array {
    let childHash = (child: number) => blanked ? this.hashSubtree(child, blanked) : this.treeHash(child);
    if (this.level(nodeIndex) == 0) {
      let leafIndex = nodeIndex / 2;
      let leaf = blanked?.has(leafIndex) ? null : this.leaf(leafIndex);
      return this.suite.hash(tlsSerialize(writer => writer
        .uint8(NodeType.Leaf).uint32(leafIndex)
        .optional(leaf, (writer, leaf) => leaf.writeTo(writer))));
    }
    let parent = this.parentNode(nodeIndex);
    if (parent && blanked) {
      parent = parent.clone();
      parent.unmergedLeaves = parent.unmergedLeaves.filter(leafIndex => !blanked.has(leafIndex));
    }
    let left = childHash(this.leftChild(nodeIndex));
    let right = childHash(this.rightChild(nodeIndex));
    return this.suite.hash(tlsSerialize(writer => writer
      .uint8(NodeType.Parent)
      .optional(parent, (writer, node) => node.writeTo(writer))
      .opaque(left).opaque(right)));
  }

  /** RFC 9420 § 7.9 `original_sibling_tree_hash`: the tree hash of `nodeIndex`
   * from before the unmerged leaves joined. Equal to the plain tree hash
   * whenever none of them is in this subtree, which is the common case. */
  protected originalTreeHash(nodeIndex: number, unmergedLeaves: number[]): Uint8Array {
    let below = unmergedLeaves.filter(leafIndex => this.isInSubtree(leafIndex * 2, nodeIndex));
    return below.length ? this.hashSubtree(nodeIndex, new Set(below)) : this.treeHash(nodeIndex);
  }

  /** RFC 9420 § 7.9.2: is there a child of `parentIndex` that was set by the
   * same UpdatePath, i.e. that carries our parent hash and is the only thing
   * in its resolution besides our own unmerged leaves? */
  protected hasParentHashChild(parentIndex: number): boolean {
    let unmergedLeaves = this.parentNode(parentIndex).unmergedLeaves;
    let children = [this.leftChild(parentIndex), this.rightChild(parentIndex)];
    return children.some((child, i) => {
      let expected = this.parentHash(parentIndex, children[1 - i]);
      let resolution = this.resolution(child);
      let unmerged = unmergedLeaves.filter(leafIndex => this.isInSubtree(leafIndex * 2, child))
        .map(leafIndex => leafIndex * 2);
      return resolution.some((node, position) => {
        let hash = this.parentHashOf(node);
        return hash && bytesEqual(hash, expected) &&
          sameNodes(resolution.filter((node, other) => other != position), unmerged);
      });
    });
  }

  /** The `parent_hash` a node carries, or null for a leaf that no Commit set
   * and that therefore has none. */
  protected parentHashOf(nodeIndex: number): Uint8Array | null {
    let node = this.nodes[nodeIndex];
    if (node instanceof ParentNode) {
      return node.parentHash;
    }
    return node instanceof LeafNode && node.source == LeafNodeSource.Commit ? node.parentHash : null;
  }

  /** RFC 9420 § 7.9: fills in the `parent_hash` of every node on `path`, from
   * the root downwards so that each hash covers the ones above it, and returns
   * the hash that the leaf below the path must carry. */
  protected fillParentHashes(leafIndex: number, path: number[]): Uint8Array {
    let hash: Uint8Array = kNoBytes;
    for (let i = path.length - 1; i >= 0; i--) {
      this.parentNode(path[i]).parentHash = hash;
      hash = this.parentHash(path[i], this.copathChild(path[i], leafIndex));
    }
    this.changed();
    return hash;
  }

  /** RFC 9420 § 7.6: one UpdatePathNode per node of the committer's filtered
   * direct path. A different count means we do not see the same tree it did. */
  protected checkPathLength(senderLeafIndex: number, filtered: number[], path: UpdatePath): void {
    if (filtered.length != path.nodes.length) {
      throw new MLSError(`UpdatePath has ${path.nodes.length} nodes, but the filtered direct path of leaf ` +
        `${senderLeafIndex} has ${filtered.length}`);
    }
  }

  /** RFC 9420 § 7.5 step 2: the key of ours that the committer encrypted to,
   * and the one ciphertext of `pathNode` that is meant for it. The committer
   * encrypted to the resolution of `copathChild` in order, so our position in
   * that resolution is the index of our ciphertext — which is why we have to
   * leave out exactly the leaves the committer left out. */
  protected recipientOf(pathNode: UpdatePathNode, copathChild: number, ourLeafIndex: number,
    ourPrivateKeys: Map<number, Uint8Array>, excludeLeaves: number[]): { privateKey: Uint8Array, sealed: HPKECiphertext } {
    let excluded = new Set(excludeLeaves.map(leafIndex => leafIndex * 2));
    let recipients = this.resolution(copathChild).filter(nodeIndex => !excluded.has(nodeIndex));
    let position = recipients.findIndex(nodeIndex =>
      ourPrivateKeys.has(nodeIndex) && this.isInSubtree(ourLeafIndex * 2, nodeIndex));
    let sealed = pathNode.encryptedPathSecrets[position];
    if (position < 0 || !sealed) {
      throw new MLSError(`The UpdatePath holds no path secret that leaf ${ourLeafIndex} could decrypt`);
    }
    return { privateKey: ourPrivateKeys.get(recipients[position]), sealed };
  }

  /** RFC 9420 § 12.4.1: what to put into each new member's `GroupSecrets`, the
   * path secret of the lowest node we re-keyed that is also above them. */
  protected pathSecretsPerMember(leafIndex: number, path: number[], pathSecrets: Uint8Array[]): Map<number, Uint8Array> {
    let secrets = new Map<number, Uint8Array>();
    for (let member of this.memberLeafIndices()) {
      let position = path.findIndex(nodeIndex => this.isInSubtree(member * 2, nodeIndex));
      if (member != leafIndex && position >= 0) {
        secrets.set(member, pathSecrets[position]);
      }
    }
    return secrets;
  }

  /** The child of `parentIndex` that the leaf is *not* below, i.e. the subtree
   * a path secret has to be encrypted to. */
  protected copathChild(parentIndex: number, leafIndex: number): number {
    let left = this.leftChild(parentIndex);
    return this.isInSubtree(leafIndex * 2, left) ? this.rightChild(parentIndex) : left;
  }

  /** Whether `nodeIndex` is `subtreeIndex` or below it. Both are node indices,
   * and this is the same bit trick as `commonAncestor()`: every node under a
   * head at level k shares the head's bits above k. */
  protected isInSubtree(nodeIndex: number, subtreeIndex: number): boolean {
    let level = this.level(subtreeIndex) + 1;
    return nodeIndex >> level == subtreeIndex >> level;
  }

  /** The level of a node that has children. @throws `MLSError` for a leaf */
  protected parentLevel(nodeIndex: number): number {
    let level = this.level(nodeIndex);
    if (level == 0) {
      throw new MLSError(`Node ${nodeIndex} is a leaf and has no children`);
    }
    return level;
  }

  protected encryptionKeyOf(nodeIndex: number): Uint8Array {
    let node = this.nodes[nodeIndex];
    if (!node) {
      throw new MLSError(`Node ${nodeIndex} is blank and has no encryption key`);
    }
    return node.encryptionKey;
  }

  /** RFC 9420 § 7.7 and Appendix C: double the number of leaves by appending
   * `nodeCount + 1` blanks, which makes the old root the new root's left child. */
  protected extend(): void {
    let blanks = this.nodes.length + 1;
    for (let i = 0; i < blanks; i++) {
      this.nodes.push(null);
    }
  }

  protected hasMemberInRightHalf(): boolean {
    for (let leafIndex = this.leafCount / 2; leafIndex < this.leafCount; leafIndex++) {
      if (this.leaf(leafIndex)) {
        return true;
      }
    }
    return false;
  }

  protected changed(): void {
    this.treeHashes.clear();
  }
}

export type TreeNode = LeafNode | ParentNode;

export interface CreatedUpdatePath {
  updatePath: UpdatePath;
  /** `commit_secret = DeriveSecret(path_secret[root], "path")` */
  commitSecret: Uint8Array;
  /** Node index → HPKE private key, for the nodes we now own. Our own leaf key
   * is not in here: it belongs to the `newLeaf` the caller made. */
  privateKeys: Map<number, Uint8Array>;
  /** Leaf index → path secret to put into that member's `GroupSecrets` */
  pathSecrets: Map<number, Uint8Array>;
}

/** RFC 9420 § 7.8 */
export enum NodeType {
  Leaf = 1,
  Parent = 2,
}

/** RFC 9420 § 12.4.3.3 `Node`, the tagged union in the `ratchet_tree` extension. */
function readNode(reader: TLSReader): TreeNode {
  let type = reader.uint8();
  switch (type) {
    case NodeType.Leaf:
      return LeafNode.read(reader);
    case NodeType.Parent:
      return ParentNode.read(reader);
    default:
      throw new TLSParseError(`Unknown ratchet tree node type ${type}`);
  }
}

function writeNode(writer: TLSWriter, node: TreeNode): void {
  writer.uint8(node instanceof LeafNode ? NodeType.Leaf : NodeType.Parent);
  node.writeTo(writer);
}

/** The exponent of the largest power of 2 that is not greater than `x`. */
function log2(x: number): number {
  let k = 0;
  while (x >> k > 0) {
    k++;
  }
  return k ? k - 1 : 0;
}

function sameNodes(a: number[], b: number[]): boolean {
  return a.length == b.length && a.every((node, i) => node == b[i]);
}

const kNoBytes = new Uint8Array(0);
