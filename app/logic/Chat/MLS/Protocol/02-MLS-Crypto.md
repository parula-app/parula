# MLS Cryptography — Primitives, Key Schedule, Secret Tree, Hashes

Implementation reference for a clean-room TypeScript implementation of
**RFC 9420 (MLS)** on top of **RFC 9180 (HPKE)**, using only generic primitives
(`@noble/curves`, `@noble/hashes`, `@noble/ciphers`).

Everything is quoted from RFC 9420 or RFC 9180 with section numbers. Formulas are
verbatim. Where the RFC is ambiguous it says so explicitly.

Companion documents: `01-MLS-Wire-Format.md` (serialisation),
`03-MLS-Protocol-Flow.md` (state machine).

---

## 1. Cipher suites (RFC 9420 §5.1, §17.1)

> RFC 9420 §5.1: "Each MLS session uses a single cipher suite that specifies the
> following primitives to be used in group key computations:
>
> *  HPKE parameters:
>    -  A Key Encapsulation Mechanism (KEM)
>    -  A Key Derivation Function (KDF)
>    -  An Authenticated Encryption with Associated Data (AEAD) encryption algorithm
> *  A hash algorithm
> *  A Message Authentication Code (MAC) algorithm
> *  A signature algorithm"
>
> "MLS uses HPKE for public key encryption [RFC9180]. The DeriveKeyPair function
> associated to the KEM for the cipher suite maps octet strings to HPKE key pairs.
> As in HPKE, MLS assumes that an AEAD algorithm produces a single ciphertext output
> from AEAD encryption (aligning with [RFC5116]), as opposed to a separate
> ciphertext and tag."

### 1.1 Registered cipher suites (RFC 9420 §17.1, Table 6)

```
| 0x0000 | RESERVED                                           |
| 0x0001 | MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519       |
| 0x0002 | MLS_128_DHKEMP256_AES128GCM_SHA256_P256            |
| 0x0003 | MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519|
| 0x0004 | MLS_256_DHKEMX448_AES256GCM_SHA512_Ed448           |
| 0x0005 | MLS_256_DHKEMP521_AES256GCM_SHA512_P521            |
| 0x0006 | MLS_256_DHKEMX448_CHACHA20POLY1305_SHA512_Ed448    |
| 0x0007 | MLS_256_DHKEMP384_AES256GCM_SHA384_P384            |
```

Naming convention (RFC 9420 §17.1): `MLS_LVL_KEM_AEAD_HASH_SIG`, where LVL is the
security level in bits, KEM/AEAD/HASH are the HPKE parameters, and SIG is the
signature algorithm used for message authentication.

### 1.2 Algorithm mapping (RFC 9420 §17.1, Table 7)

> "All of the non-GREASE cipher suites use HMAC [RFC2104] as their MAC function,
> with different hashes per cipher suite. The mapping of cipher suites to HPKE
> primitives [RFC9180], HMAC hash functions, and TLS signature schemes [RFC8446] is
> as follows:"

```
|Value |KEM   | KDF    | AEAD   | Hash   | Signature              |
|0x0001|0x0020| 0x0001 | 0x0001 | SHA256 | ed25519                |
|0x0002|0x0010| 0x0001 | 0x0001 | SHA256 | ecdsa_secp256r1_sha256 |
|0x0003|0x0020| 0x0001 | 0x0003 | SHA256 | ed25519                |
|0x0004|0x0021| 0x0003 | 0x0002 | SHA512 | ed448                  |
|0x0005|0x0012| 0x0003 | 0x0002 | SHA512 | ecdsa_secp521r1_sha512 |
|0x0006|0x0021| 0x0003 | 0x0003 | SHA512 | ed448                  |
|0x0007|0x0011| 0x0002 | 0x0002 | SHA384 | ecdsa_secp384r1_sha384 |
```

> "The hash used for the MLS transcript hash is the one referenced in the cipher
> suite name."
>
> "The mandatory-to-implement cipher suite for MLS 1.0 is
> MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519, which uses Curve25519 for key
> exchange, AES-128-GCM for HPKE, HKDF over SHA2-256, and Ed25519 for signatures.
> MLS clients MUST implement this cipher suite."

### 1.3 The two suites Wire uses, fully expanded

**`0x0001 MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`**

| Parameter | Value | Constant |
|---|---|---|
| KEM | `0x0020` DHKEM(X25519, HKDF-SHA256) (RFC 9180 Table 2) | `Nsecret=32, Nenc=32, Npk=32, Nsk=32, Ndh=32` |
| KDF | `0x0001` HKDF-SHA256 (RFC 9180 Table 3) | `Nh = 32` |
| AEAD | `0x0001` AES-128-GCM (RFC 9180 Table 5) | `Nk = 16, Nn = 12, Nt = 16` |
| Hash | SHA-256 | 32-byte digest |
| MAC | HMAC-SHA256 | 32-byte tag (full length, not truncated) |
| Signature | Ed25519 | 32-byte public key, 64-byte signature |

**`0x0003 MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519`**

Identical except AEAD = `0x0003` ChaCha20Poly1305, `Nk = 32, Nn = 12, Nt = 16`.

So for both Wire suites: `KDF.Nh = 32`, `Hash` = SHA-256, `MAC` = HMAC-SHA256,
`KEM` = DHKEM(X25519, HKDF-SHA256), `Sig` = Ed25519. Only `AEAD.Nk` differs
(16 vs 32).

### 1.4 Mapping to `@noble`

```ts
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { extract, expand } from '@noble/hashes/hkdf';
import { x25519, ed25519 } from '@noble/curves/ed25519';
import { gcm } from '@noble/ciphers/aes';
import { chacha20poly1305 } from '@noble/ciphers/chacha';
```

* `KDF.Extract(salt, ikm)` = HKDF-Extract = `HMAC(key = salt, msg = ikm)`.
  **`@noble/hashes` argument order is `extract(hash, ikm, salt)` — ikm first,
  salt second. The RFC writes `Extract(salt, ikm)`. Swapping them is silent and
  fatal.**
* `KDF.Expand(prk, info, L)` = `expand(sha256, prk, info, L)`.
* `Hash(x)` = `sha256(x)`.
* `MAC(key, msg)` = `hmac(sha256, key, msg)`.
* `Signature.Sign(sk, msg)` = `ed25519.sign(msg, sk)` (note noble's argument
  order is (message, privateKey)); `Signature.Verify(pk, msg, sig)` =
  `ed25519.verify(sig, msg, pk)`.
* `DH(sk, pk)` = `x25519.getSharedSecret(sk, pk)`;
  `pk(sk)` = `x25519.getPublicKey(sk)`.
