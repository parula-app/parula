# 07 — How Wire uses MLS (RFC 9420)

Scope: **only the Wire-specific parts.** The generic MLS protocol (TreeKEM, key schedule, framing,
proposal/commit semantics, HPKE, secret tree, …) is covered in a separate document. This one tells you
what Wire puts *into* those generic structures, which endpoints carry them, and which byte layouts the
Wire backend actually parses.

Source repositories referenced below (all read-only clones):

| prefix | repo | role |
|---|---|---|
| `wire-server/` | `wire-server` (Haskell) | **authoritative** — the backend parses/validates every byte |
| `core-crypto/` | `core-crypto` (Rust) | the MLS engine all official Wire clients embed |
| `wire-webapp/` | `wire-webapp` monorepo (TS) | reference client + api-client bindings |

Citations are `path:line`. Where a claim could not be verified from these sources it is marked
**UNVERIFIED**.

---

## 0. Terminology and conventions used throughout

* **TLS presentation language** (RFC 8446 §3) is the serialisation for everything MLS. Wire's Haskell
  implementation of it is `wire-server/libs/wire-api/src/Wire/API/MLS/Serialisation.hs`.
* `<V>` = variable-length vector with the MLS **VarInt** length prefix
  (`wire-server/libs/wire-api/src/Wire/API/MLS/Serialisation.hs:88-118`):

  | prefix bits | encoded length | usable bits | range |
  |---|---|---|---|
  | `00` | 1 byte | 6 | 0 – 63 |
  | `01` | 2 bytes (big-endian, top 2 bits `01`) | 14 | 64 – 16383 |
  | `10` | 4 bytes (big-endian, top 2 bits `10`) | 30 | 16384 – 1073741823 |
  | `11` | invalid | — | — |

* All fixed-width integers are **big-endian** (`Data.Binary` `putWord16be`/`putWord32be`).
* Enums on the wire are 1-based in Wire's Haskell parser: value `0` is "reserved", value `n` maps to
  constructor index `n-1` (`Serialisation.hs:179-213`). This matches RFC 9420's IANA registries where
  `0` is always reserved.
* API paths below are relative to the versioned API root, i.e. real URL =
  `https://<backend>/v<N>/<path>`. MLS endpoints exist from **API version 5**
  (`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Galley/MLS.hs:62` `From 'V5`).
* Authentication is the normal Wire bearer token. `Z-User`, `Z-Client`, `Z-Connection` in the Haskell
  route definitions are **internal** headers injected by the `nginz` gateway from the access token —
  a client does not set them. In particular the "own client id" used by
  `POST /mls/key-packages/claim/...` comes from the access token's client claim
  (`wire-server/libs/wire-api/src/Wire/API/Routes/Public.hs:135-140, 220`).

---

## 1. Ciphersuites

### 1.1 The four suites Wire's backend understands

`wire-server/libs/wire-api/src/Wire/API/MLS/CipherSuite.hs:117-122,182-185`:

| Wire tag | numeric ID | KEM | AEAD | Hash | Signature |
|---|---|---|---|---|---|
| `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` | `0x0001` | DHKEM(X25519, HKDF-SHA256) | AES-128-GCM | SHA-256 | Ed25519 |
| `MLS_128_DHKEMP256_AES128GCM_SHA256_P256` | `0x0002` | DHKEM(P-256, HKDF-SHA256) | AES-128-GCM | SHA-256 | ECDSA P-256 + SHA-256 |
| `MLS_256_DHKEMP521_AES256GCM_SHA512_P521` | `0x0005` | DHKEM(P-521, HKDF-SHA512) | AES-256-GCM | SHA-512 | ECDSA P-521 + SHA-512 |
| `MLS_256_DHKEMP384_AES256GCM_SHA384_P384` | `0x0007` | DHKEM(P-384, HKDF-SHA384) | AES-256-GCM | SHA-384 | ECDSA P-384 + SHA-384 |

Note the **non-contiguous IDs**: `0x0003`, `0x0004`, `0x0006` (the ChaCha20-Poly1305 and Ed448 suites)
are *not* accepted by the backend. Hash algorithm per suite: `CipherSuite.hs:190-194`. Signature scheme
per suite: `CipherSuite.hs:259-263`.

Signature-scheme names, used as JSON keys everywhere (`CipherSuite.hs:339-343`):

```
Ed25519                 -> "ed25519"
Ecdsa_secp256r1_sha256  -> "ecdsa_secp256r1_sha256"
Ecdsa_secp384r1_sha384  -> "ecdsa_secp384r1_sha384"
Ecdsa_secp521r1_sha512  -> "ecdsa_secp521r1_sha512"
```

ECDSA signatures are DER-encoded `SEQUENCE { r INTEGER, s INTEGER }` (Wire wraps
`Wire.API.MLS.ECDSA.encodeSignature`); Ed25519 signatures are the raw 64 bytes.

`core-crypto` additionally *supports* `MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519` and
advertises it in leaf-node capabilities (`core-crypto/crypto/src/mls/conversation/config.rs:49-55`),
but the Wire backend will reject a group whose GroupInfo names it
(`CipherSuite.hs:174-178` returns `Nothing` → "Unsupported ciphersuite").

### 1.2 Query-parameter encoding of a ciphersuite

Where a ciphersuite appears as a query parameter it is written **hex with `0x` prefix**
(`CipherSuite.hs:104-115`): `?ciphersuite=0x0001`. The parser also accepts bare hex without `0x`.
Comma-separated lists use the same encoding: `?ciphersuites=0x0001,0x0002`
(`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:196-212`).

### 1.3 Which suite to use — three independent sources

1. **Team feature config** `GET /feature-configs` → `mls` entry
   (`wire-server/libs/wire-api/src/Wire/API/Team/Feature.hs:1144-1159`):

   ```json
   { "status": "enabled", "lockStatus": "unlocked",
     "config": { "protocolToggleUsers": [],
                 "defaultProtocol": "proteus" | "mls" | "mixed",
                 "allowedCipherSuites": [1],
                 "defaultCipherSuite": 1,
                 "supportedProtocols": ["proteus", "mls"],
                 "groupInfoDiagnostics": false } }
   ```

   Ciphersuites here are **plain JSON numbers**, not hex strings (`Feature.hs:1155-1156`,
   `CipherSuite.hs:138-150`). `defaultProtocol` decides whether new conversations are created as MLS.

   The hard-coded fallback in wire-server is `defaultCipherSuite = 0x0002`
   (`Feature.hs:1133-1142`), and the shipped Helm chart also sets
   `allowedCipherSuites: [2] / defaultCipherSuite: 2`
   (`wire-server/charts/wire-server/values.yaml:196-207`). **UNVERIFIED**: what the Wire *cloud*
   (`wire.com`) actually serves — the value is per-deployment and per-team, so a client MUST read it
   from the feature config rather than hard-code it. Treat `0x0001` and `0x0002` as the two you will
   realistically meet; `core-crypto`'s own `Default` is `0x0001`
   (`core-crypto/crypto/src/mls/cipher_suite.rs:29-33`).

   The official web client feeds exactly these two fields into its MLS layer
   (`wire-webapp/apps/webapp/src/script/repositories/client/clientMLSConfig.ts:30-37`):
   `defaultCiphersuite = config.defaultCipherSuite`, `ciphersuites = config.allowedCipherSuites`.

2. **`GET /mls/public-keys`** tells you which signature schemes the backend has removal keys for
   (§5). A suite is unusable if the backend has no removal key for its signature scheme.

3. **Per-conversation** `cipher_suite` field. Present in the conversation JSON only once the group is
   *active* (epoch ≥ 1) — see §6.4.

---

## 2. Wire's MLS Credential

### 2.1 Credential wire format (RFC 9420 §5.3, as Wire parses it)

`wire-server/libs/wire-api/src/Wire/API/MLS/Credential.hs:47,55-77`:

```
struct {
  uint16 credential_type;      // 1 = basic, 2 = x509
  select (credential_type) {
    case basic:  opaque identity<V>;
    case x509:   Certificate certificates<V>;   // vector of opaque cert_data<V>, DER, leaf first
  }
} Credential;
```

Wire supports exactly these two types; anything else fails to parse.

### 2.2 BasicCredential identity — the exact bytes

The identity is the **UTF-8 ASCII string**

```
<user-uuid>:<client-id>@<domain>
```

with:

* `<user-uuid>` — the user id as a **lower-case hyphenated UUID, exactly 36 ASCII bytes**
  (`8-4-4-4-12`). The Haskell parser reads exactly 36 bytes and calls `fromASCIIBytes`
  (`Credential.hs:125-126,128-136`); the serialiser writes `toASCIIBytes (toUUID uid)`
  (`Credential.hs:166-172`).
