# MLS implementation — design and module contract

This is the map from the RFC 9420 documents (`01`–`03` in this directory) onto our
code. Read it before touching `app/logic/Chat/MLS/`. It fixes the file layout and
the API between the modules, so that the pieces fit together.

The MLS code is **generic**: it knows nothing about Wire. Everything Wire-specific
(key package upload, commit bundles, the delivery service, the credential identity
format) lives in `app/logic/Chat/Wire/`.

## Ground rules

- **Clean room.** No MLS library, no code copied from openmls / core-crypto. The
  RFC and our own docs are the only sources.
- **Crypto only from @noble** (`@noble/curves`, `@noble/hashes`, `@noble/ciphers`),
  which the app already depends on. Byte helpers (`concatBytes`, `randomBytes`,
  `bytesEqual`, `base64Encode`/`base64Decode`) are reused from
  `Chat/Signal/Crypto/primitives`, as `Chat/WhatsApp/` already does.
- **Synchronous crypto.** MLS recurses over the tree and derives dozens of secrets
  per commit; @noble is synchronous, so no MLS function is `async`. Do not reach
  for WebCrypto here.
- **Code style** follows `Mail/IMAP/` and `Mail/JMAP/`: `let`, not `const`, except
  for hardcoded literals; `ID` spelled uppercase; comments short and only where the
  code surprises; the main class first in the file, helpers after it.
- **Object orientation.** Nouns are classes, verbs are their methods. Every RFC
  struct is a class with `static read(reader)` / `writeTo(writer)`, and
  `static fromBytes()` / `toBytes()` where it is exchanged whole.
- **Errors**: throw `TLSParseError` for malformed input, `MLSError` (`../util`) for
  a protocol failure such as a bad signature or a wrong epoch. Both mean "drop this
  message"; neither is fatal to the account.

## Serialization

Where a struct only ever needs the *serialized* form of another struct — the
`GroupContext` in the key schedule and in the TreeKEM encryption context, the
`ConfirmedTranscriptHashInput` in the transcript hash — the API takes
`Uint8Array`, not the object. That keeps `Tree/` and `KeySchedule.ts` independent
of `Messages/`.

`Codec/TLSWriter` and `Codec/TLSReader` implement the TLS presentation language of
RFC 9420 § 2.1, including the variable-size length header and `optional<T>`.
`tlsSerialize(writer => …)` and `tlsParse(bytes, reader => …)` are the shorthands.
Never hand-roll a length prefix.

## File layout

| Path | Holds |
|---|---|
| `Codec/TLSWriter.ts`, `Codec/TLSReader.ts` | TLS presentation language ✅ done |
| `Crypto/AEAD.ts`, `KDF.ts`, `KEM.ts`, `SignatureScheme.ts` | the four primitives, as strategy classes ✅ done |
| `Crypto/HPKE.ts` | RFC 9180 base mode ✅ done |
| `Crypto/CipherSuite.ts` | the suite registry and every labelled MLS operation ✅ done |
| `Messages/Credential.ts` | `Credential`, `BasicCredential`, `X509Credential` ✅ done |
| `Messages/Extension.ts` | `Extension`, `RequiredCapabilities`, `ExternalSender` ✅ done |
| `Tree/Capabilities.ts`, `Tree/Lifetime.ts` | leaf node sub-structs ✅ done |
| `Tree/LeafNode.ts`, `Tree/ParentNode.ts` | the two node types ✅ done |
| `Tree/RatchetTree.ts` | the tree: geometry, resolution, hashes, TreeKEM paths |
| `Tree/SecretTree.ts` | per-sender message key ratchets |
| `Messages/KeyPackage.ts` | `KeyPackage` and its signature |
| `Messages/GroupContext.ts` | `GroupContext` |
| `Messages/GroupInfo.ts` | `GroupInfo`, its signature and confirmation tag |
| `Messages/Welcome.ts` | `Welcome`, `GroupSecrets`, `EncryptedGroupSecrets`, `PathSecret` |
| `Messages/Proposal.ts` | every proposal variant, `PreSharedKeyID`, `ProposalOrRef` |
| `Messages/Commit.ts` | `Commit`, `UpdatePath`, `UpdatePathNode` |
| `Messages/Framing.ts` | `FramedContent`, `AuthenticatedContent`, `PublicMessage`, `PrivateMessage`, `Sender` |
| `Messages/MLSMessage.ts` | the outermost `MLSMessage` wrapper |
| `KeySchedule.ts` | epoch secrets, transcript hashes, PSK secret |
| `MLSGroup.ts` | the state machine: create, commit, process, encrypt, decrypt |
| `MLSClient.ts` | our identity: signature key, credential, key packages, the groups |
| `MLSStorage.ts` | the interface the app implements to persist group state |

