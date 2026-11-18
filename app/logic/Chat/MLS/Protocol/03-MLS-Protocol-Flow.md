# MLS Protocol Flow — The State Machine

Implementation reference for a clean-room TypeScript implementation of
**RFC 9420 (MLS)**. Companion documents: `01-MLS-Wire-Format.md` (serialisation),
`02-MLS-Crypto.md` (primitives, key schedule, hashes).

All rules are quoted from RFC 9420 with section numbers. Where the RFC is ambiguous
it says so explicitly.

The final section, **§13 Minimum viable subset for talking to Wire**, says which
parts can be skipped, based on Wire's `core-crypto` and `wire-server` sources.

---

## 1. What a client stores

Per group, per epoch:

| Field | Source |
|---|---|
| `GroupContext` (version, cipher_suite, group_id, epoch, tree_hash, confirmed_transcript_hash, extensions) | §8.1 |
| `interim_transcript_hash` | §8.2 |
| the full public **ratchet tree** (every node: blank, `LeafNode`, or `ParentNode`) | §4, §7 |
| own `leaf_index` | §5.3.3 |
| own signature key pair | §5.1.2 |
| private keys for the nodes on own direct path that are known | §4.2 tree invariant |
| `init_secret` (of the current epoch, i.e. the input to the *next* epoch) | §8 |
| `sender_data_secret`, `encryption_secret`, `exporter_secret`, `external_secret`, `confirmation_key`, `membership_key`, `resumption_psk`, `epoch_authenticator` | §8 Table 4 |
| the **secret tree** for the epoch and the two ratchets (handshake/application) per member, with generation counters | §9 |
| pending (uncommitted) proposals received this epoch, keyed by `ProposalRef` | §12.1 |
| a *pending commit* (own commit, awaiting DS acceptance) | §14 |

Outside groups: own `KeyPackage`s with their `init_key` private keys and their
`encryption_key` private keys, indexed by `KeyPackageRef`.

> RFC 9420 §4.2 (the tree invariant): "The private key for a node in the tree is
> known to a member of the group only if the node's subtree contains that member's
> leaf."

---

## 2. Ratchet tree concepts (RFC 9420 §4.1)

Every MLS tree is a **perfect binary tree** with `2^d` leaves.

> RFC 9420 §4.1: "Every tree used in this protocol is a perfect binary tree, that
> is, a complete balanced binary tree with 2^d leaves all at the same depth d. This
> structure is unique for a given depth d."

> RFC 9420 §4.1.1: "Each leaf node in a ratchet tree is given an _index_ (or _leaf
> index_), starting at 0 from the left to 2^d - 1 at the right (for a tree with 2^d
> leaves). A tree with 2^d leaves has 2^(d+1) - 1 nodes, including parent nodes."
>
> "Each node in a ratchet tree is either _blank_ (containing no value) or it holds
> an HPKE public key with some associated data:
>
> *  A public key (for the HPKE scheme in use; see Section 5.1)
> *  A credential (only for leaf nodes; see Section 5.3)
> *  An ordered list of "unmerged" leaves (see Section 4.2)
> *  A hash of certain information about the node's parent, as of the last time the
>    node was changed (see Section 7.9)."

### 2.1 Resolution (RFC 9420 §4.1.1) — get this exactly right

> "The _resolution_ of a node is an ordered list of non-blank nodes that
> collectively cover all non-blank descendants of the node. The resolution of the
> root contains the set of keys that are collectively necessary to encrypt to every
> node in the group. The resolution of a node is effectively a depth-first,
> left-first enumeration of the nearest non-blank nodes below the node:
>
> *  The resolution of a non-blank node comprises the node itself, followed by its
>    list of unmerged leaves, if any.
> *  The resolution of a blank leaf node is the empty list.
> *  The resolution of a blank intermediate node is the result of concatenating the
>    resolution of its left child with the resolution of its right child, in that
>    order."

```
resolution(x):
  if x is non-blank:
    return [x] ++ [ leafNode(2*L) for L in unmergedLeaves(x) ]   // parents only
  if x is a leaf (and blank):
    return []
  return resolution(left(x)) ++ resolution(right(x))
```

Two traps:

* The `unmerged_leaves` entries are appended **after** the node itself, in the
  order stored (which MUST be increasing, §7.1).
* `unmerged_leaves` only exists on `ParentNode`; a non-blank leaf resolves to just
  itself.

> "For example, consider the following subtree, where the _ character represents a
> blank node and unmerged leaves are indicated in square brackets:"
>
> ```
>                ...
>                /
>               _
>         ______|______
>        /             \
>       X[B]            _
>     __|__           __|__
>    /     \         /     \
>   _       _       Y       _
>  / \     / \     / \     / \
> A   B   _   D   E   F   _   H
>
> 0   1   2   3   4   5   6   7
> ```
>
> "In this tree, we can see all of the above rules in play:
>
> *  The resolution of node X is the list [X, B].
> *  The resolution of leaf 2 or leaf 6 is the empty list [].
> *  The resolution of top node is the list [X, B, Y, H]."

Note in the example that `D` is **not** in the resolution of the top node: `D` is
under the blank node whose resolution would include it... actually re-read the
tree: the top node's left child is `X[B]`, which is non-blank, so its resolution is
`[X, B]` and the subtree below `X` (containing `A`, `B`, `D`) is *not* enumerated
further. The right child of the top node is blank, so it resolves to
`resolution(Y's parent) ++ resolution(H's parent)` = `[Y] ++ [H]`. Hence
`[X, B, Y, H]`.

### 2.2 Direct path, copath, filtered direct path (RFC 9420 §4.1.2)

> "The _direct path_ of a root is the empty list. The direct path of any other node
> is the concatenation of that node's parent along with the parent's direct path."
>
> "The _copath_ of a node is the node's sibling concatenated with the list of
> siblings of all the nodes in its direct path, excluding the root."
>
> "The _filtered direct path_ of a leaf node L is the node's direct path, with any
> node removed whose child on the copath of L has an empty resolution (keeping in
> mind that any unmerged leaves of the copath child count toward its resolution).
> The removed nodes do not need their own key pairs because encrypting to the node's
> key pair would be equivalent to encrypting to its non-copath child."

> "For example, consider the following tree (where blank nodes are indicated with _,
> but also assigned a label for reference):"
>
> ```
>               W = root
>               |
>         .-----+-----.
>        /             \
>       _=U             Y
>       |               |
>     .-+-.           .-+-.
>    /     \         /     \
>   T       _=V     X       _=Z
>  / \     / \     / \     / \
> A   B   _   _   E   F   G   _=H
>
> 0   1   2   3   4   5   6   7
> ```
>
> "In this tree, the direct paths, copaths, and filtered direct paths for the leaf
> nodes are as follows:"
>
> ```
> +======+=============+=========+======================+
> | Node | Direct path | Copath  | Filtered Direct Path |
> +======+=============+=========+======================+
> | A    | T, U, W     | B, V, Y | T, W                 |
> +------+-------------+---------+----------------------+
> | B    | T, U, W     | A, V, Y | T, W                 |
> +------+-------------+---------+----------------------+
> | E    | X, Y, W     | F, Z, U | X, Y, W              |
> +------+-------------+---------+----------------------+
> | F    | X, Y, W     | E, Z, U | X, Y, W              |
> +------+-------------+---------+----------------------+
> | G    | Z, Y, W     | H, X, U | Y, W                 |
> +------+-------------+---------+----------------------+
> ```

Walk through the `A` row to be sure the algorithm is right:

* direct path of leaf `A` (node 0) is `[T(=1), U(=3), W(=7)]`.
* copath is `[B(=2), V(=5), Y(=11)]` — `B` is `A`'s sibling, `V` is `T`'s sibling,
  `Y` is `U`'s sibling. The root is excluded (its sibling does not exist).
* `T`: copath child is `B`, non-blank leaf → resolution `[B]`, non-empty → **keep T**.
* `U`: copath child is `V`, a blank parent whose children are blank leaves 2 and 3
  → resolution `[]` → **drop U**.
* `W`: copath child is `Y`, non-blank → resolution `[Y]` non-empty → **keep W**.
* Result: `[T, W]`. Matches.

And the `G` row: direct path `[Z, Y, W]`, copath `[H, X, U]`. `Z`'s copath child is
`H` (blank leaf) → resolution `[]` → drop `Z`. `Y`'s copath child is `X`
(non-blank) → keep `Y`. `W`'s copath child is `U` (blank, but its subtree contains
`A`, `B` under non-blank `T`) → resolution `[T]` non-empty → keep `W`. Result
`[Y, W]`. Matches.

```
filteredDirectPath(leafNode):
  dp = directPath(leafNode)          // leaf -> root, excluding the leaf itself
  cp = copath(leafNode)              // same length, cp[i] is the sibling of the node
                                     // below dp[i] on the direct path
  return [ dp[i] for i in 0..len-1 if resolution(cp[i]) is non-empty ]
```

`cp[i]` is "the child of `dp[i]` that is not on the direct path of the leaf". With
the Appendix C helpers, `copath(x, n)` (see `01-MLS-Wire-Format.md` §5) returns
exactly that list, aligned index-for-index with `direct_path(x, n)`.

### 2.3 Unmerged leaves (RFC 9420 §4.2)

> "A member may not know the private key of an intermediate node above them. Such a
> member has an _unmerged_ leaf at the intermediate node. Encrypting to an
> intermediate node requires encrypting to the node's public key, as well as the
> public keys of all the unmerged leaves below it. A leaf is unmerged with regard to
> all of its ancestors when it is first added, because the process of adding the leaf
> does not give it access to the private keys for all of the nodes above it in the
> tree. Leaves are "merged" as they receive the private keys for nodes, as described
> in Section 7.4."

The two rules that maintain `unmerged_leaves`:

* **Add** (§12.1.1): "For each non-blank intermediate node along the path from the
  leaf L to the root, add L's leaf index to the unmerged_leaves list for the node."
* **UpdatePath merge** (§7.5): "For all nodes on the filtered direct path of the
  sender's leaf, ... Set the list of unmerged leaves to the empty list."

Nothing else touches them. (Blanking a node discards the list along with the node.)

### 2.4 Extending and truncating (RFC 9420 §7.7)

> "Leaves are always added and removed at the right edge of the tree. When the size
> of the tree needs to be increased, a new blank root node is added, whose left
> subtree is the existing tree and right subtree is a new all-blank subtree. This
> operation is typically done when adding a member to the group."
>
> "When the right subtree of the tree no longer has any non-blank nodes, it can be
> safely removed. The root of the tree and the right subtree are discarded (whether
> or not the root node is blank). The left child of the root becomes the new root
> node, and the left subtree becomes the new tree. This operation is typically done
> after removing a member from the group."