* `:` — U+003A, one byte `0x3A`.
* `<client-id>` — the 64-bit Wire client id as **lower-case hexadecimal with no `0x` prefix and no
  leading zeros** (`wire-server/libs/types-common/src/Data/Id.hs:358-374`:
  `clientToText = hexadecimal . clientToWord64`; the doc string at `Id.hs:383-385` states
  "lowercase digits and no leading zeros"). Length is therefore 1–16 hex characters, typically 16.
* `@` — U+0040, one byte `0x40`.
* `<domain>` — the ASCII backend domain of the *user*, e.g. `wire.com`, `staging.zinfra.io`. Read to
  end-of-input by the parser (`Credential.hs:135`).

Worked example (a real-looking id):

```
fb880fac-b549-4d8b-9398-4246324c7b85:67f41928e2844b6c@staging.zinfra.io
```

71 bytes of ASCII (36 + 1 + 16 + 1 + 17). Serialised inside a Credential this becomes:

```
00 01                                   credential_type = basic (1)
3e                                      VarInt length 62  (0x3e < 64 -> 1-byte form)
66 62 38 38 30 ... 69 6f                the 62 ASCII bytes above
```

The same string is what `core-crypto` calls the "client id" and what it hands to
`Credential::new_basic` verbatim:
`format!("{user_id:hyphenated}:{device_id:x}@{domain}")`
(`core-crypto/crypto/src/mls/session/id.rs:31-48`), then
`mls_credential: MlsCredential::new_basic(client_id.into_inner())`
(`core-crypto/crypto/src/mls/credential/mod.rs:91-105`). The web client builds the identical string in
TypeScript: `` `${userId}:${clientId}@${domain}` ``
(`wire-webapp/libraries/core/src/util/fullyQualifiedClientIdUtils.ts:28-32`, used by
`generateMLSDeviceId` in `wire-webapp/libraries/core/src/messagingProtocols/mls/utils/mlsId.ts:30-33`).

⚠️ There is **no length prefix, no domain-of-the-conversation, and no trailing NUL**. The separator
order is `uuid` `:` `clientid` `@` `domain` — not `clientid:uuid`, not `@` before `:`.

### 2.3 Special identity: the backend's own external-sender credential

The delivery service (backend) is added to the group as an external sender with a BasicCredential
whose identity is the literal ASCII string **`wire-server`** (11 bytes)
(`core-crypto/crypto/src/mls/external_sender.rs:9,34,48`). See §5.

### 2.4 Special identity: history-sharing clients

A group may contain a "history client" whose BasicCredential identity is
`history-client:<uuid-36>` (`wire-server/libs/wire-api/src/Wire/API/MLS/Credential.hs:145-151`,
`core-crypto/crypto/src/mls/session/id.rs:61-65`). The backend enforces at most one per group
(`mls-history-client-duplication`). A first implementation can ignore this; just do not choke when a
leaf's identity does not parse as `uuid:hex@domain`.

### 2.5 X509Credential identity (E2EI) — the exact bytes

The credential holds a DER certificate **chain, leaf first** (`Credential.hs:75-77`,
`KeyPackage.hs:238-247` uses `(c : _)` = head as the leaf). The Wire client identity lives in the
leaf certificate's **Subject Alternative Name**, as a `uniformResourceIdentifier` GeneralName with
this exact shape (`wire-server/libs/wire-api/src/Wire/API/MLS/KeyPackage.hs:264-273` and the parser
at `Credential.hs:153-164`):

```
wireapp://<user-id-b64url>%21<client-id-hex>@<domain>
```

* `<user-id-b64url>` — the 16 raw bytes of the user UUID, **base64url without padding**, therefore
  **exactly 22 characters** (`Credential.hs:156-159`: `getByteString 22` then
  `B64URL.decodeUnpadded`). This is *different* from the BasicCredential, which uses the hyphenated
  36-char form.
* `%21` — literal percent-encoded `!` (three ASCII bytes), *not* `:` (`Credential.hs:160`).
* `<client-id-hex>` — same lower-case hex 64-bit client id as above.
* `@<domain>` — same.

Example: `wireapp://LcksJb74Tm6N12cDjFy7lQ%218e6424430d3b28be@wire.com`
(cf. the doc comment in `core-crypto/crypto/src/mls/session/user_id.rs:9`, which shows the decoded
`!` form).

The leaf certificate also carries, in the same SAN, a second URI holding the user's **qualified
handle**, and in the Subject: `CN = display name`, `O = domain`
(`core-crypto/e2e-identity/src/acquisition/identity.rs:105-158`). The backend validates that the
certificate's `SubjectPublicKeyInfo` equals the leaf node's `signature_key`
(`wire-server/libs/wire-api/src/Wire/API/MLS/Validation.hs:119-136`).

### 2.6 Leaf-node capability requirement enforced by the backend

`validateCapabilities` rejects a leaf node whose `capabilities.credentials` list does not contain the
credential type of its own credential (`Validation.hs:152-155`). So a basic-credential leaf **must**
advertise credential type `1` in its capabilities; an x509 leaf must advertise `2`.
`core-crypto` always advertises both (`config.rs:45-46,85-93`).

---

## 3. `group_id`

### 3.1 Who creates it

**The backend.** When you `POST /conversations` with `protocol: "mls"`, galley derives the group id
from the freshly minted conversation id and returns it in the conversation object
(`wire-server/libs/wire-subsystems/src/Wire/StoredConversation.hs:174-190` →
`MLS.newGroupId meta.cnvmType (Conv <$> tUntagged lcnv)`). A client never invents a group id.

### 3.2 Byte layout

`wire-server/libs/wire-api/src/Wire/API/MLS/Group/Serialisation.hs:82-97`. Two versions exist.

**Version 1** (`newGroupId`, `Serialisation.hs:155-156` — what you get for every newly created
conversation and subconversation today):

```
uint16  version        = 0x0001
uint16  conv_type              // 0 regular, 1 self, 2 one2one, 3 connect
opaque  conv_uuid[16]          // raw 16 bytes of the conversation UUID (network order)
uint8   subconv_len            // 0 for a main conversation
opaque  subconv_id[subconv_len]// ASCII, e.g. "conference"
uint32  gid_gen                // PRESENT ONLY IF subconv_len > 0
opaque  domain[..]             // ASCII domain, runs to the end of the blob, NO length prefix
```

The `gid_gen` field is written only when the version is > 1 **or** a subconversation id is present
(`Serialisation.hs:91-92`), and the reader mirrors that (`Serialisation.hs:113-116`).

**Version 2** (`nextGenGroupId`, produced when a conversation or subconversation is *reset* —
`Serialisation.hs:158-164`):

```
uint16  version        = 0x0002
uint16  conv_type
opaque  conv_uuid[16]
uint8   subconv_len
opaque  subconv_id[subconv_len]
uint32  gid_gen                // ALWAYS present; incremented on each reset
uint16  domain_len             // ALWAYS present in v2
opaque  domain[domain_len]
// v2 is explicitly extensible: any trailing bytes must be ignored (Serialisation.hs:127-131)
```

Worked v1 example — regular conversation `1234abcd-…` on `example.com` (11 bytes):

```
00 01                     version 1
00 00                     conv_type 0 (regular)
12 34 ab cd .. .. (16B)   conversation UUID
00                        no subconversation
65 78 61 6d 70 6c 65 2e 63 6f 6d      "example.com"
```

Total 32 bytes. A `conference` subconversation of the same conversation is 4 bytes of `gid_gen` and
10 bytes of `"conference"` longer, i.e. 46 bytes, with `subconv_len = 0x0a`.

### 3.3 Client rules

* **Treat it as opaque.** The backend says so explicitly: "not assumed to be stable over time or even
  consistent among different backends" (`Serialisation.hs:80-81`). Never regenerate it; never parse it
  to find the conversation — use the `qualified_conversation` field on events instead.
* In JSON it is always **standard base64 (padded)**
  (`wire-server/libs/wire-api/src/Wire/API/MLS/Group.hs:49-53`,
  `Conversation/Protocol.hs:120-124` "A base64-encoded MLS group ID"). Base64-**decode** it before
  handing it to your MLS engine, and base64-encode it again when you use it as a local map key
  (this is exactly what the web client does:
  `Decoder.fromBase64(groupId).asBytes` / `Encoder.toBase64(...).asString`,
  e.g. `wire-webapp/libraries/core/src/messagingProtocols/mls/mlsService/mlsService.ts:338,472,512`).
* Inside the MLS `GroupContext` it is a `opaque group_id<V>` — length-prefixed
  (`Group.hs:43-47`).
