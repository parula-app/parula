# Wire protocol, part 9: Proteus (the legacy, Signal-derived encryption layer)

Proteus is Wire's original end-to-end encryption layer. It predates MLS and is
still the fallback whenever MLS cannot be used. Its job is exactly one thing:
turn a serialised `GenericMessage` (see `08-GenericMessage-Protobuf.md`) into
one ciphertext **per recipient device**, and back.

The end of this document (section 12) answers the practical question — can a new
client skip Proteus?

## 1. What Proteus is

Proteus is an implementation of the **Axolotl** ratchet (later renamed the
**Double Ratchet**) *without header keys*, using **prekeys** so that a session
can be started while the peer is offline. Roles are fixed by who fetched the
prekey: the side that claims a prekey and initiates is **Alice**, the side that
receives the resulting PreKeyMessage is **Bob**
(`proteus/README.asciidoc`, "Proteus" section).

### 1.1 Primitives — note the correction

The upstream README is explicit
(`proteus/README.asciidoc`, "All cryptographic primitives"):

| Role | Algorithm |
|---|---|
| Cipher | **ChaCha20** (the "legacy" 8-byte-nonce variant) |
| MAC | **HMAC-SHA256** |
| Diffie-Hellman | **Curve25519 / X25519** |
| KDF | **HKDF-SHA256** |
| Serialisation | **CBOR** (RFC 7049) |

**Proteus does NOT use AES-CBC for messages.** A widespread misconception — AES-256-CBC
*is* used in the Wire stack, but only for **assets** and for **`External`
message bodies** (see `08-GenericMessage-Protobuf.md` §9), never for the
per-device Proteus payload.

Verified in the current implementation
(`proteus/src/internal/derived.rs`, crate `proteus-wasm` v3.0.1, pulled by
core-crypto at `core-crypto/Cargo.toml:135-136`):

* `type HmacSha256 = hmac::SimpleHmac<sha2::Sha256>;` — `derived.rs:31`
* `type HkdfSha256 = hkdf::Hkdf<sha2::Sha256>;` — `derived.rs:32`
* `CipherKey(chacha20::Key)`, `ChaCha20Legacy::new(&self.0, &nonce)` —
  `derived.rs:75`, `:87`, `:97`
* `Mac([u8; 32])` — `derived.rs:192`

### 1.2 Keys are Ed25519, DH is X25519

A slightly odd detail with real consequences: Proteus stores and transmits
**Ed25519** public keys (32 bytes) and converts them to Montgomery form for
Diffie-Hellman:

* `PublicKey(ed25519_dalek::VerifyingKey)` — `proteus/src/internal/keys.rs:594`
* `SecretKey::to_dh()` does the standard SHA-512 clamp of the Ed25519 seed to
  get an X25519 scalar — `keys.rs:528-545`
* `PublicKey::to_dh()` decompresses the Edwards point and calls
  `to_montgomery()` — `keys.rs:635-647`
* `shared_secret()` rejects an all-zero peer key (`ProteusError::Zero`) —
  `keys.rs:547-562`

So if you implement this yourself: the bytes on the wire are Ed25519 encodings,
and the birational map to Curve25519 must be applied before every DH.
Prekey *signatures*, when present, are Ed25519 signatures over the prekey public
key (`keys.rs:265-275`).

### 1.3 Per-device, not per-user

There is no group crypto in Proteus. A message to a conversation of *N* users
with *M* devices in total is encrypted **M times** (excluding your own sending
device, but *including* your other own devices). This is the reason `External`
exists, the reason the `412 missing clients` dance exists, and the single
biggest reason MLS was built.

## 2. CBOR serialisation — everything on the wire

Proteus uses plain, definite-length CBOR maps with **small integer keys**.
The encoder (`proteus/crates/cbor-codec/src/encoder.rs`) emits minimal-length
integers: `0..=23` inline in the initial byte, `24..=0xFF` as `0x18 xx`,
`0x100..=0xFFFF` as `0x19 xxxx`, etc. (`encoder.rs:138-172`, `:415-436`).
`object(n)` is a CBOR map of `n` pairs (major type 5) — `encoder.rs:401-403`.
`null` is `0xF6`.

Decoders **skip unknown keys** (`d.skip()` in every `decode` arm), so the format
is forward-compatible, but duplicate keys are rejected.

### 2.1 `PreKeyBundle` — what you get from the server

This is the only Proteus structure you *must* parse to talk to Wire, because the
server hands it to you base64-encoded.

```
PreKeyBundle = CBOR map(5) {
  0: uint      version          -- always 1
  1: uint      prekey_id        -- u16, 0..65535
  2: map(1){ 0: bytes(32) }     -- prekey public key   (Ed25519)
  3: map(1){ 0: map(1){ 0: bytes(32) } }  -- identity key (IdentityKey wrapping PublicKey)
  4: null | map(1){ 0: bytes(64) }        -- optional Ed25519 signature over key 2
}
```

Sources: `proteus/src/internal/keys.rs:305-320` (`PreKeyBundle::encode`),
`:52-56` (`IdentityKey::encode` → one extra map level),
`:664-668` (`PublicKey::encode`), `:305-319` (signature or `null`).

The nesting asymmetry between key 2 and key 3 is real and easy to get wrong:
**key 2 is one map level deep, key 3 is two.**

The backend independently validates this structure, which is a second source
confirming the layout: `wire-server/libs/wire-api/src/Wire/API/User/Client/Prekey.hs:209-243`
(`decodePrekeyBundlePrekeyPayload`), with `decodePrekeyBundleIdentityKey`
unwrapping **one** map (`:124-127`) and `decodePrekeyBundlePublicKey` unwrapping
**two** (`:118-122`).