* AEAD `Seal(key, nonce, aad, pt)` = `gcm(key, nonce, aad).encrypt(pt)` /
  `chacha20poly1305(key, nonce, aad).encrypt(pt)`; `Open` = `.decrypt(ct)`.
  Both produce/consume ciphertext **with the 16-byte tag appended**, which is
  exactly what RFC 9420 §5.1 requires ("a single ciphertext output ... as opposed
  to a separate ciphertext and tag").

X25519 validation (RFC 9180 §7.1.4): "For X25519 and X448, public keys and
Diffie-Hellman outputs MUST be validated as described in [RFC7748]. In particular,
recipients MUST check whether the Diffie-Hellman shared secret is the all-zero
value and abort if so." `@noble/curves` throws on an all-zero X25519 output
already, but assert it explicitly.

---

## 2. Hash-based identifiers: `RefHash` (RFC 9420 §5.2)

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

Where `RefHashInput` is defined as:

```
struct {
  opaque label<V>;
  opaque value<V>;
} RefHashInput;
```

And its fields are set to:

```
label = label;
value = value;
```

> RFC 9420 §5.2: "For a KeyPackageRef, the value input is the encoded KeyPackage,
> and the cipher suite specified in the KeyPackage determines the KDF used. For a
> ProposalRef, the value input is the AuthenticatedContent carrying the Proposal.
> In the latter two cases, the KDF is determined by the group's cipher suite."

**Ambiguity, flagged:** the prose says "KDF"; the definition says `Hash`. Use the
cipher suite's hash (SHA-256 for 0x0001/0x0003). Wire's server implements it as a
plain hash of the serialised `RefHashInput`.

Note the two label strings **already contain** the `"MLS 1.0 "` prefix; `RefHash`
does not add one (unlike `SignWithLabel` / `EncryptWithLabel` / `ExpandWithLabel`).

Concrete: `MakeProposalRef(ac)` = `sha256( varint(len("MLS 1.0 Proposal
Reference")) || "MLS 1.0 Proposal Reference" || varint(len(enc(ac))) || enc(ac) )`,
where `enc(ac)` is the serialised `AuthenticatedContent`.

---

## 3. KDF constructions (RFC 9420 §8, §9.1)

> RFC 9420 §8: "Group keys are derived using the Extract and Expand functions from
> the KDF for the group's cipher suite, as well as the functions defined below:"

```
ExpandWithLabel(Secret, Label, Context, Length) =
    KDF.Expand(Secret, KDFLabel, Length)

DeriveSecret(Secret, Label) =
    ExpandWithLabel(Secret, Label, "", KDF.Nh)
```

> "Where KDFLabel is specified as:"

```
struct {
    uint16 length;
    opaque label<V>;
    opaque context<V>;
} KDFLabel;
```

> "And its fields are set to:"

```
length = Length;
label = "MLS 1.0 " + Label;
context = Context;
```

> "The value KDF.Nh is the size of an output from KDF.Extract, in bytes."

And, from RFC 9420 §9.1:

```
DeriveTreeSecret(Secret, Label, Generation, Length) =
    ExpandWithLabel(Secret, Label, Generation, Length)
```

> "Where Generation is encoded as a big endian uint32."

So `DeriveTreeSecret` is just `ExpandWithLabel` with a 4-byte big-endian
`Generation` as the `Context`.

### 3.1 Worked byte-level example (to pin the encoding down)

`DeriveSecret(S, "init")` with SHA-256 (`KDF.Nh = 32`):

* `label = "MLS 1.0 " + "init" = "MLS 1.0 init"` — 12 bytes:
  `4D 4C 53 20 31 2E 30 20 69 6E 69 74`
* `context = ""` — 0 bytes
* `KDFLabel` = `00 20` (uint16 32) `|| 0C` (varint 12) `|| 4D4C532031 2E3020 696E6974` `|| 00` (varint 0)
  = `00 20 0C 4D 4C 53 20 31 2E 30 20 69 6E 69 74 00` (16 bytes)
* result = `HKDF-Expand(S, KDFLabel, 32)`

`DeriveTreeSecret(S, "key", 5, 16)`:

* `label = "MLS 1.0 key"` (11 bytes), `context = 00 00 00 05` (4 bytes)
* `KDFLabel` = `00 10 0B "MLS 1.0 key" 04 00 00 00 05`
* result = `HKDF-Expand(S, KDFLabel, 16)`

**Note how different this is from HPKE's `LabeledExpand`** (§5.3 below), which
concatenates raw bytes with no length prefixes. Do not share code between the two.

### 3.2 Complete list of `ExpandWithLabel` / `DeriveSecret` labels in RFC 9420

| Label | Where | Section |
|---|---|---|
| `"joiner"` | `joiner_secret` (with GroupContext as context) | §8 Fig. 22 |
| `"welcome"` | `welcome_secret` (DeriveSecret) | §8 Fig. 22 |
| `"epoch"` | `epoch_secret` (with GroupContext as context) | §8 Fig. 22 |
| `"sender data"` | `sender_data_secret` (DeriveSecret from epoch_secret) | §8 Table 4 |
| `"encryption"` | `encryption_secret` | §8 Table 4 |
| `"exporter"` | `exporter_secret` | §8 Table 4 |
| `"external"` | `external_secret` | §8 Table 4 |
| `"confirm"` | `confirmation_key` | §8 Table 4 |
| `"membership"` | `membership_key` | §8 Table 4 |
| `"resumption"` | `resumption_psk` | §8 Table 4 |
| `"authentication"` | `epoch_authenticator` | §8 Table 4 |
| `"init"` | next epoch's `init_secret` | §8 Fig. 22 |
| `"derived psk"` | `psk_input_[i]` (context = `PSKLabel`) | §8.4 |
| `"exported"` | MLS-Exporter output (context = `Hash(Context)`) | §8.5 |
| `"path"` | `path_secret[n]` from `path_secret[n-1]` | §7.4 |
| `"node"` | `node_secret[n]` from `path_secret[n]` | §7.4 |
| `"tree"` | secret-tree children (context = `"left"` / `"right"`) | §9 |
| `"handshake"` | handshake ratchet root (context = `""`) | §9 |
| `"application"` | application ratchet root (context = `""`) | §9 |
| `"nonce"` | ratchet nonce (DeriveTreeSecret, context = generation) | §9.1 |
| `"key"` | ratchet key (DeriveTreeSecret, context = generation) | §9.1 |
| `"secret"` | next ratchet secret (DeriveTreeSecret, context = generation) | §9.1 |
| `"key"` | `welcome_key` (context = `""`); `sender_data_key` (context = ciphertext sample) | §12.4.3.1, §6.3.2 |
| `"nonce"` | `welcome_nonce` (context = `""`); `sender_data_nonce` (context = ciphertext sample) | §12.4.3.1, §6.3.2 |

`"key"` and `"nonce"` are reused in three different places with three different
contexts and three different parent secrets — the parent secret provides the
domain separation, not the label.

Separate from all of these: `"MLS 1.0 external init secret"` (RFC 9420 §8.3) is a
**complete** string handed to the HPKE `Context.Export` interface, not an
`ExpandWithLabel` label. It already carries the `"MLS 1.0 "` prefix. See §6.5.

---

## 4. Signatures (RFC 9420 §5.1.2)

> "The signature algorithm specified in a group's cipher suite is the mandatory
> algorithm to be used for signing messages within the group. It MUST be the same
> as the signature algorithm specified in the credentials in the leaves of the tree
> (including the leaf node information in KeyPackages used to add new members)."
>
> "The signatures used in this document are encoded as specified in [RFC8446]. In
> particular, ECDSA signatures are DER encoded, and EdDSA signatures are defined as
> the concatenation of R and S, as specified in [RFC8032]."
>
> "To disambiguate different signatures used in MLS, each signed value is prefixed
> by a label as shown below:"

```
SignWithLabel(SignatureKey, Label, Content) =
    Signature.Sign(SignatureKey, SignContent)

VerifyWithLabel(VerificationKey, Label, Content, SignatureValue) =
    Signature.Verify(VerificationKey, SignContent, SignatureValue)
```

> "Where SignContent is specified as:"

```
struct {
    opaque label<V>;
    opaque content<V>;
} SignContent;
```

> "And its fields are set to:"

```
label = "MLS 1.0 " + Label;
content = Content;
```

> "The functions Signature.Sign and Signature.Verify are defined by the signature
> algorithm. If MLS extensions require signatures by group members, they should
> reuse the SignWithLabel construction, using a distinct label."

### 4.1 Every signature in the protocol

RFC 9420 §17.6 "MLS Signature Labels" registry initial contents:
`"FramedContentTBS"`, `"LeafNodeTBS"`, `"KeyPackageTBS"`, `"GroupInfoTBS"`.

| Signature | Label | Content (the bytes signed) | Signing key | Verifying key | Section |
|---|---|---|---|---|---|
| `LeafNode.signature` | `"LeafNodeTBS"` | serialised `LeafNodeTBS` | the client's signature private key | `LeafNode.signature_key` | §7.2 |
| `KeyPackage.signature` | `"KeyPackageTBS"` | serialised `KeyPackageTBS` | the client's signature private key | `key_package.leaf_node.signature_key` | §10 |
| `GroupInfo.signature` | `"GroupInfoTBS"` | serialised `GroupInfoTBS` | committer's signature private key | signature key in the ratchet-tree leaf at index `GroupInfo.signer` | §12.4.3 |
| `FramedContentAuthData.signature` | `"FramedContentTBS"` | serialised `FramedContentTBS` | depends on `sender_type` | depends on `sender_type` | §6.1 |

For `FramedContentAuthData.signature` the key selection is (RFC 9420 §6.1, quoted
in full in `01-MLS-Wire-Format.md` §3.26):

* `member` → signature key in the ratchet-tree `LeafNode` at `sender.leaf_index`.
* `external` → signature key at `sender.sender_index` in the `external_senders`
  GroupContext extension. Content type MUST be `proposal`, and the proposal type
  MUST be one allowed for external senders (`add`, `remove`, `psk`, `reinit`,
  `group_context_extensions`).
* `new_member_commit` → signature key in `commit.path.leaf_node`. Content type
  MUST be `commit`.
* `new_member_proposal` → signature key in the `LeafNode` of the `KeyPackage` in
  the external `Add` proposal. Content type MUST be `proposal`, proposal type MUST
  be `add`.

### 4.2 Worked example

`SignWithLabel(sk, "LeafNodeTBS", tbs)` with `tbs` = 200 bytes:

* `label = "MLS 1.0 LeafNodeTBS"` = 19 bytes → varint `0x13`
* `content` = 200 bytes → varint `0x40 0xC8` (2-byte form, since 200 > 63)
* `SignContent` = `13 || "MLS 1.0 LeafNodeTBS" || 40 C8 || tbs`
* signature = `ed25519.sign(SignContent, sk)` → 64 raw bytes

---

## 5. HPKE (RFC 9180), as used by MLS

MLS uses HPKE **base mode, single-shot**, with the `info` parameter carrying an
MLS-specific `EncryptContext` struct and an empty `aad`.

### 5.1 MLS's wrapper (RFC 9420 §5.1.3)

> "As with signing, MLS includes a label and context in encryption operations to
> avoid confusion between ciphertexts produced for different purposes. Encryption
> and decryption including this label and context are done as follows:"

```
EncryptWithLabel(PublicKey, Label, Context, Plaintext) =
  SealBase(PublicKey, EncryptContext, "", Plaintext)

DecryptWithLabel(PrivateKey, Label, Context, KEMOutput, Ciphertext) =
  OpenBase(KEMOutput, PrivateKey, EncryptContext, "", Ciphertext)
```

> "Where EncryptContext is specified as:"

```
struct {
  opaque label<V>;
  opaque context<V>;
} EncryptContext;
```

> "And its fields are set to:"

```
label = "MLS 1.0 " + Label;
context = Context;
```

> "The functions SealBase and OpenBase are defined in Section 6.1 of [RFC9180]
> (with "Base" as the MODE), using the HPKE algorithms specified by the group's
> cipher suite."

So: the serialised `EncryptContext` is the HPKE `info` parameter and the HPKE
`aad` is the empty string. `SealBase` returns `(enc, ct)`; MLS stores them as
`HPKECiphertext { kem_output = enc; ciphertext = ct; }`.

RFC 9420 §17.7 "MLS Public Key Encryption Labels" registry initial contents:

| Label | Context | Plaintext | Recipient key | Section |
|---|---|---|---|---|
| `"UpdatePathNode"` | serialised **provisional** `GroupContext` | `path_secret` (raw `KDF.Nh` bytes) | the resolution node's `encryption_key` | §7.6 |
| `"Welcome"` | `Welcome.encrypted_group_info` bytes | serialised `GroupSecrets` | new member's `KeyPackage.init_key` | §12.4.3.1 |

Note for `"UpdatePathNode"` the plaintext is the *raw* path secret bytes, not a
`PathSecret` struct (contrast `GroupSecrets.path_secret`, which *is* a
`PathSecret` struct, i.e. length-prefixed).

### 5.2 HPKE mode and identifiers

RFC 9180 §5, Table 1:

```
| mode_base     | 0x00 |
| mode_psk      | 0x01 |
| mode_auth     | 0x02 |
| mode_auth_psk | 0x03 |
```

MLS uses `mode_base` (0x00) only.

RFC 9180 §7.1 Table 2 (KEM IDs), §7.2 Table 3 (KDF IDs), §7.3 Table 5 (AEAD IDs):

```
| 0x0020 | DHKEM(X25519, HKDF-SHA256) | Nsecret 32 | Nenc 32 | Npk 32 | Nsk 32 |
| 0x0001 | HKDF-SHA256 | Nh 32 |
| 0x0001 | AES-128-GCM      | Nk 16 | Nn 12 | Nt 16 |
| 0x0003 | ChaCha20Poly1305 | Nk 32 | Nn 12 | Nt 16 |
```

### 5.3 `LabeledExtract` / `LabeledExpand` and `suite_id` (RFC 9180 §4)

> "The following two functions are defined to facilitate domain separation of KDF
> calls as well as context binding:"

```
def LabeledExtract(salt, label, ikm):
  labeled_ikm = concat("HPKE-v1", suite_id, label, ikm)
  return Extract(salt, labeled_ikm)

def LabeledExpand(prk, label, info, L):
  labeled_info = concat(I2OSP(L, 2), "HPKE-v1", suite_id,
                        label, info)
  return Expand(prk, labeled_info, L)
```

> "The value of suite_id depends on where the KDF is used; it is assumed implicit
> from the implementation and not passed as a parameter. If used inside a KEM
> algorithm, suite_id MUST start with "KEM" and identify this KEM algorithm; if
> used in the remainder of HPKE, it MUST start with "HPKE" and identify the entire
> ciphersuite in use."

**Plain concatenation, no length prefixes.** The exact byte strings:

* `"HPKE-v1"` = `48 50 4B 45 2D 76 31` (7 bytes)
* KEM suite_id (RFC 9180 §4.1): `suite_id = concat("KEM", I2OSP(kem_id, 2))`
  → `"KEM"` = `4B 45 4D`, so for `0x0020`: `4B 45 4D 00 20` (5 bytes)
* HPKE suite_id (RFC 9180 §5.1):
  ```
  suite_id = concat(
    "HPKE",
    I2OSP(kem_id, 2),
    I2OSP(kdf_id, 2),
    I2OSP(aead_id, 2)
  )
  ```
  → `"HPKE"` = `48 50 4B 45`. For MLS cipher suite `0x0001`
  (kem 0x0020, kdf 0x0001, aead 0x0001): `48 50 4B 45 00 20 00 01 00 01` (10 bytes).
  For MLS cipher suite `0x0003` (aead 0x0003): `48 50 4B 45 00 20 00 01 00 03`.

`I2OSP(n, w)` (RFC 9180 §3): "Convert non-negative integer n to a w-length,
big-endian byte string."

**Which suite_id in which call:** RFC 9180 §7.1.3: "All invocations of KDF
functions (such as LabeledExtract or LabeledExpand) in any DHKEM's DeriveKeyPair()
function use the DHKEM's associated KDF (as opposed to the ciphersuite's KDF)."
The same applies to `ExtractAndExpand` inside `Encap`/`Decap`. Everything in
`KeySchedule`/`Export` uses the HPKE suite_id.