## Module contract

Only the parts that cross module boundaries are fixed here. Anything private is the
implementer's choice.

### `Tree/RatchetTree.ts`

```ts
export type TreeNode = LeafNode | ParentNode;

export class RatchetTree {
  readonly suite: CipherSuite;
  constructor(suite: CipherSuite);
  /** One member, at leaf 0 */
  static withLeaf(suite: CipherSuite, leaf: LeafNode): RatchetTree;
  /** The `ratchet_tree` extension body: `optional<Node> ratchet_tree<V>` */
  static fromBytes(suite: CipherSuite, data: Uint8Array): RatchetTree;
  toBytes(): Uint8Array;

  get leafCount(): number;          // number of leaf slots, including blanks
  get nodeCount(): number;          // 2 * leafCount - 1
  get memberCount(): number;        // non-blank leaves
  get rootIndex(): number;

  leaf(leafIndex: number): LeafNode | null;
  parentNode(nodeIndex: number): ParentNode | null;
  memberLeafIndices(): number[];

  /** Geometry, RFC 9420 Appendix C. Node indices, not leaf indices. */
  level(nodeIndex: number): number;
  leftChild(nodeIndex: number): number;
  rightChild(nodeIndex: number): number;
  parentOf(nodeIndex: number): number;
  siblingOf(nodeIndex: number): number;
  directPath(nodeIndex: number): number[];      // leaf → root, excluding self
  copath(nodeIndex: number): number[];
  commonAncestor(a: number, b: number): number;
  resolution(nodeIndex: number): number[];
  filteredDirectPath(leafIndex: number): number[];

  /** Leftmost blank leaf, or a new leaf at the right edge, extending the tree */
  addLeaf(leaf: LeafNode): number;
  removeLeaf(leafIndex: number): void;          // blanks the leaf and its direct path, then truncates
  updateLeaf(leafIndex: number, leaf: LeafNode): void;
  blankDirectPath(leafIndex: number): void;

  treeHash(nodeIndex?: number): Uint8Array;     // default: the root
  /** RFC 9420 § 7.9: parent hash of `parentIndex` with copath child `siblingIndex` */
  parentHash(parentIndex: number, siblingIndex: number): Uint8Array;
  verifyParentHashes(): boolean;
  verifyLeaves(groupID: Uint8Array, now?: Date): boolean;

  /** TreeKEM, RFC 9420 § 7.5 and § 12.4.1. `leafIndex` is the committer.
   * Blanks and re-keys the committer's filtered direct path, encrypting each
   * path secret to the resolution of the copath sibling. */
  createUpdatePath(leafIndex: number, groupContext: Uint8Array, signaturePrivateKey: Uint8Array,
    newLeaf: LeafNode, excludeLeaves?: number[]): CreatedUpdatePath;
  /** Applies someone else's UpdatePath and recovers the commit secret. */
  applyUpdatePath(senderLeafIndex: number, path: UpdatePath, groupContext: Uint8Array,
    ourLeafIndex: number, ourPrivateKeys: Map<number, Uint8Array>): Uint8Array;
  /** Applies an UpdatePath without decrypting, e.g. as an unrelated observer. */
  mergeUpdatePath(senderLeafIndex: number, path: UpdatePath): void;

  clone(): RatchetTree;
}

export interface CreatedUpdatePath {
  updatePath: UpdatePath;
  /** commit_secret = DeriveSecret(path_secret[root], "path") */
  commitSecret: Uint8Array;
  /** Node index → HPKE private key, for the nodes we now own */
  privateKeys: Map<number, Uint8Array>;
  /** Leaf index → path secret to put into that member's GroupSecrets */
  pathSecrets: Map<number, Uint8Array>;
}
```

### `Tree/SecretTree.ts`

