# MLS Wire Format — Serialisation Layer

Implementation reference for a clean-room TypeScript implementation of
**RFC 9420 (The Messaging Layer Security (MLS) Protocol)**, July 2023.

Everything in this file comes from RFC 9420. Section numbers are quoted for every
statement. Struct definitions are reproduced **verbatim** from the RFC — do not
"tidy" them, the field order *is* the wire format.

Companion documents:

* `02-MLS-Crypto.md` — ciphersuites, KDF/HPKE/signature/MAC constructions, key schedule, secret tree, tree hash, parent hash.
* `03-MLS-Protocol-Flow.md` — the state machine (group creation, Add/Commit/Welcome, Remove, resolution & filtered direct path, validation, Wire's minimum subset).

---

## 1. The presentation language (RFC 9420 §2.1)

> RFC 9420 §2.1: "We use the TLS presentation language [RFC8446] to describe the
> structure of protocol messages. In addition to the base syntax, we add two
> additional features: the ability for fields to be optional and the ability for
> vectors to have variable-size length headers."

So the base rules are those of RFC 8446 §3, with two MLS additions
(`optional<T>` and `<V>` vectors). There is **no** framing, no tags, no padding
between fields: a struct is the plain concatenation of its serialised fields in
declaration order.

### 1.1 Fixed-size integers (RFC 8446 §3.3, used throughout RFC 9420)

All integers are **unsigned, big-endian (network byte order)**, fixed width:

| Type     | Width   | TS representation |
|----------|---------|-------------------|
| `uint8`  | 1 byte  | `number`          |
| `uint16` | 2 bytes | `number`          |
| `uint32` | 4 bytes | `number`          |
| `uint64` | 8 bytes | `bigint` (JS `number` cannot hold 2^53..2^64) |

`uint64` appears in `FramedContent.epoch`, `GroupContext.epoch`,
`PrivateMessage.epoch`, `PrivateContentAAD.epoch`, `SenderDataAAD.epoch`,
`Lifetime.not_before`, `Lifetime.not_after`, `PreSharedKeyID.psk_epoch`.
Use `bigint` for all of them.

### 1.2 Enums

An enum is written as

```
enum {
    reserved(0),
    application(1),
    proposal(2),
    commit(3),
    (255)
} ContentType;
```

The trailing `(255)` / `(65535)` is the **maximum value**, and it determines the
encoded width (RFC 8446 §3.5): a maximum of 255 means the enum is one byte, a
maximum of 65535 means two bytes. In RFC 9420:

* one byte (`(255)`): `ContentType`, `SenderType`, `NodeType`, `LeafNodeSource`,
  `PSKType`, `ResumptionPSKUsage`, `ProposalOrRefType`.
* two bytes (`(65535)`): `ProtocolVersion`.

Types declared as `uint16 X;` (`CipherSuite`, `WireFormat`, `ExtensionType`,
`ProposalType`, `CredentialType`) are of course two bytes.

Value `0` is `reserved` in every MLS enum and MUST NOT be sent.

### 1.3 Fixed-length opaque arrays

`opaque reuse_guard[4];` (RFC 9420 §6.3.2) — exactly 4 bytes, **no** length
prefix. This is the only fixed-length array in the MLS structs.

`opaque padding[length_of_padding];` in `PrivateMessageContent` (§6.3.1) is a
special case: its length is *not* encoded anywhere. See §3.29 below.

### 1.4 Variable-size vectors with a varint length header (RFC 9420 §2.1.2)

> RFC 9420 §2.1.2: "In MLS, there are several vectors whose sizes vary over
> significant ranges. So instead of using a fixed-size length field, we use a
> variable-size length using a variable-length integer encoding based on the one
> described in Section 16 of [RFC9000]. They differ only in that the one here
> requires a minimum-size encoding. Instead of presenting min and max values, the
> vector description simply includes a V. For example:"
>
> ```
> struct {
>     uint32 fixed<0..255>;
>     opaque variable<V>;
> } StructWithVectors;
> ```
>
> "Such a vector can represent values with length from 0 bytes to 2^30 bytes. The
> variable-length integer encoding reserves the two most significant bits of the
> first byte to encode the base 2 logarithm of the integer encoding length in
> bytes. The integer value is encoded on the remaining bits, so that the overall
> value is in network byte order. The encoded value MUST use the smallest number
> of bits required to represent the value. When decoding, values using more bits
> than necessary MUST be treated as malformed."
>
> "This means that integers are encoded in 1, 2, or 4 bytes and can encode 6-,
> 14-, or 30-bit values, respectively."

**Table 1 of RFC 9420 §2.1.2, Summary of Integer Encodings:**

```
+========+=========+=============+=======+============+
| Prefix | Length  | Usable Bits | Min   | Max        |
+========+=========+=============+=======+============+
| 00     | 1       | 6           | 0     | 63         |
+--------+---------+-------------+-------+------------+
| 01     | 2       | 14          | 64    | 16383      |
+--------+---------+-------------+-------+------------+
| 10     | 4       | 30          | 16384 | 1073741823 |
+--------+---------+-------------+-------+------------+
| 11     | invalid | -           | -     | -          |
+--------+---------+-------------+-------+------------+
```

> "Vectors that start with the prefix "11" are invalid and MUST be rejected."
>
> "For example:
>
> *  The four-byte length value 0x9d7f3e7d decodes to 494878333.
> *  The two-byte length value 0x7bbd decodes to 15293.
> *  The single-byte length value 0x25 decodes to 37."

Check those three examples in a unit test:

* `0x9d7f3e7d`: prefix `10` → 4 bytes, value = `0x1d7f3e7d` = 494878333. OK
* `0x7bbd`: prefix `01` → 2 bytes, value = `0x3bbd` = 15293. OK
* `0x25`: prefix `00` → 1 byte, value = `0x25` = 37. OK

**Decoder, verbatim from RFC 9420 §2.1.2** ("The following figure adapts the
pseudocode provided in [RFC9000] to add a check for minimum-length encoding"):

```
ReadVarint(data):
  // The length of variable-length integers is encoded in the
  // first two bits of the first byte.
  v = data.next_byte()
  prefix = v >> 6
  if prefix == 3:
    raise Exception('invalid variable length integer prefix')

  length = 1 << prefix

  // Once the length is known, remove these bits and read any
  // remaining bytes.
  v = v & 0x3f
  repeat length-1 times:
    v = (v << 8) + data.next_byte()

  // Check if the value would fit in half the provided length.
  if prefix >= 1 && v < (1 << (8*(length/2) - 2)):
    raise Exception('minimum encoding was not used')

  return v
```

Encoder (the inverse; the RFC gives only the decoder, but the "smallest number of
bits" rule fixes the encoder uniquely):

```
WriteVarint(v):
  if v <= 63:          emit 1 byte:  0x00 | v
  else if v <= 16383:  emit 2 bytes: 0x40 | (v >> 8), v & 0xff
  else if v <= 1073741823:
                       emit 4 bytes: 0x80 | (v >> 24), (v>>16)&0xff, (v>>8)&0xff, v&0xff
  else: error
```

> RFC 9420 §2.1.2: "The use of variable-size integers for vector lengths allows
> vectors to grow very large, up to 2^30 bytes. Implementations should take care
> not to allow vectors to overflow available storage."

**THE MOST IMPORTANT SUBTLETY IN THIS FILE.** The vector length header counts
**bytes of the encoded element sequence, not the number of elements**. This is the
plain TLS presentation-language rule (RFC 9420 §2.1.2: "vectors are encoded as a
sequence of encoded elements prefixed with a length. The length field has a fixed
size set by specifying the minimum and maximum lengths of the *encoded sequence of
elements*"). So:

* `opaque identity<V>` — varint(N) followed by N raw bytes. Element size 1, so
  here byte count == element count.
* `uint32 unmerged_leaves<V>` with 3 leaves — varint(**12**), then 3x4 bytes.
* `Extension extensions<V>` with 2 extensions — varint(total encoded byte size of
  both `Extension` structs), then the two structs.
* `optional<Node> ratchet_tree<V>` — varint(total encoded byte size), then the
  entries.

Consequently the **decoder for a vector of structs must be length-driven**: read
the byte length L, then repeatedly parse elements until exactly L bytes have been
consumed (and error out if an element straddles the boundary). You cannot know the
element count in advance.

Recommended TS primitive shape:

```ts
writeVector(items, writeItem)   // serialise items into a scratch buffer, prefix its byte length as varint
readVector(reader, readItem)    // read varint L, sub-reader over L bytes, loop readItem until exhausted
writeOpaque(bytes)              // varint(bytes.length) || bytes
readOpaque(reader)              // varint L, then L bytes
```

`<V>` is the **only** vector form used by real MLS structs. The `<0..255>` form
appears only in the illustrative `StructWithVectors` example in §2.1.2; you never
need it.

### 1.5 `optional<T>` (RFC 9420 §2.1.1)

> RFC 9420 §2.1.1: "An optional value is encoded with a presence-signaling octet,
> followed by the value itself if present. When decoding, a presence octet with a
> value other than 0 or 1 MUST be rejected as malformed."
>
> ```
> struct {
>     uint8 present;
>     select (present) {
>         case 0: struct{};
>         case 1: T value;
>     };
> } optional<T>;
> ```

So: one byte `0x00` (absent, nothing follows) or `0x01` followed by the encoded
`T`. Any other first byte is a parse error.

`optional<T>` occurs in: `Commit.path` (`optional<UpdatePath>`),
`GroupSecrets.path_secret` (`optional<PathSecret>`),
`LeafNodeHashInput.leaf_node` (`optional<LeafNode>`),
`ParentNodeHashInput.parent_node` (`optional<ParentNode>`),
and the ratchet-tree extension body `optional<Node> ratchet_tree<V>`.

### 1.6 `select` / variants

```
struct {
    ContentType content_type;
    select (FramedContent.content_type) {
        case application:  opaque application_data<V>;
        ...
    };
} FramedContent;
```

The discriminant field is serialised normally, then the selected arm's fields
follow inline. `struct{}` means **nothing is written** for that arm (zero bytes) —
this matters for `Sender` (`new_member_commit` / `new_member_proposal` write only
the 1-byte sender type), for `LeafNode` with `leaf_node_source == update`, and for
`FramedContentAuthData` on non-commit content.

Note the RFC writes the discriminant expression with the *outer* struct name
(`select (Credential.credential_type)` inside `Credential`,
`select (PrivateMessage.content_type)` inside `PrivateMessageContent`). Where the
name refers to a different struct (`PrivateMessage`, `MLSMessage`) the discriminant
is **not** re-encoded inside the inner struct; it comes from the enclosing message.
`PrivateMessageContent` is the important case: its content type comes from
`PrivateMessage.content_type`, which is in the cleartext header.

### 1.7 Signed structs — the general shape

MLS never signs a "message" directly. Every signature is
`SignWithLabel(key, "<Label>", <TBS-struct serialisation>)`, where the TBS struct
is a *separate* struct that repeats the signed fields (see `02-MLS-Crypto.md` §4).
The four labels are exactly (RFC 9420 §17.6, "MLS Signature Labels" registry):

```
"FramedContentTBS"    "LeafNodeTBS"    "KeyPackageTBS"    "GroupInfoTBS"
```

The per-struct signing notes are given with each struct below.

---

## 2. Registered constants

### 2.1 `ProtocolVersion` (RFC 9420 §6)

```
enum {
    reserved(0),
    mls10(1),
    (65535)
} ProtocolVersion;
```

`mls10 = 1`, encoded as **uint16** `0x0001`.

### 2.2 `ContentType` (RFC 9420 §6)

```
enum {
    reserved(0),
    application(1),
    proposal(2),
    commit(3),
    (255)
} ContentType;
```

uint8: `application = 1`, `proposal = 2`, `commit = 3`.

### 2.3 `SenderType` (RFC 9420 §6)

```
enum {
    reserved(0),
    member(1),
    external(2),
    new_member_proposal(3),
    new_member_commit(4),
    (255)
} SenderType;
```

uint8: `member = 1`, `external = 2`, `new_member_proposal = 3`, `new_member_commit = 4`.

### 2.4 `WireFormat` (RFC 9420 §6, values from §17.2 "MLS Wire Formats")

`uint16 WireFormat;`

```
| 0x0000 | RESERVED            |
| 0x0001 | mls_public_message  |
| 0x0002 | mls_private_message |
| 0x0003 | mls_welcome         |
| 0x0004 | mls_group_info      |
| 0x0005 | mls_key_package     |
| 0xF000 - 0xFFFF | Reserved for Private Use |
```

### 2.5 `CipherSuite` (RFC 9420 §17.1)

`uint16 CipherSuite;` — values in `02-MLS-Crypto.md` §1. The two that matter:
`0x0001 MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`,
`0x0003 MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519`.

### 2.6 `ProposalType` (RFC 9420 §12.1, values from §17.4)

`uint16 ProposalType;`

```
| 0x0001 | add                      | Ext: Y | Path Required: N |
| 0x0002 | update                   | Ext: N | Path Required: Y |
| 0x0003 | remove                   | Ext: Y | Path Required: Y |
| 0x0004 | psk                      | Ext: Y | Path Required: N |
| 0x0005 | reinit                   | Ext: Y | Path Required: N |
| 0x0006 | external_init            | Ext: N | Path Required: Y |
| 0x0007 | group_context_extensions | Ext: Y | Path Required: Y |
```

"Ext" = may be sent by an external sender (§12.1.8). "Path Required" = a Commit
covering such a proposal MUST populate `path` (§12.4).

### 2.7 `ExtensionType` (RFC 9420 §7.2, values from §17.3)

`uint16 ExtensionType;`

```
| 0x0001 | application_id        | in LeafNode        |
| 0x0002 | ratchet_tree          | in GroupInfo       |
| 0x0003 | required_capabilities | in GroupContext    |
| 0x0004 | external_pub          | in GroupInfo       |
| 0x0005 | external_senders      | in GroupContext    |
```

### 2.8 `CredentialType` (RFC 9420 §5.3, values from §17.5)

`uint16 CredentialType;` — `basic = 0x0001`, `x509 = 0x0002`.

### 2.9 `NodeType` (RFC 9420 §7.8)

```
enum {
    reserved(0),
    leaf(1),
    parent(2),
    (255)
} NodeType;
```

uint8: `leaf = 1`, `parent = 2`.

### 2.10 `LeafNodeSource` (RFC 9420 §7.2)

```
enum {
    reserved(0),
    key_package(1),
    update(2),
    commit(3),
    (255)
} LeafNodeSource;
```

uint8: `key_package = 1`, `update = 2`, `commit = 3`.

### 2.11 `PSKType` and `ResumptionPSKUsage` (RFC 9420 §8.4)

```
enum {
  reserved(0),
  external(1),
  resumption(2),
  (255)
} PSKType;

enum {
  reserved(0),
  application(1),
  reinit(2),
  branch(3),
  (255)
} ResumptionPSKUsage;
```

Both uint8.

### 2.12 `ProposalOrRefType` (RFC 9420 §12.4)

```
enum {
  reserved(0),
  proposal(1),
  reference(2),
  (255)
} ProposalOrRefType;
```

uint8: `proposal = 1`, `reference = 2`.

### 2.13 GREASE values (RFC 9420 §13.5)

Reserved in every registry: `0x0A0A, 0x1A1A, 0x2A2A, 0x3A3A, 0x4A4A, 0x5A5A,
0x6A6A, 0x7A7A, 0x8A8A, 0x9A9A, 0xAAAA, 0xBABA, 0xCACA, 0xDADA, 0xEAEA`.

> RFC 9420 §13.5: "Clients MUST NOT implement any special processing rules for how
> to handle these values when receiving them, since this negates their utility for
> detecting extensibility failures."

Meaning: your parser must simply tolerate unknown values in
`LeafNode.capabilities.*`, `LeafNode.extensions`, `KeyPackage.extensions`,
`GroupInfo.extensions`. GREASE values MUST NOT be sent in
`Proposal.proposal_type`, `Credential.credential_type`, `GroupContext.extensions`,
`GroupContextExtensions.extensions` (§13.5).

---

## 3. The structs, in dependency order

Each entry gives the verbatim RFC definition, the RFC section, and whether/how the
struct is signed.

### 3.1 `Certificate` (RFC 9420 §5.3)

```
struct {
    opaque cert_data<V>;
} Certificate;
```

> RFC 9420 §5.3: "For an X.509 credential, each entry in the certificates field
> represents a single DER-encoded X.509 certificate. The chain is ordered such that
> the first entry (certificates[0]) is the end-entity certificate. The public key
> encoded in the subjectPublicKeyInfo of the end-entity certificate MUST be
> identical to the signature_key in the LeafNode containing this credential. A
> chain MAY omit any non-leaf certificates that supported peers are known to
> already possess."

Not signed on its own.

### 3.2 `Credential` (RFC 9420 §5.3)

```
// See the "MLS Credential Types" IANA registry for values
uint16 CredentialType;

struct {
    CredentialType credential_type;
    select (Credential.credential_type) {
        case basic:
            opaque identity<V>;

        case x509:
            Certificate certificates<V>;
    };
} Credential;
```

**"BasicCredential"** is not a separate struct in RFC 9420 — it is the
`case basic:` arm, i.e. `uint16(0x0001) || varint(len) || identity`. (Earlier MLS
drafts had a `BasicCredential` struct; RFC 9420 inlines it. Do not invent one.)

> RFC 9420 §5.3: "A "basic" credential is a bare assertion of an identity, without
> any additional information. The format of the encoded identity is defined by the
> application."

Not signed on its own; it is covered by `LeafNodeTBS`.

### 3.3 `HPKEPublicKey`, `SignaturePublicKey` (RFC 9420 §5.1.1)

```
opaque HPKEPublicKey<V>;

opaque SignaturePublicKey<V>;
```

Both are just `<V>`-prefixed opaque byte strings.

> RFC 9420 §5.1.1: "HPKE public keys are opaque values in a format defined by the
> underlying protocol (see Section 4 of [RFC9180] for more information)."
>
> "For cipher suites using the Edwards-curve Digital Signature Algorithm (EdDSA)
> signature schemes (Ed25519 or Ed448), the public key is in the format specified
> in [RFC8032]."
>
> "For cipher suites using the Elliptic Curve Digital Signature Algorithm (ECDSA)
> with the NIST curves (P-256, P-384, or P-521), the public key is represented as
> an encoded UncompressedPointRepresentation struct, as defined in [RFC8446]."

For ciphersuites 0x0001/0x0003 the HPKE public key is a raw 32-byte X25519 public
key (RFC 9180 §7.1.1: SerializePublicKey for X25519 is the identity function), and
the signature public key is a raw 32-byte Ed25519 public key. Both then carry the
`<V>` length prefix (`0x20` for 32 bytes).

Signature encoding (RFC 9420 §5.1.2): "The signatures used in this document are
encoded as specified in [RFC8446]. In particular, ECDSA signatures are DER
encoded, and EdDSA signatures are defined as the concatenation of R and S, as
specified in [RFC8032]." So Ed25519 signatures are the raw 64 bytes, carried in an
`opaque signature<V>` field.

### 3.4 `Capabilities` (RFC 9420 §7.2)

```
struct {
    ProtocolVersion versions<V>;
    CipherSuite cipher_suites<V>;
    ExtensionType extensions<V>;
    ProposalType proposals<V>;
    CredentialType credentials<V>;
} Capabilities;
```

All five are vectors of uint16 values, each with a **byte-length** varint header
(so 3 versions -> varint(6)).

> RFC 9420 §7.2: "The following proposal and extension types are considered
> "default" and MUST NOT be listed:
>
> *  Proposal types: 0x0001 add, 0x0002 update, 0x0003 remove, 0x0004 psk,
>    0x0005 reinit, 0x0006 external_init, 0x0007 group_context_extensions
> *  Extension types: 0x0001 application_id, 0x0002 ratchet_tree,
>    0x0003 required_capabilities, 0x0004 external_pub, 0x0005 external_senders
>
> There are no default values for the other fields of a capabilities object. The
> client MUST list all values for the respective parameters that it supports."
>
> "The types of any non-default extensions that appear in the extensions field of a
> LeafNode MUST be included in the extensions field of the capabilities field, and
> the credential type used in the LeafNode MUST be included in the credentials
> field of the capabilities field."

So for a plain client: `versions = [mls10]`, `cipher_suites = [the suites you
implement]`, `extensions = []`, `proposals = []`, `credentials = [basic]` (add
`x509` if you support it).

### 3.5 `Lifetime` (RFC 9420 §7.2)

```
struct {
    uint64 not_before;
    uint64 not_after;
} Lifetime;
```

> RFC 9420 §7.2: "These times are represented as absolute times, measured in
> seconds since the Unix epoch (1970-01-01T00:00:00Z). Applications MUST define a
> maximum total lifetime that is acceptable for a LeafNode, and reject any LeafNode
> where the total lifetime is longer than this duration."

Both fields are `bigint` (seconds, not milliseconds).

### 3.6 `Extension` (RFC 9420 §7.2)

```
// See the "MLS Extension Types" IANA registry for values
uint16 ExtensionType;

struct {
    ExtensionType extension_type;
    opaque extension_data<V>;
} Extension;
```

`extension_data` is the serialisation of the extension's own body:

| extension | body |
|---|---|
| `application_id` (0x0001) | `opaque application_id<V>;` (RFC 9420 §5.3.3) |
| `ratchet_tree` (0x0002) | `optional<Node> ratchet_tree<V>;` (§12.4.3.3) |
| `required_capabilities` (0x0003) | `RequiredCapabilities` (§11.1) |
| `external_pub` (0x0004) | `ExternalPub` (§12.4.3.2) |
| `external_senders` (0x0005) | `ExternalSender external_senders<V>;` (§12.1.8.1) |

> RFC 9420 §13.4: "Any field containing a list of extensions MUST NOT have more
> than one extension of any given type."

### 3.7 `RequiredCapabilities` (RFC 9420 §11.1)

```
struct {
    ExtensionType extension_types<V>;
    ProposalType proposal_types<V>;
    CredentialType credential_types<V>;
} RequiredCapabilities;
```

> RFC 9420 §11.1: "This extension lists the extensions, proposals, and credential
> types that must be supported by all members of the group. The "default" proposal
> and extension types defined in this document are assumed to be implemented by all
> clients, and need not be listed in RequiredCapabilities in order to be safely
> used. Note that this is not true for credential types."

Lives in `GroupContext.extensions`.

### 3.8 `ExternalSender` (RFC 9420 §12.1.8.1)

```
struct {
  SignaturePublicKey signature_key;
  Credential credential;
} ExternalSender;

ExternalSender external_senders<V>;
```

The `external_senders` GroupContext extension body is the vector
`ExternalSender external_senders<V>`. `Sender.sender_index` for
`sender_type == external` indexes into this vector (RFC 9420 §6.1).

### 3.9 `ExternalPub` (RFC 9420 §12.4.3.2)

```
struct {
    HPKEPublicKey external_pub;
} ExternalPub;
```

The `external_pub` GroupInfo extension body. Required for external Commits.

### 3.10 `LeafNode` and `LeafNodeTBS` (RFC 9420 §7.2)

```
struct {
    HPKEPublicKey encryption_key;
    SignaturePublicKey signature_key;
    Credential credential;
    Capabilities capabilities;

    LeafNodeSource leaf_node_source;
    select (LeafNode.leaf_node_source) {
        case key_package:
            Lifetime lifetime;

        case update:
            struct{};

        case commit:
            opaque parent_hash<V>;
    };

    Extension extensions<V>;
    /* SignWithLabel(., "LeafNodeTBS", LeafNodeTBS) */
    opaque signature<V>;
} LeafNode;

struct {
    HPKEPublicKey encryption_key;
    SignaturePublicKey signature_key;
    Credential credential;
    Capabilities capabilities;

    LeafNodeSource leaf_node_source;
    select (LeafNodeTBS.leaf_node_source) {
        case key_package:
            Lifetime lifetime;

        case update:
            struct{};

        case commit:
            opaque parent_hash<V>;
    };

    Extension extensions<V>;

    select (LeafNodeTBS.leaf_node_source) {
        case key_package:
            struct{};

        case update:
            opaque group_id<V>;
            uint32 leaf_index;

        case commit:
            opaque group_id<V>;
            uint32 leaf_index;
    };
} LeafNodeTBS;
```

**Signed.** `LeafNode.signature = SignWithLabel(sig_priv, "LeafNodeTBS",
LeafNodeTBS)`, verified with `LeafNode.signature_key`.

`LeafNodeTBS` is byte-for-byte the `LeafNode` prefix up to (not including)
`signature`, **plus**, for `update` and `commit` sources only, a trailing
`group_id<V> || uint32 leaf_index`. So in code you can serialise the leaf-node
prefix once and append the group context suffix.

> RFC 9420 §7.2: "The leaf_node_source field indicates how this LeafNode came to be
> added to the tree. This signal tells other members of the group whether the leaf
> node is required to have a lifetime or parent_hash, and whether the group_id is
> added as context to the signature. These fields are included selectively because
> the client creating a LeafNode is not always able to compute all of them. For
> example, a KeyPackage is created before the client knows which group it will be
> used with, so its signature can't bind to a group_id."
>
> "LeafNode objects stored in the group's ratchet tree are updated according to the
> evolution of the tree. Each modification of LeafNode content MUST be reflected by
> a change in its signature."

Where each source is used:

* `key_package (1)` — the `LeafNode` inside a `KeyPackage` (RFC 9420 §10: "The
  field leaf_node.leaf_node_source of the LeafNode in a KeyPackage MUST be set to
  key_package.").
* `update (2)` — the `LeafNode` inside an `Update` proposal.
* `commit (3)` — the `LeafNode` inside `UpdatePath.leaf_node`.

### 3.11 `KeyPackage` and `KeyPackageTBS` (RFC 9420 §10)

```
struct {
    ProtocolVersion version;
    CipherSuite cipher_suite;
    HPKEPublicKey init_key;
    LeafNode leaf_node;
    Extension extensions<V>;
    /* SignWithLabel(., "KeyPackageTBS", KeyPackageTBS) */
    opaque signature<V>;
} KeyPackage;

struct {
    ProtocolVersion version;
    CipherSuite cipher_suite;
    HPKEPublicKey init_key;
    LeafNode leaf_node;
    Extension extensions<V>;
} KeyPackageTBS;
```

**Signed.** `KeyPackage.signature = SignWithLabel(sig_priv, "KeyPackageTBS",
KeyPackageTBS)`.

> RFC 9420 §10: "The signature is computed by the function SignWithLabel with a
> label "KeyPackageTBS" and a Content input comprising all of the fields except for
> the signature field."
>
> "The value for init_key MUST be a public key for the asymmetric encryption scheme
> defined by cipher_suite, and it MUST be unique among the set of KeyPackages
> created by this client."
>
> "A KeyPackage object with an invalid signature field MUST be considered
> malformed."

The verification key is the one in `leaf_node.signature_key` (RFC 9420 §10.1:
"Verify that the signature on the KeyPackage is valid using the public key in
leaf_node.credential."). Note the RFC prose says "the public key in
leaf_node.credential" while the key actually carried in the leaf is
`leaf_node.signature_key`; for a basic credential these are the same key — the
credential *asserts* an identity for `signature_key`. Use `leaf_node.signature_key`.

`init_key` is a *separate* HPKE key from `leaf_node.encryption_key`:

> RFC 9420 §10.1: "Verify that the value of leaf_node.encryption_key is different
> from the value of the init_key field."

`init_key` decrypts the `Welcome`; `encryption_key` is the leaf's ratchet-tree key.

### 3.12 `ParentNode` (RFC 9420 §7.1)

```
struct {
    HPKEPublicKey encryption_key;
    opaque parent_hash<V>;
    uint32 unmerged_leaves<V>;
} ParentNode;
```

> RFC 9420 §7.1: "The encryption_key field contains an HPKE public key whose
> private key is held only by the members at the leaves among its descendants. The
> parent_hash field contains a hash of this node's parent node, as described in
> Section 7.9. The unmerged_leaves field lists the leaves under this parent node
> that are unmerged, according to their indices among all the leaves in the tree.
> The entries in the unmerged_leaves vector MUST be sorted in increasing order."

Reminder: `unmerged_leaves<V>` is a *byte*-length-prefixed vector of `uint32`
values.

Not signed. Its integrity comes from the tree hash + parent hash chain.

### 3.13 `Node` and the ratchet tree (RFC 9420 §12.4.3.3)

```
struct {
    NodeType node_type;
    select (Node.node_type) {
        case leaf:   LeafNode leaf_node;
        case parent: ParentNode parent_node;
    };
} Node;

optional<Node> ratchet_tree<V>;
```

> RFC 9420 §12.4.3.3: "Each entry in the ratchet_tree vector provides the value for
> a node in the tree, or the null optional for a blank node."
>
> "The nodes are listed in the order specified by a left-to-right in-order
> traversal of the ratchet tree. Each node is listed between its left subtree and
> its right subtree. (This is the same ordering as specified for the array-based
> trees outlined in Appendix C.)"
>
> "If the tree has 2^d leaves, then it has 2^(d+1) - 1 nodes. The ratchet_tree
> vector logically has this number of entries, but the sender MUST NOT include
> blank nodes after the last non-blank node. The receiver MUST check that the last
> node in ratchet_tree is non-blank, and then extend the tree to the right until it
> has a length of the form 2^(d+1) - 1, adding the minimum number of blank values
> possible."
>
> "The leaves of the tree are stored in even-numbered entries in the array (the
> leaf with index L in array position 2*L). The root node of the tree is at
> position 2^d - 1 of the array."

Decoding a `ratchet_tree` extension body: read `optional<Node> ratchet_tree<V>`
(byte-length-prefixed), reject if the last entry is absent, then right-pad with
blanks to `2^(d+1) - 1` entries. A node at an even array index must be a `leaf`
node and a node at an odd index must be a `parent` node — the RFC does not state
this as a MUST, but it follows from the traversal order, and mismatches have to be
rejected as malformed.

> RFC 9420 §12.4.3.3: "Regardless of how the client obtains the tree, the client
> MUST verify that the root hash of the ratchet tree matches the tree_hash of the
> GroupContext before using the tree for MLS operations."

### 3.14 `GroupContext` (RFC 9420 §8.1)

```
struct {
    ProtocolVersion version = mls10;
    CipherSuite cipher_suite;
    opaque group_id<V>;
    uint64 epoch;
    opaque tree_hash<V>;
    opaque confirmed_transcript_hash<V>;
    Extension extensions<V>;
} GroupContext;
```

`version = mls10` still occupies 2 bytes on the wire (value `0x0001`).

> RFC 9420 §8.1 semantics: "The cipher_suite is the cipher suite used by the group.
> The group_id field is an application-defined identifier for the group. The epoch
> field represents the current version of the group. The tree_hash field contains a
> commitment to the contents of the group's ratchet tree and the credentials for
> the members of the group, as described in Section 7.8. The confirmed_transcript_hash
> field contains a running hash over the messages that led to this state. The
> extensions field contains the details of any protocol extensions that apply to
> the group."
>
> "*  The group_id field is constant.
> *  The epoch field increments by one for each Commit message that is processed.
> *  The tree_hash is updated to represent the current tree and credentials.
> *  The confirmed_transcript_hash field is updated with the data for an
>    AuthenticatedContent encoding a Commit message.
> *  The extensions field changes when a GroupContextExtensions proposal is
>    committed."

Not signed itself; it is included in `FramedContentTBS` (member/new_member_commit
senders), in `GroupInfoTBS`, and as the HPKE `context` for `UpdatePathNode`
encryption.

### 3.15 `GroupInfo` and `GroupInfoTBS` (RFC 9420 §12.4.3)

```
struct {
    GroupContext group_context;
    Extension extensions<V>;
    MAC confirmation_tag;
    uint32 signer;
    /* SignWithLabel(., "GroupInfoTBS", GroupInfoTBS) */
    opaque signature<V>;
} GroupInfo;

struct {
    GroupContext group_context;
    Extension extensions<V>;
    MAC confirmation_tag;
    uint32 signer;
} GroupInfoTBS;
```

**Signed.** `GroupInfo.signature = SignWithLabel(sig_priv, "GroupInfoTBS",
GroupInfoTBS)`.

> RFC 9420 §12.4.3: "New members also MUST verify the signature using the public
> key taken from the leaf node of the ratchet tree with leaf index signer. The
> signature covers the following structure, comprising all the fields in the
> GroupInfo above signature."
>
> "The confirmation_tag represents the confirmation tag from the Commit that
> initiated the current epoch, or for epoch 0, the confirmation tag computed in the
> creation of the group (see Section 11). (In either case, the creator of a
> GroupInfo may recompute the confirmation tag as MAC(confirmation_key,
> confirmed_transcript_hash).)"
>
> "As discussed in Section 13, unknown extensions in GroupInfo.extensions MUST be
> ignored ... Extensions in GroupInfo.group_context.extensions, however, MUST be
> supported by the new joiner."

`GroupInfo.extensions` is where `ratchet_tree` (0x0002) and `external_pub`
(0x0004) live. `GroupInfo.group_context.extensions` is where
`required_capabilities` (0x0003) and `external_senders` (0x0005) live.

### 3.16 `PathSecret`, `GroupSecrets`, `EncryptedGroupSecrets`, `Welcome` (RFC 9420 §12.4.3.1)

```
struct {
  opaque path_secret<V>;
} PathSecret;

struct {
  opaque joiner_secret<V>;
  optional<PathSecret> path_secret;
  PreSharedKeyID psks<V>;
} GroupSecrets;

struct {
  KeyPackageRef new_member;
  HPKECiphertext encrypted_group_secrets;
} EncryptedGroupSecrets;

struct {
  CipherSuite cipher_suite;
  EncryptedGroupSecrets secrets<V>;
  opaque encrypted_group_info<V>;
} Welcome;
```

> RFC 9420 §12.4.3.1:
> ```
> encrypted_group_secrets =
>   EncryptWithLabel(init_key, "Welcome",
>                    encrypted_group_info, group_secrets)
>
> group_secrets =
>   DecryptWithLabel(init_key_priv, "Welcome",
>                    encrypted_group_info, kem_output, ciphertext)
> ```

Note the ordering dependency: `encrypted_group_info` is the HPKE **context** for
every `EncryptedGroupSecrets`, so the committer must produce `encrypted_group_info`
*first*, then encrypt each `GroupSecrets`. The context value is the byte string
that ends up in the `Welcome.encrypted_group_info` field (its own `<V>` prefix
belongs to the `Welcome` struct and is not part of the context bytes; the
`EncryptContext.context<V>` field re-prefixes it).

Nothing in `Welcome` is signed. Its authenticity comes from the `GroupInfo`
signature inside `encrypted_group_info` and from the `confirmation_tag` check.

### 3.17 `PreSharedKeyID` and `PSKLabel` (RFC 9420 §8.4)

```
struct {
  PSKType psktype;
  select (PreSharedKeyID.psktype) {
    case external:
      opaque psk_id<V>;

    case resumption:
      ResumptionPSKUsage usage;
      opaque psk_group_id<V>;
      uint64 psk_epoch;
  };
  opaque psk_nonce<V>;
} PreSharedKeyID;

struct {
    PreSharedKeyID id;
    uint16 index;
    uint16 count;
} PSKLabel;
```

`psk_nonce` is written **after** the variant arm, for both variants.

> RFC 9420 §8.4: "Each time a client injects a PSK into a group, the psk_nonce of
> its PreSharedKeyID MUST be set to a fresh random value of length KDF.Nh."

### 3.18 `HPKECiphertext` (RFC 9420 §7.6)

```
struct {
    opaque kem_output<V>;
    opaque ciphertext<V>;
} HPKECiphertext;
```

`kem_output` is the HPKE `enc` (32 bytes for DHKEM(X25519, HKDF-SHA256)),
`ciphertext` is the AEAD output including the 16-byte tag.

### 3.19 `UpdatePathNode`, `UpdatePath` (RFC 9420 §7.6)

```
struct {
    HPKEPublicKey encryption_key;
    HPKECiphertext encrypted_path_secret<V>;
} UpdatePathNode;

struct {
    LeafNode leaf_node;
    UpdatePathNode nodes<V>;
} UpdatePath;
```

> RFC 9420 §7.6: "As described in Section 12.4, each Commit message may optionally
> contain an UpdatePath, with a new LeafNode and set of parent nodes for the
> sender's filtered direct path. For each parent node, the UpdatePath contains a
> new public key and encrypted path secret. The parent nodes are kept in the same
> order as the filtered direct path."
>
> "For each UpdatePathNode, the resolution of the corresponding copath node MUST
> exclude all new leaf nodes added as part of the current Commit. The length of the
> encrypted_path_secret vector MUST be equal to the length of the resolution of the
> copath node (excluding new leaf nodes), with each ciphertext being the encryption
> to the respective resolution node."
>
> ```
> (kem_output, ciphertext) =
>   EncryptWithLabel(node_public_key, "UpdatePathNode",
>                    group_context, path_secret)
>
> path_secret =
>   DecryptWithLabel(node_private_key, "UpdatePathNode",
>                    group_context, kem_output, ciphertext)
> ```
>
> "Here node_public_key is the public key of the node for which the path secret is
> encrypted, group_context is the provisional GroupContext object for the group,
> and the EncryptWithLabel function is as defined in Section 5.1.3."

`UpdatePath.leaf_node` is a `LeafNode` with `leaf_node_source == commit` (so it
carries `parent_hash`), signed with `"LeafNodeTBS"` over a `LeafNodeTBS` that
includes `group_id` and the committer's `leaf_index`.

The ordering is leaf -> root: `nodes[0]` is the first node of the committer's
filtered direct path (the lowest one), `nodes[n-1]` is the root.
`encrypted_path_secret` can legitimately be an empty vector (see
`03-MLS-Protocol-Flow.md` §6).

### 3.20 Proposal variants (RFC 9420 §12.1.1 – §12.1.7)

```
struct {
    KeyPackage key_package;
} Add;

struct {
    LeafNode leaf_node;
} Update;

struct {
    uint32 removed;
} Remove;

struct {
    PreSharedKeyID psk;
} PreSharedKey;

struct {
    opaque group_id<V>;
    ProtocolVersion version;
    CipherSuite cipher_suite;
    Extension extensions<V>;
} ReInit;

struct {
  opaque kem_output<V>;
} ExternalInit;

struct {
  Extension extensions<V>;
} GroupContextExtensions;
```

`Remove.removed` is a **leaf index**, not a node index (RFC 9420 §12.1.3: "A Remove
proposal requests that the member with the leaf index removed be removed from the
group.").

### 3.21 `Proposal` (RFC 9420 §12.1)

```
// See the "MLS Proposal Types" IANA registry for values
uint16 ProposalType;

struct {
    ProposalType proposal_type;
    select (Proposal.proposal_type) {
        case add:                      Add;
        case update:                   Update;
        case remove:                   Remove;
        case psk:                      PreSharedKey;
        case reinit:                   ReInit;
        case external_init:            ExternalInit;
        case group_context_extensions: GroupContextExtensions;
    };
} Proposal;
```

### 3.22 `ProposalOrRef`, `Commit` (RFC 9420 §12.4)

```
enum {
  reserved(0),
  proposal(1),
  reference(2),
  (255)
} ProposalOrRefType;

struct {
  ProposalOrRefType type;
  select (ProposalOrRef.type) {
    case proposal:  Proposal proposal;
    case reference: ProposalRef reference;
  };
} ProposalOrRef;

struct {
    ProposalOrRef proposals<V>;
    optional<UpdatePath> path;
} Commit;
```

> RFC 9420 §12.4: "Commits that refer to new Proposals from the committer can be
> included by value. Commits for previously sent proposals from anyone (including
> the committer) can be sent by reference. Proposals sent by reference are specified
> by including the hash of the AuthenticatedContent object in which the proposal was
> sent (see Section 5.2)."

### 3.23 `Sender` (RFC 9420 §6)

```
struct {
    SenderType sender_type;
    select (Sender.sender_type) {
        case member:
            uint32 leaf_index;
        case external:
            uint32 sender_index;
        case new_member_commit:
        case new_member_proposal:
            struct{};
    };
} Sender;
```

`member` and `external` are 5 bytes; `new_member_commit` and
`new_member_proposal` are 1 byte.

### 3.24 `FramedContent` (RFC 9420 §6)

```
struct {
    opaque group_id<V>;
    uint64 epoch;
    Sender sender;
    opaque authenticated_data<V>;

    ContentType content_type;
    select (FramedContent.content_type) {
        case application:
          opaque application_data<V>;
        case proposal:
          Proposal proposal;
        case commit:
          Commit commit;
    };
} FramedContent;
```

Note the field order: `authenticated_data` comes **before** `content_type`.

### 3.25 `FramedContentTBS` (RFC 9420 §6.1)

```
struct {
    ProtocolVersion version = mls10;
    WireFormat wire_format;
    FramedContent content;
    select (FramedContentTBS.content.sender.sender_type) {
        case member:
        case new_member_commit:
            GroupContext context;
        case external:
        case new_member_proposal:
            struct{};
    };
} FramedContentTBS;
```

> RFC 9420 §6.1: "The signature is computed using SignWithLabel with label
> "FramedContentTBS" and with a content that covers the message content and the
> wire format that will be used for this message. If the sender's sender_type is
> member, the content also covers the GroupContext for the current epoch so that
> signatures are specific to a given group and epoch."

`wire_format` is part of the signature, so a `PublicMessage` cannot be re-framed as
a `PrivateMessage` (or vice versa) without breaking the signature.

Which GroupContext: the one for the **epoch the message is sent in**, i.e. the
current (old) GroupContext for a Commit, not the new one (RFC 9420 §12.4.1:
"Construct a FramedContent object containing the Commit object. Sign the
FramedContent using the old GroupContext as context."). For an external Commit
(`new_member_commit`), the context is the GroupContext from the `GroupInfo` the
joiner used.

### 3.26 `FramedContentAuthData`, `MAC` (RFC 9420 §6.1)

```
opaque MAC<V>;

struct {
    /* SignWithLabel(., "FramedContentTBS", FramedContentTBS) */
    opaque signature<V>;
    select (FramedContent.content_type) {
        case commit:
            /*
              MAC(confirmation_key,
                  GroupContext.confirmed_transcript_hash)
            */
            MAC confirmation_tag;
        case application:
        case proposal:
            struct{};
    };
} FramedContentAuthData;
```

> RFC 9420 §6.1: "The sender MUST use the private key corresponding to the
> following signature key depending on the sender's sender_type:
>
> *  member: The signature key contained in the LeafNode at the index indicated by
>    leaf_index in the ratchet tree.
> *  external: The signature key at the index indicated by sender_index in the
>    external_senders group context extension (see Section 12.1.8.1). The
>    content_type of the message MUST be proposal and the proposal_type MUST be a
>    value that is allowed for external senders.
> *  new_member_commit: The signature key in the LeafNode in the Commit's path (see
>    Section 12.4.3.2). The content_type of the message MUST be commit.
> *  new_member_proposal: The signature key in the LeafNode in the KeyPackage
>    embedded in an external Add proposal. The content_type of the message MUST be
>    proposal and the proposal_type of the Proposal MUST be add.
>
> Recipients of an MLSMessage MUST verify the signature with the key depending on
> the sender_type of the sender as described above."
>
> "A FramedContentAuthData is said to be valid when both the signature and
> confirmation_tag fields are valid."

The `confirmation_tag` is computed with the **new** epoch's `confirmation_key`
over the **new** epoch's `confirmed_transcript_hash`.

### 3.27 `AuthenticatedContent` (RFC 9420 §6)

```
struct {
    WireFormat wire_format;
    FramedContent content;
    FramedContentAuthData auth;
} AuthenticatedContent;
```

> RFC 9420 §6: "The following structure is used to fully describe the data
> transmitted in plaintexts or ciphertexts."

This is the object you hash to get a `ProposalRef` (RFC 9420 §5.2: "For a
ProposalRef, the value input is the AuthenticatedContent carrying the Proposal.").
It is never sent on the wire as such — it is the internal, unframed form.

### 3.28 `PublicMessage`, `AuthenticatedContentTBM` (RFC 9420 §6.2)

```
struct {
    FramedContent content;
    FramedContentAuthData auth;
    select (PublicMessage.content.sender.sender_type) {
        case member:
            MAC membership_tag;
        case external:
        case new_member_commit:
        case new_member_proposal:
            struct{};
    };
} PublicMessage;

struct {
  FramedContentTBS content_tbs;
  FramedContentAuthData auth;
} AuthenticatedContentTBM;
```

> RFC 9420 §6.2: "The membership_tag field in the PublicMessage object
> authenticates the sender's membership in the group. For messages sent by members,
> it MUST be set to the following value: `membership_tag =
> MAC(membership_key, AuthenticatedContentTBM)`"
>
> "When decoding a PublicMessage into an AuthenticatedContent, the application MUST
> check membership_tag and MUST check that the FramedContentAuthData is valid."

`AuthenticatedContentTBM` embeds the *whole* `FramedContentTBS` again — including
the `version`, `wire_format` and (for members) the `GroupContext` — plus the
already-computed `auth`. So the membership tag covers the signature.

### 3.29 `PrivateMessage`, `PrivateMessageContent`, `PrivateContentAAD` (RFC 9420 §6.3, §6.3.1)

```
struct {
    opaque group_id<V>;
    uint64 epoch;
    ContentType content_type;
    opaque authenticated_data<V>;
    opaque encrypted_sender_data<V>;
    opaque ciphertext<V>;
} PrivateMessage;

struct {
    select (PrivateMessage.content_type) {
        case application:
          opaque application_data<V>;

        case proposal:
          Proposal proposal;

        case commit:
          Commit commit;
    };

    FramedContentAuthData auth;
    opaque padding[length_of_padding];
} PrivateMessageContent;

struct {
    opaque group_id<V>;
    uint64 epoch;
    ContentType content_type;
    opaque authenticated_data<V>;
} PrivateContentAAD;
```

> RFC 9420 §6.3.1: "The padding field is set by the sender, by first encoding the
> content (via the select) and the auth field, and then appending the chosen number
> of zero bytes. A receiver identifies the padding field in a plaintext decoded from
> PrivateMessage.ciphertext by first decoding the content and the auth field; then
> the padding field comprises any remaining octets of plaintext. The padding field
> MUST be filled with all zero bytes. A receiver MUST verify that there are no
> non-zero bytes in the padding field, and if this check fails, the enclosing
> PrivateMessage MUST be rejected as malformed. This check ensures that the padding
> process is deterministic, so that, for example, padding cannot be used as a covert
> channel."
>
> "When decoding a PrivateMessageContent, the application MUST check that the
> FramedContentAuthData is valid."

`PrivateContentAAD` is exactly the first four fields of `PrivateMessage`, in the
same order, so you can serialise them once and reuse the bytes.

Reconstructing the `FramedContent` for signature verification after decryption:
`group_id`, `epoch`, `authenticated_data`, `content_type` come from the
`PrivateMessage` header; `sender` is `Sender { sender_type: member, leaf_index }`
from the decrypted `SenderData`; the content body comes from
`PrivateMessageContent`.

### 3.30 `SenderData`, `SenderDataAAD` (RFC 9420 §6.3.2)

```
struct {
    uint32 leaf_index;
    uint32 generation;
    opaque reuse_guard[4];
} SenderData;

struct {
    opaque group_id<V>;
    uint64 epoch;
    ContentType content_type;
} SenderDataAAD;
```

`reuse_guard` is a bare 4-byte array — no length prefix. `SenderData` is therefore
always exactly 12 bytes.

> RFC 9420 §6.3.2: "When constructing a SenderData object from a Sender object, the
> sender MUST verify Sender.sender_type is member and use Sender.leaf_index for
> SenderData.leaf_index."
>
> "When parsing a SenderData struct as part of message decryption, the recipient
> MUST verify that the leaf index indicated in the leaf_index field identifies a
> non-blank node."

### 3.31 `MLSMessage` (RFC 9420 §6)

```
struct {
    ProtocolVersion version = mls10;
    WireFormat wire_format;
    select (MLSMessage.wire_format) {
        case mls_public_message:
            PublicMessage public_message;
        case mls_private_message:
            PrivateMessage private_message;
        case mls_welcome:
            Welcome welcome;
        case mls_group_info:
            GroupInfo group_info;
        case mls_key_package:
            KeyPackage key_package;
    };
} MLSMessage;
```

Wire format on the wire: 2 bytes version `0x0001`, 2 bytes wire format, then the
body. This is the outermost object; the media type is `message/mls`
(RFC 9420 §17.10).

> RFC 9420 §10: "If a client receives a KeyPackage carried within an MLSMessage
> object, then it MUST verify that the version field of the KeyPackage has the same
> value as the version field of the MLSMessage."

### 3.32 `KeyPackageRef`, `ProposalRef`, `RefHashInput` (RFC 9420 §5.2)

```
opaque HashReference<V>;

HashReference KeyPackageRef;
HashReference ProposalRef;

MakeKeyPackageRef(value)
  = RefHash("MLS 1.0 KeyPackage Reference", value)

MakeProposalRef(value)
  = RefHash("MLS 1.0 Proposal Reference", value)

RefHash(label, value) = Hash(RefHashInput)
```

> Where RefHashInput is defined as:
> ```
> struct {
>   opaque label<V>;
>   opaque value<V>;
> } RefHashInput;
> ```
> And its fields are set to:
> ```
> label = label;
> value = value;
> ```
>
> RFC 9420 §5.2: "For a KeyPackageRef, the value input is the encoded KeyPackage,
> and the cipher suite specified in the KeyPackage determines the KDF used. For a
> ProposalRef, the value input is the AuthenticatedContent carrying the Proposal.
> In the latter two cases, the KDF is determined by the group's cipher suite."

**RFC ambiguity, flagged.** The prose says "determines the KDF used", but the
definition is `RefHash(label, value) = Hash(RefHashInput)` — a plain hash, not a
KDF. Implement it as `Hash(...)` with the cipher suite's hash function (SHA-256 for
0x0001/0x0003). Wire's server does exactly that (`hashWith a . encodeMLS' $
RefHashInput ctx value` in `libs/wire-api/src/Wire/API/MLS/CipherSuite.hs`). The
labels include the trailing space: `"MLS 1.0 KeyPackage Reference"`,
`"MLS 1.0 Proposal Reference"` — note these already contain the `"MLS 1.0 "`
prefix, unlike `SignWithLabel`/`EncryptWithLabel`/`ExpandWithLabel` where the
prefix is added by the construction.

Also note the sentence "In the latter two cases" is left over from an earlier draft
that listed three cases; there are only two here. Harmless.

`KeyPackageRef` and `ProposalRef` are `opaque<V>` on the wire, so a SHA-256
reference is 33 bytes: `0x20` followed by 32 bytes.

### 3.33 `EncryptContext`, `SignContent` (RFC 9420 §5.1.2, §5.1.3)

```
struct {
    opaque label<V>;
    opaque content<V>;
} SignContent;

struct {
  opaque label<V>;
  opaque context<V>;
} EncryptContext;
```

Both have `label = "MLS 1.0 " + Label`. Full details in `02-MLS-Crypto.md` §4
and §5.

### 3.34 `KDFLabel` (RFC 9420 §8)

```
struct {
    uint16 length;
    opaque label<V>;
    opaque context<V>;
} KDFLabel;
```

`length = Length` (the requested output length in bytes),
`label = "MLS 1.0 " + Label`, `context = Context`. Details in `02-MLS-Crypto.md` §3.

### 3.35 Tree-hash inputs (RFC 9420 §7.8)

```
enum {
    reserved(0),
    leaf(1),
    parent(2),
    (255)
} NodeType;

struct {
  NodeType node_type;
  select (TreeHashInput.node_type) {
    case leaf:   LeafNodeHashInput leaf_node;
    case parent: ParentNodeHashInput parent_node;
  };
} TreeHashInput;

struct {
    uint32 leaf_index;
    optional<LeafNode> leaf_node;
} LeafNodeHashInput;

struct {
    optional<ParentNode> parent_node;
    opaque left_hash<V>;
    opaque right_hash<V>;
} ParentNodeHashInput;
```

> RFC 9420 §7.8: "The tree hash of an individual node is the hash of the node's
> TreeHashInput object, which may contain either a LeafNodeHashInput or a
> ParentNodeHashInput depending on the type of node. LeafNodeHashInput objects
> contain the leaf_index and the LeafNode (if any). ParentNodeHashInput objects
> contain the ParentNode (if any) and the tree hash of the node's left and right
> children. For both parent and leaf nodes, the optional node value MUST be absent
> if the node is blank and present if the node contains a value."

`LeafNodeHashInput.leaf_index` is the **leaf** index (0-based among leaves), not the
array node index.

### 3.36 `ParentHashInput` (RFC 9420 §7.9)

```
struct {
    HPKEPublicKey encryption_key;
    opaque parent_hash<V>;
    opaque original_sibling_tree_hash<V>;
} ParentHashInput;
```

Full computation rules in `02-MLS-Crypto.md` §9.

### 3.37 Transcript-hash inputs (RFC 9420 §8.2)

```
struct {
    WireFormat wire_format;
    FramedContent content; /* with content_type == commit */
    opaque signature<V>;
} ConfirmedTranscriptHashInput;

struct {
    MAC confirmation_tag;
} InterimTranscriptHashInput;
```

Note `ConfirmedTranscriptHashInput` is the `AuthenticatedContent` of the Commit
with the `confirmation_tag` **removed** (only the `signature` from
`FramedContentAuthData` is included). Formulas in `02-MLS-Crypto.md` §7.

---

## 4. Serialisation checklist / gotchas

1. **Vector lengths are byte counts, not element counts.** `unmerged_leaves<V>`,
   `Extension extensions<V>`, `ProposalOrRef proposals<V>`,
   `UpdatePathNode nodes<V>`, `HPKECiphertext encrypted_path_secret<V>`,
   `EncryptedGroupSecrets secrets<V>`, `PreSharedKeyID psks<V>`,
   `optional<Node> ratchet_tree<V>`, `ExternalSender external_senders<V>`,
   `Certificate certificates<V>`, and all `Capabilities` fields.
2. **Varints must be minimally encoded** on both send and receive; a
   non-minimal encoding is a parse error (§2.1.2).
3. **`optional<T>` presence byte must be 0 or 1**; anything else is malformed
   (§2.1.1).
4. `struct{}` arms write **zero bytes**.
5. `uint64` fields need `bigint`.
6. `reuse_guard[4]` has **no** length prefix.
7. `PrivateMessageContent.padding` has no length; it is "the rest", and must be
   all zeros (§6.3.1).
8. `ProtocolVersion` is **2 bytes** even though every other MLS enum with a
   `(255)` bound is 1 byte.
9. `LeafNodeTBS` for `update`/`commit` appends `group_id<V> || uint32 leaf_index`
   after `extensions`.
10. `FramedContentTBS` starts with `version` and `wire_format` before
    `FramedContent`, and appends the `GroupContext` for `member` /
    `new_member_commit` senders only.
11. `PrivateContentAAD` and `SenderDataAAD` are prefixes of `PrivateMessage`'s
    header fields — serialise once, slice twice.
12. `Welcome.encrypted_group_info` must exist **before** the per-member
    `EncryptedGroupSecrets` can be produced (it is the HPKE context).
13. The ratchet-tree extension body must not end in a blank node, and the receiver
    must right-pad to `2^(d+1)-1` entries (§12.4.3.3).
14. Signatures over `*TBS` structs, references over the *encoded object*
    (`KeyPackage` for `KeyPackageRef`, `AuthenticatedContent` for `ProposalRef`) —
    never mix the two.

---

## 5. Array-based tree index arithmetic (RFC 9420 Appendix C, non-normative)

Needed to implement the ratchet-tree extension order, direct paths, copaths and
resolutions. Reproduced verbatim (RFC 9420 Appendix C: "The concrete algorithms are
non-normative. An implementation may use any algorithm that produces the correct
tree in its internal representation.").

> "In this representation, leaf nodes are even-numbered nodes, with the n-th leaf at
> 2*n. Intermediate nodes are held in odd-numbered nodes."
>
> ```
>                            X
>                            |
>                  .---------+---------.
>                 /                     \
>                X                       X
>                |                       |
>            .---+---.               .---+---.
>           /         \             /         \
>          X           X           X           X
>         / \         / \         / \         / \
>        /   \       /   \       /   \       /   \
>       X     X     X     X     X     X     X     X
>
> Node: 0  1  2  3  4  5  6  7  8  9 10 11 12 13 14
>
> Leaf: 0     1     2     3     4     5     6     7
> ```
>
> "The basic rule is that the high-order bits of parent and child nodes indices have
> the following relation (where x is an arbitrary bit string):
> `parent=01x => left=00x, right=10x`"
>
> "Since node relationships are implicit, the algorithms for adding and removing
> nodes at the right edge of the tree are quite simple. If there are N nodes in the
> array:
> *  Add: Append N + 1 blank values to the end of the array.
> *  Remove: Truncate the array to its first (N-1) / 2 entries."

```python
# The exponent of the largest power of 2 less than x. Equivalent to:
#   int(math.floor(math.log(x, 2)))
def log2(x):
    if x == 0:
        return 0

    k = 0
    while (x >> k) > 0:
        k += 1
    return k-1

# The level of a node in the tree. Leaves are level 0, their parents
# are level 1, etc. If a node's children are at different levels,
# then its level is the max level of its children plus one.
def level(x):
    if x & 0x01 == 0:
        return 0

    k = 0
    while ((x >> k) & 0x01) == 1:
        k += 1
    return k

# The number of nodes needed to represent a tree with n leaves.
def node_width(n):
    if n == 0:
        return 0
    else:
        return 2*(n - 1) + 1

# The index of the root node of a tree with n leaves.
def root(n):
    w = node_width(n)
    return (1 << log2(w)) - 1

# The left child of an intermediate node.
def left(x):
    k = level(x)
    if k == 0:
        raise Exception('leaf node has no children')

    return x ^ (0x01 << (k - 1))

# The right child of an intermediate node.
def right(x):
    k = level(x)
    if k == 0:
        raise Exception('leaf node has no children')

    return x ^ (0x03 << (k - 1))

# The parent of a node.
def parent(x, n):
    if x == root(n):
        raise Exception('root node has no parent')

    k = level(x)
    b = (x >> (k + 1)) & 0x01
    return (x | (1 << k)) ^ (b << (k + 1))

# The other child of the node's parent.
def sibling(x, n):
    p = parent(x, n)
    if x < p:
        return right(p)
    else:
        return left(p)

# The direct path of a node, ordered from leaf to root.
def direct_path(x, n):
    r = root(n)
    if x == r:
        return []

    d = []
    while x != r:
        x = parent(x, n)
        d.append(x)
    return d

# The copath of a node, ordered from leaf to root.
def copath(x, n):
    if x == root(n):
        return []

    d = direct_path(x, n)
    d.insert(0, x)
    d.pop()
    return [sibling(y, n) for y in d]

# The common ancestor of two nodes is the lowest node that is in the
# direct paths of both leaves.
def common_ancestor_semantic(x, y, n):
    dx = set([x]) | set(direct_path(x, n))
    dy = set([y]) | set(direct_path(y, n))
    dxy = dx & dy
    if len(dxy) == 0:
        raise Exception('failed to find common ancestor')

    return min(dxy, key=level)

# The common ancestor of two nodes is the lowest node that is in the
# direct paths of both leaves.
def common_ancestor_direct(x, y, _):
    # Handle cases where one is an ancestor of the other
    lx, ly = level(x)+1, level(y)+1
    if (lx <= ly) and (x>>ly == y>>ly):
      return y
    elif (ly <= lx) and (x>>lx == y>>lx):
      return x

    # Handle other cases
    xn, yn = x, y
    k = 0
    while xn != yn:
       xn, yn = xn >> 1, yn >> 1
       k += 1
    return (xn << k) + (1 << (k-1)) - 1
```

`n` throughout is the **number of leaves** (always a power of two for the perfect
binary tree MLS uses). `x` and `y` are **node** indices, so a leaf with leaf index
`L` is node `2*L`.

The `ratchet_tree` extension order (§12.4.3.3) is exactly this array order, and the
decoding helper the RFC gives is:

```python
# Assuming a class Node that has left and right members
def subtree_root(nodes):
    # If there is only one node in the array, return it
    if len(nodes) == 1:
        return Node(nodes[0])

    # Otherwise, the length of the array MUST be odd
    if len(nodes) % 2 == 0:
        raise Exception("Malformed node array {}", len(nodes))

    # Identify the root of the subtree
    d = 0
    while (2**(d+1)) < len(nodes):
       d += 1
    R = 2**d - 1
    root = Node(nodes[R])
    root.left = subtree_root(nodes[:R])
    root.right = subtree_root(nodes[(R+1):])
    return root
```