In array terms (Appendix C): "Add: Append N + 1 blank values to the end of the
array. Remove: Truncate the array to its first (N-1) / 2 entries."

---

## 3. Group creation (RFC 9420 §11)

> "A group is always created with a single member, the "creator". Other members are
> then added to the group using the usual Add/Commit mechanism."
>
> "The creator of a group is responsible for setting the group ID, cipher suite, and
> initial extensions for the group. If the creator intends to add other members at
> the time of creation, then it SHOULD fetch KeyPackages for the members to be added,
> and select a cipher suite and extensions according to the capabilities of the
> members. To protect against downgrade attacks, the creator MUST use the
> capabilities information in these KeyPackages to verify that the chosen version and
> cipher suite is the best option supported by all members."
>
> "Group IDs SHOULD be constructed in such a way that there is an overwhelmingly low
> probability of honest group creators generating the same group ID, even without
> assistance from the Delivery Service. This can be done, for example, by making the
> group ID a freshly generated random value of size KDF.Nh."
>
> "To initialize a group, the creator of the group MUST take the following steps:
>
> *  Initialize a one-member group with the following initial values:
>    -  Ratchet tree: A tree with a single node, a leaf node containing an HPKE
>       public key and credential for the creator
>    -  Group ID: A value set by the creator
>    -  Epoch: 0
>    -  Tree hash: The root hash of the above ratchet tree
>    -  Confirmed transcript hash: The zero-length octet string
>    -  Epoch secret: A fresh random value of size KDF.Nh
>    -  Extensions: Any values of the creator's choosing
>
> *  Calculate the interim transcript hash:
>    -  Derive the confirmation_key for the epoch as described in Section 8.
>    -  Compute a confirmation_tag over the empty confirmed_transcript_hash using the
>       confirmation_key as described in Section 6.1.
>    -  Compute the updated interim_transcript_hash from the confirmed_transcript_hash
>       and the confirmation_tag as described in Section 8.2."
>
> "At this point, the creator's state represents a one-member group with a fully
> initialized key schedule, transcript hashes, etc. Proposals and Commits can be
> generated for this group state just like any other state of the group, such as Add
> proposals and Commits to add other members to the group."

Concretely:

```
tree            = [ LeafNode(leaf_node_source = key_package or update/commit; see note) ]  // one leaf, node 0
group_id        = random(KDF.Nh)
epoch           = 0
confirmed_transcript_hash = ""
extensions      = chosen by the creator (e.g. required_capabilities, external_senders)
GroupContext_0  = { mls10, cipher_suite, group_id, 0, treeHash(tree), "", extensions }

epoch_secret        = random(KDF.Nh)          // NOT derived; sampled
sender_data_secret  = DeriveSecret(epoch_secret, "sender data")
encryption_secret   = DeriveSecret(epoch_secret, "encryption")
exporter_secret     = DeriveSecret(epoch_secret, "exporter")
external_secret     = DeriveSecret(epoch_secret, "external")
confirmation_key    = DeriveSecret(epoch_secret, "confirm")
membership_key      = DeriveSecret(epoch_secret, "membership")
resumption_psk      = DeriveSecret(epoch_secret, "resumption")
epoch_authenticator = DeriveSecret(epoch_secret, "authentication")
init_secret_0       = DeriveSecret(epoch_secret, "init")

confirmation_tag_0      = MAC(confirmation_key, "")
interim_transcript_hash = Hash("" || InterimTranscriptHashInput{confirmation_tag_0})
```

Note the creator's leaf: it is created by the creator itself, so it is not
constrained by an Add. In practice, take your own `KeyPackage`'s `LeafNode` (with
`leaf_node_source = key_package` and its `Lifetime`) and put it at leaf 0. The RFC
does not require a different source for the creator's initial leaf, and the leaf
validation rules in §7.3 only constrain `leaf_node_source` for leaves appearing in
KeyPackages, Update proposals and UpdatePaths. This is a small under-specification;
using the `key_package` leaf directly is what implementations do and is what a
joiner's tree-validation will accept.

> RFC 9420 §11: "In principle, the above process could be streamlined by having the
> creator directly create a tree and choose a random value for first epoch's epoch
> secret. We follow the steps above because it removes unnecessary choices, by
> which, for example, bad randomness could be introduced."

---

## 4. Proposals (RFC 9420 §12.1)

> "On receiving a FramedContent containing a Proposal, a client MUST verify the
> signature inside FramedContentAuthData and that the epoch field of the enclosing
> FramedContent is equal to the epoch field of the current GroupContext object. If
> the verification is successful, then the Proposal should be cached in such a way
> that it can be retrieved by hash (as a ProposalOrRef object) in a later Commit
> message."

The cache key is `MakeProposalRef(AuthenticatedContent)`
(`02-MLS-Crypto.md` §2), so keep the raw `AuthenticatedContent` bytes, not just
the parsed `Proposal`.

### 4.1 Add (§12.1.1)

```
struct {
    KeyPackage key_package;
} Add;
```

> "An Add proposal is invalid if the KeyPackage is invalid according to Section 10.1."
>
> "An Add is applied after being included in a Commit message. The position of the Add
> in the list of proposals determines the leaf node where the new member will be
> added. For the first Add in the Commit, the corresponding new member will be placed
> in the leftmost empty leaf in the tree, for the second Add, the next empty leaf to
> the right, etc. If no empty leaf exists, the tree is extended to the right.
>
> *  Identify the leaf L for the new member: if there are empty leaves in the tree, L
>    is the leftmost empty leaf. Otherwise, the tree is extended to the right as
>    described in Section 7.7, and L is assigned the leftmost new blank leaf.
> *  For each non-blank intermediate node along the path from the leaf L to the root,
>    add L's leaf index to the unmerged_leaves list for the node.
> *  Set the leaf node L to a new node containing the LeafNode object carried in the
>    leaf_node field of the KeyPackage in the Add."

### 4.2 Update (§12.1.2)

```
struct {
    LeafNode leaf_node;
} Update;
```

> "An Update proposal is a similar mechanism to Add with the distinction that it
> replaces the sender's LeafNode in the tree instead of adding a new leaf to the tree."
>
> "An Update proposal is invalid if the LeafNode is invalid for an Update proposal
> according to Section 7.3."
>
> "A member of the group applies an Update message by taking the following steps:
>
> *  Replace the sender's LeafNode with the one contained in the Update proposal.
> *  Blank the intermediate nodes along the path from the sender's leaf to the root."

"The sender's leaf" is `FramedContent.sender.leaf_index` of the **proposal**, not
of the Commit — so when applying a proposal by reference you need the sender index
you cached with it.

### 4.3 Remove (§12.1.3)

```
struct {
    uint32 removed;
} Remove;
```

> "A Remove proposal is invalid if the removed field does not identify a non-blank
> leaf node."
>
> "A member of the group applies a Remove message by taking the following steps:
>
> *  Identify the leaf node matching removed. Let L be this leaf node.
> *  Replace the leaf node L with a blank node.
> *  Blank the intermediate nodes along the path from L to the root.
> *  Truncate the tree by removing the right subtree until there is at least one
>    non-blank leaf node in the right subtree. If the rightmost non-blank leaf has
>    index L, then this will result in the tree having 2^d leaves, where d is the
>    smallest value such that 2^d > L."

Note "Blank the intermediate nodes along the path from L to the root" removes the
whole direct path, including the root, which is why a Remove requires a path.

The RFC does **not** say to remove the removed leaf's index from other nodes'
`unmerged_leaves` lists. Blanking the direct path removes it from every ancestor
anyway (those are the only nodes that could list it), so no extra cleanup is
needed.

### 4.4 PreSharedKey (§12.1.4)

```
struct {
    PreSharedKeyID psk;
} PreSharedKey;
```

> "A PreSharedKey proposal is invalid if any of the following is true:
>
> *  The PreSharedKey proposal is not being processed as part of a reinitialization of
>    the group (see Section 11.2), and the PreSharedKeyID has psktype set to
>    resumption and usage set to reinit.
> *  The PreSharedKey proposal is not being processed as part of a subgroup branching
>    operation (see Section 11.3), and the PreSharedKeyID has psktype set to
>    resumption and usage set to branch.
> *  The psk_nonce is not of length KDF.Nh.
>
> The psk_nonce MUST be randomly sampled. When processing a Commit message that
> includes one or more PreSharedKey proposals, group members derive psk_secret as
> described in Section 8.4, where the order of the PSKs corresponds to the order of
> the PreSharedKey proposals in the Commit."

### 4.5 ReInit (§12.1.5)

```
struct {
    opaque group_id<V>;
    ProtocolVersion version;
    CipherSuite cipher_suite;
    Extension extensions<V>;
} ReInit;
```

> "A ReInit proposal is invalid if the version field is less than the version for the
> current group."
>
> "A member of the group applies a ReInit proposal by waiting for the committer to
> send the Welcome message that matches the ReInit, according to the criteria in
> Section 11.2."

### 4.6 ExternalInit (§12.1.6)

```
struct {
  opaque kem_output<V>;
} ExternalInit;
```

> "An ExternalInit proposal is used by new members that want to join a group by using
> an external commit. This proposal can only be used in that context."
>
> "A member of the group applies an ExternalInit message by initializing the next
> epoch using an init secret computed as described in Section 8.3. The kem_output
> field contains the required KEM output."

### 4.7 GroupContextExtensions (§12.1.7)

```
struct {
  Extension extensions<V>;
} GroupContextExtensions;
```

> "A GroupContextExtensions proposal is invalid if it includes a
> required_capabilities extension and some members of the group do not support some
> of the required capabilities (including those added in the same Commit, and
> excluding those removed)."
>
> "A member of the group applies a GroupContextExtensions proposal with the following
> steps:
>
> *  Remove all of the existing extensions from the GroupContext object for the group
>    and replace them with the list of extensions in the proposal. (This is a
>    wholesale replacement, not a merge. An extension is only carried over if the
>    sender of the proposal includes it in the new list.)"

### 4.8 External proposals (§12.1.8)