> Caution: the Haskell field *names* at `Prekey.hs:185-196` label key 2
> `prekeyBundleIdentityKey` and key 3 `prekeyBundleSignedPrekey`. Those names are
> swapped relative to proteus. The *decoders* are correct; only the names are
> wrong. Trust the decoders and `keys.rs`.

The backend also enforces `PreKey.id == the prekey_id inside the CBOR`
(`Prekey.hs:155-157`, `:200-207`), and rejects trailing bytes.

#### Worked example

`wire-server` ships a real bundle as a test fixture (`Prekey.hs:273`):

```
pQABAQcCoQBYIDXdN8VlKb5lbgPmoDPLPyqNIEyShG4oT/DlW0peRRZUA6EAoQBYILLf1TIwSB62q69Ojs/X1tzJ+dYHNAw4QbW/7TC5vSZqBPY=
```

83 bytes, decoding to:

```
a5                        map(5)
  00 01                   0 : 1                      version
  01 07                   1 : 7                      prekey_id
  02 a1 00 58 20 …32B…    2 : {0: h'35dd37c5…1654'}  prekey public key
  03 a1 00 a1 00 58 20 …32B…
                          3 : {0: {0: h'b2dfd532…266a'}}  identity key
  04 f6                   4 : null                   no signature
```

A minimal bundle is therefore ~83 bytes; with a signature ~150.

### 2.2 `PreKey` (private side, local storage only)

```
PreKey = map(3) { 0: uint version(=1), 1: uint key_id, 2: KeyPair }
KeyPair = map(2) { 0: SecretKey, 1: PublicKey }
SecretKey = map(1) { 0: bytes(64) }   -- ed25519 keypair bytes (seed||public)
PublicKey = map(1) { 0: bytes(32) }
```
`keys.rs:194-202`, `:423-429`, `:564-568`, `:664-668`.

### 2.3 The message envelope

Everything that travels in `ClientEntry.text` is an `Envelope`:

```
Envelope = map(3) {
  0: uint  version(=1)
  1: map(1){ 0: bytes(32) }   -- HMAC-SHA256 tag  (Mac)
  2: bytes                    -- the CBOR-encoded Message, verbatim
}
```
`proteus/src/internal/message.rs:379-387`, `derived.rs:205-209`.

Key 2 is **bytes containing a nested CBOR document**, not an inline map. The MAC
is computed over exactly those bytes (`message.rs:315-325`,
`Envelope::verify` at `:337-340`). Keep the raw bytes around: you must MAC the
bytes you received, not a re-encoding.

Inside, `Message` is a type tag **followed by** the body, with no container
around the two: the tag is one CBOR uint and the body is the next CBOR item, one
after the other in the same byte string. There is no array header
(`message.rs:149-169`; `wire-webapp`'s `CipherMessage.serialise()` writes
`encoder.u8(1)` and then the map, and `Envelope.deserialiseMessage()` reads it
back with a bare `decoder.u8()`):

```
Message = 1, CipherMessage   -- "Plain"
        | 2, PreKeyMessage   -- "Keyed"
```

Wrapping the two in a CBOR array instead is the obvious misreading, and it fails
only against a real peer: both ends of a test that uses one implementation agree
with each other.

```
PreKeyMessage = map(4) {
  0: uint prekey_id            -- which of the receiver's prekeys was consumed
  1: PublicKey base_key        -- Alice's ephemeral base key
  2: IdentityKey identity_key  -- Alice's long-term identity
  3: CipherMessage message
}
```
`message.rs:193-203`.

```
CipherMessage = map(5) {
  0: bytes(16) session_tag
  1: uint      counter
  2: uint      prev_counter
  3: PublicKey ratchet_key
  4: bytes     cipher_text
}
```
`message.rs:256-269`, `SessionTag` is 16 random bytes (`message.rs:81-108`).

The ChaCha20 nonce is derived from `counter`: `((counter as u64) << 32).to_be_bytes()`,
i.e. an 8-byte nonce whose first 4 bytes are the big-endian counter and whose
last 4 bytes are zero (`message.rs:56-66`). This is unusual; copy it exactly.

## 3. Session establishment

### 3.1 Alice (initiator, has a `PreKeyBundle`)

Three DHs, concatenated, then one HKDF (`proteus/src/internal/session.rs:797-830`):

```
master_key = DH(alice_identity_sk,  bob_prekey_pk)
          || DH(alice_base_sk,      bob_identity_pk)
          || DH(alice_base_sk,      bob_prekey_pk)

(root_key, chain_key) = HKDF-SHA256(ikm = master_key, salt = none, info = "handshake")
                        -> 64 bytes; first 32 = cipher key -> RootKey,
                                     last  32 = mac key    -> ChainKey (idx 0)
```

Alice then immediately performs one DH ratchet with a fresh sending ratchet key
against Bob's prekey public key to derive her *sending* chain
(`session.rs:820-822`), and keeps the initial chain as her *receiving* chain
(`:816-817`).

The `Session` records `pending_prekey = (prekey_id, alice_base_public)`
(`session.rs:465`). While it is set, every outgoing message is wrapped as a
`PreKeyMessage`; it is cleared as soon as anything from Bob decrypts
(`session.rs:557`, `:579`).

### 3.2 Bob (responder, receives a `PreKeyMessage`)

The mirror image (`session.rs:832-858`):

```
master_key = DH(bob_prekey_sk,    alice_identity_pk)
          || DH(bob_identity_sk,  alice_base_pk)
          || DH(bob_prekey_sk,    alice_base_pk)
```