* When a conversation is reset the backend hands you a **new** group id in
  `conversation.mls-reset` (`new_group_id`,
  `wire-server/libs/wire-api/src/Wire/API/Event/Conversation.hs:504-517`). You must wipe the old local
  group and start over.

---

## 4. Key packages

All four endpoints live under `<root>/mls/key-packages/...` and are served by **brig**
(`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:1594-1705`).

### 4.1 Upload — `POST /mls/key-packages/self/:client`

`Brig.hs:1596-1607`. Body is JSON:

```json
{ "key_packages": ["<base64 of a TLS-serialised KeyPackage>", "..."] }
```

`key_packages` is a JSON array of **standard base64** strings, each the complete
`KeyPackage` structure (`wire-server/libs/wire-api/src/Wire/API/MLS/KeyPackage.hs:65-75`,
`276-282`). `201` on success, empty body. There is no ciphersuite parameter — it is read out of each
key package.

Server-side validation on upload
(`wire-server/services/brig/src/Brig/API/MLS/KeyPackages/Validation.hs:51-85`, which calls
`wire-server/libs/wire-api/src/Wire/API/MLS/Validation.hs:41-78`):

1. ciphersuite must be one of the four (§1.1);
2. `KeyPackageTBS` signature verifies under `leaf_node.signature_key` with label
   `"KeyPackageTBS"` (RFC label prefix `"MLS 1.0 "` is added, `CipherSuite.hs:233-238`);
3. `protocol_version` must be `1` (MLS 1.0) — `ProtocolVersion.hs:58-70`;
4. the leaf node signature verifies with label `"LeafNodeTBS"`;
5. **the credential identity must equal the uploading client's identity** — else
   `mls-identity-mismatch` (`Validation.hs:108-117`);
6. `leaf_node.source` must be `key_package(1)` and carry a `Lifetime`;
7. `not_before <= now < not_after`, and if the backend configures a maximum,
   `not_after <= now + max` (`wire-server/libs/wire-subsystems/src/Wire/MlsKeyPackageSubsystem.hs:42-46`);
8. `capabilities.credentials` contains the leaf's own credential type (§2.6);
9. **`leaf_node.signature_key` must byte-equal the key previously registered as the client's
   `mls_public_keys[<signature scheme>]`** — otherwise `mls-protocol-error` "Unrecognised signature
   key" (`Validation.hs:63-81`). So §4.5 must happen *before* the first upload.

### 4.2 Replace — `PUT /mls/key-packages/self/:client?ciphersuites=0x0001,...`

`Brig.hs:1609-1637`. Same body; deletes the existing unclaimed key packages for the listed
ciphersuites and installs the new batch. From API v8 the `ciphersuites` parameter is required; on
v5–v7 it defaults to `0x0001`. Used after E2EI enrolment swaps the credential type. "Use this
sparingly" per the endpoint description.

### 4.3 Count — `GET /mls/key-packages/self/:client/count?ciphersuite=0x0001`

`Brig.hs:1663-1685`. Response `{"count": 42}`
(`KeyPackage.hs:120-127`). From v8 `ciphersuite` is mandatory; on v5–v7 it defaults to `0x0001`.

### 4.4 Claim — `POST /mls/key-packages/claim/:domain/:user?ciphersuite=0x0001`

`Brig.hs:1638-1662`. **One key package per client of the target user**, consumed atomically. Response
(`KeyPackage.hs:93-118`, plus `qualifiedObjectSchema` at
`wire-server/libs/types-common/src/Data/Qualified.hs:200-207`):

```json
{ "key_packages": [
    { "user": "<user uuid>",
      "domain": "<user domain>",
      "client": "<client id hex>",
      "key_package": "<base64 KeyPackage>",
      "key_package_ref": "<base64 32-byte ref>" } ] }
```

Note the qualified user is flattened into two sibling fields `user` + `domain`, not a nested object.
The TS binding mirrors this exactly (`wire-webapp/libraries/api-client/src/client/clientApi.ts:30-38`).

`key_package_ref` = `RefHash("MLS 1.0 KeyPackage Reference", key_package_bytes)` — i.e. the
ciphersuite hash of `SignContent{ label = "MLS 1.0 KeyPackage Reference", content = raw KP }`
(`KeyPackage.hs:164-178`, `CipherSuite.hs:196-198`, `Context.hs:22-24`). Same value RFC 9420 calls
`KeyPackageRef`.

**Skipping your own client**: when the target user *is* you, the backend omits the key package of the
client identified by the request's own client id (`Z-Client`, taken from the access token) —
`wire-server/services/brig/src/Brig/API/MLS/KeyPackages.hs:143,159-164`. The TS api-client also
appends a `?skip_own=<clientid>` query parameter
(`wire-webapp/libraries/api-client/src/client/clientApi.ts:233-235`); current wire-server master does
**not** read such a query parameter — the behaviour comes from the token. Treat `skip_own` as
harmless/legacy. **UNVERIFIED** whether older deployments honour it.

If a user has uploaded no key packages you get `{"key_packages": []}` (not an error); the official
client treats that user as "not MLS capable"
(`wire-webapp/.../mlsService.ts:412-417`).

### 4.5 Delete — `DELETE /mls/key-packages/self/:client?ciphersuite=0x0001`

`Brig.hs:1686-1710`. Body `{"key_packages": ["<base64 ref>", ...]}` — these are **key package refs**,
not key packages (`KeyPackage.hs:129-141`); 1–1000 entries. Response `201`, empty.

### 4.6 Registering the signature public key — `mls_public_keys`

On `POST /clients` or `PUT /clients/:id`, the client sends
(`wire-server/libs/wire-api/src/Wire/API/User/Client.hs:513-541,590-591,802,887`):

```json
{ "mls_public_keys": { "ed25519": "<base64 raw public key>" } }
```

The type is `Map SignatureSchemeTag ByteString` (`Client.hs:520`) — key = signature scheme name from
§1.1, value = **standard base64 of the raw public key bytes** (32 bytes for Ed25519; the uncompressed
SEC1 point `04||X||Y` for the ECDSA suites, matching how the backend encodes its own keys at
`wire-server/libs/wire-api/src/Wire/API/MLS/Keys.hs:96-103`). The same map is returned on `GET
/clients/:id`, which is how a client detects "am I already MLS-registered, and with which key"
(`wire-webapp/.../mlsService.ts:216-238,984-997`).

### 4.7 How many, and when to replenish (official-client policy)

`wire-webapp/libraries/core/src/messagingProtocols/mls/mlsService/mlsService.ts`:

* target count `nbKeyPackages = 100` (line 111-114, `defaultConfig`);
* "min required" = `floor(nbKeyPackages / 2)` = **50** (line 185-187);
* on client init, `mlsInit(clientId, ciphersuites, nbKeyPackages)` generates the initial batch
  locally (line 210-213), then uploads (line 232-236);
* a **daily** background task calls `verifyRemoteMLSKeyPackagesAmount` (line 925-938);
* that task does `GET .../count`; if `count > 50` it does nothing, else it generates `100` fresh key
  packages and `POST`s them (line 953-963);
* additionally, **every time a `conversation.mls-welcome` arrives** the client re-checks its local
  count first (a welcome means one of its key packages was consumed) — line 1192-1201 →
  `verifyLocalMLSKeyPackagesAmount` (line 945-951).

Key package **lifetime** generated by core-crypto: `60*60*24*28*3` seconds ≈ **84 days / ~3 months**
(`core-crypto/crypto/src/transaction_context/key_package.rs:17-18,36`). Each generated key package
gets `leaf_node_capabilities = ConversationConfiguration::default_leaf_capabilities()` (§6.2) and
`ProtocolVersion::default()` = MLS 1.0 (`key_package.rs:41-56`).

---

## 5. Removal key / backend public keys

### 5.1 `GET /mls/public-keys[?format=raw|jwk]`

`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Galley/MLS.hs:135-155`. Response shape
(`wire-server/libs/wire-api/src/Wire/API/MLS/Keys.hs:38-66,89-94`):

```json
{ "removal": {
    "ed25519":                "<base64 raw 32-byte Ed25519 public key>",
    "ecdsa_secp256r1_sha256": "<base64 SEC1 uncompressed point>",
    "ecdsa_secp384r1_sha384": "<base64 ...>",
    "ecdsa_secp521r1_sha512": "<base64 ...>" } }
```

`format=jwk` returns each key as a nested JWK object instead
(`{"kty":"OKP","crv":"Ed25519","x":"<base64url>"}` for Ed25519,
`{"kty":"EC","crv":"P-256","x":..,"y":..}` for ECDSA — `Keys.hs:129-180`). Default is `raw`
(`Keys.hs:105-118`). A deployment that has not configured removal keys omits/errors on that scheme —
the official client throws if the entry for the chosen suite's signature scheme is missing or empty
(`wire-webapp/.../mlsService.ts:647-655`).