### 5.4 DHKEM(X25519, HKDF-SHA256) (RFC 9180 §4.1)

> ```
> def ExtractAndExpand(dh, kem_context):
>   eae_prk = LabeledExtract("", "eae_prk", dh)
>   shared_secret = LabeledExpand(eae_prk, "shared_secret",
>                                 kem_context, Nsecret)
>   return shared_secret
>
> def Encap(pkR):
>   skE, pkE = GenerateKeyPair()
>   dh = DH(skE, pkR)
>   enc = SerializePublicKey(pkE)
>
>   pkRm = SerializePublicKey(pkR)
>   kem_context = concat(enc, pkRm)
>
>   shared_secret = ExtractAndExpand(dh, kem_context)
>   return shared_secret, enc
>
> def Decap(enc, skR):
>   pkE = DeserializePublicKey(enc)
>   dh = DH(skR, pkE)
>
>   pkRm = SerializePublicKey(pk(skR))
>   kem_context = concat(enc, pkRm)
>
>   shared_secret = ExtractAndExpand(dh, kem_context)
>   return shared_secret
> ```

`AuthEncap`/`AuthDecap` exist in RFC 9180 §4.1 but MLS never uses them.

For X25519 (RFC 9180 §7.1.1): "For X25519 and X448, the SerializePublicKey() and
DeserializePublicKey() functions are the identity function, since these curves
already use fixed-length byte strings for public keys." So `enc` is the 32 raw
bytes of the ephemeral public key and `kem_context` is 64 bytes.

`Ndh = 32` for X25519 (RFC 9180 §4.1), `Nsecret = 32`.

`DeriveKeyPair` for X25519 (RFC 9180 §7.1.3):

```
def DeriveKeyPair(ikm):
  dkp_prk = LabeledExtract("", "dkp_prk", ikm)
  sk = LabeledExpand(dkp_prk, "sk", "", Nsk)
  return (sk, pk(sk))
```

(with the **KEM** suite_id, `"KEM" || 0x0020`). MLS calls this in two places:
`KEM.DeriveKeyPair(node_secret)` for ratchet-tree node key pairs (RFC 9420 §7.4)
and `KEM.DeriveKeyPair(external_secret)` for the external key pair (§8).

RFC 9180 §7.1.2: "For X25519 and X448, private keys are identical to their byte
string representation ... The SerializePrivateKey() function MUST clamp its output
and the DeserializePrivateKey() function MUST clamp its input". `@noble`'s
`x25519.getPublicKey` and `getSharedSecret` clamp internally, so store the raw
32 bytes produced by `LabeledExpand` and let noble clamp.

### 5.5 HPKE key schedule, base mode (RFC 9180 §5.1)