Same HKDF with info `"handshake"`; Bob's initial chain is a *sending* chain
whose ratchet key is his prekey keypair (`:850`). Bob has no receiving chain
until Alice ratchets.

Bob then **deletes the consumed prekey** unless it was the last-resort one
(`session.rs:497-502`, `:550-555`).

### 3.3 Ratchet and chain KDFs

* DH ratchet: `HKDF(ikm = DH(ours, theirs), salt = current root key, info = "dh_ratchet")`
  → new root key (first 32 B) + new chain key (last 32 B) — `session.rs:52-63`.
* Chain step: `chain_key' = HMAC-SHA256(chain_key, "1")` — `session.rs:102-107`.
* Message keys: `base = HMAC-SHA256(chain_key, "0")`, then
  `HKDF(ikm = base, salt = none, info = "hash_ratchet")` → cipher key + mac key —
  `session.rs:109-117`.

Note the two literal one-byte info strings `"0"` and `"1"`, and the three
distinct HKDF `info` values `"handshake"`, `"dh_ratchet"`, `"hash_ratchet"`.

### 3.4 Encrypt / decrypt

Encrypt (`session.rs:885-915`): take message keys from the send chain, produce a
`CipherMessage{session_tag, ratchet_key, counter, prev_counter, ciphertext}`,
wrap in `PreKeyMessage` if `pending_prekey` is set, MAC the encoded `Message`
with the message MAC key, advance the chain key.

Decrypt (`session.rs:917-952`): find the receive chain whose `ratchet_key`
matches; if none, perform a DH ratchet first. Then compare `m.counter` with the
chain index:

* **less** → look for a stored skipped message key (`try_message_keys`,
  `session.rs:211-247`),
* **greater** → derive and stage the gap keys (`stage_message_keys`, `:249-269`),
  decrypt, commit the staged keys,
* **equal** → decrypt with the current key and step the chain.

The MAC is verified **after** decryption in every branch (`:935`, `:945`) but
before the plaintext is returned.

### 3.5 Limits you must reproduce

| Constant | Value | Source |
|---|---|---|
| `MAX_COUNTER_GAP` | 1000 | `session.rs:191` |
| `MAX_RECV_CHAINS` | 5 | `session.rs:398` |
| `MAX_SESSION_STATES` | 100 | `session.rs:399` |

Exceeding the counter gap yields `TooDistantFuture` (`session.rs:255-257`); more
than 5 receive chains drops the oldest (`:878-880`); more than 100 session states
evicts the lowest-numbered one (`:650-660`).

## 4. Prekeys and the client lifecycle

### 4.1 The `PreKey` JSON object

Everywhere in the REST API a prekey is:

```json
{ "id": 4711, "key": "pQABAQcCoQBYID..." }
```

`id` is a `uint16` (`wire-server/.../Prekey.hs:62`, `newtype PrekeyId = PrekeyId Word16`),
`key` is base64 of the CBOR `PreKeyBundle` from §2.1
(`wire-webapp/libraries/api-client/src/auth/preKey.ts:20-25`).

### 4.2 The last-resort prekey, id `0xFFFF`

`lastPrekeyId = PrekeyId maxBound` = **65535 = 0xFFFF**
(`wire-server/libs/wire-api/src/Wire/API/User/Client/Prekey.hs:264-265`), matching
`MAX_PREKEY_ID: PreKeyId = PreKeyId(u16::MAX)` in proteus
(`proteus/src/internal/keys.rs:356`, `PreKey::last_resort()` at `:180-182`).

It is **never consumed**: the server hands it out repeatedly once the one-time
prekeys are exhausted, and the receiver does not delete it after use
(`proteus/src/internal/session.rs:497-502`: `if pkmsg.prekey_id != MAX_PREKEY_ID { store.remove(...) }`).
The backend refuses to register a client whose `lastkey` has any other id
(`Prekey.hs:253-259`).

### 4.3 Registering a client

`POST /clients`, JSON body (`wire-webapp/libraries/api-client/src/client/clientApi.ts:67-76`,
type `CreateClientPayload` at `libraries/api-client/src/client/newClient.ts:41-54`):

```json
{
  "type": "permanent" | "temporary",
  "class": "desktop" | "phone" | "tablet",
  "cookie": "<label>",
  "lastkey": { "id": 65535, "key": "<base64 CBOR PreKeyBundle>" },
  "prekeys": [ { "id": 0, "key": "..." }, ... ],
  "label": "...",
  "model": "...",
  "password": "...",
  "capabilities": [ ... ]
}
```

The reference client generates **100** one-time prekeys at registration
(`wire-webapp/libraries/core/src/account.ts:213`: `nbPrekeys: 100`,
consumed at `proteusService.ts:115-117`).

### 4.4 Topping up prekeys

* **How many are left on the server**: `GET /clients/:clientId/prekeys` returns a
  JSON array of the remaining **prekey IDs**
  (`clientApi.ts:151-159`; backend route `wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:1164-1172`,
  `Get '[JSON] [PrekeyId]`, summary "List the remaining prekey IDs of a client").
  The reference client subtracts 1 for the last-resort key
  (`proteusService.ts:110-112`).
* **Upload more**: `PUT /clients/:clientId` with `{"prekeys": [ ... ]}`
  (`clientApi.ts:78-90`; caller at `wire-webapp/libraries/core/src/account.ts:463-468`).
  The same endpoint also accepts `lastkey`, `label`, `capabilities`,
  `mls_public_keys` (`newClient.ts:26-36`).