The web client caches this response for 24 h
(`wire-webapp/libraries/api-client/src/client/clientApi.ts:269-290`).

### 5.2 What the key is for

The backend must be able to evict clients from a group (user leaves, client deleted, user removed from
team) without being a member. It does that by signing an **external RemoveProposal** as
`Sender = external(0)`:

```haskell
mkSignedPublicMessage kp groupId epoch (TaggedSenderExternal 0) (FramedContentProposal proposal)
```

(`wire-server/libs/wire-subsystems/src/Wire/ConversationSubsystem/MLS/Removal.hs:100-113`.) The `0`
is the **index into the group's `external_senders` extension**. Therefore:

> **The backend removal key MUST be entry number 0 of `external_senders`.** If you put anything else
> first, or omit the extension, the backend can never remove anybody and your group will drift out of
> sync with the server's member list.

The proposal is signed with label `"FramedContentTBS"`
(`wire-server/libs/wire-api/src/Wire/API/MLS/AuthenticatedContent.hs:113`) using the removal private
key whose signature scheme matches the group's ciphersuite (`Removal.hs:94-95`).

### 5.3 Exact `external_senders` construction

RFC 9420 §12.1.8.1:

```
struct { SignaturePublicKey signature_key; Credential credential; } ExternalSender;
struct { ExternalSender external_senders<V>; } external_senders;   // extension_type 0x0002? NO — see below
```

Extension type for `external_senders` is **`0x0005`** (`ratchet_tree` is `0x0002` — confirmed for
Wire at `wire-server/libs/wire-api/src/Wire/API/MLS/RatchetTree.hs:30-31`). Neither wire-server nor
core-crypto spells the numeric id out; both go through openmls' `Extension::ExternalSenders`. The
value is RFC 9420 § 17.3, where `0x0004` is `external_pub` and `0x0005` is `external_senders` — an
earlier draft of this document said `0x0004`, which is wrong.

The single entry Wire builds is (`core-crypto/crypto/src/mls/external_sender.rs:30-49`):

```
ExternalSender {
  signature_key = <the base64-decoded bytes of removal[<signature scheme of your ciphersuite>]>,
  credential    = BasicCredential { identity = "wire-server" }   // 11 ASCII bytes
}
```

i.e. serialised:

```
<VarInt len of signature_key> <raw pubkey bytes>
00 01                      credential_type = basic
0b                         VarInt 11
77 69 72 65 2d 73 65 72 76 65 72     "wire-server"
```

core-crypto first tries to parse the blob as a JSON JWK, and falls back to treating it as a raw
public key (`external_sender.rs:51-57`) — matching the two `format=` options of the endpoint. The
raw path validates the key against the signature scheme before use (`external_sender.rs:42-49`).

Client side, the flow is: fetch `removal`, pick
`removal[getSignatureAlgorithmForCiphersuite(defaultCiphersuite)]`, base64-decode, wrap as one
`ExternalSenderKey`, and pass it as `ConversationConfiguration.externalSenders`
(`wire-webapp/.../mlsService.ts:640-669`).

**Subconversations use the parent's external sender instead**: the client copies the parent group's
external sender rather than re-fetching (`mlsService.ts:641-645`).

**MLS 1:1 conversations** may use a *different* removal key: `GET /one2one-conversations/:domain/:user`
returns a `public_keys` object of the same shape, which is the key of the backend that *owns* the 1:1
conversation (possibly the remote one). If present, it wins over the local
`GET /mls/public-keys` (`mlsService.ts:636,648-649`; server side
`wire-server/libs/wire-api/src/Wire/API/Conversation.hs:381-392`).

---

## 6. Creating an MLS group

### 6.1 End-to-end sequence

```
1.  GET  /feature-configs                       -> mls.config.defaultCipherSuite, allowedCipherSuites
2.  GET  /mls/public-keys                       -> removal[<sigscheme>]
3.  POST /conversations   { "protocol": "mls", "name": ..., "access": ..., "conversation_role": ...,
                            "qualified_users": []   <-- MUST be empty }
                                                -> 201 { "qualified_id": {...},
                                                         "group_id": "<base64>",
                                                         "protocol": "mls", "epoch": 0, ... }
4.  local: create MLS group with that group_id, ciphersuite, external_senders=[removal key],
           required_capabilities, leaf capabilities  (epoch 0, only you in the tree)
5.  POST /mls/key-packages/claim/<domain>/<user>?ciphersuite=0x000N   for every user to add
           (for yourself, your own client is skipped automatically)
6.  local: build ONE Commit with an Add proposal per claimed key package
           -> commit (PublicMessage), welcome, group_info
7.  POST /mls/commit-bundles      Content-Type: message/mls,  body = commit || group_info || welcome
                                                -> 201 { "events": [...], "time": "..." }
8.  GET  /conversations/<domain>/<id>            (optional) to pick up the server-side member list
```

Step 3 must send an **empty** member list: the backend does not know the MLS membership, it learns it
from the commit. The official client explicitly nulls `users`/`qualified_users`
(`wire-webapp/libraries/core/src/conversation/conversationService/conversationService.ts:332-351`).
`protocol` accepts `"proteus" | "mls" | "mixed"`
(`wire-server/libs/wire-api/src/Wire/API/Conversation/Protocol.hs:232-246`;
`NewConv.protocol` optional, defaults `proteus` —
`wire-server/libs/wire-api/src/Wire/API/Conversation.hs:986-989`).

If there is nobody to add (a group of one), you still must send a commit to reach epoch 1 — the
official client sends an **empty commit / keying-material update** instead
(`mlsService.ts:702-708`, `tryEstablishingMLSGroup` at 785-813).

### 6.2 Required group configuration

From `core-crypto/crypto/src/mls/conversation/config.rs:37-108` — this is exactly what every official
Wire client puts into a new group:

* **Protocol version**: `MLS 1.0` (= `0x0001`) (`config.rs:42`). The backend rejects anything else
  (`Validation.hs:64-68`).
* **GroupContext extension `required_capabilities`**:
  `extension_types = []`, `proposal_types = []`, `credential_types = [basic(1), x509(2)]`
  (`config.rs:95-97`, asserted by their own test at `config.rs:180-189`).
* **GroupContext extension `external_senders`**: exactly one entry, the backend removal key (§5.3).
* **GroupContext extension `ratchet_tree` (0x0002)**: enabled — `use_ratchet_tree_extension(true)`
  (`config.rs:78`). The backend *requires* the GroupInfo to carry it when the
  `groupInfoDiagnostics` team feature is on
  (`wire-server/libs/wire-subsystems/src/Wire/ConversationSubsystem/MLS/GroupInfoCheck.hs:76-89`:
  "No ratchet tree extension found in GroupInfo"), and external commits are impossible without it.
* **Leaf-node capabilities** (`config.rs:85-93`):
  * `versions   = [MLS 1.0]`
  * `ciphersuites = [0x0001, 0x0002, 0x0003, 0x0007, 0x0005]` — in `config.rs:49-55` order:
    X25519/AES128, P256/AES128, X25519/ChaCha20, P384/AES256, P521/AES256
  * `extensions = []`
  * `proposals  = []`
  * `credentials = [basic(1), x509(2)]`
* **Wire format policy**: `Plaintext` by default (`config.rs:129-135`, `WirePolicy::Plaintext = 1`),
  i.e. **handshake messages (commits/proposals) are sent as `PublicMessage`, application messages as
  `PrivateMessage`**. This is not optional in practice: the backend's commit-bundle parser only
  accepts a *public* commit (`IncomingMessage.hs:90-105,125-133`) — a `PrivateMessage` in the
  commit slot is classified as the optional application message instead.
* Other engine knobs (not on the wire, but they affect interop robustness):
  `padding_size = 128` (`config.rs:39`), `max_past_epochs = 3` (`config.rs:17`),
  `out_of_order_tolerance = 2`, `maximum_forward_distance = 1000` (`config.rs:21-24`),
  `number_of_resumption_psks = 1` (`config.rs:58`).

### 6.3 What the backend does with the first commit

`wire-server/libs/wire-subsystems/src/Wire/ConversationSubsystem/MLS/Message.hs:269-400`:

* reads the ciphersuite from `bundle.group_info.group_context.cipher_suite` (line 276-278) — this is
  the *only* place the conversation's ciphersuite comes from;
* if the conversation has no active data yet (epoch 0), it **adopts** that ciphersuite
  (line 302-304); afterwards a mismatch is a protocol error (line 306-309) and a wrong epoch is
  `mls-stale-message` (line 310-319);
* stores the GroupInfo blob for later `GET .../groupinfo` (line 380);
* propagates the raw commit as `conversation.mls-message-add` to everyone who is in the group both
  before *and* after (line 383-385);