```ts
export class SecretTree {
  constructor(suite: CipherSuite, leafCount: number, encryptionSecret: Uint8Array,
    senderDataSecret: Uint8Array);
  /** RFC 9420 § 6.3.2. Samples the first KDF.Nh bytes of the ciphertext itself. */
  senderDataKey(ciphertext: Uint8Array): MessageKey;
  /** Consumes the ratchet up to `generation`; keys are single use. */
  handshakeKey(leafIndex: number, generation: number): MessageKey;
  applicationKey(leafIndex: number, generation: number): MessageKey;
  /** The next generation we will send with, and it advances. */
  nextHandshakeKey(leafIndex: number): MessageKey & { generation: number };
  nextApplicationKey(leafIndex: number): MessageKey & { generation: number };
}

export interface MessageKey {
  key: Uint8Array;
  nonce: Uint8Array;
}
```

### `KeySchedule.ts`

```ts
export class KeySchedule {
  readonly suite: CipherSuite;
  readonly joinerSecret: Uint8Array;
  readonly welcomeSecret: Uint8Array;
  readonly epochSecret: Uint8Array;
  readonly senderDataSecret: Uint8Array;
  readonly encryptionSecret: Uint8Array;
  readonly exporterSecret: Uint8Array;
  readonly externalSecret: Uint8Array;
  readonly confirmationKey: Uint8Array;
  readonly membershipKey: Uint8Array;
  readonly resumptionPSK: Uint8Array;
  readonly epochAuthenticator: Uint8Array;
  readonly initSecret: Uint8Array;   // for the *next* epoch

  /** The normal path: previous epoch's init secret plus this commit's secret. */
  static advance(suite: CipherSuite, previousInitSecret: Uint8Array, commitSecret: Uint8Array,
    groupContext: Uint8Array, pskSecret: Uint8Array): KeySchedule;
  /** The joiner path: a Welcome gives us the joiner secret directly. */
  static fromJoinerSecret(suite: CipherSuite, joinerSecret: Uint8Array,
    groupContext: Uint8Array, pskSecret: Uint8Array): KeySchedule;
  /** The very first epoch of a brand new group. */
  static forNewGroup(suite: CipherSuite, groupContext: Uint8Array): KeySchedule;

  /** RFC 9420 § 12.4.3.1: the AEAD key and nonce that protect GroupSecrets. */
  welcomeKeyAndNonce(): MessageKey;
  /** RFC 9420 § 8: the group-wide HPKE key pair for external commits. */
  externalKeyPair(): KeyPair;
  exportSecret(label: string, context: Uint8Array, length: number): Uint8Array;
}

/** RFC 9420 § 8.2. Both hashes are opaque running values; hold them in MLSGroup. */
export class TranscriptHash {
  static confirmed(suite: CipherSuite, interimHash: Uint8Array, confirmedTranscriptHashInput: Uint8Array): Uint8Array;
  static interim(suite: CipherSuite, confirmedHash: Uint8Array, confirmationTag: Uint8Array): Uint8Array;
}

/** RFC 9420 § 8.4 `psk_secret`. Empty list → `Nh` zero bytes. */
export class PreSharedKeys {
  static secret(suite: CipherSuite, psks: { id: PreSharedKeyID, secret: Uint8Array }[]): Uint8Array;
}
```

### `MLSGroup.ts`

```ts
export class MLSGroup {
  readonly suite: CipherSuite;
  readonly groupID: Uint8Array;
  get epoch(): bigint;
  get tree(): RatchetTree;
  get ourLeafIndex(): number;
  get members(): LeafNode[];
  /** RFC 9420 § 8.7: compare with other members to confirm the same view */
  get epochAuthenticator(): Uint8Array;

  /** A brand-new group with only us in it. */
  static create(client: MLSClient, groupID: Uint8Array, suite: CipherSuite,
    extensions: Extension[]): MLSGroup;
  /** Join from a Welcome. `tree` may come from the `ratchet_tree` extension
   * inside the Welcome, or be supplied by the delivery service. */
  static fromWelcome(client: MLSClient, welcome: Welcome, tree: RatchetTree | null): MLSGroup;
  /** Join an existing group without being added: RFC 9420 § 12.4.3.2. */
  static externalCommit(client: MLSClient, groupInfo: GroupInfo, tree: RatchetTree | null): {
    group: MLSGroup, commit: MLSMessage };

  /** Build (but do not apply) a commit. Apply it only once the delivery service
   * accepted it, with `applyOwnCommit()`. */
  commit(proposals: Proposal[], options?: CommitOptions): CommitResult;
  applyOwnCommit(result: CommitResult): void;

  /** Handle an inbound handshake or application message. */
  process(message: MLSMessage): ProcessResult;

  /** Encrypt application data as a PrivateMessage. */
  encrypt(plaintext: Uint8Array, authenticatedData?: Uint8Array): MLSMessage;

  /** RFC 9420 § 8.5 */
  exportSecret(label: string, context: Uint8Array, length: number): Uint8Array;

  toJSON(): any;
  static fromJSON(client: MLSClient, json: any): MLSGroup;
}

export interface CommitResult {
  /** The commit, as a PublicMessage or PrivateMessage, ready to send */
  commit: MLSMessage;
  /** Present when the commit added members */
  welcome: MLSMessage | null;
  /** The new epoch's GroupInfo, which Wire uploads with every commit bundle */
  groupInfo: GroupInfo;
}

export interface ProcessResult {
  kind: "application" | "proposal" | "commit";
  /** For "application" */
  plaintext?: Uint8Array;
  senderLeafIndex?: number;
  /** For "commit": what changed, so the app can show join/leave events */
  added?: LeafNode[];
  removed?: LeafNode[];
  /** True when the commit removed us; the group is dead afterwards */
  weWereRemoved?: boolean;
}
```