* **When**: the reference client tracks consumption locally and refills when the
  count drops to half of `nbPrekeys`, back up to `nbPrekeys`
  (`wire-webapp/libraries/core/src/messagingProtocols/proteus/proteusService/cryptoClient/coreCryptoWrapper/prekeysTracker/prekeysTracker.ts:62-76`).
  A prekey is counted as consumed whenever *we* create a session from an
  incoming message (`coreCryptoWrapper.ts:244-247`) or when we receive a
  `ClientAction.RESET_SESSION` (`otrMessageAdd.ts:56-60`).

### 4.5 Claiming a peer's prekeys

| Purpose | Method + path | Body | Response |
|---|---|---|---|
| One prekey for one client | `GET /users/:domain/:userId/prekeys/:clientId` | — | `ClientPreKey` = `{client, prekey: {id, key}}` |
| One prekey per client of one user | `GET /users/:domain/:userId/prekeys` | — | `PreKeyBundle` = `{user, clients: [ClientPreKey]}` |
| Bulk, qualified | `POST /users/list-prekeys` | `QualifiedUserClients` | `{qualified_user_client_prekeys, failed_to_list?}` |
| Bulk, legacy unqualified (deprecated, `Until V2`) | `POST /users/prekeys` | `UserClients` | `UserClientPrekeyMap` |

Sources: `wire-webapp/libraries/api-client/src/user/userApi.ts:197-207` (single
client), `:339-349` (per-user bundle), `:547-556` (`/users/list-prekeys`);
backend routes `wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:846-922`.
The deprecated unqualified variants are `Until 'V2` — a modern client must use
the qualified ones.

`POST /users/list-prekeys` request body shape (a `QualifiedUserClients`):

```json
{ "example.com": { "<userId>": ["<clientId>", "<clientId>"] } }
```

Response (`QualifiedUserClientPrekeyMapV4`,
`wire-server/libs/wire-api/src/Wire/API/User/Client.hs:322-345`):

```json
{
  "qualified_user_client_prekeys": {
    "example.com": { "<userId>": { "<clientId>": {"id": 12, "key": "..."} } }
  },
  "failed_to_list": [ {"domain": "other.example", "id": "<userId>"} ]
}
```

A `null` instead of a prekey object means **that client no longer exists** — the
reference client records those as "unknowns" and drops them from the recipient
list
(`wire-webapp/libraries/core/src/messagingProtocols/proteus/utility/sessionHandler/sessionHandler.ts:252-258`).
`failed_to_list` lists users on backends that were unreachable
(`sessionHandler.ts:124-135`).

The reference client chunks the request at **128 users**
(`userApi.ts:78`: `DEFAULT_USERS_PREKEY_BUNDLE_CHUNK_SIZE = 128`, chunking at
`:630-673`).

### 4.6 Session IDs

Sessions are keyed by a string, not by an opaque handle:

```
sessionId = "<domain>@<userId>@<clientId>"     (qualified)
          = "<userId>@<clientId>"              (legacy, pre-federation)
```
`sessionHandler.ts:56-60`, parsed back at `:74-82` with
`/((?<domain>.+)@)?(?<userId>.+)@(?<clientId>.+)$/`.

`clientId` is the backend's client ID — a **lowercase hex string** (see §5.2).

## 5. Sending

### 5.1 Endpoint

```
POST /conversations/{domain}/{conversationId}/proteus/messages
Content-Type: application/x-protobuf
Body: otr.proto QualifiedNewOtrMessage
```

`wire-webapp/libraries/api-client/src/conversation/conversationApi/conversationApi.ts:686-703`
(URL assembled from `CONVERSATIONS`, domain, id, `PROTEUS` = `'proteus'`
(`:113`), `MESSAGES`), content type from
`libraries/api-client/src/http/httpClient.ts:449-458` +
`libraries/api-client/src/http/contentType.ts:22`
(`APPLICATION_PROTOBUF = 'application/x-protobuf'`).

The team-wide broadcast variant (used for `Availability`) is
`POST /broadcast/proteus/messages` with the identical body
(`libraries/api-client/src/broadcast/broadcastApi.ts:32`, `:41-57`).

### 5.2 `otr.proto`, verbatim (v1.56.0)

```proto
syntax = "proto2";

package proteus;

option java_package = "com.wire.messages";
option java_outer_classname = "Otr";
option optimize_for = LITE_RUNTIME;

message UserId {
    required bytes uuid = 1;
}

message QualifiedUserId {
    required string id     = 1;
    required string domain = 2;
}

message ClientId {
    required uint64 client = 1;
}

message ClientEntry {
    required ClientId client = 1;
    required bytes    text   = 2;
}

message UserEntry {
    required UserId      user    = 1;
    repeated ClientEntry clients = 2;
}

message QualifiedUserEntry {
  required string domain = 1;
  repeated UserEntry entries = 2;
}

enum Priority {
  // 0 is reserved for errors
  LOW_PRIORITY = 1;
  HIGH_PRIORITY = 2;
};

// deprecated, use QualifiedNewOtrMessage
message NewOtrMessage {
    required ClientId  sender          = 1;
    repeated UserEntry recipients      = 2;
    optional bool      native_push     = 3 [default = true];
    optional bytes     blob            = 4;
    optional Priority  native_priority = 5;
    optional bool      transient       = 6;
    repeated UserId    report_missing  = 7;
}

message QualifiedNewOtrMessage {
    required ClientId                  sender          = 1;
    repeated QualifiedUserEntry        recipients      = 2;
    optional bool                      native_push     = 3 [default = true];
    optional bytes                     blob            = 4;
    optional Priority                  native_priority = 5;
    optional bool                      transient       = 6;
    // For more details please refer to backend swagger at
    // https://staging-nginz-https.zinfra.io/api/swagger-ui/
    oneof client_mismatch_strategy {
        ClientMismatchStrategy.ReportAll  report_all   = 7;
        ClientMismatchStrategy.IgnoreAll  ignore_all   = 8;
        ClientMismatchStrategy.ReportOnly report_only  = 9;
        ClientMismatchStrategy.IgnoreOnly ignore_only  = 10;
    }
}

message ClientMismatchStrategy {
    message ReportAll {}
    message IgnoreAll {}

    message ReportOnly {
        repeated QualifiedUserId user_ids = 1;
    }

    message IgnoreOnly {
        repeated QualifiedUserId user_ids = 1;
    }
}

message OtrAssetMeta {
    required ClientId  sender      = 1;
    repeated UserEntry recipients  = 2;
    optional bool      isInline    = 3 [default = false];
    optional bool      native_push = 4 [default = true];
}
```