* sends the Welcome as `conversation.mls-welcome` to the newly added clients only (line 391-393);
* propagates the optional application message afterwards (line 395-398).

### 6.4 Conversation JSON, MLS fields

`wire-server/libs/wire-api/src/Wire/API/Conversation/Protocol.hs:117-215`:

```json
{ "protocol": "mls",
  "group_id": "<base64>",
  "epoch": 0,
  "epoch_timestamp": "2026-01-02T03:04:05.000Z",   // absent while epoch == 0 (from API v6)
  "cipher_suite": 1                                // absent while epoch == 0 (from API v6)
}
```

On **API v5** the legacy encoding is used: `epoch` always present, `epoch_timestamp` present but
`null`, and `cipher_suite` defaults to `1` when unknown (`Protocol.hs:130-149`). From v6 the three
"active" fields are genuinely optional (`Protocol.hs:150-174`). So: **do not trust `cipher_suite`
before epoch ≥ 1 on v5.**

---

## 7. Commit bundles — `POST /mls/commit-bundles`

### 7.1 It is NOT protobuf

Verified. The route is
`"commit-bundles" :> ReqBody '[MLS] (RawMLS CommitBundle)`
(`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Galley/MLS.hs:127-133`) and the `MLS` content
type is

```haskell
instance Accept MLS where contentType _ = "message" // "mls"
```

(`wire-server/libs/wire-api/src/Wire/API/MLS/Servant.hs:28-31`).

So: **`Content-Type: message/mls`**, and the body is a bare **concatenation of TLS-serialised
`MLSMessage` structures**, no framing, no length prefixes between them, no protobuf, no JSON.

(Historical note: a protobuf `CommitBundle` did exist in an earlier iteration of the Wire API. It is
gone from current wire-server — `grep -r protobuf` finds nothing under `Wire/API/MLS/`. Do not
implement it.)

### 7.2 Exact body encoding

`wire-server/libs/wire-api/src/Wire/API/MLS/CommitBundle.hs:29-99`:

```
CommitBundleBody := MLSMessage*      // 1..4 concatenated MLSMessage structures, parsed until EOF
```

The parser reads a stream of `MLSMessage`s (`CommitBundle.hs:88-92` → `parseMLSStream`,
`Serialisation.hs:124-129`) and **classifies each one by its `wire_format`**
(`CommitBundle.hs:75-86`):

| wire_format in MLSMessage | slot | cardinality |
|---|---|---|
| `mls_public_message(1)` whose FramedContent is a **Commit** | `commit` | exactly 1 (required) |
| `mls_welcome(3)` | `welcome` | 0 or 1 |
| `mls_group_info(4)` | `group_info` | exactly 1 (required) |
| `mls_private_message(2)` | `appMessage` | 0 or 1 |
| anything else | — | error "unexpected message type" |
| `mls_public_message(1)` that is a *Proposal* | — | error "unexpected proposal" |

**Order does not matter** — classification is by wire format, and duplicates in a slot are an error
("Redundant occurrence of …", `CommitBundle.hs:57-73`).

The canonical order the backend itself emits is `commit, welcome, group_info, appMessage`
(`CommitBundle.hs:94-99`). The official web client sends
**`commit || group_info || welcome`**
(`wire-webapp/.../mlsService.ts:262-266`):

```ts
const bundlePayload = new Uint8Array([
  ...commit,
  ...groupInfo.payload.copyBytes(),
  ...(welcome?.copyBytes() ?? []),
]);
```

Both work. Pick one and stay consistent.

Each element is a full `MLSMessage`
(`wire-server/libs/wire-api/src/Wire/API/MLS/Message.hs:74-140`):

```
struct {
  uint16 version;              // 1 = MLS 1.0
  uint16 wire_format;          // 1 public, 2 private, 3 welcome, 4 group_info, 5 key_package
  select (wire_format) {
    case mls_public_message:  PublicMessage;
    case mls_private_message: PrivateMessage;
    case mls_welcome:         Welcome;
    case mls_group_info:      GroupInfo;
    case mls_key_package:     KeyPackage;
  }
} MLSMessage;
```

So a minimal 2-part bundle starts with `00 01 00 01 …` (version 1, public message = commit) and
somewhere later contains `00 01 00 04 …` (version 1, group info). Note that core-crypto's
`GroupInfoBundle.payload` is already a serialised `MlsMessageOut` — i.e. it **already has the
`00 01 00 04` header**, do not add another one
(`core-crypto/crypto/src/mls/conversation/group_info.rs:20-32`).

`GroupInfo` payload layout, as the backend parses it
(`wire-server/libs/wire-api/src/Wire/API/MLS/GroupInfo.hs:42-118`):

```
GroupContext { uint16 version; uint16 cipher_suite; opaque group_id<V>; uint64 epoch;
               opaque tree_hash<V>; opaque confirmed_transcript_hash<V>; Extension extensions<V>; }
Extension    extensions<V>;        // must contain ratchet_tree (0x0002)
opaque       confirmation_tag<V>;
uint32       signer;
opaque       signature<V>;
```

`Welcome` layout (`wire-server/libs/wire-api/src/Wire/API/MLS/Welcome.hs:28-67`):
`uint16 cipher_suite; GroupSecrets secrets<V>; opaque encrypted_group_info<V>;` where
`GroupSecrets = { opaque new_member<V>; HPKECiphertext encrypted_group_secrets; }`.

`PublicMessage` (`Message.hs:146-174`): `FramedContent content; FramedContentAuthData auth;` plus an
`opaque membership_tag<V>` **only when `sender` is of type `member`**. A commit sent by an existing
member therefore has a membership tag; an external commit (`sender = new_member_commit`) has none.

### 7.3 Response

`201 Created`, JSON `MLSMessageSendingStatus`
(`wire-server/libs/wire-api/src/Wire/API/MLS/Message.hs:364-384`):

```json
{ "events": [ /* conversation events caused by this commit */ ],
  "time": "2026-01-02T03:04:05.678Z" }
```

The TS binding also declares optional `failed_to_send: QualifiedId[]` and `failed: QualifiedId[]`
(`wire-webapp/libraries/api-client/src/conversation/conversationApi/conversationApi.ts:75-80`) — these
appear on federated deployments when some remote backend was unreachable. They are **not** in current
wire-server's `MLSMessageSendingStatus` schema, so treat them as optional. The official client treats
a present `failed_to_send` as "retry the whole commit bundle"
(`wire-webapp/.../mlsService.ts:270-273`).

### 7.4 What can go in one bundle

* one commit (mandatory) + its group info (mandatory);
* the welcome, if the commit adds anybody;
* optionally **one application message**, which the backend validates against **epoch+1** (i.e. the
  epoch created by this very commit) and forwards after the commit
  (`Message.hs:274`, `395-398`). This is how you can atomically "commit pending proposals and send
  the message" — the official client instead does two round-trips
  (`conversationService.ts:462-474`).

---

## 8. Sending application messages — `POST /mls/messages`

`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Galley/MLS.hs:58-94`.

* Method/path: `POST <root>/mls/messages`
* `Content-Type: message/mls`
* Body: **one raw `MLSMessage`**, TLS-serialised — no base64, no JSON wrapper
  (`ReqBody '[MLS] (RawMLS Message)`).
* For an application message this is `wire_format = mls_private_message(2)`; the plaintext inside is
  a Wire **`GenericMessage` protobuf** (the same one Proteus uses) —
  `GenericMessage.encode(payload).finish()` fed to `encryptMessage`
  (`wire-webapp/.../conversationService.ts:469-472`), decoded on receipt at
  `wire-webapp/libraries/core/src/messagingProtocols/mls/eventHandler/events/messageAdd/messageAdd.ts:98`.
* You may also post a bare **proposal** as a `PublicMessage` here (the route's error list includes
  `mls-proposal-not-found`, and `mkIncomingMessage` accepts public messages). Commits must go through
  `/mls/commit-bundles`.
* Response: `201` + the same `MLSMessageSendingStatus` as §7.3.
* The group id and epoch are read out of the message itself
  (`IncomingMessage.hs:89-115`), so there is no conversation id in the URL.

Client-side order of operations used by the official client
(`conversationService.ts:462-474`): commit any pending proposals **first**, then encrypt, then post.

---

## 9. Receiving — events, epochs, and errors

### 9.1 The two MLS events

Both arrive over the normal Wire notification stream / websocket.
`wire-server/libs/wire-api/src/Wire/API/Event/Conversation.hs:203-236,651-652`:

```json
{ "type": "conversation.mls-message-add",
  "conversation": "<uuid>", "qualified_conversation": {"id": "...", "domain": "..."},
  "subconv": "conference",                      // optional; present for subconversation traffic
  "from": "<uuid>", "qualified_from": {...},
  "time": "...",
  "data": "<base64 of a raw MLSMessage>" }
```