> "Proposals can be constructed and sent to the group by a party that is outside the
> group in two cases. One case, indicated by the external SenderType, allows an entity
> outside the group to submit proposals to the group."
>
> "The external SenderType requires that signers are pre-provisioned to the clients
> within a group and can only be used if the external_senders extension is present in
> the group's GroupContext."
>
> "The other case, indicated by the new_member_proposal SenderType, is useful when
> existing members of the group can independently verify that an Add proposal sent by
> the new joiner itself (not an existing member) is authorized. External proposals
> that are not authorized are considered invalid."
>
> "An external proposal MUST be sent as a PublicMessage object, since the sender will
> not have the keys necessary to construct a PrivateMessage object."
>
> "Proposals of some types cannot be sent by an external sender. Among the proposal
> types defined in this document, only the following types may be sent by an external
> sender: add, remove, psk, reinit, group_context_extensions."
>
> "Messages from external senders containing proposal types other than the above MUST
> be rejected as malformed."

---

## 5. Proposal list validation and application

### 5.1 Validation (RFC 9420 §12.2), verbatim

> "A group member creating a Commit and a group member processing a Commit MUST verify
> that the list of committed proposals is valid using one of the following procedures,
> depending on whether the Commit is external or not. If the list of proposals is
> invalid, then the Commit message MUST be rejected as invalid."
>
> "For a regular, i.e., not external, Commit, the list is invalid if any of the
> following occurs:
>
> *  It contains an individual proposal that is invalid as specified in Section 12.1.
> *  It contains an Update proposal generated by the committer.
> *  It contains a Remove proposal that removes the committer.
> *  It contains multiple Update and/or Remove proposals that apply to the same leaf.
>    If the committer has received multiple such proposals they SHOULD prefer any
>    Remove received, or the most recent Update if there are no Removes.
> *  It contains multiple Add proposals that contain KeyPackages that represent the
>    same client according to the application (for example, identical signature keys).
> *  It contains an Add proposal with a KeyPackage that represents a client already in
>    the group according to the application, unless there is a Remove proposal in the
>    list removing the matching client from the group.
> *  It contains multiple PreSharedKey proposals that reference the same PreSharedKeyID.
> *  It contains multiple GroupContextExtensions proposals.
> *  It contains a ReInit proposal together with any other proposal. If the committer
>    has received other proposals during the epoch, they SHOULD prefer them over the
>    ReInit proposal, allowing the ReInit to be resent and applied in a subsequent
>    epoch.
> *  It contains an ExternalInit proposal.
> *  It contains a Proposal with a non-default proposal type that is not supported by
>    some members of the group that will process the Commit (i.e., members being added
>    or removed by the Commit do not need to support the proposal type).
> *  After processing the Commit the ratchet tree is invalid, in particular, if it
>    contains any leaf node that is invalid according to Section 7.3."
>
> "An application may extend the above procedure by additional rules, for example,
> requiring application-level permissions to add members, or rules concerning
> non-default proposal types."
>
> "For an external Commit, the list is valid if it contains only the following
> proposals (not necessarily in this order):
>
> *  Exactly one ExternalInit
> *  At most one Remove proposal, with which the joiner removes an old version of
>    themselves. If a Remove proposal is present, then the LeafNode in the path field
>    of the external Commit MUST meet the same criteria as would the LeafNode in an
>    Update for the removed leaf (see Section 12.1.2). In particular, the credential in
>    the LeafNode MUST present a set of identifiers that is acceptable to the
>    application for the removed participant.
> *  Zero or more PreSharedKey proposals
> *  No other proposals"

### 5.2 Application order (RFC 9420 §12.3), verbatim

> "The client MUST apply the proposals in the list in the following order:
>
> *  If there is a GroupContextExtensions proposal, replace the extensions field of the
>    GroupContext for the group with the contents of the proposal. The new extensions
>    MUST be used when evaluating other proposals in this list. For example, if a
>    GroupContextExtensions proposal adds a required_capabilities extension, then any
>    Add proposals need to indicate support for those capabilities.
> *  Apply any Update proposals to the ratchet tree, in any order.
> *  Apply any Remove proposals to the ratchet tree, in any order.
> *  Apply any Add proposals to the ratchet tree, in the order they appear in the list.
> *  Look up the PSK secrets for any PreSharedKey proposals, in the order they appear
>    in the list. These secrets are then used to advance the key schedule later in
>    Commit processing.
> *  If there is an ExternalInit proposal, use it to derive the init_secret for use
>    later in Commit processing.
> *  If there is a ReInit proposal, note its parameters for application later in Commit
>    processing."

The order matters: Removes free up leaves that Adds then fill (leftmost-first), so
running Adds before Removes gives a different tree.

---

## 6. Commits

### 6.1 When a path is required (RFC 9420 §12.4)

> "By default, the path field of a Commit MUST be populated. The path field MAY be
> omitted if (a) it covers at least one proposal and (b) none of the proposals covered
> by the Commit are of "path required" types. A proposal type requires a path if it
> cannot change the group membership in a way that requires the forward secrecy and
> post-compromise security guarantees that an UpdatePath provides. The only proposal
> types defined in this document that do not require a path are: add, psk, reinit."
>
> "In pseudocode, the logic for validating the path field of a Commit is as follows:"
>
> ```
> pathRequiredTypes = [
>     update,
>     remove,
>     external_init,
>     group_context_extensions
> ]
>
> pathRequired = false
>
> for proposal in commit.proposals:
>     pathRequired = pathRequired ||
>                    (proposal.msg_type in pathRequiredTypes)
>
> if len(commit.proposals) == 0 || pathRequired:
>     assert(commit.path != null)
> ```
>
> "To summarize, a Commit can have three different configurations, with different uses:
>
> 1.  An "empty" Commit that references no proposals, which updates the committer's
>     contribution to the group and provides PCS with regard to the committer.
> 2.  A "partial" Commit that references proposals that do not require a path, and
>     where the path is empty. Such a Commit doesn't provide PCS with regard to the
>     committer.
> 3.  A "full" Commit that references proposals of any type, which provides FS with
>     regard to any removed members and PCS for the committer and any updated members."

**This is the "no UpdatePath needed if the commit only contains adds" rule.** A
Commit whose proposals are all `add` (and/or `psk`/`reinit`) may set
`Commit.path` to the null optional, in which case `commit_secret` is the all-zero
vector of `KDF.Nh` bytes and no `GroupSecrets.path_secret` is sent to the new
members.

Also §12.4: "A group member that has observed one or more valid proposals within an
epoch MUST send a Commit message before sending application data." and "A member of
the group MAY send a Commit that references no proposals at all, which would thus
have an empty proposals vector."

### 6.2 Updating the direct path (RFC 9420 §7.5), verbatim

> "A member of the group _updates their direct path_ by computing new values for their
> leaf node and the nodes along their filtered direct path as follows:
>
> 1.  Blank all nodes along the direct path of the sender's leaf.
>
> 2.  Compute updated path secrets and public keys for the nodes on the sender's
>     filtered direct path.
>     *  Generate a sequence of path secrets of the same length as the filtered direct
>        path, as defined in Section 7.4.
>     *  For each node in the filtered direct path, replace the node's public key with
>        the node_pub[n] value derived from the corresponding path secret
>        path_secret[n].
>
> 3.  Compute the new parent hashes for the nodes along the filtered direct path and
>     the sender's leaf node.
>
> 4.  Update the leaf node for the sender.
>     *  Set the leaf_node_source to commit.
>     *  Set the encryption_key to the public key of a freshly sampled key pair.
>     *  Set the parent hash to the parent hash for the leaf.
>     *  Re-sign the leaf node with its new contents."
>
> "Since the new leaf node effectively updates an existing leaf node in the group, it
> MUST adhere to the same restrictions as LeafNodes used in Update proposals (aside
> from leaf_node_source). The application MAY specify other changes to the leaf node,
> e.g., providing a new signature key, updated capabilities, or different extensions."

**Important consequence of step 1 + step 2:** blanking the whole direct path also
clears `unmerged_leaves` on those nodes; then only the *filtered* direct path nodes
get new public keys. Nodes that were filtered out stay blank.

> "The member then _encrypts path secrets to the group_. For each node in the member's
> filtered direct path, the member takes the following steps:
>
> 1.  Compute the resolution of the node's child that is on the copath of the sender
>     (the child that is not in the direct path of the sender). Any new member (from an
>     Add proposal) added in the same Commit MUST be excluded from this resolution.
>
> 2.  For each node in the resolution, encrypt the path secret for the direct path node
>     using the public key of the resolution node, as defined in Section 7.6."

And from §7.6: "The length of the encrypted_path_secret vector MUST be equal to the
length of the resolution of the copath node (excluding new leaf nodes), with each
ciphertext being the encryption to the respective resolution node."

**Ordering note (important, and only implicit in the RFC).** The filtered direct
path is computed on the tree **after** the proposals have been applied (so the new
Add leaves are present), because §12.4.1 applies the proposals first and then says
"Update the sender's direct path in the ratchet tree as described in Section 7.5".
But the *encryption* step excludes those new leaves from the resolutions. That
combination is deliberate:

* a new member's leaf keeps its parent from being filtered out (so a path secret
  exists for the lowest common ancestor), and
* the new member is *not* sent the path secret over HPKE-to-its-leaf-key; it gets it
  in `GroupSecrets` instead.

Therefore `UpdatePathNode.encrypted_path_secret` can legitimately be an **empty
vector** — e.g. a Commit that adds a member into a previously all-blank subtree.

### 6.3 Encryption of path secrets (RFC 9420 §7.6)

```
(kem_output, ciphertext) =
  EncryptWithLabel(node_public_key, "UpdatePathNode",
                   group_context, path_secret)
```

The `group_context` is the **provisional** GroupContext (RFC 9420 §12.4.1):

> "Construct a provisional GroupContext object containing the following values:
>
> o  group_id: Same as the old GroupContext
> o  epoch: The epoch number for the new epoch
> o  tree_hash: The tree hash of the new ratchet tree
> o  confirmed_transcript_hash: Same as the old GroupContext
> o  extensions: The new GroupContext extensions (possibly updated by a
>    GroupContextExtensions proposal)"

New epoch number, new tree hash, **old** confirmed transcript hash. This is
different from the GroupContext used in the key schedule (which has the new
confirmed transcript hash). Getting these two mixed up is a classic bug.

Example from §7.5 of what a committer at leaf B transmits, for the tree

```
      Y
      |
    .-+-.
   /     \
  X       Z[C]
 / \     / \
A   B   C   D

0   1   2   3
```