(`generic-message-proto/proto/otr.proto:20-108`, verbatim minus the GPL header.)

Encoding notes for a hand-written codec:

* `ClientId.client` is a **`uint64` holding the hex client ID parsed as base 16**:
  `Long.fromString(clientId, 16)`
  (`wire-webapp/libraries/core/src/conversation/message/messageService.ts:111`, `:131`).
  The backend does the inverse (`wire-server/libs/wire-api/src/Wire/API/Message.hs:276-279`).
* `UserId.uuid` is the **raw 16 bytes** of the user UUID, not its string form:
  `Buffer.from(uuid.replace(/-/g, ''), 'hex')`
  (`wire-webapp/libraries/commons/src/util/StringUtil.ts:31-33`, used at
  `messageService.ts:118`).
* `ClientEntry.text` is the CBOR `Envelope` from §2.3, raw bytes.
* `blob` (field 4) is the `External` ciphertext (§ `08-…` §9). Optional and
  unused by modern web senders.
* `native_push` (field 3) defaults to true; set it false for confirmations and
  other silent traffic.
* `transient` (field 6) means "do not persist in the notification stream".
* `client_mismatch_strategy` is a `oneof` and the backend **requires** exactly
  one of the four to be present — `protolensToClientMismatchStrategy` returns
  `Left "ClientMismatchStrategy not specified!"` for `Nothing`
  (`wire-server/libs/wire-api/src/Wire/API/Message.hs:427-433`). `ReportAll` and
  `IgnoreAll` are **empty messages**, so on the wire they are a tag with a
  zero-length body (e.g. `3A 00` for `report_all`).

`NewOtrMessage` and `OtrAssetMeta` are legacy; a new client should only ever
build `QualifiedNewOtrMessage`.

### 5.3 The four mismatch strategies

From the endpoint's own documentation
(`wire-webapp/libraries/api-client/src/conversation/conversationApi/conversationApi.ts:665-675`)
and the backend's `ClientMismatchStrategy`
(`wire-server/libs/wire-api/src/Wire/API/Message.hs:419-423`):

| Strategy | Field | Meaning |
|---|---|---|
| `report_all` | 7 | If **any** client is missing, do not send; report the missing ones (→ 412). |
| `ignore_all` | 8 | Do no missing-client check at all; send to exactly what was supplied. |
| `report_only` | 9 | Take a list of qualified user IDs. If any client **of those users** is missing, do not send; report. |
| `ignore_only` | 10 | Take a list of qualified user IDs. If any client of the **non-listed** users is missing, do not send; report. |

What the reference client picks
(`wire-webapp/libraries/core/src/conversation/message/messageService.ts:140-148`,
driven by `getGenericMessageParams.ts:64-72`):

* caller gave an explicit `QualifiedUserClients` map → `report_all`
  (`reportMissing = true`),
* caller gave a plain list of user IDs (`MessageTargetMode.USERS`) →
  `report_only` with those user IDs,
* caller targeted specific user/client pairs (`MessageTargetMode.USERS_CLIENTS`)
  → `ignore_all`,
* caller gave nothing (client fetched the full device list itself) →
  `reportMissing` is `false` → `ignore_all`.

Broadcast always uses `report_only` with every recipient
(`wire-webapp/libraries/core/src/broadcast/broadcastService.ts:48`).

### 5.4 The `412` response and the retry loop

On a mismatch the backend answers **HTTP 412 Precondition Failed** with a
`MessageSendingStatus` body
(`wire-server/libs/wire-api/src/Wire/API/Message.hs:497-518`;
TypeScript mirror at
`wire-webapp/libraries/api-client/src/conversation/messageSendingStatus.ts:22-29`):

```json
{
  "time": "2026-08-20T12:34:56.789Z",
  "missing":   { "example.com": { "<userId>": ["<clientId>"] } },
  "redundant": { ... },
  "deleted":   { ... },
  "failed_to_send": { ... },
  "failed_to_confirm_clients": { ... }
}
```

* `missing` — clients the message *should* have been encrypted for but wasn't.
* `redundant` — clients it *should not* have been encrypted for but was.
* `deleted` — clients that no longer exist.
* `failed_to_send` — partial federation failure. **This appears with HTTP 201,
  not 412**: the message went out to some backends and not others
  (`conversationApi.ts:676-681`).
* `failed_to_confirm_clients` — clients whose delivery could not be confirmed.

The same shape (minus the last two fields) is returned as `ClientMismatch`
(`time`/`missing`/`redundant`/`deleted`) by the older unqualified endpoints
(`Message.hs:469-495`).