```
default_psk = ""
default_psk_id = ""

def KeySchedule<ROLE>(mode, shared_secret, info, psk, psk_id):
  VerifyPSKInputs(mode, psk, psk_id)

  psk_id_hash = LabeledExtract("", "psk_id_hash", psk_id)
  info_hash = LabeledExtract("", "info_hash", info)
  key_schedule_context = concat(mode, psk_id_hash, info_hash)

  secret = LabeledExtract(shared_secret, "secret", psk)

  key = LabeledExpand(secret, "key", key_schedule_context, Nk)
  base_nonce = LabeledExpand(secret, "base_nonce",
                             key_schedule_context, Nn)
  exporter_secret = LabeledExpand(secret, "exp",
                                  key_schedule_context, Nh)

  return Context<ROLE>(key, base_nonce, 0, exporter_secret)
```

> RFC 9180 §5.1: "Note that the key_schedule_context construction in KeySchedule()
> is equivalent to serializing a structure of the following form in the TLS
> presentation syntax:
> ```
> struct {
>     uint8 mode;
>     opaque psk_id_hash[Nh];
>     opaque info_hash[Nh];
> } KeyScheduleContext;
> ```"

In base mode: `mode = 0x00`, `psk = ""`, `psk_id = ""`. So `psk_id_hash` and
`info_hash` are `LabeledExtract("", "psk_id_hash", "")` and
`LabeledExtract("", "info_hash", info)`, and `key_schedule_context` is
`1 + 32 + 32 = 65` bytes for HKDF-SHA256. `psk_id_hash` is a **constant** for a
given suite — you can precompute it.

Setup (RFC 9180 §5.1.1):

```
def SetupBaseS(pkR, info):
  shared_secret, enc = Encap(pkR)
  return enc, KeyScheduleS(mode_base, shared_secret, info,
                           default_psk, default_psk_id)

def SetupBaseR(enc, skR, info):
  shared_secret = Decap(enc, skR)
  return KeyScheduleR(mode_base, shared_secret, info,
                      default_psk, default_psk_id)
```

### 5.6 Seal/Open and the nonce (RFC 9180 §5.2, §6.1)

```
def ContextS.Seal(aad, pt):
  ct = Seal(self.key, self.ComputeNonce(self.seq), aad, pt)
  self.IncrementSeq()
  return ct

def ContextR.Open(aad, ct):
  pt = Open(self.key, self.ComputeNonce(self.seq), aad, ct)
  if pt == OpenError:
    raise OpenError
  self.IncrementSeq()
  return pt

def Context<ROLE>.ComputeNonce(seq):
  seq_bytes = I2OSP(seq, Nn)
  return xor(self.base_nonce, seq_bytes)
```

Single-shot (RFC 9180 §6.1):

```
def Seal<MODE>(pkR, info, aad, pt, ...):
  enc, ctx = Setup<MODE>S(pkR, info, ...)
  ct = ctx.Seal(aad, pt)
  return enc, ct

def Open<MODE>(enc, skR, info, aad, ct, ...):
  ctx = Setup<MODE>R(enc, skR, info, ...)
  return ctx.Open(aad, ct)
```

MLS always uses the single-shot form, so `seq = 0` and the nonce is simply
`base_nonce`. **Do not implement the sequence counter for MLS** — every
`EncryptWithLabel` / `DecryptWithLabel` sets up a fresh context.

Export (RFC 9180 §5.3):

```
def Context.Export(exporter_context, L):
  return LabeledExpand(self.exporter_secret, "sec",
                       exporter_context, L)
```

Used by MLS only for external init (§6.5 below).

### 5.7 Minimal HPKE implementation checklist for MLS

You need exactly: `Encap`, `Decap`, `KeyScheduleS/R` in base mode, `Seal`, `Open`,
`Export`, `DeriveKeyPair`. You do **not** need PSK/Auth modes, sequence numbers, or
any KEM other than DHKEM(X25519, HKDF-SHA256).

---

## 6. The MLS key schedule (RFC 9420 §8)

> RFC 9420 §8: "In the below diagram:
>
> *  KDF.Extract takes its salt argument from the top and its Input Keying Material
>    (IKM) argument from the left.
> *  DeriveSecret takes its Secret argument from the incoming arrow.
> *  0 represents an all-zero byte string of length KDF.Nh."
>
> "When processing a handshake message, a client combines the following information
> to derive new epoch secrets:
>
> *  The init secret from the previous epoch
> *  The commit secret for the current epoch
> *  The GroupContext object for current epoch"

### 6.1 Figure 22, The MLS Key Schedule (verbatim)

```
                 init_secret_[n-1]
                       |
                       |
                       V
 commit_secret --> KDF.Extract
                       |
                       |
                       V
               ExpandWithLabel(., "joiner", GroupContext_[n], KDF.Nh)
                       |
                       |
                       V
                  joiner_secret
                       |
                       |
                       V
psk_secret (or 0) --> KDF.Extract
                       |
                       +--> DeriveSecret(., "welcome")
                       |    = welcome_secret
                       |
                       V
               ExpandWithLabel(., "epoch", GroupContext_[n], KDF.Nh)
                       |
                       |
                       V
                  epoch_secret
                       |
                       |
                       +--> DeriveSecret(., <label>)
                       |    = <secret>
                       |
                       V
                 DeriveSecret(., "init")
                       |
                       |
                       V
                 init_secret_[n]
```

### 6.2 The same thing as executable pseudocode

Applying the "salt from the top, IKM from the left" rule:

```
// step 1 -- only existing members can do this; joiners get joiner_secret directly
pre_joiner   = KDF.Extract(salt = init_secret_[n-1], ikm = commit_secret)
joiner_secret = ExpandWithLabel(pre_joiner, "joiner", GroupContext_[n], KDF.Nh)

// step 2 -- both members and joiners
member_secret  = KDF.Extract(salt = joiner_secret, ikm = psk_secret)
welcome_secret = DeriveSecret(member_secret, "welcome")
epoch_secret   = ExpandWithLabel(member_secret, "epoch", GroupContext_[n], KDF.Nh)

// step 3 -- the epoch secrets
sender_data_secret  = DeriveSecret(epoch_secret, "sender data")
encryption_secret   = DeriveSecret(epoch_secret, "encryption")
exporter_secret     = DeriveSecret(epoch_secret, "exporter")
external_secret     = DeriveSecret(epoch_secret, "external")
confirmation_key    = DeriveSecret(epoch_secret, "confirm")
membership_key      = DeriveSecret(epoch_secret, "membership")
resumption_psk      = DeriveSecret(epoch_secret, "resumption")
epoch_authenticator = DeriveSecret(epoch_secret, "authentication")
init_secret_[n]     = DeriveSecret(epoch_secret, "init")
```