```json
{ "type": "conversation.mls-welcome",
  "qualified_conversation": {...}, "qualified_from": {...}, "time": "...",
  "data": "<base64 of a raw MLSMessage with wire_format = mls_welcome(3)>" }
```

Both `data` payloads are `base64Schema` (`Event/Conversation.hs:651-652`). Important details:

* `mls-message-add.data` is the **verbatim bytes the sender submitted** — the backend re-broadcasts
  `msg.raw` unchanged (`.../MLS/Propagate.hs:83-91`). It can be a commit (public), a proposal
  (public), or an application message (private).
* `mls-welcome.data` is a full **MLSMessage**, not a bare `Welcome` struct: the backend wraps it with
  `mkRawMLS $ mkMessage (MessageWelcome welcome)` (`.../MLS/Welcome.hs:74`). Strip the 4-byte
  `00 01 00 03` header only if your engine expects a bare Welcome.
* You never receive your own commit back (the sender is filtered out of the recipient list —
  `Propagate.hs:115`, `cmWithoutSender`). Your local state must be advanced by *merging your own
  pending commit* once `POST /mls/commit-bundles` returns 201.

### 9.2 Processing rules

**On `conversation.mls-welcome`:**
1. re-check your local key-package stock (a welcome means one was consumed) — §4.7;
2. `processWelcomeMessage(data)` → your engine returns the **group id**;
3. map group id ↔ conversation via the conversation object you fetch/already have;
4. arm the periodic keying-material renewal timer for that group (§14);
5. read the new epoch and treat the conversation as joined.
(`wire-webapp/libraries/core/src/messagingProtocols/mls/eventHandler/events/welcomeMessage/welcomeMessage.ts:31-53`,
`mlsService.ts:1192-1201`.)

**On `conversation.mls-message-add`:**
1. resolve `qualified_conversation` (+ `subconv`) → local group id; if unknown, this is a hard error —
   you were never in that group (`mlsService.ts:1169-1190`);
2. base64-decode `data` and feed it to `decryptMessage(group_id, bytes)`;
3. the result may contain: the decrypted application plaintext (a `GenericMessage` protobuf), a
   `senderClientId` (the BasicCredential identity bytes of the sender — parse per §2.2), a
   `commitDelay`, and `hasEpochChanged`;
4. if `commitDelay` is a number, the message contained **proposals**: schedule "commit pending
   proposals" after `event.time + commitDelay` ms; delay `0` means do it immediately
   (`messageAdd.ts:83-96`, `mlsService.ts:1036-1058`). The delay is RFC 9420's commit-delay
   heuristic that avoids every member committing the same proposal at once;
5. if the epoch changed, reset the keying-material timer.

Certain decryption errors are *expected* and must be swallowed rather than surfaced: duplicate
message, own commit echoed back, buffered future message, unmergeable pending commit
(`mlsService.ts:578-584` → `shouldMLSDecryptionErrorBeIgnored`).

### 9.3 Full list of MLS error labels

Every Wire error body is `{"code": <http>, "label": "<label>", "message": "<text>"}`.
From `wire-server/libs/wire-api/src/Wire/API/Error/Galley.hs:260-310,382-390` and
`.../Error/Brig.hs:235,246`:

| HTTP | label | meaning | recovery |
|---|---|---|---|
| 400 | `mls-protocol-error` | catch-all malformed MLS input (brig + galley) | fix the message; do not retry blindly |
| 400 | `mls-commit-missing-references` | your commit does not reference all pending proposals the backend knows about | re-fetch state: apply the proposals you missed (they arrived as `mls-message-add`), rebuild the commit, resend |
| 400 | `mls-invalid-leaf-node-index` | a proposal points at a blank/nonexistent leaf | your tree is desynchronised → rejoin by external commit (§10) |
| 400 | `mls-invalid-leaf-node-signature` | leaf node signature check failed | conversation is broken → external-commit rejoin, or conversation reset |
| 400 | `mls-self-removal-not-allowed` | you tried to Remove your own leaf | leave via the conversation API instead |
| 400 | `mls-group-conversation-mismatch` | group id in the message ≠ the conversation it maps to | you used the wrong group id |
| 400 | `mls-client-sender-user-mismatch` | credential's user id ≠ authenticated user | your credential identity is wrong (§2.2) |
| 400 | `mls-welcome-mismatch` | welcome recipients ≠ clients added by the commit | rebuild the bundle |
| 400 | `non-empty-member-list` | you passed users to `POST /conversations` with `protocol: mls` | send an empty list |
| 400 | `mls-migration-criteria-not-satisfied` | mixed→mls migration preconditions unmet | n/a for a new client |
| 400 | `mls-federated-one2one-not-supported` | federated MLS 1:1 needs API ≥ v6 | bump API version |
| 400 | `mls-federated-reset-not-supported` | remote backend cannot reset | n/a |
| 400 | `mls-history-client-conflict` / `mls-history-client-duplication` | history-sharing invariants | out of scope |
| 403 | `mls-identity-mismatch` | leaf credential identity ≠ the client uploading/committing | fix identity string |
| 403 | `mls-subconv-unsupported-convtype` | subconversations only exist for regular conversations | — |
| 403 | `mls-subconv-join-parent-missing` | not a member of the parent conversation | join the parent first |
| 403 | `mls-receipts-not-allowed` | read receipts in MLS conv | — |
| 404 | `mls-proposal-not-found` | commit references a proposal the backend never saw | resend the proposals inline, or rebuild the commit with inline proposals |
| 404 | `mls-missing-group-info` | `GET .../groupinfo` before the first commit | wait / establish the group |
| 409 | `mls-client-mismatch` | an Add/Remove proposal does not cover the *full* client list of a user | re-claim key packages for that user and redo the commit covering every client |
| 409 | `mls-stale-message` | the epoch in your message is older than the conversation's | **abort the commit locally**, process the events you are missing, then retry; if still stale, rejoin by external commit |
| 409 | `mls-group-out-of-sync` | body also has `"missing_users": [{id,domain},…]` — the group's leaves do not match the backend's member list | add the missing users in a new commit |
| 409 | `mls-legal-hold-not-allowed` | a participant is under legal hold | cannot proceed |
| 422 | `mls-unsupported-message` | content-type / wire-format combination not accepted | e.g. you sent a private commit |
| 422 | `mls-unsupported-proposal` | proposal type not allowed here | — |
| 400 | `mls-not-enabled` (`Galley.hs:259-264`) | backend has MLS disabled | fall back to Proteus |
| 400 | `mls-duplicate-public-key` | `mls_public_keys` already set for that scheme | do not re-register |

`mls-group-out-of-sync` is the one error with a structured body
(`Error/Galley.hs:747-777`):

```json
{ "missing_users": [ {"id": "...", "domain": "..."} ],
  "label": "mls-group-out-of-sync", "message": "Group is out of sync", "code": 409 }
```

Recovery policy used by the official client
(`wire-webapp/.../mlsService.ts:283-322`, `recovery/mlsErrorMapper.ts:128-140`): on
`mls-invalid-leaf-node-signature` / `mls-invalid-leaf-node-index` → "broken MLS conversation"
(→ conversation reset); on `mls-stale-message` → abort the in-flight commit and let the epoch
recovery orchestrator rejoin; on `mls-group-out-of-sync` → abort and re-add the named users. Rejoins
are serialised per group through a queue so two rejoins never race
(`wire-webapp/libraries/core/src/messagingProtocols/mls/conversationRejoinQueue.ts:35-45`).

### 9.4 Conversation reset (last resort)

`POST /mls/reset-conversation` with `{"group_id": "<base64>", "epoch": <n>}`
(`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Galley/MLS.hs:156-175`,
`MLSReset` at `MLS.hs:43-56`). The backend wipes MLS state for the conversation, mints a **new**
group id (version 2, `gid_gen` incremented — §3.2) and emits `conversation.mls-reset` with
`new_group_id`. Every client then creates the group afresh. Requires the caller to know the current
epoch; wrong epoch → `mls-stale-message`.

---

## 10. Joining an existing group by external commit

### 10.1 `GET /conversations/:domain/:id/groupinfo`

`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Galley/Conversation.hs:213-231`.

* Response `200`, **`Content-Type: message/mls`**, body = the stored `GroupInfoData` blob, i.e. the
  bytes of the `mls_group_info` **MLSMessage** exactly as the last committer uploaded it
  (`Message.hs:380` stores `bundle.groupInfo.raw`; `GroupInfoData` is "rest of input",
  `GroupInfo.hs:132-140`).