The retry loop
(`wire-webapp/libraries/core/src/conversation/message/messageService.ts:57-92`,
`reencryptAfterMismatch` at `:171-196`):

1. Encrypt for the recipients you know about, `POST` the message.
2. On **412**: parse the body.
3. Call the app's `onClientMismatch` hook. If it returns `false` (e.g. the user
   declined to send to an unverified new device), **abort** and report
   `canceled: true` (`:84-88`).
4. **Remove** every client listed in `deleted` from the payload (`:176-189`).
5. If `missing` is empty, resend the pruned payload as-is (`:191-193`).
6. Otherwise claim prekeys for exactly the `missing` clients
   (`POST /users/list-prekeys`), build sessions, encrypt for them, merge into the
   existing payload (`:194-195`).
7. Resend. **Only once** — the reference client does not loop
   (`messageService.ts:89-90` calls `send()` and returns). A second 412 propagates
   as an error.

Note that `redundant` is *not* acted upon: sending to a redundant client is
harmless.

### 5.5 Getting the recipient list in the first place

Before encrypting, you need every device of every participant:
`POST /users/list-clients` with `{"qualified_users": [{"domain":..,"id":..}]}`
(`wire-webapp/libraries/api-client/src/user/userApi.ts:612-624`, path
`/users/list-clients`), then flatten to `{domain: {userId: [clientId, ...]}}`
(`wire-webapp/libraries/core/src/messagingProtocols/proteus/utility/recipients.ts:29-58`).

Sessions that already exist are reused; only the genuinely new client IDs
trigger a prekey claim
(`sessionHandler.ts:148-219` — `initSessions` partitions into existing sessions,
clients with an inline prekey, and clients needing a fetch).

## 6. Receiving

### 6.1 The event

Proteus messages arrive as `conversation.otr-message-add` events on the
notification stream / websocket, with this `data` payload
(`wire-webapp/libraries/api-client/src/conversation/data/conversationOtrMessageAddData.ts:20-25`):

```json
{
  "recipient": "<my clientId, hex>",
  "sender":    "<sender clientId, hex>",
  "text":      "<base64 CBOR Envelope>",
  "data":      "<base64 External ciphertext, optional>"
}
```

plus the event-level `from` / `qualified_from` (sender user), `conversation` /
`qualified_conversation`, and `time`.

`sender` **is** the `sender_client_id` — the hex client ID of the sending
device, taken straight from `QualifiedNewOtrMessage.sender`. You need it, with
the sender user ID, to compute the session ID (§4.6).

### 6.2 Decrypting

`wire-webapp/libraries/core/src/messagingProtocols/proteus/eventHandler/events/otrMessageAdd/otrMessageAdd.ts:42-65`:

```
userId       = qualified_from ?? {id: from, domain: ''}
messageBytes = base64decode(data.text)
plaintext    = proteusService.decrypt(messageBytes, userId, data.sender)
genericMsg   = GenericMessage.decode(plaintext)
```

`ProteusService.decrypt` (`proteusService.ts:296-317`) branches on whether the
session already exists:

* **session exists** → `decrypt(sessionId, bytes)`.
* **no session** → `sessionFromMessage(sessionId, bytes)`: parse the `Envelope`,
  require `Message::Keyed` (a `PreKeyMessage`), look up
  `PreKeyMessage.prekey_id` in the local prekey store, run the Bob handshake
  (§3.2), decrypt, then persist the session and **count a prekey as consumed**
  (`coreCryptoWrapper.ts:244-247`).

If the local prekey for that id is gone, proteus returns
`PreKeyNotFound` → error code `102 SessionNotFound`
(`proteus/src/internal/session.rs:594-599`).

Note that a `PreKeyMessage` can also arrive for a session that already exists —
e.g. the peer re-initiated. Proteus first tries the normal path, and only on
`InvalidSignature` / `InvalidMessage` does it build a new state from the prekey
(`session.rs:539-565`). A new client must reproduce that fallback, otherwise a
peer's session reset will look like permanent corruption.

### 6.3 Duplicates and out-of-order

Handled inside the ratchet, not by the app:

* **Out of order (message from the future)**: message keys for the skipped
  counters are derived and stored (`stage_message_keys`, `session.rs:249-269`),
  bounded by `MAX_COUNTER_GAP = 1000`; exceeding it → `TooDistantFuture` (212).
* **Out of order (message from the past)**: looked up in the stored skipped keys;
  the key is **removed** on use (`try_message_keys`, `session.rs:211-247`).
* **Duplicate**: the key was already consumed, so the lookup fails →
  `DuplicateMessage` (209) (`session.rs:230-232`).
* **Too old**: if the oldest stored key is already newer than the message,
  `OutdatedMessage` (`session.rs:216-223`).
* **Peer changed identity** on an existing session → `RemoteIdentityChanged`
  (204) (`session.rs:542-544`).

Error codes as surfaced to the app
(`wire-webapp/libraries/core/src/messagingProtocols/proteus/proteusService/decryptionErrorGenerator/decryptionErrorGenerator.ts:32-41`):

```
102 SessionNotFound        201 InvalidMessage
204 RemoteIdentityChanged  207 InvalidSignature
209 DuplicateMessage       212 TooDistantFuture
406 PreKeyMessageUnMatchedSignature   999 Unknown
```

A `DuplicateMessage` is a **normal** condition (the notification stream can
replay); log it and drop the event. `SessionNotFound` and `InvalidMessage` are
what the user sees as "you cannot read this message" and what a session reset is
meant to fix. `RemoteIdentityChanged` is the security-relevant one — the peer's
device key changed, which must un-verify the device and warn the user
(`wire-webapp/apps/webapp/src/script/repositories/entity/message/decryptErrorMessage.ts:43`).