> ```
> +=============+====================================================+
> | Public Key  | Ciphertext(s)                                      |
> +=============+====================================================+
> | node_pub[1] | E(pk(Z), path_secret[1]), E(pk(C), path_secret[1]) |
> +-------------+----------------------------------------------------+
> | node_pub[0] | E(pk(A), path_secret[0])                           |
> +-------------+----------------------------------------------------+
> ```
>
> "A recipient at node A would decrypt E(pk(A), path_secret[0]) to obtain
> path_secret[0], then use it to derive path_secret[1] and the resulting node secrets
> and key pairs. Thus, A would have the private keys to nodes X' and Y', in accordance
> with the tree invariant."
>
> "Similarly, a recipient at node D would decrypt E(pk(Z), path_secret[1]) to obtain
> path_secret[1], then use it to derive the node secret and key pair for the node Y'.
> As required to maintain the tree invariant, node D does not receive the private key
> for the node X', since X' is not an ancestor of D."

Note `Z` has `C` as an unmerged leaf, so `resolution(Z) = [Z, C]` and there are two
ciphertexts for `node_pub[1]`, in exactly that order.

### 6.4 Merging an UpdatePath as a receiver (RFC 9420 §7.5), verbatim

> "First, the recipient _merges UpdatePath into the tree_:
>
> 1.  Blank all nodes on the direct path of the sender's leaf.
>
> 2.  For all nodes on the filtered direct path of the sender's leaf,
>     *  Set the public key to the public key in the UpdatePath.
>     *  Set the list of unmerged leaves to the empty list.
>
> 3.  Compute parent hashes for the nodes in the sender's filtered direct path, and
>     verify that the parent_hash field of the leaf node matches the parent hash for the
>     first node in its filtered direct path.
>     *  Note that these hashes are computed from root to leaf, so that each hash
>        incorporates all the non-blank nodes above it. The root node always has a
>        zero-length hash for its parent hash."
>
> "Second, the recipient _decrypts the path secrets_:
>
> 1.  Identify a node in the filtered direct path for which the recipient is in the
>     subtree of the non-updated child.
>
> 2.  Identify a node in the resolution of the copath node for which the recipient has a
>     private key.
>
> 3.  Decrypt the path secret for the parent of the copath node using the private key
>     from the resolution node.
>
> 4.  Derive path secrets for ancestors of that node in the sender's filtered direct
>     path using the algorithm described above.
>
> 5.  Derive the node secrets and node key pairs from the path secrets.
>
> 6.  Verify that the derived public keys are the same as the corresponding public keys
>     sent in the UpdatePath.
>
> 7.  Store the derived private keys in the corresponding ratchet tree nodes."
>
> "After processing the update, each recipient MUST delete outdated key material,
> specifically:
>
> *  The path secrets and node secrets used to derive each updated node key pair.
> *  Each outdated node key pair that was replaced by the update."

Concrete algorithm for steps 1–3: walk the committer's filtered direct path from the
bottom. For each entry `i`, let `C_i` be the copath child (relative to the
committer). If the receiver's leaf is in the subtree under `C_i` — equivalently, the
first `i` where that is true — compute `resolution(C_i)` (the same list the sender
used, **excluding new members added in this Commit**), find the position `j` of a
node whose private key the receiver holds, and decrypt
`UpdatePath.nodes[i].encrypted_path_secret[j]`. That gives `path_secret[i]`; then
`path_secret[i+1] = DeriveSecret(path_secret[i], "path")` and so on to the root.

### 6.5 Creating a Commit (RFC 9420 §12.4.1), verbatim

> "A member of the group creates a Commit message and the corresponding Welcome message
> at the same time, by taking the following steps:
>
> *  Verify that the list of proposals to be committed is valid as specified in
>    Section 12.2.
>
> *  Construct an initial Commit object with the proposals field populated from Proposals
>    received during the current epoch, and with the path field empty.
>
> *  Create the new ratchet tree and GroupContext by applying the list of proposals to
>    the old ratchet tree and GroupContext, as defined in Section 12.3.
>
> *  Decide whether to populate the path field: If the path field is required based on
>    the proposals that are in the Commit (see above), then it MUST be populated.
>    Otherwise, the sender MAY omit the path field at its discretion.
>
> *  If populating the path field:
>    -  If this is an external Commit, assign the sender the leftmost blank leaf node in
>       the new ratchet tree. If there are no blank leaf nodes in the new ratchet tree,
>       expand the tree to the right as defined in Section 7.7 and assign the leftmost
>       new blank leaf to the sender.
>    -  Update the sender's direct path in the ratchet tree as described in Section 7.5.
>       Define commit_secret as the value path_secret[n+1] derived from the last path
>       secret value (path_secret[n]) derived for the UpdatePath.
>    -  Construct a provisional GroupContext object containing the following values:
>       o  group_id: Same as the old GroupContext
>       o  epoch: The epoch number for the new epoch
>       o  tree_hash: The tree hash of the new ratchet tree
>       o  confirmed_transcript_hash: Same as the old GroupContext
>       o  extensions: The new GroupContext extensions (possibly updated by a
>          GroupContextExtensions proposal)
>    -  Encrypt the path secrets resulting from the tree update to the group as described
>       in Section 7.5, using the provisional group context as the context for HPKE
>       encryption.
>    -  Create an UpdatePath containing the sender's new leaf node and the new public keys
>       and encrypted path secrets along the sender's filtered direct path. Assign this
>       UpdatePath to the path field in the Commit.
>
> *  If not populating the path field: Set the path field in the Commit to the null
>    optional. Define commit_secret as the all-zero vector of length KDF.Nh (the same
>    length as a path_secret value would be).
>
> *  Derive the psk_secret as specified in Section 8.4, where the order of PSKs in the
>    derivation corresponds to the order of PreSharedKey proposals in the proposals
>    vector.
>
> *  Construct a FramedContent object containing the Commit object. Sign the FramedContent
>    using the old GroupContext as context.
>    -  Use the FramedContent to update the confirmed transcript hash and update the new
>       GroupContext.
>    -  Use the init_secret from the previous epoch, the commit_secret and psk_secret
>       defined in the previous steps, and the new GroupContext to compute the new
>       joiner_secret, welcome_secret, epoch_secret, and derived secrets for the new
>       epoch.
>    -  Use the confirmation_key for the new epoch to compute the confirmation_tag value.
>    -  Calculate the interim transcript hash using the new confirmed transcript hash and
>       the confirmation_tag from the FramedContentAuthData.
>
> *  Protect the AuthenticatedContent object using keys from the old epoch:
>    -  If encoding as PublicMessage, compute the membership_tag value using the
>       membership_key.
>    -  If encoding as a PrivateMessage, encrypt the message using the sender_data_secret
>       and the next (key, nonce) pair from the sender's handshake ratchet.
>
> *  Construct a GroupInfo reflecting the new state:
>    -  Set the group_id, epoch, tree, confirmed_transcript_hash, interim_transcript_hash,
>       and group_context_extensions fields to reflect the new state.
>    -  Set the confirmation_tag field to the value of the corresponding field in the
>       FramedContentAuthData object.
>    -  Add any other extensions as defined by the application.
>    -  Optionally derive an external key pair as described in Section 8. (required for
>       external Commits, see Section 12.4.3.2).
>    -  Sign the GroupInfo using the member's private signing key.
>    -  Encrypt the GroupInfo using the key and nonce derived from the joiner_secret. for
>       the new epoch (see Section 12.4.3.1).
>
> *  For each new member in the group:
>    -  Identify the lowest common ancestor in the tree of the new member's leaf node and
>       the member sending the Commit.
>    -  If the path field was populated above: Compute the path secret corresponding to
>       the common ancestor node.
>    -  Compute an EncryptedGroupSecrets object that encapsulates the init_secret for the
>       current epoch and the path secret (if present).
>
> *  Construct one or more Welcome messages from the encrypted GroupInfo object, the
>    encrypted key packages, and any PSKs for which a proposal was included in the Commit.
>    The order of the psks MUST be the same as the order of PreSharedKey proposals in the
>    proposals vector. As discussed in Section 12.4.3.1, the committer is free to choose
>    how many Welcome messages to construct. However, the set of Welcome messages produced
>    in this step MUST cover every new member added in the Commit.
>
> *  If a ReInit proposal was part of the Commit, the committer MUST create a new group
>    with the parameters specified in the ReInit proposal, and with the same members as
>    the original group. The Welcome message MUST include a PreSharedKeyID with the
>    following parameters:
>    -  psktype: resumption
>    -  usage: reinit
>    -  group_id: The group ID for the current group
>    -  epoch: The epoch that the group will be in after this Commit"

**Errata-grade oddities in the above, flagged:**

* "Set the group_id, epoch, tree, confirmed_transcript_hash, interim_transcript_hash,
  and group_context_extensions fields" — `GroupInfo` has no `tree`,
  `interim_transcript_hash` or `group_context_extensions` fields. Read it as: fill
  `GroupInfo.group_context` from the new GroupContext, and put the tree in a
  `ratchet_tree` extension in `GroupInfo.extensions` if you want to ship it inline.
  The new joiner recomputes the interim transcript hash from
  `confirmed_transcript_hash` + `confirmation_tag` itself (§8.2, §12.4.3.1).