* `404 mls-missing-group-info` if the group has never been committed to.
* Fetch it as an arraybuffer, not JSON
  (`wire-webapp/libraries/api-client/src/conversation/conversationApi/conversationApi.ts:381-388`).

Subconversation variant: `GET /conversations/:domain/:id/subconversations/:subid/groupinfo`
(`Conversation.hs:718-739`).

### 10.2 Building the external commit

RFC 9420 §12.2 rules, enforced verbatim by the backend
(`wire-server/libs/wire-subsystems/src/Wire/ConversationSubsystem/MLS/Commit/ExternalCommit.hs:73-131`):

* the commit's `sender` is `new_member_commit`, so it carries **no membership tag**;
* it must contain **exactly one `ExternalInit` proposal** (line 95-96);
* **at most one `Remove` proposal**, and it may only remove *your own* previous leaf (line 103-113);
* zero or more `PreSharedKey` proposals;
* **no other proposal types** (line 97-98, `allowedProposals` at line 126);
* **all proposals must be inline**, never by reference (line 128-131);
* it must carry an `UpdatePath` with your new leaf node;
* epoch must equal the conversation's current epoch, and must be > 0 — "The first commit in a group
  cannot be external" (line 76-82);
* if you are already a member you **must** include the Remove of your old leaf (line 109-112).

Then upload it exactly like any other commit: `POST /mls/commit-bundles` with
`commit || group_info` (no welcome — an external commit adds nobody else).

### 10.3 When Wire uses this

* **Rejoin after desync** — `mls-stale-message`, wrong-epoch decryption failures, missing
  ratchet-tree state. The client wipes the local group and re-joins from a fresh GroupInfo
  (`wire-webapp/.../mlsService.ts:496-526` `joinByExternalCommit`, driven by the recovery
  orchestrator).
* **Joining via a guest/join link**, where the backend adds you to the conversation but nobody
  commits an Add for you. **UNVERIFIED** in these repos which exact code path drives the guest-link
  case; the mechanism is the same `joinByExternalCommit(getGroupInfo)` helper.
* **Joining a conference subconversation** (§12) — every participant external-commits into the
  subgroup.

After a successful external commit the client arms the keying-material timer and emits a new-epoch
notification (`mlsService.ts:510-521`).

---

## 11. MLS 1:1 conversations

### 11.1 `GET /one2one-conversations/:domain/:user[?format=raw|jwk]`

(API ≥ v7; on v5/v6 the path is `GET /conversations/one2one/:domain/:user` —
`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Galley/Conversation.hs:828-880`.)

Response (`wire-server/libs/wire-api/src/Wire/API/Conversation.hs:381-392`):

```json
{ "conversation": { ...normal conversation object..., "protocol": "mls",
                    "group_id": "<base64>", "epoch": 0 },
  "public_keys": { "removal": { "ed25519": "<base64>", ... } } }
```

The `public_keys.removal` here belongs to the backend that **owns** the 1:1 conversation, which for a
federated pair is not necessarily yours — use it in preference to `GET /mls/public-keys`
(`wire-webapp/.../mlsService.ts:636,648-649`).

### 11.2 How the conversation id — and hence the group id — is derived

Deterministically, from the two user ids, by **both** sides
(`wire-server/libs/galley-types/src/Galley/Types/Conversations/One2One.hs:43-119`):

1. Order the two qualified users by `(domain, uuid)` lexicographically; call them *a* and *b*
   (line 47-49, 94-95). This makes the function symmetric.
2. Build `c = namespace(16 bytes) || uuid_a(16) || domain_a(ascii) || uuid_b(16) || domain_b(ascii)`
   (line 51-52, 97-102). Note `quidToByteString` emits `uuid` then `domain`, so the domains are
   interleaved, not appended at the end.
3. `x = SHA-256(c)` (line 38-39).
4. Conversation UUID = `UUIDv5(x[0..15])` — i.e. take the first 16 bytes and stamp the RFC 4122
   version/variant bits (line 104-115). "Not strictly RFC 4122 compliant since we use SHA-256, not
   SHA-1" (comment at line 86-87).
5. Owning domain = `domain_a` if `x[16] & 0x80 == 0`, else `domain_b` (line 116-118).

Namespace UUIDs (line 43-45):

```
MLS:     95589dd5-b045-40dc-a6aa-dd9c4fad1c2f     (UUID.fromWords 0x95589dd5 0xb04540dc 0xa6aadd9c 0x4fad1c2f)
Proteus: 9a51edb8-060c-0d9a-0c29-50a85d152982
```

The **group id** is then the ordinary v1 group id (§3.2) with `conv_type = 2` (`One2OneConv`) over
that conversation id (`wire-server/libs/wire-subsystems/src/Wire/ConversationSubsystem/MLS/One2One.hs:83-97`).

### 11.3 Who creates the group, and the race

Because the id is deterministic, **either side may create the group** — both compute the same
`group_id`. The resolution is "first commit wins":

1. both clients `GET /one2one-conversations/...`, see `epoch: 0`, and try to establish the group;
2. each locally creates the group and sends its first commit with an Add for the other side;
3. the loser's `POST /mls/commit-bundles` fails (the conversation already has active data at a higher
   epoch → `mls-stale-message`);
4. the loser **wipes its local group** and waits for the `conversation.mls-welcome` that the winner's
   commit produced, or joins by external commit.

The official client's `register1to1Conversation` wraps the whole thing in try/catch and calls
`wipeConversation(groupId)` on any failure (`wire-webapp/.../mlsService.ts:729-777`), and
`tryEstablishingMLSGroup` does the same for group conversations, explicitly noting "Somebody else
might have created the group in the meantime. We should wipe the group locally, wait for the welcome
message or join later via external commit" (`mlsService.ts:785-813`).

Sequencing detail: for 1:1 the client creates the empty group first, then claims the *other* user's
key packages, then its *own* other clients' key packages, and adds them all in a single commit
(`mlsService.ts:737-767`).

---

## 12. Subconversations (MLS conference calling)

Endpoints (`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Galley/Conversation.hs:655-739`):

| method | path | purpose |
|---|---|---|
| GET | `/conversations/:domain/:id/subconversations/:subid` | fetch subconversation state (JSON) |
| GET | `/conversations/:domain/:id/subconversations/:subid/groupinfo` | GroupInfo (`message/mls`) |
| DELETE | `/conversations/:domain/:id/subconversations/:subid/self` | leave (the backend sends a Remove proposal for your leaf) |
| DELETE | `/conversations/:domain/:id/subconversations/:subid` | reset it; body `{"group_id": "<b64>", "epoch": n}` |

GET response (`wire-server/libs/wire-api/src/Wire/API/MLS/SubConversation.hs:86-99`):

```json
{ "parent_qualified_id": {"id": "...", "domain": "..."},
  "subconv_id": "conference",
  "group_id": "<base64>",
  "epoch": 3, "epoch_timestamp": "...", "cipher_suite": 1,
  "members": [ {"user_id": "...", "client_id": "...", "domain": "..."} ] }
```

`subconv_id` is a client-chosen string, 1–255 printable ASCII characters, no whitespace
(`SubConversation.hs:51-74`). Wire uses exactly one in practice: **`"conference"`**
(`wire-webapp/libraries/api-client/src/conversation/subconversation.ts:22-24`).

Group id derivation: identical to §3.2 with `subconv_len > 0`, the subconv id in ASCII, and a
`gid_gen` counter that increments on every subconversation reset
(`wire-server/libs/wire-subsystems/src/Wire/ConversationSubsystem/MLS/SubConversation.hs:420-431`).
The `conv_type` is that of the **parent** conversation.

Wire specifics:

* only members of the parent conversation may join — else `mls-subconv-join-parent-missing`
  (`.../MLS/Commit/ExternalCommit.hs:156-160`);
* only regular conversations may have subconversations
  (`mls-subconv-unsupported-convtype`);
* the subgroup's `external_senders` is **copied from the parent group**, not fetched
  (`wire-webapp/.../mlsService.ts:641-645`);
* participants join by external commit against `.../subconversations/conference/groupinfo` (§10);
* the group's exported secret is used as the SFRAME/AVS key material for the call. **UNVERIFIED**
  here — the export label and length live in the calling stack (avs), not in these repos; the
  generic hook is `exportSecretKey(groupId, keyLength)`
  (`wire-webapp/.../mlsService.ts:528-532`);
* `conversation.mls-message-add` events for a subconversation carry `"subconv": "conference"` —
  route them to the subgroup, not the parent (`Event/Conversation.hs:677`,
  `wire-webapp/.../mlsService.ts:1169-1189`).

---

## 13. E2EI / X.509 credentials — overview only

**Out of scope for a first implementation.** Ship BasicCredential first; a Wire deployment only
requires x509 credentials if the team has the `mlsE2EId` feature enabled.