The reference client never throws away the *event* on a decryption failure: it
returns `{event, decryptionError}` (`otrMessageAdd.ts:66-72`) so the UI can show
a placeholder with a "reset session" button.

## 7. Session reset (`ClientAction.RESET_SESSION`)

The recovery path when a session is broken beyond repair.

Local half
(`wire-webapp/apps/webapp/src/script/repositories/conversation/MessageRepository.ts:1135-1163`):

1. Read the remote fingerprint (this creates the session if missing).
2. **Delete** the local session (`deleteSession(userId, clientId)`).
3. Read the remote fingerprint again — this claims a fresh prekey and builds a
   brand-new session.
4. If the fingerprint changed, mark the peer device **unverified** and raise a
   `CLIENTS_UPDATED` event.

Remote half (`MessageRepository.ts:1177-1188`): send

```
GenericMessage { message_id: <new uuid>, clientAction: RESET_SESSION (= 0) }
```

(built by `wire-webapp/libraries/core/src/conversation/message/messageBuilder.ts:339-344`),
targeted at **that one client only**, with
`protocol: PROTEUS` and `targetMode: USERS_CLIENTS` — which means `ignore_all`,
no mismatch handling.

On the receiving side, a `RESET_SESSION` is not shown to the user. Its only
effect is bookkeeping: the receiver decrements its local prekey count, because
the sender just claimed a fresh prekey
(`otrMessageAdd.ts:56-60`). The next message from the resetting peer will be a
`PreKeyMessage` and will build the new session automatically (§6.2).

`RESET_SESSION` is meaningless over MLS; only send it in Proteus conversations.

## 8. Protocol selection: when is Proteus used at all?

Three independent switches decide.

### 8.1 Team feature `mls`

`GET /feature-configs` returns an `mls` feature whose config is
(`wire-webapp/libraries/api-client/src/team/feature/featureList.schema.ts:100-106`):

```
{ allowedCipherSuites: number[], defaultCipherSuite: number,
  defaultProtocol: "mls" | "proteus" | "mixed",
  protocolToggleUsers: string[],
  supportedProtocols: ("mls"|"proteus"|"mixed")[] }
```

`defaultProtocol` decides which protocol **new group conversations** get.
`supportedProtocols` is the team-wide allowlist.

`CONVERSATION_PROTOCOL` values are `'mls' | 'proteus' | 'mixed'`
(`libraries/api-client/src/team/feature/featureList.types.ts:122-126`).

### 8.2 Per-user `supported_protocols`

Each user advertises what their devices can do:
`PUT /self/supported-protocols` with `{"supported_protocols": [...]}`
(`libraries/api-client/src/self/selfApi.ts:190-196`), readable per user at
`GET /users/:domain/:id/supported-protocols` (`userApi.ts:351-358`).

**An empty/absent list means `["proteus"]`** —
`wire-webapp/libraries/core/src/user/userService.ts:59-60`:
```ts
return supportedProtocols.length > 0 ? supportedProtocols : [CONVERSATION_PROTOCOL.PROTEUS];
```

The self value is *derived*, not chosen: a client advertises `proteus` if the
team allows it, and `mls` only once **all** of the user's active devices have
registered MLS key packages, or migration is finalised
(`wire-webapp/apps/webapp/src/script/repositories/self/SelfSupportedProtocols/SelfSupportedProtocols.ts:83-125`).

### 8.3 1:1 conversation protocol negotiation

`getProtocolFor1to1Conversation()`
(`wire-webapp/apps/webapp/src/script/repositories/conversation/ConversationRepository.ts:1757-1792`):

1. Intersect my `supported_protocols` with the other user's.
2. If the intersection contains **`mls`** → MLS.
3. Else if it contains **`proteus`** → **Proteus**.
4. Else (no overlap at all) → my own preferred protocol; the conversation will
   not work until one side changes.

So a 1:1 falls back to Proteus **whenever either side is not fully MLS-capable**.

### 8.4 `mixed` conversations

`mixed` is the migration state of a *group*: the conversation has both an MLS
group and the classic Proteus membership, and clients must send **both** ways
during the transition. Protocol upgrades go
`proteus → mixed → mls` and are one-way — the update endpoint accepts only
`MIXED | MLS`
(`libraries/api-client/src/conversation/conversationApi/conversationApi.ts:986`,
`libraries/api-client/src/conversation/data/conversationProtocolUpdateData.ts:23`).

A client that implements MLS but not Proteus **cannot fully participate in a
`mixed` conversation**: it will read the MLS side but be invisible to peers who
are still on the Proteus side.

## 9. What the official clients actually run

The reference client does not implement Proteus in TypeScript. It calls
**CoreCrypto** (Rust → WASM), which wraps the `proteus-wasm` crate
(`core-crypto/Cargo.toml:135-136`, git `wireapp/proteus` tag `v3.0.1`).
The TypeScript side is a thin adapter:
`wire-webapp/libraries/core/src/messagingProtocols/proteus/proteusService/cryptoClient/coreCryptoWrapper/coreCryptoWrapper.ts:180-283`
(`proteusEncryptBatched`, `proteusDecrypt`, `proteusSessionFromMessage`,
`proteusSessionFromPrekey`, `proteusNewPrekeyAuto`, `proteusLastResortPrekey`,
`proteusFingerprint`). A legacy `cryptoboxWrapper.ts` for the old JS
`@wireapp/cryptobox` still exists alongside it.