### `MLSClient.ts`

```ts
export class MLSClient {
  readonly suite: CipherSuite;
  readonly credential: Credential;
  readonly signatureKeyPair: KeyPair;
  readonly groups = new Map<string, MLSGroup>();   // key: base64 group ID

  constructor(suite: CipherSuite, credential: Credential, signatureKeyPair: KeyPair);

  /** A fresh KeyPackage plus the private keys we must keep to accept a Welcome. */
  createKeyPackage(lifetimeDays?: number): CreatedKeyPackage;
  /** Our leaf, for a group we create ourselves or join by external commit. */
  createLeafNode(source: LeafNodeSource): { leaf: LeafNode, encryptionKeyPair: KeyPair };

  /** Key packages we published and may still be welcomed with. */
  rememberKeyPackage(created: CreatedKeyPackage): void;
  keyPackageForRef(ref: Uint8Array): CreatedKeyPackage | null;

  toJSON(): any;
  static fromJSON(json: any): MLSClient;
}

export interface CreatedKeyPackage {
  keyPackage: KeyPackage;
  /** `MakeKeyPackageRef(keyPackage)`, how a Welcome addresses us */
  ref: Uint8Array;
  initKeyPair: KeyPair;
  encryptionKeyPair: KeyPair;
}
```

## Test vectors

The official interop vectors from <https://github.com/mlswg/mls-implementations>
(`test-vectors/`) are the acceptance criteria. They live in
`app/test/logic/Chat/MLS/vectors/` and each layer has a test that consumes them:

| Vector file | Validates | Test |
|---|---|---|
| `crypto-basics.json` | RefHash, ExpandWithLabel, DeriveSecret, DeriveTreeSecret, SignWithLabel, EncryptWithLabel | `cryptoBasics.test.ts` ✅ passing |
| `deserialization.json` | variable-length headers | `cryptoBasics.test.ts` ✅ passing |
| `tree-math.json` | the Appendix C index arithmetic | `treeMath.test.ts` |
| `tree-validation.json` | tree hash, parent hash, resolution | `treeValidation.test.ts` |
| `tree-operations.json` | applying Add/Update/Remove to a tree | `treeOperations.test.ts` |
| `treekem.json` | UpdatePath creation and processing, commit secret | `treeKEM.test.ts` |
| `secret-tree.json` | the per-sender handshake/application ratchets | `secretTree.test.ts` |
| `key-schedule.json` | every epoch secret, welcome key, external key pair | `keySchedule.test.ts` |
| `transcript-hashes.json` | confirmed and interim transcript hashes | `keySchedule.test.ts` |
| `psk_secret.json` | the PSK secret computation | `keySchedule.test.ts` |
| `messages.json` | parse/serialize round trip of every wire struct | `messages.test.ts` |
| `message-protection.json` | PublicMessage and PrivateMessage, both directions | `messageProtection.test.ts` |
| `welcome.json` | joining from a Welcome | `welcome.test.ts` |
| `passive-client-*.json` | the whole state machine, driven as a passive member | `passiveClient.test.ts` |

Only the cipher suites we implement are exercised; skip a vector whose
`cipher_suite` is not in `CipherSuite.all`.