`psk_secret` is the all-zero vector of length `KDF.Nh` when there are no PSKs
(RFC 9420 §8.4: "In particular, if there are no PreSharedKey proposals in a given
Commit, then the resulting psk_secret is psk_secret_[0], the all-zero vector.").

`commit_secret` (RFC 9420 §12.4.1): "Define commit_secret as the value
path_secret[n+1] derived from the last path secret value (path_secret[n]) derived
for the UpdatePath." — i.e. one more `DeriveSecret(., "path")` step past the root's
path secret. If the Commit has no `path`: "Define commit_secret as the all-zero
vector of length KDF.Nh (the same length as a path_secret value would be)."

**The GroupContext used in `"joiner"` and `"epoch"` is `GroupContext_[n]`, the
NEW epoch's context** — with the new epoch number, the new tree hash and the new
`confirmed_transcript_hash` (RFC 9420 §12.4.1: "Use the FramedContent to update the
confirmed transcript hash and update the new GroupContext. Use the init_secret from
the previous epoch, the commit_secret and psk_secret defined in the previous steps,
and the new GroupContext to compute the new joiner_secret, welcome_secret,
epoch_secret, and derived secrets for the new epoch."). This is a different
GroupContext from the *provisional* one used as HPKE context for `UpdatePathNode`
(which still has the **old** `confirmed_transcript_hash`).

### 6.3 Table 4, Epoch-Derived Secrets (verbatim, RFC 9420 §8)

```
+==================+=====================+=======================+
| Label            | Secret              | Purpose               |
+==================+=====================+=======================+
| "sender data"    | sender_data_secret  | Deriving keys to      |
|                  |                     | encrypt sender data   |
+------------------+---------------------+-----------------------+
| "encryption"     | encryption_secret   | Deriving message      |
|                  |                     | encryption keys (via  |
|                  |                     | the secret tree)      |
+------------------+---------------------+-----------------------+
| "exporter"       | exporter_secret     | Deriving exported     |
|                  |                     | secrets               |
+------------------+---------------------+-----------------------+
| "external"       | external_secret     | Deriving the external |
|                  |                     | init key              |
+------------------+---------------------+-----------------------+
| "confirm"        | confirmation_key    | Computing the         |
|                  |                     | confirmation MAC for  |
|                  |                     | an epoch              |
+------------------+---------------------+-----------------------+
| "membership"     | membership_key      | Computing the         |
|                  |                     | membership MAC for a  |
|                  |                     | PublicMessage         |
+------------------+---------------------+-----------------------+
| "resumption"     | resumption_psk      | Proving membership in |
|                  |                     | this epoch (via a PSK |
|                  |                     | injected later)       |
+------------------+---------------------+-----------------------+
| "authentication" | epoch_authenticator | Confirming that two   |
|                  |                     | clients have the same |
|                  |                     | view of the group     |
+------------------+---------------------+-----------------------+
```

> RFC 9420 §8: "The external_secret is used to derive an HPKE key pair whose private
> key is held by the entire group:
> `external_priv, external_pub = KEM.DeriveKeyPair(external_secret)`
> The public key external_pub can be published as part of the GroupInfo struct in
> order to allow non-members to join the group using an external Commit."

### 6.4 PSK secret (RFC 9420 §8.4)

```
struct {
    PreSharedKeyID id;
    uint16 index;
    uint16 count;
} PSKLabel;

psk_extracted_[i] = KDF.Extract(0, psk_[i])
psk_input_[i] = ExpandWithLabel(psk_extracted_[i], "derived psk",
                  PSKLabel, KDF.Nh)

psk_secret_[0] = 0
psk_secret_[i] = KDF.Extract(psk_input_[i-1], psk_secret_[i-1])
psk_secret     = psk_secret_[n]
```

> "Here 0 represents the all-zero vector of length KDF.Nh. The index field in
> PSKLabel corresponds to the index of the PSK in the psk array, while the count
> field contains the total number of PSKs."

Figure 24, Computation of a PSK Secret from a Set of PSKs (verbatim):

```
                 0                               0    = psk_secret_[0]
                 |                               |
                 V                               V
psk_[0]   --> Extract --> ExpandWithLabel --> Extract = psk_secret_[1]
                                                 |
                 0                               |
                 |                               |
                 V                               V
psk_[1]   --> Extract --> ExpandWithLabel --> Extract = psk_secret_[2]
                                                 |
                 0                              ...
                 |                               |
                 V                               V
psk_[n-1] --> Extract --> ExpandWithLabel --> Extract = psk_secret_[n]
```

**RFC ambiguity, flagged.** The prose formula
`psk_secret_[i] = KDF.Extract(psk_input_[i-1], psk_secret_[i-1])` means
`salt = psk_input_[i-1]`, `ikm = psk_secret_[i-1]`, whereas Figure 24 with the
"salt from the top, IKM from the left" convention of §8 means the opposite
(`salt = psk_secret_[i-1]`, `ikm = psk_input_[i-1]`). The two readings disagree.
If you implement PSKs, validate against the official RFC 9420 test vectors
(`psk_secret.json` in the mlswg/mls-implementations repository) before shipping.
This does not affect a Wire-only client: Wire uses no MLS `PreSharedKey`
proposals, so `psk_secret` is always the all-zero vector (see
`03-MLS-Protocol-Flow.md` §12).

Also: `psk_extracted_[i] = KDF.Extract(0, psk_[i])` — here `0` is the all-zero
salt of length `KDF.Nh`, not an empty salt.

For a resumption PSK, `psk_[i]` is "the resumption_psk of the group and epoch
specified in the PreSharedKeyID object" (RFC 9420 §8.4).

### 6.5 External initialisation (RFC 9420 §8.3)

> "In this process, the joiner sends a new init_secret value to the group using the
> HPKE export method. The joiner then uses that init_secret with information
> provided in the GroupInfo and an external Commit to initialize their copy of the
> key schedule for the new epoch."

```
kem_output, context = SetupBaseS(external_pub, "")
init_secret = context.export("MLS 1.0 external init secret", KDF.Nh)
```

> "Members of the group receive the kem_output in an ExternalInit proposal and
> perform the corresponding calculation to retrieve the init_secret value."

```
context = SetupBaseR(kem_output, external_priv, "")
init_secret = context.export("MLS 1.0 external init secret", KDF.Nh)
```

The HPKE `info` here is the **empty string**, not an `EncryptContext` — this is a
raw HPKE call, not `EncryptWithLabel`. The exporter context string
`"MLS 1.0 external init secret"` is used literally (it already contains the
`"MLS 1.0 "` prefix) and lands in HPKE's `LabeledExpand(exporter_secret, "sec",
exporter_context, L)`.

The resulting `init_secret` replaces `init_secret_[n-1]` in the key schedule for
that Commit.

### 6.6 Exporters (RFC 9420 §8.5)

```
MLS-Exporter(Label, Context, Length) =
       ExpandWithLabel(DeriveSecret(exporter_secret, Label),
                         "exported", Hash(Context), Length)
```

Note the double derivation and that the application `Context` is **hashed** before
being used as the `ExpandWithLabel` context.

### 6.7 Deletion schedule (RFC 9420 §9.2)

> "It is important to delete all security-sensitive values as soon as they are
> _consumed_. A sensitive value S is said to be _consumed_ if:
>
> *  S was used to encrypt or (successfully) decrypt a message, or
> *  a key, nonce, or secret derived from S has been consumed. (This goes for values
>    derived via DeriveSecret as well as ExpandWithLabel.)
>
> Here S may be the init_secret, commit_secret, epoch_secret, or encryption_secret
> as well as any secret in a secret tree or one of the ratchets."
>
> "As soon as a group member consumes a value, they MUST immediately delete (all
> representations of) that value. This is crucial to ensuring forward secrecy for
> past messages. Members MAY keep unconsumed values around for some reasonable
> amount of time to handle out-of-order message delivery."

Also RFC 9420 §7.5: "After processing the update, each recipient MUST delete
outdated key material, specifically: The path secrets and node secrets used to
derive each updated node key pair. Each outdated node key pair that was replaced by
the update."

---

## 7. Transcript hashes and the confirmation tag (RFC 9420 §8.2, §6.1, §6.2)

### 7.1 Transcript hash formulas (verbatim, RFC 9420 §8.2)

```
struct {
    WireFormat wire_format;
    FramedContent content; /* with content_type == commit */
    opaque signature<V>;
} ConfirmedTranscriptHashInput;

struct {
    MAC confirmation_tag;
} InterimTranscriptHashInput;

confirmed_transcript_hash_[0] = ""; /* zero-length octet string */
interim_transcript_hash_[0] = ""; /* zero-length octet string */

confirmed_transcript_hash_[epoch] =
    Hash(interim_transcript_hash_[epoch - 1] ||
        ConfirmedTranscriptHashInput_[epoch]);

interim_transcript_hash_[epoch] =
    Hash(confirmed_transcript_hash_[epoch] ||
        InterimTranscriptHashInput_[epoch]);
```

> "In this notation, ConfirmedTranscriptHashInput_[epoch] and
> InterimTranscriptHashInput_[epoch] are based on the Commit that initiated the
> epoch with epoch number epoch. (Note that the epoch field in this Commit will be
> set to epoch - 1, since it is sent within the previous epoch.)"
>
> "The transcript hash ConfirmedTranscriptHashInput_[epoch] is used as the
> confirmed_transcript_hash input to the confirmation_tag field for this Commit.
> Each Commit thus confirms the whole transcript of Commits up to that point, except
> for the latest Commit's confirmation tag."
>
> "The transcript hashes computed in MLS represent a running hash over all Proposal
> and Commit messages that have ever been sent in a group. Commit messages are
> included directly. Proposal messages are indirectly included via the Commit that
> applied them. Messages of both types are included by hashing the
> AuthenticatedContent object in which they were sent."
>
> "New members compute the interim transcript hash using the confirmation_tag field
> of the GroupInfo struct, while existing members can compute it directly."

The `||` is plain byte concatenation of the previous hash value (raw bytes, no
length prefix) with the serialised input struct.

`ConfirmedTranscriptHashInput` is the Commit's `AuthenticatedContent` minus the
`confirmation_tag`: `wire_format`, `FramedContent`, and only the `signature` from
`FramedContentAuthData`. `InterimTranscriptHashInput` is just
`MAC confirmation_tag`, i.e. `varint(len) || tag`.

### 7.2 Confirmation tag (RFC 9420 §6.1)

```
confirmation_tag = MAC(confirmation_key, GroupContext.confirmed_transcript_hash)
```

`confirmation_key` is the **new** epoch's key, `confirmed_transcript_hash` is the
**new** epoch's value (i.e. `confirmed_transcript_hash_[n]` computed from this very
Commit). `MAC` is HMAC with the cipher suite hash, output at full length.
The tag bytes go into `FramedContentAuthData.confirmation_tag` and into
`GroupInfo.confirmation_tag`.

For epoch 0 (RFC 9420 §11): "Compute a confirmation_tag over the empty
confirmed_transcript_hash using the confirmation_key" — i.e.
`MAC(confirmation_key_[0], "")`.

### 7.3 Membership tag (RFC 9420 §6.2)

```
struct {
  FramedContentTBS content_tbs;
  FramedContentAuthData auth;
} AuthenticatedContentTBM;

membership_tag = MAC(membership_key, AuthenticatedContentTBM)
```

> "The membership_tag field in the PublicMessage object authenticates the sender's
> membership in the group. For messages sent by members, it MUST be set to the
> following value ..."
>
> "When decoding a PublicMessage into an AuthenticatedContent, the application MUST
> check membership_tag and MUST check that the FramedContentAuthData is valid."

Only present when `sender.sender_type == member`. `membership_key` is from the
epoch the message is sent in (the **old** epoch for a Commit).

---

## 8. Secret tree and message keys (RFC 9420 §9, §9.1, §6.3)

> RFC 9420 §9: "For the generation of encryption keys and nonces, the key schedule
> begins with the encryption_secret at the root and derives a tree of secrets with
> the same structure as the group's ratchet tree. Each leaf in the secret tree is
> associated with the same group member as the corresponding leaf in the ratchet
> tree."

### 8.1 Deriving the tree (Figure 25, verbatim)

```
tree_node_[N]_secret
        |
        |
        +--> ExpandWithLabel(., "tree", "left", KDF.Nh)
        |    = tree_node_[left(N)]_secret
        |
        +--> ExpandWithLabel(., "tree", "right", KDF.Nh)
             = tree_node_[right(N)]_secret
```

The root's secret is `encryption_secret`. The context strings are the ASCII
literals `"left"` (4 bytes) and `"right"` (5 bytes).

### 8.2 Initialising the ratchets (Figure 26, verbatim)

```
tree_node_[N]_secret
        |
        |
        +--> ExpandWithLabel(., "handshake", "", KDF.Nh)
        |    = handshake_ratchet_secret_[N]_[0]
        |
        +--> ExpandWithLabel(., "application", "", KDF.Nh)
             = application_ratchet_secret_[N]_[0]
```

`N` here is a **leaf** of the secret tree, i.e. the leaf corresponding to a group
member. Context is the empty string in both cases.

### 8.3 Advancing a ratchet (RFC 9420 §9.1, verbatim)

```
DeriveTreeSecret(Secret, Label, Generation, Length) =
    ExpandWithLabel(Secret, Label, Generation, Length)
```

> "Where Generation is encoded as a big endian uint32."

```
ratchet_secret_[N]_[j]
      |
      +--> DeriveTreeSecret(., "nonce", j, AEAD.Nn)
      |    = ratchet_nonce_[N]_[j]
      |
      +--> DeriveTreeSecret(., "key", j,  AEAD.Nk)
      |    = ratchet_key_[N]_[j]
      |
      V
DeriveTreeSecret(., "secret", j, KDF.Nh)
= ratchet_secret_[N]_[j+1]
```

> "Here AEAD.Nn and AEAD.Nk denote the lengths in bytes of the nonce and key for the
> AEAD scheme defined by the cipher suite."

Note the generation passed to the `"secret"` derivation is `j`, not `j+1`.

> RFC 9420 §9.1: "A sender ratchet starts from a per-sender base secret derived from
> a Secret Tree ... The sender uses the j-th key/nonce pair in the sequence to
> encrypt (using the AEAD) the j-th message they send during that epoch. Each
> key/nonce pair MUST NOT be used to encrypt more than one message."

Each member has **two** ratchets per epoch: `handshake` (for `proposal` and
`commit` content types) and `application` (for `application` content type), with
independent generation counters. RFC 9420 §6.3.1: "In the MLS key schedule, the
sender creates two distinct key ratchets for handshake and application messages for
each member of the group. When encrypting a message, the sender looks at the
ratchets it derived for its own member and chooses an unused generation from either
the handshake ratchet or the application ratchet, depending on the content type of
the message."

### 8.4 The reuse guard (RFC 9420 §6.3.1)

> "Before use in the encryption operation, the nonce is XORed with a fresh random
> value to guard against reuse. Because the key schedule generates nonces
> deterministically, a client MUST keep persistent state as to where in the key
> schedule it is; if this persistent state is lost or corrupted, a client might
> reuse a generation that has already been used, causing reuse of a key/nonce pair."
>
> "To avoid this situation, the sender of a message MUST generate a fresh random
> four-byte "reuse guard" value and XOR it with the first four bytes of the nonce
> from the key schedule before using the nonce for encryption. The sender MUST
> include the reuse guard in the reuse_guard field of the sender data object, so
> that the recipient of the message can use it to compute the nonce to be used for
> decryption."

```
+-+-+-+-+---------...---+
|   Key Schedule Nonce  |
+-+-+-+-+---------...---+
           XOR
+-+-+-+-+---------...---+
| Guard |       0       |
+-+-+-+-+---------...---+
           ===
+-+-+-+-+---------...---+
| Encrypt/Decrypt Nonce |
+-+-+-+-+---------...---+
```

So: `nonce[0..3] ^= reuse_guard[0..3]`, bytes 4..11 unchanged.

### 8.5 Content encryption (RFC 9420 §6.3.1)

AAD = serialised `PrivateContentAAD`; plaintext = serialised
`PrivateMessageContent` (content || auth || zero padding); key/nonce from the
sender's own ratchet at the chosen generation, nonce XORed with the reuse guard.
Output goes to `PrivateMessage.ciphertext`.

### 8.6 Sender data encryption (RFC 9420 §6.3.2)

> "The key and nonce provided to the AEAD are computed as the KDF of the first
> KDF.Nh bytes of the ciphertext generated in the previous section. If the length of
> the ciphertext is less than KDF.Nh, the whole ciphertext is used. In pseudocode,
> the key and nonce are derived as:"

```
ciphertext_sample = ciphertext[0..KDF.Nh-1]

sender_data_key = ExpandWithLabel(sender_data_secret, "key",
                      ciphertext_sample, AEAD.Nk)
sender_data_nonce = ExpandWithLabel(sender_data_secret, "nonce",
                      ciphertext_sample, AEAD.Nn)
```

> "The AAD for the SenderData ciphertext is the first three fields of
> PrivateMessage:"

```
struct {
    opaque group_id<V>;
    uint64 epoch;
    ContentType content_type;
} SenderDataAAD;
```

The sender-data nonce is **not** XORed with the reuse guard — it is already unique
because it is derived from a sample of the content ciphertext. Also note the
sample is taken from `PrivateMessage.ciphertext`, so the content must be encrypted
**before** the sender data.

### 8.7 Welcome key and nonce (RFC 9420 §12.4.3.1)

```
welcome_nonce = ExpandWithLabel(welcome_secret, "nonce", "", AEAD.Nn)
welcome_key = ExpandWithLabel(welcome_secret, "key", "", AEAD.Nk)
```

`Welcome.encrypted_group_info = AEAD.Seal(welcome_key, welcome_nonce, "",
GroupInfo)` — **empty AAD**. (The RFC does not spell out the AAD for this
encryption; the only reading consistent with the struct definitions and with
interoperable implementations is an empty AAD. Flagged as an under-specified point,
but it is not actually ambiguous in practice.)

### 8.8 Out-of-order handling (RFC 9420 §15.3)

> "Since each application message contains the group identifier, the epoch, and a
> generation counter, a client can receive messages out of order. When messages are
> received out of order, the client moves the sender ratchet forward to match the
> received generation counter. Any unused nonce and key pairs from the ratchet are
> potentially stored so that they can be used to decrypt the messages that were
> delayed or reordered."
>
> "Applications SHOULD also define a policy limiting the maximum number of steps
> that clients will move the ratchet forward in response to a new message. Messages
> received with a generation counter that is too much higher than the last message
> received would then be rejected. This avoids causing a denial-of-service attack by
> requiring the recipient to perform an excessive number of key derivations. For
> example, a malicious group member could send a message with generation =
> 0xffffffff at the beginning of a new epoch, forcing recipients to perform billions
> of key derivations unless they apply limits of the type discussed above."

Wire's core-crypto uses `OUT_OF_ORDER_TOLERANCE = 2` (how many already-used
generations to keep) and `MAXIMUM_FORWARD_DISTANCE = 1000` (how far the ratchet may
be advanced in one step), and `MAX_PAST_EPOCHS = 3`.

---

## 9. Tree hash (RFC 9420 §7.8)

> "Each node in a ratchet tree has a tree hash that summarizes the subtree below
> that node. The tree hash of the root is used in the GroupContext to confirm that
> the group agrees on the whole tree. Tree hashes are computed recursively from the
> leaves up to the root."
>
> "The tree hash of an individual node is the hash of the node's TreeHashInput
> object, which may contain either a LeafNodeHashInput or a ParentNodeHashInput
> depending on the type of node. LeafNodeHashInput objects contain the leaf_index
> and the LeafNode (if any). ParentNodeHashInput objects contain the ParentNode (if
> any) and the tree hash of the node's left and right children. For both parent and
> leaf nodes, the optional node value MUST be absent if the node is blank and
> present if the node contains a value."

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

> "The tree hash of an entire tree corresponds to the tree hash of the root node,
> which is computed recursively by starting at the leaf nodes and building up."

```
treeHash(node):
  if node is a leaf with leaf index L:
    return Hash( uint8(1) || uint32(L) || optional(leafNodeOrBlank) )
  else:
    return Hash( uint8(2) || optional(parentNodeOrBlank)
                 || opaque(treeHash(left(node)))
                 || opaque(treeHash(right(node))) )
```

`left_hash` and `right_hash` are `<V>`-prefixed (so `0x20 || 32 bytes` for
SHA-256).

---

## 10. Parent hash (RFC 9420 §7.9)

> "While tree hashes summarize the state of a tree at point in time, parent hashes
> capture information about how keys in the tree were populated."
>
> "When a client sends a Commit to change a group, it can include an UpdatePath to
> assign new keys to the nodes along its filtered direct path. When a client computes
> an UpdatePath (as defined in Section 7.5), it computes and signs a parent hash that
> summarizes the state of the tree after the UpdatePath has been applied. These
> summaries are constructed in a chain from the root to the member's leaf so that the
> part of the chain closer to the root can be overwritten as nodes set in one
> UpdatePath are reset by a later UpdatePath."
>
> "Consider a ratchet tree with a non-blank parent node P and children D and S (for
> "parent", "direct path", and "sibling"), with D and P in the direct path of a leaf
> node L (for "leaf"):"
>
> ```
>          ...
>          /
>         P
>       __|__
>      /     \
>     D       S
>    / \     / \
>  ... ... ... ...
>  /
> L
> ```
>
> "The parent hash of P changes whenever an UpdatePath object is applied to the
> ratchet tree along a path from a leaf L traversing node D (and hence also P). The
> new "Parent hash of P (with copath child S)" is obtained by hashing P's
> ParentHashInput struct."

```
struct {
    HPKEPublicKey encryption_key;
    opaque parent_hash<V>;
    opaque original_sibling_tree_hash<V>;
} ParentHashInput;
```

> "The field encryption_key contains the HPKE public key of P. If P is the root,
> then the parent_hash field is set to a zero-length octet string. Otherwise,
> parent_hash is the parent hash of the next node after P on the filtered direct path
> of the leaf L. This way, P's parent hash fixes the new HPKE public key of each
> non-blank node on the path from P to the root. Note that the path from P to the
> root may contain some blank nodes that are not fixed by P's parent hash. However,
> for each node that has an HPKE key, this key is fixed by P's parent hash."
>
> "Finally, original_sibling_tree_hash is the tree hash of S in the ratchet tree
> modified as follows: For each leaf L in P.unmerged_leaves, blank L and remove it
> from the unmerged_leaves sets of all parent nodes."
>
> "Observe that original_sibling_tree_hash does not change between updates of P.
> This property is crucial for the correctness of the protocol."
>
> "Note that original_sibling_tree_hash is the tree hash of S, not the parent hash.
> The parent_hash field in ParentHashInput captures information about the nodes above
> P. the original_sibling_tree_hash captures information about the subtree under S
> that is not being updated (and thus the subtree to which a path secret for P would
> be encrypted according to Section 7.5)."

Worked example from RFC 9420 §7.9:

> "For example, in the following tree:
> ```
>               W [F]
>         ______|_____
>        /             \
>       U               Y [F]
>     __|__           __|__
>    /     \         /     \
>   T       _       _       _
>  / \     / \     / \     / \
> A   B   C   D   E   F   G   _
> ```
> With P = W and S = Y, original_sibling_tree_hash is the tree hash of the following
> tree:
> ```
>       Y
>     __|__
>    /     \
>   _       _
>  / \     / \
> E   _   G   _
> ```
> Because W.unmerged_leaves includes F, F is blanked and removed from
> Y.unmerged_leaves."

Optimisation notes (RFC 9420 §7.9):

> "Note that no recomputation is needed if the tree hash of S is unchanged since the
> last time P was updated. This is the case for computing or processing a Commit
> whose UpdatePath traverses P, since the Commit itself resets P. (In other words, it
> is only necessary to recompute the original sibling tree hash when validating a
> group's tree on joining.) More generally, if none of the entries in
> P.unmerged_leaves are in the subtree under S (and thus no leaves were blanked), then
> the original tree hash at S is the tree hash of S in the current tree."
>
> "If it is necessary to recompute the original tree hash of a node, the efficiency of
> recomputation can be improved by caching intermediate tree hashes, to avoid
> recomputing over the subtree when the subtree is included in multiple parent hashes.
> A subtree hash can be reused as long as the intersection of the parent's unmerged
> leaves with the subtree is the same as in the earlier computation."

### 10.1 Using parent hashes (RFC 9420 §7.9.1)

> "In ParentNode objects and LeafNode objects with leaf_node_source set to commit,
> the value of the parent_hash field is the parent hash of the next non-blank parent
> node above the node in question (the next node in the filtered direct path). Using
> the node labels in Figure 20, the parent_hash field of D is equal to the parent hash
> of P with copath child S. This is the case even when the node D is a leaf node."
>
> "The parent_hash field of a LeafNode is signed by the member. The signature of such
> a LeafNode thus attests to which keys the group member introduced into the ratchet
> tree and to whom the corresponding secret keys were sent, in addition to the other
> contents of the LeafNode. This prevents malicious insiders from constructing
> artificial ratchet trees with a node D whose HPKE secret key is known to the
> insider, yet where the insider isn't assigned a leaf in the subtree rooted at D.
> Indeed, such a ratchet tree would violate the tree invariant."

**Computation order when creating an UpdatePath:** the chain is computed from the
**root down to the leaf**, because each node's `parent_hash` depends on the node
above it. RFC 9420 §7.5: "Note that these hashes are computed from root to leaf, so
that each hash incorporates all the non-blank nodes above it. The root node always
has a zero-length hash for its parent hash."

Concretely, for the committer's filtered direct path `[p_0, p_1, ..., p_{k-1}]`
(leaf-to-root order, so `p_{k-1}` is the root):

```
ph_[k] = ""                                   // above the root
for i = k-1 down to 0:
    S_i = the child of p_i that is NOT on the committer's direct path (copath child)
    ph_i = Hash( ParentHashInput {
                   encryption_key = p_i.encryption_key (the NEW key),
                   parent_hash = ph_[i+1],
                   original_sibling_tree_hash = originalTreeHash(S_i, p_i.unmerged_leaves)
                 } )
    p_i.parent_hash = ph_[i+1]                // node stores its PARENT's hash
leaf.parent_hash = ph_0                       // leaf stores the hash of p_0
```

Read that carefully: `p_i.parent_hash` holds the hash **of the node above it**
(`ph_[i+1]`), while `ph_i` is the hash **of** `p_i`, which is stored one level
down. The leaf stores `ph_0` (the hash of the lowest filtered-direct-path node).
The root's own `parent_hash` field is the zero-length string.

Since the Commit resets every node on the filtered direct path, the
`unmerged_leaves` of each `p_i` is empty at that moment, so
`originalTreeHash(S_i, {})` is just the ordinary tree hash of `S_i` in the new
tree.

### 10.2 Verifying parent hashes (RFC 9420 §7.9.2)

> "Parent hashes are verified at two points in the protocol: When joining a group and
> when processing a Commit."
>
> "The parent hash in a node D is valid with respect to a parent node P if the
> following criteria hold. Here C and S are the children of P (for "child" and
> "sibling"), with C being the child that is on the direct path of D (possibly D
> itself) and S being the other child:
>
> *  D is a descendant of P in the tree.
> *  The parent_hash field of D is equal to the parent hash of P with copath child S.
> *  D is in the resolution of C, and the intersection of P's unmerged_leaves with the
>    subtree under C is equal to the resolution of C with D removed.
>
> These checks verify that D and P were updated at the same time (in the same
> UpdatePath), and that they were neighbors in the UpdatePath because the nodes in
> between them would have omitted from the filtered direct path."
>
> "A parent node P is "parent-hash valid" if it can be chained back to a leaf node in
> this way. That is, if there is leaf node L and a sequence of parent nodes P_1, ...,
> P_N such that P_N = P and each step in the chain is authenticated by a parent hash,
> then L's parent hash is valid with respect to P_1, P_1's parent hash is valid with
> respect to P_2, and so on."
>
> "When joining a group, the new member MUST authenticate that each non-blank parent
> node P is parent-hash valid. This can be done "bottom up" by building chains up from
> leaves and verifying that all non-blank parent nodes are covered by exactly one such
> chain, or "top down" by verifying that there is exactly one descendant of each
> non-blank parent node for which the parent node is parent-hash valid."
>
> "When processing a Commit message that includes an UpdatePath, clients MUST
> recompute the expected value of parent_hash for the committer's new leaf and verify
> that it matches the parent_hash value in the supplied leaf_node. After being merged
> into the tree, the nodes in the UpdatePath form a parent-hash chain from the
> committer's leaf to the root."

### 10.3 Worked evolution example (RFC 9420 Appendix B)

Kept in full because it is the clearest available check on an implementation.

> "Consider the following sequence of operations:
>
> 1.  A initializes a new group
> 2.  A adds B to the group with a full Commit
> 3.  B adds C and D to the group with a full Commit
> 4.  C sends an empty Commit
>
> ```
>                           Y                   Y'
>                           |                   |
>                         .-+-.               .-+-.
>    ==>         ==>     /     \     ==>     /     \
>           X           X'      _=Z         X'      Z'
>          / \         / \     / \         / \     / \
> A       A   B       A   B   C   D       A   B   C   D
> ```
>
> Then the parent hashes associated to the nodes will be updated as follows (where we
> use the shorthand ph for parent hash, th for tree hash, and osth for original
> sibling tree hash):
>
> 1.  A adds B: set X
>     *  A.parent_hash = ph(X) = H(X, ph="", osth=th(B))
> 2.  B adds C, D: set B', X', and Y
>     *  X'.parent_hash = ph(Y) = H(Y, ph="", osth=th(Z)), where th(Z) covers (C, _, D)
>     *  B'.parent_hash = ph(X') = H(X', ph=X'.parent_hash, osth=th(A))
> 3.  C sends empty Commit: set C', Z', Y'
>     *  Z'.parent_hash = ph(Y') = H(Y', ph="", osth=th(X')), where th(X') covers (A, X', B')
>     *  C'.parent_hash = ph(Z') = H(Z', ph=Z'.parent_hash, osth=th(D))
>
> When a new member joins, they will receive a tree that has the following parent hash
> values and compute the indicated parent hash validity relationships:
>
> | Node | Parent Hash Value                    | Valid?               |
> | A    | H(X, ph="", osth=th(B))              | No, B changed        |
> | B'   | H(X', ph=X'.parent_hash, osth=th(A)) | Yes                  |
> | C'   | H(Z', ph=Z'.parent_hash, osth=th(D)) | Yes                  |
> | D    | (none, never sent an UpdatePath)     | N/A                  |
> | X'   | H(Y, ph="", osth=th(Z))              | No, Y and Z changed  |
> | Z'   | H(Y', ph="", osth=th(X'))            | Yes                  |
>
> In other words, the joiner will find the following path-hash links in the tree:
>
> ```
>        Y'
>        |
>        +-.
>           \
>    X'      Z'
>     \     /
>  A   B'  C'  D
> ```
>
> Since these chains collectively cover all non-blank parent nodes in the tree, the
> tree is parent-hash valid."
>
> "Note that this tree, though valid, contains invalid parent-hash links. If a client
> were checking parent hashes top-down from Y', for example, they would find that X'
> has an invalid parent hash relative to Y', but that Z' has a valid parent hash.
> Likewise, if the client were checking bottom-up, they would find that the chain from
> B' ends in an invalid link from X' to Y'. These invalid links are the natural result
> of multiple clients having committed."
>
> "In the particular case where a new member first receives the tree for a group (e.g.,
> in a ratchet tree GroupInfo extension Section 12.4.3.3), the parent hashes will be
> expressed in the tree representation, but the tree hash need not be. Instead, the new
> member will recompute the tree hashes for all the nodes in the tree, verifying that
> this matches the tree hash in the GroupInfo object."

---

## 11. Ratchet-tree key derivation (RFC 9420 §7.4)

> "A member updates the nodes along its direct path as follows:
>
> *  Blank all the nodes on the direct path from the leaf to the root.
> *  Generate a fresh HPKE key pair for the leaf.
> *  Generate a sequence of path secrets, one for each node on the leaf's filtered
>    direct path, as follows. In this setting, path_secret[0] refers to the first
>    parent node in the filtered direct path, path_secret[1] to the second parent
>    node, and so on."

```
path_secret[0] is sampled at random
path_secret[n] = DeriveSecret(path_secret[n-1], "path")
```

> "*  Compute the sequence of HPKE key pairs (node_priv,node_pub), one for each node
>    on the leaf's direct path, as follows."

```
node_secret[n] = DeriveSecret(path_secret[n], "node")
node_priv[n], node_pub[n] = KEM.DeriveKeyPair(node_secret[n])
```

> "The node secret is derived as a temporary intermediate secret so that each secret
> is only used with one algorithm: The path secret is used as an input to
> DeriveSecret, and the node secret is used as an input to DeriveKeyPair."

`path_secret[0]` is `KDF.Nh` random bytes. `commit_secret` is
`DeriveSecret(path_secret[n], "path")` where `path_secret[n]` is the **last**
(root) path secret — i.e. `path_secret[n+1]` in the chain (RFC 9420 §12.4.1).

The committer's own new leaf key pair is generated freshly (RFC 9420 §7.5: "Set the
encryption_key to the public key of a freshly sampled key pair.") and is **not**
derived from `path_secret[0]`. Figure 14 shows a `leaf_secret ->
leaf_node_secret -> leaf_priv, leaf_pub` derivation, but §7.5 only requires "a
freshly sampled key pair", so a plain random keypair is compliant and simpler.

---

## 12. Size reference for cipher suites 0x0001 / 0x0003

| Quantity | 0x0001 | 0x0003 |
|---|---|---|
| `KDF.Nh` (secret sizes: path secrets, epoch secrets, psk_nonce, group_id recommendation) | 32 | 32 |
| `Hash` digest (tree hash, parent hash, transcript hashes, refs) | 32 | 32 |
| `MAC` tag (confirmation_tag, membership_tag) | 32 | 32 |
| `AEAD.Nk` | 16 | 32 |
| `AEAD.Nn` | 12 | 12 |
| `AEAD.Nt` (ciphertext expansion) | 16 | 16 |
| `KEM.Nenc` (`HPKECiphertext.kem_output`) | 32 | 32 |
| `KEM.Npk` / `Nsk` (HPKE public/private key) | 32 | 32 |
| Ed25519 public key / signature | 32 / 64 | 32 / 64 |

---

## 13. Testing strategy

The official RFC 9420 interop test vectors (mlswg/mls-implementations, `test-vectors/`)
cover exactly the pieces documented here and are the only practical way to be sure:

* `crypto-basics.json` — `RefHash`, `ExpandWithLabel`, `DeriveSecret`,
  `DeriveTreeSecret`, `SignWithLabel`, `EncryptWithLabel`.
* `secret-tree.json` — secret tree and ratchets.
* `key-schedule.json` — the full epoch key schedule including `psk_secret`.
* `psk_secret.json` — resolves the §6.4 ambiguity.
* `tree-math.json` — the Appendix C index arithmetic.
* `tree-validation.json`, `tree-operations.json` — tree hash, parent hash,
  resolution.
* `transcript-hashes.json` — §7 formulas.
* `message-protection.json` — PublicMessage/PrivateMessage framing end to end.
* `welcome.json`, `passive-client-*.json` — the joiner path.

Build the primitives bottom-up in that order; every layer above is meaningless if
`ExpandWithLabel` is off by one length prefix.