* "Compute an EncryptedGroupSecrets object that encapsulates the init_secret for the
  current epoch" — it is the **`joiner_secret`** that goes into `GroupSecrets`, not
  the init secret. The struct definition in §12.4.3.1 (`opaque joiner_secret<V>`)
  and the joining procedure ("Use the joiner_secret from the GroupSecrets object to
  generate the epoch secret") are unambiguous. Send `joiner_secret`.

**The lowest common ancestor is always in the filtered direct path.** Because the
new member's leaf is a non-blank descendant of the LCA's copath child, that child's
resolution is non-empty, so the LCA survives filtering. So "compute the path secret
corresponding to the common ancestor node" always has an answer: it is
`path_secret[i]` where `i` is the LCA's position in the committer's filtered direct
path.

### 6.6 Processing a Commit (RFC 9420 §12.4.2), verbatim

> "A member of the group applies a Commit message by taking the following steps:
>
> *  Verify that the epoch field of the enclosing FramedContent is equal to the epoch
>    field of the current GroupContext object.
>
> *  Unprotect the Commit using the keys from the current epoch:
>    -  If the message is encoded as PublicMessage, verify the membership MAC using the
>       membership_key.
>    -  If the message is encoded as PrivateMessage, decrypt the message using the
>       sender_data_secret and the (key, nonce) pair from the step on the sender's hash
>       ratchet indicated by the generation field.
>
> *  Verify the signature on the FramedContent message as described in Section 6.1.
>
> *  Verify that the proposals vector is valid according to the rules in Section 12.2.
>
> *  Verify that all PreSharedKey proposals in the proposals vector are available.
>
> *  Create the new ratchet tree and GroupContext by applying the list of proposals to the
>    old ratchet tree and GroupContext, as defined in Section 12.3.
>
> *  Verify that the path value is populated if the proposals vector contains any Update
>    or Remove proposals, or if it's empty. Otherwise, the path value MAY be omitted.
>
> *  If the path value is populated, validate it and apply it to the tree:
>    -  If this is an external Commit, assign the sender the leftmost blank leaf node in
>       the new ratchet tree. If there are no blank leaf nodes in the new ratchet tree, add
>       a blank leaf to the right side of the new ratchet tree and assign it to the sender.
>    -  Validate the LeafNode as specified in Section 7.3. The leaf_node_source field MUST
>       be set to commit.
>    -  Verify that the encryption_key value in the LeafNode is different from the
>       committer's current leaf node.
>    -  Verify that none of the public keys in the UpdatePath appear in any node of the new
>       ratchet tree.
>    -  Merge the UpdatePath into the new ratchet tree, as described in Section 7.5.
>    -  Construct a provisional GroupContext object containing the following values:
>       o  group_id: Same as the old GroupContext
>       o  epoch: The epoch number for the new epoch
>       o  tree_hash: The tree hash of the new ratchet tree
>       o  confirmed_transcript_hash: Same as the old GroupContext
>       o  extensions: The new GroupContext extensions (possibly updated by a
>          GroupContextExtensions proposal)
>    -  Decrypt the path secrets for UpdatePath as described in Section 7.5, using the
>       provisional GroupContext as the context for HPKE decryption.
>    -  Define commit_secret as the value path_secret[n+1] derived from the last path secret
>       value (path_secret[n]) derived for the UpdatePath.
>
> *  If the path value is not populated, define commit_secret as the all-zero vector of
>    length KDF.Nh (the same length as a path_secret value would be).
>
> *  Update the confirmed and interim transcript hashes using the new Commit, and generate
>    the new GroupContext.
>
> *  Derive the psk_secret as specified in Section 8.4, where the order of PSKs in the
>    derivation corresponds to the order of PreSharedKey proposals in the proposals vector.
>
> *  Use the init_secret from the previous epoch, the commit_secret and psk_secret defined
>    in the previous steps, and the new GroupContext to compute the new joiner_secret,
>    welcome_secret, epoch_secret, and derived secrets for the new epoch.
>
> *  Use the confirmation_key for the new epoch to compute the confirmation tag for this
>    message, as described below, and verify that it is the same as the confirmation_tag
>    field in the FramedContentAuthData object.
>
> *  If the above checks are successful, consider the new GroupContext object as the current
>    state of the group.
>
> *  If the Commit included a ReInit proposal, the client MUST NOT use the group to send
>    messages anymore. Instead, it MUST wait for a Welcome message from the committer
>    meeting the requirements of Section 11.2."
>
> "Note that clients need to be prepared to receive a valid Commit message that removes them
> from the group. In this case, the client cannot send any more messages in the group and
> SHOULD promptly delete its group state and secret tree. (A client might keep the secret
> tree for a short time to decrypt late messages in the previous epoch.)"

Note the ordering subtlety: `commit_secret` is derived from path secrets that are
themselves derived from `path_secret[n]` at the root, and then one more
`DeriveSecret(., "path")` is applied. The receiver derives the chain up to the root
and then does that extra step, exactly as the committer did.

### 6.7 Commit by self ("own commit")

RFC 9420 does not spell this out as a separate procedure; it follows from §14:

> RFC 9420 §14: "The generation of Commit messages MUST NOT modify a client's state,
> since the client doesn't know at that time whether the changes implied by the Commit
> message will conflict with another Commit or not. Similarly, the Welcome message
> corresponding to a Commit MUST NOT be delivered to a new joiner until it's clear that
> the Commit has been accepted."
>
> "Applications MUST have an established way to resolve conflicting Commit messages for
> the same epoch. They can do this either by preventing conflicting messages from
> occurring in the first place, or by developing rules for deciding which Commit out of
> several sent in an epoch will be canonical. The approach chosen MUST minimize the amount
> of time that forked or previous group states are kept in memory, and promptly delete
> them once they're no longer necessary to ensure forward secrecy."

So the practical shape is:

1. `createCommit()` produces `{ commitMessage, welcomeMessages, groupInfo,
   pendingState }` and leaves the live group state untouched.
2. If the DS accepts (or the message comes back over the fanout), **merge** the
   pending state: swap in the new tree, GroupContext, transcript hashes and key
   schedule. Do not re-process the Commit as if it came from someone else — the
   committer cannot decrypt its own `UpdatePath` (all `encrypted_path_secret`
   entries are encrypted to *other* nodes' keys), and re-deriving would fail.
3. If the DS rejects it (epoch conflict), discard the pending state and re-create
   the Commit against the new epoch.

When the committer *does* receive its own Commit back from the fanout, it must
recognise it (by `sender.leaf_index == own leaf_index` in the pending epoch, or by
matching the message bytes) and merge the pending state instead of processing it.

---

## 7. Adding members: Welcome

### 7.1 Creating a Welcome (RFC 9420 §12.4.3.1)

> "The sender of a Commit message is responsible for sending a Welcome message to each new
> member added via Add proposals. The format of the Welcome message allows a single Welcome
> message to be encrypted for multiple new members. It is up to the committer to decide how
> many Welcome messages to create for a given Commit."
>
> "The Welcome message provides the new members with the current state of the group after
> the application of the Commit message. The new members will not be able to decrypt or
> verify the Commit message, but they will have the secrets they need to participate in the
> epoch initiated by the Commit message."
>
> "In order to allow the same Welcome message to be sent to multiple new members,
> information describing the group is encrypted with a symmetric key and nonce derived from
> the joiner_secret for the new epoch. The joiner_secret is then encrypted to each new
> member using HPKE. In the same encrypted package, the committer transmits the path secret
> for the lowest (closest to the leaf) node that is contained in the direct paths of both
> the committer and the new member. This allows the new member to compute private keys for
> nodes in its direct path that are being reset by the corresponding Commit."
>
> "If the sender of the Welcome message wants the receiving member to include a PSK in the
> derivation of the epoch_secret, they can populate the psks field indicating which PSK to
> use."

Assembly:

```
welcome_secret = DeriveSecret(KDF.Extract(joiner_secret, psk_secret), "welcome")
welcome_nonce  = ExpandWithLabel(welcome_secret, "nonce", "", AEAD.Nn)
welcome_key    = ExpandWithLabel(welcome_secret, "key", "", AEAD.Nk)

encrypted_group_info = AEAD.Seal(welcome_key, welcome_nonce, "", enc(GroupInfo))

for each new member m:
    gs = GroupSecrets {
           joiner_secret = joiner_secret,
           path_secret   = (path present) ? PathSecret{ path_secret[LCA index] } : absent,
           psks          = the same PreSharedKeyIDs, in the same order as in the Commit
         }
    (enc, ct) = EncryptWithLabel(m.key_package.init_key, "Welcome",
                                 encrypted_group_info, enc(gs))
    secrets += EncryptedGroupSecrets {
                 new_member = MakeKeyPackageRef(enc(m.key_package)),
                 encrypted_group_secrets = HPKECiphertext{ enc, ct }
               }

Welcome { cipher_suite, secrets, encrypted_group_info }
```

Note `KDF.Extract(joiner_secret, psk_secret)` = `Extract(salt = joiner_secret,
ikm = psk_secret)`; see `02-MLS-Crypto.md` §6.2.

### 7.2 Processing a Welcome as a joiner (RFC 9420 §12.4.3.1), verbatim

> "The client processing a Welcome message will need to have a copy of the group's ratchet
> tree. The tree can be provided in the Welcome message, in an extension of type
> ratchet_tree. If it is sent otherwise (e.g., provided by a caching service on the Delivery
> Service), then the client MUST download the tree before processing the Welcome."
>
> "On receiving a Welcome message, a client processes it using the following steps:
>
> *  Identify an entry in the secrets array where the new_member value corresponds to one of
>    this client's KeyPackages, using the hash indicated by the cipher_suite field. If no
>    such field exists, or if the cipher suite indicated in the KeyPackage does not match the
>    one in the Welcome message, return an error.
>
> *  Decrypt the encrypted_group_secrets value with the algorithms indicated by the cipher
>    suite and the private key init_key_priv corresponding to init_key in the referenced
>    KeyPackage.
>
> *  If a PreSharedKeyID is part of the GroupSecrets and the client is not in possession of
>    the corresponding PSK, return an error. Additionally, if a PreSharedKeyID has type
>    resumption with usage reinit or branch, verify that it is the only such PSK.
>
> *  From the joiner_secret in the decrypted GroupSecrets object and the PSKs specified in
>    the GroupSecrets, derive the welcome_secret and then the welcome_key and welcome_nonce.
>    Use the key and nonce to decrypt the encrypted_group_info field.
>
> *  Verify the signature on the GroupInfo object. The signature input comprises all of the
>    fields in the GroupInfo object except the signature field. The public key is taken from
>    the LeafNode of the ratchet tree with leaf index signer. If the node is blank or if
>    signature verification fails, return an error.
>
> *  Verify that the group_id is unique among the groups that the client is currently
>    participating in.
>
> *  Verify that the cipher_suite in the GroupInfo matches the cipher_suite in the KeyPackage.
>
> *  Verify the integrity of the ratchet tree.
>    -  Verify that the tree hash of the ratchet tree matches the tree_hash field in GroupInfo.
>    -  For each non-empty parent node, verify that it is "parent-hash valid", as described in
>       Section 7.9.2.
>    -  For each non-empty leaf node, validate the LeafNode as described in Section 7.3.
>    -  For each non-empty parent node and each entry in the node's unmerged_leaves field:
>       o  Verify that the entry represents a non-blank leaf node that is a descendant of the
>          parent node.
>       o  Verify that every non-blank intermediate node between the leaf node and the parent
>          node also has an entry for the leaf node in its unmerged_leaves.
>       o  Verify that the encryption key in the parent node does not appear in any other node
>          of the tree.
>
> *  Identify a leaf whose LeafNode is identical to the one in the KeyPackage. If no such
>    field exists, return an error. Let my_leaf represent this leaf in the tree.
>
> *  Construct a new group state using the information in the GroupInfo object.
>    -  Initialize the GroupContext for the group from the group_context field from the
>       GroupInfo object.
>    -  Update the leaf my_leaf with the private key corresponding to the public key in the
>       node, where my_leaf is the new member's leaf node in the ratchet tree, as defined above.
>    -  If the path_secret value is set in the GroupSecrets object: Identify the lowest common
>       ancestor of the leaf node my_leaf and of the node of the member with leaf index
>       GroupInfo.signer. Set the private key for this node to the private key derived from the
>       path_secret.
>    -  For each parent of the common ancestor, up to the root of the tree, derive a new path
>       secret, and set the private key for the node to the private key derived from the path
>       secret. The private key MUST be the private key that corresponds to the public key in
>       the node.
>
> *  Use the joiner_secret from the GroupSecrets object to generate the epoch secret and other
>    derived secrets for the current epoch.
>
> *  Set the confirmed transcript hash in the new state to the value of the
>    confirmed_transcript_hash in the GroupInfo.
>
> *  Verify the confirmation tag in the GroupInfo using the derived confirmation key and the
>    confirmed_transcript_hash from the GroupInfo.
>
> *  Use the confirmed transcript hash and confirmation tag to compute the interim transcript
>    hash in the new state.
>
> *  If a PreSharedKeyID was used that has type resumption with usage reinit or branch, verify
>    that the epoch field in the GroupInfo is equal to 1.
>    -  For usage reinit, verify that the last Commit to the referenced group contains a ReInit
>       proposal and that the group_id, version, cipher_suite, and group_context.extensions
>       fields of the GroupInfo match the ReInit proposal. Additionally, verify that all the
>       members of the old group are also members of the new group, according to the application.
>    -  For usage branch, verify that the version and cipher_suite of the new group match those
>       of the old group, and that the members of the new group compose a subset of the members
>       of the old group, according to the application."

Implementation notes on the path-secret walk:

The RFC's "For each parent of the common ancestor, up to the root of the tree, derive a
new path secret" must be read together with "The private key MUST be the private key
that corresponds to the public key in the node." The chain of path secrets follows the
**committer's filtered direct path**, not every ancestor: nodes that were filtered out
are blank after the Commit and have no key. So:

```
fdp   = filteredDirectPath(leaf 2*GroupInfo.signer)     // in the post-commit tree
lca   = commonAncestor(2*my_leaf_index, 2*GroupInfo.signer)
i     = index of lca in fdp                             // always found; see §6.5
ps    = GroupSecrets.path_secret
for k = i .. len(fdp)-1:
    node_secret = DeriveSecret(ps, "node")
    (priv, pub) = KEM.DeriveKeyPair(node_secret)
    assert pub == fdp[k].encryption_key                 // "MUST be the private key that
                                                        //  corresponds to the public key"
    store priv for node fdp[k]
    ps = DeriveSecret(ps, "path")
```

The joiner then has: its own leaf private key (from the KeyPackage), plus the private
keys from the LCA up to the root. Nodes between its leaf and the LCA are blank (the
Commit blanked the committer's direct path, and the joiner's leaf was just inserted),
so there is nothing to fill in there.

Also note the joiner does **not** have `init_secret_[n-1]` or `commit_secret`; it
starts the key schedule at `joiner_secret` (`02-MLS-Crypto.md` §6.2 step 2).

Finally, the epoch for the joiner is `GroupInfo.group_context.epoch` — the *new*
epoch, already incremented by the Commit.

### 7.3 The ratchet_tree extension vs out-of-band delivery (RFC 9420 §12.4.3.3)

> "By default, a GroupInfo message only provides the joiner with a hash of the group's
> ratchet tree. In order to process or generate handshake messages, the joiner will need
> to get a copy of the ratchet tree from some other source. (For example, the DS might
> provide a cached copy.) The inclusion of the tree hash in the GroupInfo message means
> that the source of the ratchet tree need not be trusted to maintain the integrity of the
> tree."
>
> "In cases where the application does not wish to provide such an external source, the
> whole public state of the ratchet tree can be provided in an extension of type
> ratchet_tree ..."
>
> "The presence of a ratchet_tree extension in a GroupInfo message does not result in any
> changes to the GroupContext extensions for the group. The ratchet tree provided is simply
> stored by the client and used for MLS operations."
>
> "If this extension is not provided in a Welcome message, then the client will need to
> fetch the ratchet tree over some other channel before it can generate or process Commit
> messages. Applications should ensure that this out-of-band channel is provided with
> security protections equivalent to the protections that are afforded to Proposal and
> Commit messages."
>
> "Regardless of how the client obtains the tree, the client MUST verify that the root hash
> of the ratchet tree matches the tree_hash of the GroupContext before using the tree for
> MLS operations."

Wire always ships the tree inline: `core-crypto` sets
`.use_ratchet_tree_extension(true)` in
`crypto/src/mls/conversation/config.rs`. So implement the extension; the
out-of-band path is optional.

---

## 8. External commits (RFC 9420 §12.4.3.2)

> "External Commits are a mechanism for new members (external parties that want to become
> members of the group) to add themselves to a group, without requiring that an existing
> member has to come online to issue a Commit that references an Add proposal."
>
> "New members can create and issue an external Commit if they have access to the following
> information for the group's current epoch: group ID, epoch ID, cipher suite, public tree
> hash, confirmed transcript hash, confirmation tag of the most recent Commit, group
> extensions, external public key."
>
> "In other words, to join a group via an external Commit, a new member needs a GroupInfo
> with an external_pub extension present in its extensions field."
>
> ```
> struct {
>     HPKEPublicKey external_pub;
> } ExternalPub;
> ```
>
> "Thus, a member of the group can enable new clients to join by making a GroupInfo object
> available to them. Note that because a GroupInfo object is specific to an epoch, it will
> need to be updated as the group advances. In particular, each GroupInfo object can be used
> for one external join, since that external join will cause the epoch to change."
>
> "Note that the tree_hash field is used the same way as in the Welcome message. The full
> tree can be included via the ratchet_tree extension (see Section 12.4.3.3)."
>
> "In principle, external Commits work like regular Commits. However, their content has to
> meet a specific set of requirements:
>
> *  External Commits MUST contain a path field (and is therefore a "full" Commit). The
>    joiner is added at the leftmost free leaf node (just as if they were added with an Add
>    proposal), and the path is calculated relative to that leaf node.
> *  The Commit MUST NOT include any proposals by reference, since an external joiner cannot
>    determine the validity of proposals sent within the group.
> *  External Commits MUST be signed by the new member. In particular, the signature on the
>    enclosing AuthenticatedContent MUST verify using the public key for the credential in
>    the leaf_node of the path field.
> *  When processing a Commit, both existing and new members MUST use the external init
>    secret as described in Section 8.3.
> *  The sender type for the AuthenticatedContent encapsulating the external Commit MUST be
>    new_member_commit."
>
> "External Commits come in two "flavors" -- a "join" Commit that adds the sender to the
> group or a "resync" Commit that replaces a member's prior appearance with a new one."
>
> "Note that the "resync" operation allows an attacker that has compromised a member's
> signature private key to introduce themselves into the group and remove the prior,
> legitimate member in a single Commit. Without resync, this can still be done, but it
> requires two operations: the external Commit to join and a second Commit to remove the old
> appearance."

Joiner-side procedure:

1. Obtain the `GroupInfo` (a `MLSMessage` with wire format `mls_group_info`), verify
   its signature against the leaf at `signer` in the tree, verify the tree hash and the
   tree's parent hashes.
2. `kem_output, ctx = SetupBaseS(external_pub, "")`;
   `init_secret = ctx.export("MLS 1.0 external init secret", KDF.Nh)`.
3. Build proposals **by value**: exactly one `ExternalInit{kem_output}`, optionally one
   `Remove{removed}` (resync), optionally `PreSharedKey`s.
4. Apply those proposals to the tree; place yourself at the leftmost blank leaf
   (extending right if necessary); compute the UpdatePath from that leaf.
5. `FramedContent` with `sender = Sender{new_member_commit}`, `epoch` = the GroupInfo's
   epoch, `group_id` from the GroupInfo. Sign `FramedContentTBS` with the GroupContext
   from the GroupInfo (the `new_member_commit` case includes the context).
6. Frame as `PublicMessage` with **no** `membership_tag` (the `new_member_commit` arm
   is `struct{}`).
7. Run the key schedule with `init_secret` from step 2 in place of
   `init_secret_[n-1]`, the `commit_secret` from the UpdatePath, and the new
   GroupContext (confirmed transcript hash updated with this Commit, starting from the
   interim transcript hash the joiner computes as
   `Hash(GroupInfo.group_context.confirmed_transcript_hash || InterimTranscriptHashInput{GroupInfo.confirmation_tag})`).
8. Compute the `confirmation_tag` and attach it.

Existing members process it as a normal Commit except: sender type is
`new_member_commit`, the signature key comes from `commit.path.leaf_node`, the
committer's leaf index is the leftmost blank leaf (assigned during processing), and
`init_secret_[n-1]` is replaced by the value recovered from the `ExternalInit`
proposal via `SetupBaseR(kem_output, external_priv, "")`.

---

## 9. Reinitialization, branching, PSKs

### 9.1 Reinitialization (RFC 9420 §11.2)

> "A group may be reinitialized by creating a new group with the same membership and
> different parameters, and linking it to the old group via a resumption PSK. The members
> of a group reinitialize it using the following steps:
>
> 1.  A member of the old group sends a ReInit proposal (see Section 12.1.5).
> 2.  A member of the old group sends a Commit covering the ReInit proposal.
> 3.  A member of the old group creates an initial Commit that sets up a new group that
>     matches the ReInit and sends a Welcome message:
>     *  The version, cipher_suite, group_id, and extensions fields of the GroupContext
>        object in the Welcome message MUST be the same as the corresponding fields in the
>        ReInit proposal. The epoch in the Welcome message MUST be 1.
>     *  The Welcome message MUST specify a PreSharedKeyID of type resumption with usage
>        reinit, where the group_id field matches the old group and the epoch field
>        indicates the epoch after the Commit covering the ReInit."
>
> "Resumption PSKs with usage reinit MUST NOT be used in other contexts. A PreSharedKey
> proposal with type resumption and usage reinit MUST be considered invalid."

### 9.2 Subgroup branching (RFC 9420 §11.3)

> "A new group can be formed from a subset of an existing group's members, using the same
> parameters as the old group."
>
> "A member can create a subgroup by performing the following steps:
>
> 1.  Fetch a new KeyPackage for each group member that should be included in the subgroup.
> 2.  Create an initial Commit message that sets up the new group and contains a PreSharedKey
>     proposal of type resumption with usage branch. To avoid key reuse, the psk_nonce
>     included in the PreSharedKeyID object MUST be a randomly sampled nonce of length KDF.Nh.
> 3.  Send the corresponding Welcome message to the subgroup members."

### 9.3 PSK injection (RFC 9420 §8.4)

> "The injection of one or more PSKs into the key schedule is signaled in two ways: Existing
> members are informed via PreSharedKey proposals covered by a Commit, and new members added
> in the Commit are informed by the GroupSecrets object in the Welcome message corresponding
> to the Commit. To ensure that existing and new members compute the same PSK input to the
> key schedule, the Commit and GroupSecrets objects MUST indicate the same set of PSKs, in
> the same order."

Computation of `psk_secret` in `02-MLS-Crypto.md` §6.4 (including the RFC ambiguity
about the argument order of the chaining `Extract`).

---

## 10. Application messages (RFC 9420 §15, §6.3)

> RFC 9420 §6: "Applications MUST use PrivateMessage to encrypt application messages and
> SHOULD use PrivateMessage to encode handshake messages, but they MAY transmit handshake
> messages encoded as PublicMessage objects in cases where it is necessary for the Delivery
> Service to examine such messages."
>
> §15: "The group identifier and epoch allow a recipient to know which group secrets should
> be used and from which epoch_secret to start computing other secrets. The sender identifier
> and content type are used to identify which symmetric ratchet to use from the secret tree.
> The generation counter determines how far into the ratchet to iterate in order to produce
> the required nonce and key for encryption or decryption."
>
> §15.2: "During each epoch, senders MUST NOT encrypt more data than permitted by the security
> bounds of the AEAD scheme used [CFRG-AEAD-LIMITS]."
>
> "Note that each change to the group through a handshake message will also set a new
> encryption_secret. Hence this change MUST be applied before encrypting any new application
> message. This is required both to ensure that any users removed from the group can no
> longer receive messages and to (potentially) recover confidentiality and authenticity for
> future messages despite a past state compromise."

### 10.1 Sending (`protect`)

```
1. content = FramedContent {
     group_id, epoch,
     sender = Sender{ member, own_leaf_index },
     authenticated_data,
     content_type = application,
     application_data
   }
2. tbs = FramedContentTBS { mls10, mls_private_message, content, GroupContext_current }
   sig = SignWithLabel(own_sig_priv, "FramedContentTBS", tbs)
   auth = FramedContentAuthData { sig }            // no confirmation_tag for application
3. plaintext = enc(application_data) || enc(auth) || zero padding
4. generation = next unused generation of own APPLICATION ratchet
   key   = ratchet_key_[own leaf]_[generation]     // AEAD.Nk
   nonce = ratchet_nonce_[own leaf]_[generation]   // AEAD.Nn
   advance the ratchet, delete the consumed secrets
5. reuse_guard = random(4)
   nonce[0..3] ^= reuse_guard[0..3]
6. aad = enc(PrivateContentAAD{ group_id, epoch, application, authenticated_data })
   ciphertext = AEAD.Seal(key, nonce, aad, plaintext)
7. sample = ciphertext[0 .. KDF.Nh-1]              // whole ciphertext if shorter
   sd_key   = ExpandWithLabel(sender_data_secret, "key",   sample, AEAD.Nk)
   sd_nonce = ExpandWithLabel(sender_data_secret, "nonce", sample, AEAD.Nn)
   sd_aad   = enc(SenderDataAAD{ group_id, epoch, application })
   encrypted_sender_data =
     AEAD.Seal(sd_key, sd_nonce, sd_aad,
               enc(SenderData{ own_leaf_index, generation, reuse_guard }))
8. PrivateMessage { group_id, epoch, application, authenticated_data,
                    encrypted_sender_data, ciphertext }
   wrapped in MLSMessage{ mls10, mls_private_message, . }
```

For a handshake message sent as `PrivateMessage`, everything is the same except
`content_type` is `proposal`/`commit`, the **handshake** ratchet is used, and the
`auth` for a commit also carries the `confirmation_tag`.

### 10.2 Receiving (`unprotect`)

```
1. check group_id and epoch match a known epoch (current or a retained past epoch)
2. sample = ciphertext[0 .. KDF.Nh-1]
   derive sd_key / sd_nonce as above from that epoch's sender_data_secret
   SenderData = AEAD.Open(sd_key, sd_nonce, sd_aad, encrypted_sender_data)
3. verify SenderData.leaf_index identifies a NON-BLANK leaf (§6.3.2)
4. pick the ratchet: handshake if content_type in {proposal, commit}, else application,
   for leaf SenderData.leaf_index; advance it to SenderData.generation (bounded! §15.3)
   key, nonce = ratchet_key/nonce at that generation
5. nonce[0..3] ^= SenderData.reuse_guard[0..3]
6. plaintext = AEAD.Open(key, nonce, PrivateContentAAD, ciphertext)
7. parse content per content_type, then FramedContentAuthData; the REST is padding and
   MUST be all zero bytes (§6.3.1)
8. rebuild FramedContent from the header fields + SenderData.leaf_index + parsed content
   rebuild FramedContentTBS{ mls10, mls_private_message, content, GroupContext of that epoch }
   verify the signature with the leaf's signature_key (§6.1)
9. for a commit, verify the confirmation_tag after running the key schedule (§12.4.2)
```

### 10.3 Padding (RFC 9420 §15.1)

> "Application messages MAY be padded to provide some resistance against traffic analysis
> techniques over encrypted traffic. ... The length of the padding field in
> PrivateMessageContent can be chosen by the sender at the time of message encryption.
> Senders may use padding to reduce the ability of attackers outside the group to infer the
> size of the encrypted content. Note, however, that the transports used to carry MLS
> messages may have maximum message sizes, so padding schemes SHOULD avoid increasing
> message size beyond any such limits that exist in a given deployment scenario."

Wire pads to a multiple of 128 bytes (`ConversationConfiguration::PADDING_SIZE = 128`
in `crypto/src/mls/conversation/config.rs`).

---

## 11. Validation rules a receiver MUST apply

### 11.1 LeafNode validation (RFC 9420 §7.3), verbatim

> "The validity of a LeafNode needs to be verified at the following stages:
>
> *  When a LeafNode is downloaded in a KeyPackage, before it is used to add the client to
>    the group
> *  When a LeafNode is received by a group member in an Add, Update, or Commit message
> *  When a client validates a ratchet tree, e.g., when joining a group or after processing
>    a Commit"
>
> "The client verifies the validity of a LeafNode using the following steps:
>
> *  Verify that the credential in the LeafNode is valid, as described in Section 5.3.1.
> *  Verify that the signature on the LeafNode is valid using signature_key.
> *  Verify that the LeafNode is compatible with the group's parameters. If the GroupContext
>    has a required_capabilities extension, then the required extensions, proposals, and
>    credential types MUST be listed in the LeafNode's capabilities field.
> *  Verify that the credential type is supported by all members of the group, as specified
>    by the capabilities field of each member's LeafNode, and that the capabilities field of
>    this LeafNode indicates support for all the credential types currently in use by other
>    members.
> *  Verify the lifetime field:
>    -  If the LeafNode appears in a message being sent by the client, e.g., a Proposal or a
>       Commit, then the client MUST verify that the current time is within the range of the
>       lifetime field.
>    -  If instead the LeafNode appears in a message being received by the client, e.g., a
>       Proposal, a Commit, or a ratchet tree of the group the client is joining, it is
>       RECOMMENDED that the client verifies that the current time is within the range of the
>       lifetime field. (This check is not mandatory because the LeafNode might have expired in
>       the time between when the message was sent and when it was received.)
> *  Verify that the extensions in the LeafNode are supported by checking that the ID for each
>    extension in the extensions field is listed in the capabilities.extensions field of the
>    LeafNode.
> *  Verify the leaf_node_source field:
>    -  If the LeafNode appears in a KeyPackage, verify that leaf_node_source is set to
>       key_package.
>    -  If the LeafNode appears in an Update proposal, verify that leaf_node_source is set to
>       update and that encryption_key represents a different public key than the
>       encryption_key in the leaf node being replaced by the Update proposal.
>    -  If the LeafNode appears in the leaf_node value of the UpdatePath in a Commit, verify
>       that leaf_node_source is set to commit.
> *  Verify that the following fields are unique among the members of the group:
>    -  signature_key
>    -  encryption_key"

### 11.2 KeyPackage validation (RFC 9420 §10.1), verbatim

> "The client verifies the validity of a KeyPackage using the following steps:
>
> *  Verify that the cipher suite and protocol version of the KeyPackage match those in the
>    GroupContext.
> *  Verify that the leaf_node of the KeyPackage is valid for a KeyPackage according to
>    Section 7.3.
> *  Verify that the signature on the KeyPackage is valid using the public key in
>    leaf_node.credential.
> *  Verify that the value of leaf_node.encryption_key is different from the value of the
>    init_key field."

### 11.3 Credential validation (RFC 9420 §5.3.1)

> "Whenever a new credential is introduced in the group, it MUST be validated with the AS. In
> particular, at the following events in the protocol:
>
> *  When a member receives a KeyPackage that it will use in an Add proposal to add a new
>    member to the group
> *  When a member receives a GroupInfo object that it will use to join a group, either via a
>    Welcome or via an external Commit
> *  When a member receives an Add proposal adding a member to the group
> *  When a member receives an Update proposal whose LeafNode has a new credential for the
>    member
> *  When a member receives a Commit with an UpdatePath whose LeafNode has a new credential
>    for the committer
> *  When an external_senders extension is added to the group
> *  When an existing external_senders extension is updated"
>
> "In cases where a member's credential is being replaced, such as the Update and Commit cases
> above, the AS MUST also verify that the set of presented identifiers in the new credential is
> valid as a successor to the set of presented identifiers in the old credential, according to
> the application's policy."

### 11.4 Extension handling (RFC 9420 §13.4)

> "*  A client processing a KeyPackage object MUST ignore all unrecognized values in the
>    capabilities field of the LeafNode and all unknown extensions in the extensions and
>    leaf_node.extensions fields.
> *  A client processing a GroupInfo object MUST ignore all unrecognized extensions in the
>    extensions field.
> *  Any field containing a list of extensions MUST NOT have more than one extension of any
>    given type.
> *  A client adding a new member to a group MUST verify that the LeafNode for the new member
>    is compatible with the group's extensions. The capabilities field MUST indicate support
>    for each extension in the GroupContext.
> *  A client joining a group MUST verify that it supports every extension in the GroupContext
>    for the group. Otherwise, it MUST treat the enclosing GroupInfo message as invalid and not
>    join the group."

### 11.5 Message-level checks (summary of §6.1, §6.2, §6.3, §12.1, §12.4.2)

For every incoming `MLSMessage`:

1. `version == mls10`.
2. `group_id` matches a known group; `epoch` matches the current epoch (proposals and
   commits) or a retained epoch (application messages).
3. For `PublicMessage` from a `member`: verify `membership_tag` with the epoch's
   `membership_key` over `AuthenticatedContentTBM` (§6.2).
4. Verify the `FramedContentAuthData.signature` with the key chosen by `sender_type`
   (§6.1).
5. For `proposal` content: cache it under `MakeProposalRef(AuthenticatedContent)`;
   check that the proposal type is permitted for the sender type if external (§12.1.8).
6. For `commit` content: run the full §12.4.2 procedure, ending with the
   `confirmation_tag` check.
7. For `PrivateMessage`: `SenderData.leaf_index` must identify a non-blank leaf
   (§6.3.2); padding must be all zeros (§6.3.1).

---

## 12. Sequencing of state changes (RFC 9420 §14)

> "Each Commit message is premised on a given starting state, indicated by the epoch field of
> the enclosing FramedContent. If the changes implied by a Commit message are made starting from
> a different state, the results will be incorrect."
>
> "Applications MUST have an established way to resolve conflicting Commit messages for the same
> epoch."
>
> "The generation of Commit messages MUST NOT modify a client's state ... Similarly, the Welcome
> message corresponding to a Commit MUST NOT be delivered to a new joiner until it's clear that
> the Commit has been accepted."
>
> "Regardless of how messages are kept in sequence, there is a risk that in a sufficiently busy
> group, a given member may never be able to send a Commit message because they always lose to
> other members."

Wire resolves this at the Delivery Service: a `CommitBundle` is POSTed and the DS
rejects it (HTTP `mls-stale-message`) if the epoch has moved on. The client then
discards the pending commit, processes the winning commit, and retries. Wire's
`core-crypto` implements exactly that shape (`PendingConversation::send_commit` →
`clear()` on `MessageRejected`, `merge()` on success).

---

## 13. Minimum viable subset for talking to Wire

Based on `wire/core-crypto` (`crypto/src/mls/**`) and `wire/wire-server`
(`libs/wire-api/src/Wire/API/MLS/**`, `libs/wire-subsystems/src/Wire/ConversationSubsystem/MLS/**`).

### 13.1 What Wire actually uses

| Feature | Used by Wire? | Evidence |
|---|---|---|
| Cipher suite 0x0001 (X25519/AES128GCM) | **Yes**, the default | `crypto/src/mls/cipher_suite.rs`: `Default` = `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` |
| Cipher suite 0x0003 (X25519/ChaCha20) | Yes, advertised | `DEFAULT_SUPPORTED_CIPHERSUITES` in `crypto/src/mls/conversation/config.rs` |
| Cipher suites 0x0002, 0x0005, 0x0007 (NIST curves) | Advertised in capabilities, rarely negotiated | same list |
| `PublicMessage` for handshake (proposals + commits) | **Yes — required** | `WirePolicy::Plaintext` is the `Default` in `config.rs`; and `wire-server`'s `mkIncomingMessage` accepts `MessagePrivate` **only** when `tag == FramedContentApplicationDataTag`, i.e. the DS rejects encrypted handshake messages |
| `PrivateMessage` for application data | **Yes — required** | same `mkIncomingMessage` |
| `ratchet_tree` GroupInfo extension | **Yes, always** | `.use_ratchet_tree_extension(true)` in `config.rs` |
| `external_senders` GroupContext extension | **Yes** | `ConversationConfiguration.external_senders`, `set_external_senders`; the DS sends external Remove proposals (`Wire/ConversationSubsystem/MLS/Removal.hs` uses `mkSignedPublicMessage`) |
| `required_capabilities` GroupContext extension | Yes, with `extensions=[]`, `proposals=[]`, `credentials=[basic, x509]` | `default_required_capabilities()` |
| External commits (`ExternalInit` + `external_pub`) | **Yes** | `TransactionContext::join_by_external_commit`, `crypto/src/transaction_context/conversation/external_commit.rs` |
| `Add`, `Remove`, `Update` proposals | **Yes** | `crypto/src/mls/conversation/mutable/proposal.rs` and the commit paths |
| `GroupContextExtensions` proposal | Occasionally (updating external senders) | `ConversationConfiguration::set_external_senders` |
| MLS `PreSharedKey` proposals / `psk_secret` | **No** | `NUMBER_RESUMPTION_PSK` is set but commented "Not used at the moment"; no `PreSharedKey` proposal is ever built. The only PSK use is HPKE `mode_psk` for "targeted messages", which is a Wire-specific feature outside RFC 9420's key schedule |
| `ReInit` proposal / reinitialization | **No** | no `ReInit` construction anywhere in `core-crypto` |
| Subgroup branching | **No** | no `usage = branch` PSK construction |
| `x509` credentials | Yes, for E2E identity (optional feature) | `CredentialType::X509`, `crypto/src/mls/credential/x509.rs` |
| `basic` credentials | **Yes**, the default | `CredentialType::Basic` |
| `application_id` LeafNode extension | No | not set |
| GREASE | No (but must be tolerated on receive) | not generated by `core-crypto` |

### 13.2 What you can safely omit for a Wire-only client

* **`ReInit` proposals and the whole reinitialization flow (§11.2).** Not used.
  Reject a received `ReInit` as unsupported.
* **Subgroup branching (§11.3).** Not used.
* **MLS `PreSharedKey` proposals and `psk_secret` chaining (§8.4).** `psk_secret` is
  always the all-zero vector of `KDF.Nh` bytes. You can hard-code that and skip the
  `PSKLabel` / `"derived psk"` derivation entirely — which also sidesteps the RFC
  ambiguity documented in `02-MLS-Crypto.md` §6.4. (Keep the `PreSharedKeyID`
  *parser* so `GroupSecrets.psks` and `Proposal` still round-trip; reject non-empty
  lists.)
* **`x509` credentials (§5.3).** Only needed for Wire's E2E-identity feature. A
  `basic`-only client works in a normal Wire group, but it MUST still *parse* x509
  credentials (other members may use them, and the tree must validate) and MUST list
  `x509` in `capabilities.credentials` if it is willing to be in a group with such
  members. Full X.509 chain verification can be deferred; leaf-node signature
  verification uses `signature_key`, not the certificate.
* **`ecdsa` cipher suites (0x0002, 0x0005, 0x0007) and X448/Ed448 (0x0004, 0x0006).**
  Implement 0x0001 (mandatory-to-implement per §17.1) and 0x0003. Advertise only what
  you implement — §13.4 requires that a client support everything it advertises.
* **The out-of-band ratchet-tree channel (§12.4.3.3).** Wire always uses the
  `ratchet_tree` GroupInfo extension.
* **`application_id` LeafNode extension (§5.3.3).** Not used by Wire.
* **MLS exporters (§8.5)** unless you implement Wire's "targeted messages" /
  subconversation features.
* **HPKE PSK / Auth modes (RFC 9180 §5.1.2–5.1.4).** MLS proper uses base mode only.
  (Wire's targeted-message feature uses `mode_psk`, but that is not MLS.)

### 13.3 What you cannot omit

* The full **varint / TLS presentation** layer (`01-MLS-Wire-Format.md`).
* **Both** framings: `PublicMessage` (handshake) and `PrivateMessage` (application).
  Wire's DS specifically requires this split.
* The **secret tree and both ratchets**. Even though handshake messages travel as
  `PublicMessage` (so the handshake ratchet is never used for sending), application
  messages need the application ratchet, and you must derive the whole secret tree
  to get to your own leaf.
* **Tree hash and parent hash**, including `original_sibling_tree_hash` recomputation
  with unmerged leaves — you cannot join a group without validating the tree.
* **Resolution and filtered direct path**, with the "exclude new members from the
  resolution" rule.
* **External commits** — Wire uses them for "join an existing conversation from a new
  device" and for recovery.
* **`external_senders`** — Wire's backend removes users by sending external `Remove`
  proposals signed by the DS key; without this extension and `SenderType::external`
  handling you will reject legitimate removals.
* **`Update` proposals** — used by Wire for key rotation and by the backend flow.
* **GREASE tolerance** — you must ignore unknown values in `Capabilities` and in
  `KeyPackage`/`GroupInfo`/`LeafNode` extension lists.

### 13.4 Wire-specific framing above MLS

* **`CommitBundle`.** Wire posts a commit as a concatenated stream of `MLSMessage`
  objects, parsed by `libs/wire-api/src/Wire/API/MLS/CommitBundle.hs`:
  commit (`mls_public_message` carrying a `commit`), optional
  `mls_welcome`, mandatory `mls_group_info`, optional application `mls_private_message`.
  There is no length framing between them — the parser reads `MLSMessage`s until the
  input is exhausted. Order on serialisation is: commit, welcome, group info,
  application message.
* **Basic credential identity format.** Wire's `identity` byte string is the ASCII
  string `<user-uuid>:<client-id-hex>@<domain>`, e.g.
  `4c1a63eb-...:a1b2c3d4e5f6@example.com`
  (`libs/wire-api/src/Wire/API/MLS/Credential.hs`, `instance ParseMLS ClientIdentity`:
  36-byte ASCII UUID, `:`, hex client id, `@`, domain).
* **Client-side limits** (`crypto/src/mls/conversation/config.rs`):
  `PADDING_SIZE = 128`, `MAX_PAST_EPOCHS = 3`, `OUT_OF_ORDER_TOLERANCE = 2`,
  `MAXIMUM_FORWARD_DISTANCE = 1000`.
* **Default `Capabilities`** Wire puts in its leaf nodes: `versions = [mls10]`,
  `cipher_suites = [0x0001, 0x0002, 0x0003, 0x0007, 0x0005]`, `extensions = []`,
  `proposals = []`, `credentials = [basic, x509]`.

### 13.5 Suggested build order

1. Varint + TLS codec, with the three RFC varint examples as tests.
2. `ExpandWithLabel` / `DeriveSecret` / `DeriveTreeSecret` / `SignWithLabel` /
   `RefHash`, against `crypto-basics.json`.
3. HPKE base mode over DHKEM(X25519, HKDF-SHA256), against RFC 9180's own test
   vectors.
4. Tree math (Appendix C), against `tree-math.json`.
5. Tree hash / parent hash / resolution / filtered direct path, against
   `tree-validation.json` and `tree-operations.json`.
6. Key schedule + secret tree, against `key-schedule.json` and `secret-tree.json`.
7. Framing (`PublicMessage`, `PrivateMessage`), against `message-protection.json`.
8. Welcome processing, against `welcome.json` and `passive-client-welcome.json`.
9. Commit creation with UpdatePath — the only piece with no direct test vector for
   *generation*; validate by round-tripping against your own processing code and by
   `passive-client-handling-commit.json` for processing.
10. External commits, against `passive-client-random.json` / live Wire.