For us this means: **there is no small, embeddable, well-tested JS/TS Proteus
implementation to reuse** that is not either CoreCrypto's WASM blob or the
deprecated cryptobox. Implementing Proteus means implementing the Double Ratchet
plus a CBOR codec plus Ed25519↔X25519 conversion ourselves, or shipping the
CoreCrypto WASM.

## 10. Effort estimate for a clean-room Proteus

What must be built, assuming `@noble/curves` + `@noble/hashes` + `@noble/ciphers`
for the primitives:

| Piece | Notes |
|---|---|
| CBOR encode/decode | Definite-length maps/arrays/bytes/uints + `null` + skip-unknown. ~150 lines. |
| Key types | Ed25519 keygen; `to_dh()` clamp (SHA-512 of seed, bit-twiddle) and Edwards→Montgomery for public keys. The clamp and the birational map are the two places you *will* get it wrong first. |
| `PreKeyBundle` / `PreKey` / `IdentityKeyPair` codecs | §2.1-2.2. |
| `Envelope` / `Message` / `PreKeyMessage` / `CipherMessage` codecs | §2.3, incl. keeping the raw inner bytes for the MAC. |
| Handshake | Two triple-DH variants (Alice/Bob) + HKDF `"handshake"`. |
| Ratchet | root/chain/message key derivation with `"dh_ratchet"`, `"0"`, `"1"`, `"hash_ratchet"`; ChaCha20-legacy with the `counter << 32` nonce. |
| Session state machine | multiple session states keyed by 16-byte `session_tag`, ≤5 receive chains, ≤100 states, ≤1000 skipped keys, plus their eviction rules. |
| Persistence | sessions and prekeys must survive restarts and be written back after **every** decrypt (the ratchet advances). |
| Transport | `otr.proto` codec, prekey claiming, mismatch retry loop. |

Realistically: several days of work and a real interop test against a live Wire
backend, because *every* one of those constants and info strings is a silent
interop failure if wrong. There are no published Proteus test vectors; the
proteus crate's own tests are self-consistency tests.

## 11. Constants quick reference

```
last-resort prekey id        0xFFFF = 65535
prekeys generated at signup  100 (wire-webapp default)
prekey refill threshold      <= nbPrekeys/2, refill to nbPrekeys
MAX_COUNTER_GAP              1000
MAX_RECV_CHAINS              5
MAX_SESSION_STATES           100
session tag                  16 random bytes
identity / prekey pubkey     32 bytes (Ed25519)
prekey signature             64 bytes (Ed25519), optional
MAC                          32 bytes (HMAC-SHA256)
ChaCha20 nonce               8 bytes = BE(counter) || 00 00 00 00
HKDF info strings            "handshake", "dh_ratchet", "hash_ratchet"
Chain-step HMAC inputs       "1" (next chain key), "0" (message keys)
Envelope / PreKeyBundle version   1
prekey bundle CBOR size      ~83 B unsigned, ~150 B signed
sessionId                    "<domain>@<userId>@<clientId>"
```

## 12. Verdict: must a new client implement Proteus?

**No — MLS alone is enough to talk to modern Wire clients, but only under
conditions you do not control, and the failure mode is silent.**

MLS is sufficient **if and only if** all of the following hold:

1. The backend has MLS enabled and the team's `mls` feature config lists `mls`
   in `supportedProtocols`
   (`featureList.schema.ts:100-106`).
2. **Every peer** we talk to advertises `mls` in their `supported_protocols`. A
   peer that advertises nothing counts as **`proteus`-only**
   (`userService.ts:59-60`) — this includes every non-team/personal account whose
   client has not opted in, and every client older than the MLS rollout.
3. All group conversations we join are `protocol: "mls"`, not `"proteus"` and
   not `"mixed"`.
4. We never need to interoperate with a federated backend that has not enabled
   MLS.

Proteus is **still required** when:

* **Any 1:1 partner is not MLS-capable.** The negotiation
  (`ConversationRepository.ts:1774-1784`) picks Proteus as soon as `mls` is not
  in the intersection. This is the common case for personal accounts and for
  anyone on an older client.
* **A group conversation is `proteus`.** Groups created before the migration, or
  in teams whose `defaultProtocol` is `proteus`, stay Proteus forever unless an
  admin upgrades them.
* **A group conversation is `mixed`.** During migration both sides must be
  served; MLS-only participation makes us invisible to the Proteus half.
* **Federated peers on a backend without MLS.**
* **Self-conversation state sync** (`LastRead`, `Cleared`, `MessageHide`) to our
  own other devices, if any of those devices is Proteus-only.

### What exactly is lost by skipping Proteus in a first implementation

* 1:1 conversations with any non-MLS user simply **do not work** — we cannot
  send and cannot read. Not degraded: broken.
* Proteus and `mixed` group conversations are unreadable; we would see the
  conversation in the list with no messages.
* Session-reset recovery, `External` messages and the whole `412 missing
  clients` machinery become dead code we never need — a genuine simplification
  of maybe 40% of the transport work.
* Nothing at the *payload* level is lost: `GenericMessage` is identical on both
  transports (`08-GenericMessage-Protobuf.md` §11.2), so all message-type
  handling is written once regardless.

### Recommendation

Build **MLS first** and ship it. Detect Proteus conversations explicitly
(`conversation.protocol !== 'mls'`, or a 1:1 whose negotiation yields Proteus)
and surface an honest "this conversation needs Proteus, not yet supported"
state rather than an empty conversation. Add Proteus as a second phase — it is a
self-contained, well-specified chunk (this document) that plugs in below an
unchanged `GenericMessage` layer, so deferring it costs nothing architecturally
and only delays coverage of the older half of the network.