What it is: instead of a self-asserted `BasicCredential`, each client obtains an **X.509 certificate**
from an ACME (RFC 8555) CA operated for the backend, and uses `X509Credential` in its leaf nodes and
key packages.

The enrolment flow (`wire-webapp/libraries/core/src/messagingProtocols/mls/e2eIdentityService/`,
steps at `.../steps/{account,order,authorization,dpopChallenge,oidcChallenge,certificate}.ts`):

1. discover the ACME directory from the team's `discoveryUrl`;
2. create an ACME account (`newAccount`);
3. `newOrder` for the two identifiers — the client id URI and the handle URI;
4. two challenges:
   * **`wire-dpop-01`** — proves control of the *device*: the client asks brig for a nonce
     (`HEAD /clients/:id/nonce` → `replay-nonce` response header), builds a DPoP proof, exchanges it
     at `POST /clients/:id/access-token` (proof in the `DPoP` request header) for a backend-signed
     access token `{token, type:"DPoP", expires_in}`, and submits that
     (`wire-webapp/libraries/api-client/src/client/clientApi.ts:292-326`);
   * **`wire-oidc-01`** — proves control of the *user identity* via the team's OIDC IdP
     (this is what forces the browser redirect and the OAuth token in the code);
5. finalise the order with a CSR whose public key is the MLS **signature key**, and download the
   certificate chain;
6. the chain is installed as a new credential in the MLS engine, and **all key packages are
   replaced** (`PUT /mls/key-packages/self/:client`, §4.2) plus an `update` commit is sent in every
   existing group so the leaf nodes switch credential.

What changes for the protocol layer:

* `Credential.credential_type` becomes `2` and the payload is a `<V>`-vector of DER certificates,
  leaf first (§2.5);
* the identity moves into the leaf certificate's SAN URIs in the `wireapp://…%21…@domain` form —
  note the **base64url 22-char user id** and `%21`, unlike BasicCredential's hyphenated UUID and `:`;
* the backend verifies `SubjectPublicKeyInfo == leaf_node.signature_key`
  (`Validation.hs:119-136`) but explicitly does **not** verify the certificate signature today
  ("FUTUREWORK: check signature in the case of an x509 credential", `Validation.hs:109`);
* CRL distribution points are surfaced by the engine after every decrypt/commit and must be fetched
  through the team-configured **CRL proxy** (`mls-e2eid-missing-crl-proxy` error at
  `wire-server/libs/wire-api/src/Wire/API/Error/Galley.hs:529`);
* `required_capabilities.credential_types` already lists x509, and every Wire leaf already advertises
  it, so a basic-credential client can coexist in the same group with x509 clients.

---

## 14. Epoch / keying-material rotation policy

What the official clients do (`wire-webapp/libraries/core/src/messagingProtocols/mls/mlsService/mlsService.ts`):

* **`keyingMaterialUpdateThreshold` = 30 days** by default
  (`TimeUtil.TimeInMillis.DAY * 30`, line 111-114). Overridable per deployment via the
  `FEATURE_MLS_CONFIG_KEYING_MATERIAL_UPDATE_THRESHOLD` env var
  (`wire-webapp/libraries/config/src/client.config.ts:90-92`).
* A **recurring task per group** fires every `keyingMaterialUpdateThreshold` and calls
  `updateKeyingMaterial(groupId)` — an **empty `update` commit** that rotates your leaf's HPKE key
  and re-keys the epoch (line 910-918, 593-624). The task is armed:
  * after creating a group (line 705, 713),
  * after joining via welcome (`welcomeMessage.ts:43`),
  * after joining via external commit (line 516),
  * and reset whenever the epoch changes (`resetKeyMaterialRenewal`, line 893-896).
* Failure handling: one automatic retry after **10 seconds**, then give up and emit
  `keyMaterialUpdateFailure` (line 597-619).
* The task is cancelled when the group is wiped (line 1014-1016) and skipped if the group no longer
  exists locally (line 869-883).
* `core-crypto` has a `key_rotation_span` config knob for the same purpose but it is **not
  implemented** ("TODO: Not implemented yet. Tracking issue: WPB-9609",
  `core-crypto/crypto/src/mls/conversation/config.rs:113-115`) — the timer lives in the app layer.

Key-package rotation (distinct from keying material):

* generated key packages live **~84 days** (`KEYPACKAGE_DEFAULT_LIFETIME`,
  `core-crypto/crypto/src/transaction_context/key_package.rs:17-18`);
* the daily backend-sync task tops the uploaded pool back up to 100 whenever it drops to ≤ 50 (§4.7);
* the backend independently refuses key packages that are already expired, not yet valid, or whose
  `not_after` is further out than its configured maximum
  (`wire-server/libs/wire-subsystems/src/Wire/MlsKeyPackageSubsystem.hs:42-46`).

Epoch bookkeeping you must implement:

* the authoritative epoch is your local MLS engine's; the backend's `epoch` field in the conversation
  object is what it last accepted;
* a commit you send only takes effect **after** the 201 from `/mls/commit-bundles` — merge your
  pending commit then, and never before;
* messages for a *future* epoch should be buffered, not dropped (core-crypto does this internally,
  `max_past_epochs = 3` for the past direction);
* `mls-stale-message` on a commit means someone else's commit landed first: discard your pending
  commit, process the events you have not seen, rebuild, resend.

---

## Appendix A — endpoint quick reference

| method | path | content-type in | content-type out |
|---|---|---|---|
| POST | `/conversations` (`{"protocol":"mls", "qualified_users":[]}`) | json | json (has `group_id`) |
| GET | `/conversations/:domain/:id` | — | json |
| GET | `/conversations/:domain/:id/groupinfo` | — | `message/mls` |
| GET | `/one2one-conversations/:domain/:user` | — | json (`conversation` + `public_keys`) |
| GET | `/conversations/:domain/:id/subconversations/:subid` | — | json |
| GET | `/conversations/:domain/:id/subconversations/:subid/groupinfo` | — | `message/mls` |
| DELETE | `/conversations/:domain/:id/subconversations/:subid/self` | — | 200 |
| DELETE | `/conversations/:domain/:id/subconversations/:subid` | json `{group_id,epoch}` | 200 |
| POST | `/mls/messages` | `message/mls` (one MLSMessage) | json `{events,time}` |
| POST | `/mls/commit-bundles` | `message/mls` (concatenated MLSMessages) | json `{events,time}` |
| GET | `/mls/public-keys[?format=raw\|jwk]` | — | json `{removal:{...}}` |
| POST | `/mls/reset-conversation` | json `{group_id,epoch}` | 200 |
| POST | `/mls/key-packages/self/:client` | json `{key_packages:[b64]}` | 201 |
| PUT | `/mls/key-packages/self/:client?ciphersuites=` | json `{key_packages:[b64]}` | 201 |
| GET | `/mls/key-packages/self/:client/count?ciphersuite=` | — | json `{count}` |
| DELETE | `/mls/key-packages/self/:client?ciphersuite=` | json `{key_packages:[b64 refs]}` | 201 |
| POST | `/mls/key-packages/claim/:domain/:user?ciphersuite=` | — | json `{key_packages:[…]}` |
| POST/PUT | `/clients` , `/clients/:id` | json (with `mls_public_keys`) | json |
| GET | `/feature-configs` | — | json (has `mls` config) |

## Appendix B — things that will bite you

1. `POST /conversations` with `protocol: mls` **and** a non-empty user list → `non-empty-member-list`.
2. Sending the commit as a `PrivateMessage`: the backend silently classifies it as the bundle's
   *application message* slot and then rejects the bundle for "Missing commit".
3. Forgetting `external_senders` (or putting the removal key anywhere but index 0): everything works
   until the first server-side removal, which then silently never happens.
4. Forgetting the `ratchet_tree` extension in the GroupInfo: external commits (and therefore all
   recovery, and all conference calls) are impossible.
5. Using the hyphenated UUID in the x509 SAN, or the base64url UUID in the BasicCredential. They are
   different encodings on purpose (§2.2 vs §2.5).
6. Uploading key packages before registering `mls_public_keys` → `mls-protocol-error`
   "No key associated to the given identity and signature scheme".
7. Leaving `capabilities.credentials` empty → the backend rejects every key package
   ("BasicCredentialCapabilityMissing", `Validation.hs:152-155`).
8. Treating `group_id` as text: it is arbitrary bytes, base64 in JSON, length-prefixed inside MLS.
9. Assuming `cipher_suite` is present on a fresh conversation. It is not, until epoch ≥ 1 (and on
   API v5 it lies, defaulting to `1`).
10. Merging your own commit before the 201 comes back — a concurrent commit makes you unrecoverably
    forked.
