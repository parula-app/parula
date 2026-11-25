# Wire protocol — 05: Conversations

Listing, creating, membership, roles and settings. Everything **except** message
encryption (Proteus/MLS payload handling is a separate document).

Source repositories referenced below (paths are repo-relative):

| Short name | Meaning |
| --- | --- |
| `wire-webapp` | official web client monorepo; `libraries/api-client` is the authoritative TypeScript REST client |
| `wire-server` | Haskell backend; `libs/wire-api` holds the JSON schemas, `services/galley` owns conversations |
| `wire-web-packages` | older standalone copy of the api-client (same shapes, older naming) |

Swagger dumps checked into `wire-server/services/brig/docs/swagger-v<N>.json` are
generated from the Haskell types and are quoted as `swagger-v16.json` below.

---

## 0. Conventions

* **Base URL** — the backend REST root (e.g. `https://prod-nginz-https.wire.com`),
  optionally prefixed with `/v<N>` for a pinned API version.
* **API version negotiation** — `GET /api-version` returns
  `{supported: number[], development?: number[], federation?: boolean, domain: string}`
  (`wire-webapp/libraries/api-client/src/apiClient.ts:166-171`, request at `:314-320`).
  The client picks the highest mutually supported version and then prefixes every
  request with `/v<N>`. Everything below is written for **v5 and newer**; version
  differences are flagged explicitly.
* **Auth** — `Authorization: Bearer <access_token>` on every call.
* **Qualified IDs** — federation makes every ID a pair:
  ```json
  {"id": "537992e5-3782-4b6c-8718-a5db2cb786ee", "domain": "wire.com"}
  ```
  (`wire-server/libs/wire-api/.../Conversation.hs:326`, swagger
  `Qualified_Id_IdTag_Conversation`: both `id` and `domain` are required.)
* **Errors** — a failed call returns
  `{"code": <int>, "label": "<string>", "message": "<human text>"}`. See §8.
* Time stamps are ISO-8601 UTC strings, e.g. `"2015-01-13T10:41:55.032Z"`.

---

## 1. Listing conversations

### 1.1 `POST /conversations/list-ids` — paginated ID enumeration

Route: `wire-server/libs/wire-api/src/Wire/API/Routes/Public/Galley/Conversation.hs:267-277`
(`list-conversation-ids`, `From 'V3`; identical `list-conversation-ids-v2` exists `Until 'V3`).

**Request body**
```json
{"size": 1000, "paging_state": "AQ=="}
```
* `size` — optional, `1 <= size <= 1000`, **defaults to 1000**
  (`Conversation.hs:522` — `GetPaginatedConversationIds ... 1000 1000`; confirmed in
  `swagger-v16.json` → `GetMuliTabPgRqs_ConvrIdLcOm10_...`: `"optional, must be <= 1000, defaults to 1000."`).
* `paging_state` — omit on the first request; on every later request pass back
  the value from the previous response
  (`wire-server/libs/wire-api/src/Wire/API/Routes/MultiTablePaging.hs:98-107`).

**Response 200**
```json
{
  "qualified_conversations": [
    {"id": "537992e5-3782-4b6c-8718-a5db2cb786ee", "domain": "wire.com"},
    {"id": "f2520615-f860-4c72-8b90-9ace3b5f6c37", "domain": "other.example"}
  ],
  "has_more": true,
  "paging_state": "AQIDBAUGBwg="
}
```
All three fields are always present (`MultiTablePaging.hs:161-166`; swagger
`MultiTabePg_ConvrsIdqf_cLORm_Q_...` requires all three). TS type:
`QualifiedConversationIds` in
`wire-webapp/libraries/api-client/src/conversation/qualifiedConversationIds.ts:22-26`.

`paging_state` is **opaque**: base64url of one table-selector byte
(`0` = local conversations, `1` = remote conversations) followed by the raw
Cassandra paging token
(`wire-server/libs/wire-api/src/Wire/API/Routes/MultiTablePaging/State.hs:47-60,170-181`).
Never parse it; never persist it across sessions.

Loop while `has_more === true`, accumulating `qualified_conversations`
(reference implementation: `wire-webapp/libraries/api-client/src/conversation/conversationApi/conversationApi.ts:246-276`).

### 1.2 `POST /conversations/list` — fetch metadata for a batch of IDs

Route: `Conversation.hs:379-388` (`list-conversations`, `From 'V16`; the same path
since `From 'V2`, see `:330-348`). Before v2 the path was
`POST /conversations/list/v2` (`Conversation.hs:319-329`), which the api-client still
falls back to when the negotiated version is `< 2`
(`conversationApi.ts:290-293`).

**Request body**
```json
{"qualified_ids": [
  {"id": "537992e5-3782-4b6c-8718-a5db2cb786ee", "domain": "wire.com"},
  {"id": "f2520615-f860-4c72-8b90-9ace3b5f6c37", "domain": "other.example"}
]}
```
`qualified_ids` is required, **1..1000 entries** (`Conversation.hs:527-539`).
The official client chunks at **500** IDs per request
(`conversationApi.ts:93` — `MAX_CHUNK_SIZE = 500` — used at `:283`).

**Response 200**
```json
{
  "found":     [ /* full Conversation objects, see §2 */ ],
  "not_found": [ {"id": "...", "domain": "..."} ],
  "failed":    [ {"id": "...", "domain": "..."} ]
}
```
All three keys are always present (`Conversation.hs:549-562`; swagger
`ConversationsResponse_...` requires `found`, `not_found`, `failed`).

* `not_found` — "These conversations either don't exist or are deleted."
* `failed` — "The server failed to fetch these conversations, most likely due to
  network issues while contacting a remote server" (a federated peer was down).
  **Retry these later**; do not delete them locally.

TS type `RemoteConversations`:
`wire-webapp/libraries/api-client/src/conversation/remoteConversations.ts:24-28` —
note all three fields are declared optional there, so a client must default them
to `[]`.

### 1.3 Legacy: `GET /conversations?start=&size=` and `GET /conversations/ids`

Route: `Conversation.hs:278-318` (`get-conversations`, `Until 'V3`). Swagger v2
documents it as:

* `ids` — comma-separated list, 1..32 UUIDs, **mutually exclusive with `start`**
* `start` — conversation ID to start from (exclusive)
* `size` — 1..500, max number of conversations returned

```
GET /conversations?start=537992e5-3782-4b6c-8718-a5db2cb786ee&size=100
```
```json
{"has_more": false, "conversations": [ /* Conversation objects */ ]}
```
(`ConversationList` — `Conversation.hs:492-506`.) A matching real fixture of that
older, *unqualified* shape lives in
`wire-webapp/apps/webapp/test/api/payloads.js:180-184`.

The server's own description is explicit:
> "Will not return remote conversations. Use `POST /conversations/list-ids`
> followed by `POST /conversations/list` instead." (`Conversation.hs:282-285`)

`GET /conversations/ids?start=&size=` (`Conversation.hs:232-255`, `Until 'V3`)
returns bare unqualified IDs: `{"conversations": ["<uuid>", ...], "has_more": false}`
(TS `ConversationIds`, `conversationIds.ts:20-23`).

### 1.4 Which one the current webapp uses

**`list-ids` + `list`, always.** `ConversationAPI.getConversationList()`
(`conversationApi.ts:310-317`) calls `getQualifiedConversationIds()` (POST
`list-ids`, paging until exhausted) and feeds the result to
`getConversationsByQualifiedIds()` (chunked POST `list`). Neither
`GET /conversations` nor `GET /conversations/ids` has any caller left in
`wire-webapp` or in the older `wire-web-packages` copy — the legacy endpoints are
gone from the current `ConversationAPI` class entirely. The webapp additionally
filters out a locally-kept blacklist before calling `list`
(`wire-webapp/libraries/core/src/conversation/conversationService/conversationService.ts:211-217`).

---

## 2. The `Conversation` object

Canonical TS interface:
`wire-webapp/libraries/api-client/src/conversation/conversation.ts:78-121`.
Haskell schema: `wire-server/libs/wire-api/src/Wire/API/Conversation.hs:227-256`
(metadata) + `:323-331` (envelope) + protocol block from
`Wire/API/Conversation/Protocol.hs:117-174`.

### 2.1 Field reference

| Field | Type | Notes |
| --- | --- | --- |
| `qualified_id` | `{id, domain}` | **required**, the conversation identity (`Conversation.hs:326`) |
| `id` | uuid | deprecated duplicate of `qualified_id.id`; **only emitted by the `OwnConversation` variant** — see §2.5 (`Conversation.hs:327-328`) |
| `type` | integer | see §2.2 (`Conversation.hs:233`) |
| `creator` | uuid \| `null` | "The creator's user ID"; unqualified, always local to the conversation's domain (`Conversation.hs:234-238`) |
| `access` | `string[]` | `"private" \| "invite" \| "link" \| "code"` (`Conversation.hs:587-596`) |
| `access_role` | `string[]` **since v3** | `"team_member" \| "non_team_member" \| "guest" \| "service"` (`Conversation.hs:198-199,732-741`) |
| `access_role` | `string` **v2 and older** | legacy single value `"private" \| "team" \| "activated" \| "non_activated"` (`Conversation.hs:221-224,752-762`) |
| `access_role_v2` | `string[]` | **v2 only** companion to legacy `access_role`; deprecated since v3 (`Conversation.hs:225`, TS `conversation.ts:89-90`) |
| `name` | string \| `null` | 1..256 chars when set (`Conversation.hs:241`) |
| `team` | uuid \| `null` | team ID, absent for personal conversations (`Conversation.hs:245`) |
| `message_timer` | int64 \| `null` | self-deleting-message timer in **milliseconds** (`Conversation.hs:246-250`) |
| `receipt_mode` | int32 \| `null` | `0` = off, `1` = on; the backend does **not** interpret it (`Conversation.hs:827-846`) |
| `members` | object | `{self, others}` — see §3 (`Conversation.hs:330`) |
| `last_event` | string | **always the constant `"0.0"`** (`Conversation.hs:242`) |
| `last_event_time` | string | **always the constant `"1970-01-01T00:00:00.000Z"`** (`Conversation.hs:243-244`) |
| `protocol` | string | `"proteus" \| "mls" \| "mixed"` (`Protocol.hs:232-239`) |
| `group_id` | base64 string | MLS/mixed only — "A base64-encoded MLS group ID" (`Protocol.hs:120-124`) |
| `epoch` | uint64 | MLS/mixed only; `0` until the first commit (`Protocol.hs:152-156`) |
| `epoch_timestamp` | ISO-8601 \| absent | MLS only, present only once `epoch > 0` (`Protocol.hs:157-163`) |
| `cipher_suite` | int (0..65535) | MLS only, present only once `epoch > 0` (`Protocol.hs:164-170`) |
| `group_conv_type` | string | `"group_conversation" \| "channel" \| "meeting"` (`Conversation.hs:854-866`) |
| `add_permission` | string \| `null` | `"admins" \| "everyone"`; only set for channels (`Conversation.hs:1307-1321`) |
| `cells_state` | string | `"disabled" \| "pending" \| "ready"`, defaults to `"disabled"` (`Wire/API/Conversation/CellsState.hs:30-51`) |
| `parent` | uuid \| `null` | parent conversation, newer field (`Conversation.hs:255`) |
| `history` | `{depth: ...}` | history-sharing config, newer field (`Conversation.hs:256`) |

`last_event` / `last_event_time` are **hard-coded server constants** — they are
not the real last event. Do not use them for ordering; use the notification
stream instead.

### 2.2 `type` — integer conversation type

`wire-server/.../Conversation.hs:779-825`, TS mirror
`wire-webapp/libraries/api-client/src/conversation/conversation.ts:28-34`.

| Value | Haskell | TS | Meaning |
| --- | --- | --- | --- |
| `0` | `RegularConv` | `REGULAR` | group conversation / channel / meeting |
| `1` | `SelfConv` | `SELF` | the user's own notes conversation (also the MLS self-conversation) |
| `2` | `One2OneConv` | `ONE_TO_ONE` | accepted 1:1 conversation |
| `3` | `ConnectConv` | `CONNECT` | pending connection request ("connect" conversation) |
| `4` | — | `GLOBAL_TEAM` | **client-side only.** No such value exists on the backend: `convTypeFromInt32` rejects anything outside 0..3 (`Conversation.hs:819-825`) and swagger declares `"enum": [0,1,2,3]`. It is a legacy webapp constant still referenced in `wire-webapp/apps/webapp/src/script/repositories/conversation/ConversationSelectors.ts:62`. A new client should not expect it on the wire. |

For `type` 1, 2 and 3 the backend forces `access_role` to `[]` (private)
regardless of what was requested (`Conversation.hs:667-672`).

### 2.3 `access` / `access_role` semantics

`access` says **how** a user may get in; `access_role` says **who** may get in.

`access` values (`Conversation.hs:574-596,612-625`):

| String | Cassandra int | Meaning |
| --- | --- | --- |
| `private` | 1 | obsolete, superseded by an empty `access_role` |
| `invite` | 2 | an existing member may add another user |
| `link` | 3 | anyone knowing the conversation ID may join |
| `code` | 4 | anyone knowing the (revocable) guest-link code may join |

`access_role` values (`Conversation.hs:674-710,732-741`): `team_member` (1),
`non_team_member` (2), `guest` (3), `service` (4). Default when omitted on
creation: `["team_member","non_team_member","service"]` (`defRole`,
`Conversation.hs:658-665`). An **empty list is rejected** when creating.

Legacy → v3 mapping (`Conversation.hs:645-662,764-777`):

| Legacy `access_role` | `access_role` array |
| --- | --- |
| `private` | `[]` |
| `team` | `["team_member"]` |
| `activated` | `["team_member","non_team_member","service"]` |
| `non_activated` | `["team_member","non_team_member","guest","service"]` |

The webapp's named presets (`wire-webapp/apps/webapp/src/script/repositories/conversation/ConversationAccessPermission.test.ts:142-183`):

| Preset | `access` | `access_role` |
| --- | --- | --- |
| TEAM_ONLY | `["invite"]` | `["team_member"]` |
| SERVICES | `["invite"]` | `["team_member","service"]` |
| GUEST_ROOM | `["invite","code"]` | `["guest","non_team_member","team_member"]` |
| GUESTS_SERVICES | `["invite","code"]` | `["guest","non_team_member","team_member","service"]` |
| PUBLIC | `["invite","link"]` | `["team_member"]` |
| PUBLIC_GUESTS | `["invite","code","link"]` | `["guest","non_team_member","team_member"]` |

### 2.4 Full example — group conversation (Proteus, team)

Assembled from the TS interface and the zod validator
(`wire-webapp/libraries/api-client/src/conversation/conversationSchema.ts:101-143`)
plus the real self-member fixture at
`wire-webapp/libraries/api-client/src/conversation/conversationSchema.test.ts:25-49`:

```json
{
  "qualified_id": {"id": "537992e5-3782-4b6c-8718-a5db2cb786ee", "domain": "wire.com"},
  "id": "537992e5-3782-4b6c-8718-a5db2cb786ee",
  "type": 0,
  "creator": "d5a39ffb-6ce3-4cc8-9048-0e15d031b4c5",
  "name": "Very funny conversation about foo bar",
  "team": "537992e5-3782-4b6c-8718-a5db2cc786ee",
  "access": ["invite", "code"],
  "access_role": ["team_member", "non_team_member", "guest", "service"],
  "group_conv_type": "group_conversation",
  "add_permission": null,
  "cells_state": "disabled",
  "message_timer": null,
  "receipt_mode": 1,
  "last_event": "0.0",
  "last_event_time": "1970-01-01T00:00:00.000Z",
  "protocol": "proteus",
  "members": {
    "self": {
      "qualified_id": {"id": "d5a39ffb-6ce3-4cc8-9048-0e15d031b4c5", "domain": "wire.com"},
      "id": "d5a39ffb-6ce3-4cc8-9048-0e15d031b4c5",
      "conversation_role": "wire_admin",
      "hidden": false,
      "hidden_ref": null,
      "otr_archived": false,
      "otr_archived_ref": null,
      "otr_muted_status": 0,
      "otr_muted_ref": "2015-01-13T10:41:55.032Z",
      "service": null,
      "status": 0,
      "status_ref": "0.0",
      "status_time": "1970-01-01T00:00:00.000Z"
    },
    "others": [
      {
        "qualified_id": {"id": "7025598b-ffac-4993-8a81-af3f35b7147f", "domain": "wire.com"},
        "id": "7025598b-ffac-4993-8a81-af3f35b7147f",
        "conversation_role": "wire_member",
        "status": 0
      },
      {
        "qualified_id": {"id": "2441243e-6d3e-4ebc-9f04-f3236e9b5862", "domain": "other.example"},
        "id": "2441243e-6d3e-4ebc-9f04-f3236e9b5862",
        "conversation_role": "wire_admin",
        "status": 0
      }
    ]
  }
}
```

### 2.5 Full example — 1:1 conversation (`type: 2`)

```json
{
  "qualified_id": {"id": "45c8f986-6c8f-465b-9ac9-bd5405e8c944", "domain": "wire.com"},
  "id": "45c8f986-6c8f-465b-9ac9-bd5405e8c944",
  "type": 2,
  "creator": "d5a39ffb-6ce3-4cc8-9048-0e15d031b4c5",
  "name": null,
  "access": ["private"],
  "access_role": [],
  "cells_state": "disabled",
  "message_timer": null,
  "receipt_mode": null,
  "last_event": "0.0",
  "last_event_time": "1970-01-01T00:00:00.000Z",
  "protocol": "proteus",
  "members": {
    "self": {
      "qualified_id": {"id": "d5a39ffb-6ce3-4cc8-9048-0e15d031b4c5", "domain": "wire.com"},
      "conversation_role": "wire_admin",
      "hidden": false, "hidden_ref": null,
      "otr_archived": false, "otr_archived_ref": null,
      "otr_muted_status": null, "otr_muted_ref": null,
      "service": null, "status": 0, "status_ref": "0.0",
      "status_time": "1970-01-01T00:00:00.000Z"
    },
    "others": [
      {"qualified_id": {"id": "7025598b-ffac-4993-8a81-af3f35b7147f", "domain": "wire.com"},
       "conversation_role": "wire_admin", "status": 0}
    ]
  }
}
```
`access_role: []` and `access: ["private"]` are forced by the server for
`type` 1/2/3 (`Conversation.hs:667-672`).

### 2.6 Full example — MLS group, freshly created (epoch 0)

```json
{
  "qualified_id": {"id": "b2a35ba2-4f4d-4f65-a3ee-c0c1f2ec3fef", "domain": "wire.com"},
  "type": 0,
  "creator": "d5a39ffb-6ce3-4cc8-9048-0e15d031b4c5",
  "name": "MLS team room",
  "team": "537992e5-3782-4b6c-8718-a5db2cc786ee",
  "access": ["invite"],
  "access_role": ["team_member", "non_team_member", "service"],
  "cells_state": "disabled",
  "receipt_mode": 0,
  "protocol": "mls",
  "group_id": "AAEAAbKjW6JPTU9lo+7AwfLsP+8AAAAAAAAAAHdpcmUuY29t",
  "epoch": 0,
  "members": {
    "self": { "...": "creator, conversation_role wire_admin" },
    "others": []
  }
}
```
After the creator's first commit is accepted the very same conversation reads
`"epoch": 3, "epoch_timestamp": "2026-06-15T09:00:00.000Z", "cipher_suite": 1`
and `members.others` fills up. See §5.3.

### 2.7 `Conversation` vs `OwnConversation` — the `id` field

The backend has two shapes:

* `OwnConversation` — "the requestor is a member". Emits the deprecated flat
  `id` alongside `qualified_id`, and `members.self` is **required**
  (`Conversation.hs:278-331`; swagger `OwnConversation_...` has an `id` property,
  `OwnConvMembers` requires `self`).
* `Conversation` — "a conversation the requestor may or may not be a member of".
  **No `id` property**, and `members.self` is optional
  (`Conversation.hs:356-379`; swagger `Conversation_...` and `ConvMembers`).

Which one you get:

| Endpoint | Shape |
| --- | --- |
| `POST /conversations/list` → `found[]` | `OwnConversation` (has `id`) |
| `GET /conversations/:domain/:id` (v10+) | `Conversation` (**no `id`**, `self` may be missing) |
| `GET /conversations/:domain/:id` (v6..v9) | `OwnConversation` |
| `GET /conversations/mls-self` | `OwnConversation` |
| `POST /conversations` (v10+) | `CreateGroupConversation` = `Conversation` + `failed_to_add` |

**Always key off `qualified_id`**, never off `id`.

---

## 3. Members

### 3.1 `members.self` — your own membership

TS: `Member` in `wire-webapp/libraries/api-client/src/conversation/member.ts:24-46`.
Haskell: `wire-server/libs/wire-api/src/Wire/API/Conversation/Member.hs:104-160`.

| Field | Type | Notes |
| --- | --- | --- |
| `qualified_id` | `{id, domain}` | **required** (`Member.hs:137`) |
| `id` | uuid | deprecated duplicate (`Member.hs:138-139`) |
| `conversation_role` | string | defaults to `wire_admin` when absent (`Member.hs:157`) |
| `hidden` | bool | client-defined "hidden" flag; defaults `false` (`Member.hs:155`) |
| `hidden_ref` | string \| `null` | reference point for (un)hiding |
| `otr_archived` | bool | archived flag; defaults `false` (`Member.hs:153`) |
| `otr_archived_ref` | ISO-8601 \| `null` | timestamp the archive state refers to |
| `otr_muted_status` | int32 \| `null` | mute bitfield, see §3.3 |
| `otr_muted_ref` | ISO-8601 \| `null` | timestamp the mute state refers to |
| `service` | `{id, provider}` \| `null` | set when the member is a bot (`serviceRef.ts:20-23`) |
| `status` | int | **dead constant, always `0`** (`Member.hs:142`) |
| `status_ref` | string | **dead constant, always `"0.0"`** (`Member.hs:143`) |
| `status_time` | string | **dead constant, always `"1970-01-01T00:00:00.000Z"`** (`Member.hs:144-149`) |

The `_ref` fields exist so multiple devices can agree which mute/archive command
is newest: a client only applies an incoming `otr_muted_status` if its
`otr_muted_ref` is newer than the locally stored one. The webapp writes the
current time into them (`conversationService.ts:273-305`).

`hidden`, `hidden_ref`, `status*` are legacy — a new client can read and ignore
them.

### 3.2 `members.others` — everybody else

TS: `OtherMember` in `otherMember.ts:26-41`. Haskell: `Member.hs:169-188`.

```json
{
  "qualified_id": {"id": "<uuid>", "domain": "wire.com"},
  "id": "<uuid>",
  "conversation_role": "wire_member",
  "service": {"id": "<uuid>", "provider": "<uuid>"},
  "status": 0
}
```
Only `qualified_id` is required. `conversation_role` defaults to `wire_admin`
when absent (`Member.hs:185`). `status` is deprecated and always `0`
(`Member.hs:186`; TS `SERVICE_MEMBER_STATUS.REGULAR_MEMBER = 0`,
`otherMember.ts:39-41`). `service` is present only for bots.

`others` never contains yourself; `self` never appears in `others`.

Container type (`conversationMembers.ts:22-25`):
```ts
interface ConversationMembers { others: OtherMember[]; self?: Member; }
```

### 3.3 `otr_muted_status` — the mute bitfield

`wire-webapp/libraries/api-client/src/conversation/mutedStatus.ts:20-24`:

| Value | Binary | Name | Meaning |
| --- | --- | --- | --- |
| `0` | `00` | `ALL_NOTIFICATIONS` | not muted |
| `1` | `01` | `ONLY_MENTIONS` | notify only on mentions/replies |
| `3` | `11` | `NO_NOTIFICATIONS` | fully muted |

Bit 0 = "notify me at all", bit 1 = "this is a deliberate mute setting (not a
legacy boolean)". Value `2` is not used. The **backend never interprets this
number** — "The semantics of the possible different values is entirely up to
clients" (`Member.hs:162-164`).

### 3.4 Roles

`wire-server/libs/wire-api/src/Wire/API/Conversation/Role.hs`.

* Role name rules (`Role.hs:263-273`): 2..128 chars, only `[a-z0-9_]`.
  The prefix `wire_` is reserved for Wire-defined roles (`Role.hs:224-240`).
* Built-in roles (`Role.hs:252-256`, TS `conversationRole.ts:20-23`):
  * `wire_admin` — **all** actions
  * `wire_member` — only `leave_conversation` (`Role.hs:167-173`)
* Custom roles are any other valid name plus an explicit action set
  (`Role.hs:188-192`).

Action names (`Role.hs:114-124`):
`add_conversation_member`, `remove_conversation_member`,
`modify_conversation_name`, `modify_conversation_message_timer`,
`modify_conversation_receipt_mode`, `modify_conversation_access`,
`modify_other_conversation_member`, `leave_conversation`,
`delete_conversation`, `modify_add_permissions`.

#### `GET /conversations/:id/roles`

**The path is unqualified** — there is no `:domain` segment, contrary to what
one might expect. Route: `Conversation.hs:201-211`
(`"conversations" :> Capture "cnv" ConvId :> "roles"`); swagger v16 lists exactly
`/conversations/{cnv}/roles`. Client: `conversationApi.ts:336-341` builds
`` `/${CONVERSATIONS}/${conversationId}/${ROLES}` ``.

```json
{
  "conversation_roles": [
    {"conversation_role": "wire_admin",
     "actions": ["add_conversation_member", "remove_conversation_member",
                 "modify_conversation_name", "modify_conversation_message_timer",
                 "modify_conversation_receipt_mode", "modify_conversation_access",
                 "modify_other_conversation_member", "leave_conversation",
                 "delete_conversation", "modify_add_permissions"]},
    {"conversation_role": "wire_member", "actions": ["leave_conversation"]}
  ]
}
```
(`Role.hs:203-219`; TS `ConversationRolesList`, `conversationRole.ts:36-38`.)
Errors: `404 no-conversation`, `403 access-denied`.

There is also `GET /teams/:tid/conversations/roles` for team-wide role
definitions.

---

## 4. Creating conversations

### 4.1 `POST /conversations` — group / channel

Route: `Conversation.hs:534-565` (`create-group-conversation`, `From 'V16`; the
same path for every earlier version, only the response type changed).
Client: `conversationApi.ts:521-542`.

**Request body** (`NewConv`, `Conversation.hs:904-1024`; TS `NewConversation`,
`wire-webapp/libraries/api-client/src/conversation/newConversation.ts:27-43`):

| Field | Type | Default / notes |
| --- | --- | --- |
| `qualified_users` | `{id,domain}[]` | users to add, **excluding yourself**; `[]` if absent |
| `users` | `uuid[]` | deprecated unqualified form |
| `name` | string | 1..256 chars |
| `access` | `string[]` | empty/absent → `["invite"]` (`Wire/StoredConversation.hs:246-247`, used at `CreateInternal.hs:570-573`) |
| `access_role` | `string[]` (**v3+**) | absent → `["team_member","non_team_member","service"]` (`CreateInternal.hs:567-568`) |
| `access_role_v2` | `string[]` | **v2 only**, paired with the legacy string `access_role` (`Conversation.hs:211-225`) |
| `team` | `{teamid, managed}` | `managed` **must** be sent but "MUST NOT be used by clients" — always `false` (`Conversation.hs:1033-1051`; TS `TeamInfo`, `wire-webapp/libraries/api-client/src/team/team/teamInfo.ts:20-24`) |
| `message_timer` | int64 \| `null` | milliseconds |
| `receipt_mode` | int32 \| `null` | ignored for MLS, forced to `0` (`CreateInternal.hs:529-531`) |
| `conversation_role` | string | role applied to **all** users in `qualified_users`; defaults to `wire_admin` (`Conversation.hs:982-985`) |
| `protocol` | string | `"proteus"` (default) or `"mls"` (`Conversation.hs:986-989`) |
| `group_conv_type` | string | `"group_conversation"` (default), `"channel"`, `"meeting"` |
| `add_permission` | string | channels only; server default `"everyone"` (`Conversation.hs:1312-1313`, applied at `CreateInternal.hs:534`) |
| `cells` | bool | default `false`; `true` → `cells_state: "pending"` (`CreateInternal.hs:535-538`) |
| `skip_creator` | bool | team admins only: create the channel without joining it (`Conversation.hs:995-1001`) |
| `parent` | uuid | parent conversation; you must be a member of it (`CreateInternal.hs:505-508`) |
| `history` | object | history-sharing config |
| ~~`creator_client`~~ | — | **removed.** It existed between wire-server 2486 and the MLS draft-20 switch; the changelog states `POST /conversations` does not require `creator_client` anymore (`wire-server/CHANGELOG.md:3171`, added at `:4951`). It appears in no current schema and is not in the TS client. |

The webapp sends exactly (`wire-webapp/apps/webapp/src/script/repositories/conversation/ConversationRepository.ts:476-506`):
```json
{
  "conversation_role": "wire_member",
  "name": "Design team",
  "receipt_mode": null,
  "qualified_users": [{"id": "<uuid>", "domain": "wire.com"}],
  "users": [],
  "team": {"managed": false, "teamid": "<team-uuid>"},
  "access": ["invite", "code"],
  "access_role": ["team_member", "non_team_member", "guest", "service"]
}
```
It picks the field name `access_role` when the negotiated version is `>= 3`, and
`access_role_v2` otherwise (`ConversationRepository.ts:498`).

**Responses**
* `201 Created` — new conversation. `Location: <conversation-id>` header
  (`Conversation.hs:73`).
* `200 OK` — "Conversation existed" (`Conversation.hs:81-94`); can happen for
  deterministic-ID conversations. Treat 200 and 201 identically apart from not
  re-announcing creation.
* Body from v4 upward carries the partial-failure list:
  ```json
  { "...conversation fields...", "failed_to_add": [{"id": "<uuid>", "domain": "down.example"}] }
  ```
  (`Conversation.hs:412-419` / `:436-442`.) Users on unreachable backends are
  reported here rather than failing the whole call.

**Errors** (`Conversation.hs:539-550`): `403 access-denied`, `400 non-empty-member-list`
(MLS with non-empty user list), `400 mls-not-enabled`, `403 not-connected`,
`403 no-team-member`, `403 operation-denied`, `403 missing-legalhold-consent`,
`403 channels-not-enabled`, plus federation failures:
* `409` with `{"non_federating_backends": [...]}` — two users' backends do not federate
* `533` with `{"unreachable_backends": [...]}` — a backend is down

(status codes and body keys: `wire-webapp/libraries/api-client/src/conversation/federatedBackendsError.ts:28-66`).
The webapp reacts to `533` by dropping the unreachable users and retrying the
create (`wire-webapp/libraries/core/src/messagingProtocols/proteus/proteusService/proteusService.ts:157-170`).

### 4.2 What differs for MLS

1. `protocol: "mls"` and **`qualified_users` / `users` must be empty** — otherwise
   `400 non-empty-member-list` (`CreateInternal.hs:509-513`; TS comment
   `newConversation.ts:38`, enforced client-side at
   `conversationService.ts:339-343` which sets both to `undefined`).
2. The response contains a server-generated **`group_id`** (base64) and
   **`epoch: 0`**, with **no `epoch_timestamp` and no `cipher_suite`** — those two
   only appear once `epoch > 0` (`Protocol.hs:150-174`; the group is created with
   `cnvmlsActiveData = Nothing`, `wire-server/libs/wire-subsystems/src/Wire/StoredConversation.hs:179-189`).
3. `receipt_mode` is forced to the default `0`, whatever you send
   (`CreateInternal.hs:529-531`).
4. `members.others` is `[]`. **`members.self` is present** — the creator *is*
   recorded as a local member with role `wire_admin` unless you passed
   `skip_creator: true` (`CreateInternal.hs:514-518`, `Role.hs:281-282`). The
   MLS group itself, however, is empty until you commit.
5. You must then create the MLS group locally with that `group_id`, add the
   intended members and send the commit bundle (`POST /mls/commit-bundles`).
   Only after the commit does the backend fill `members.others`, bump `epoch` and
   start returning `epoch_timestamp` / `cipher_suite`. Reference flow:
   `conversationService.ts:327-352` (create → check `group_id` → establish) and
   `:410-439` (register group → **re-`GET` the conversation** to see the members).

`group_id` is opaque base64 to the client, but it is structured: version word,
conversation type, qualified conversation-or-subconversation ID and a generation
counter (`wire-server/libs/wire-api/src/Wire/API/MLS/Group/Serialisation.hs:49-68`).
Do not parse it; store and echo it.

### 4.3 1:1 conversations

There are three distinct paths.

**(a) Proteus 1:1 — via connections, not via this API.**
`type: 2` conversations materialise when a connection request is accepted;
`type: 3` ("connect") is the pending state. The webapp never calls the 1:1
creation endpoint — there is no caller of `post1to1` anywhere in
`wire-webapp/apps` or `libraries/core`. For a 1:1 with a user you are connected
to, just find the existing conversation in the list.

**(b) Explicit 1:1 creation** (used by team-internal flows):

| Version | Path |
| --- | --- |
| `< v7` | `POST /conversations/one2one` |
| `>= v7` | `POST /one2one-conversations` |

(`Conversation.hs:744-827`; client switch at `conversationApi.ts:425-436`.)
Body is `NewOne2OneConv` (`Conversation.hs:1053-1100`) — a strict subset of
`NewConv`: `qualified_users` (or deprecated `users`), `name`, `team`. No
`access`, no `protocol`, no `receipt_mode`. Returns 200 "existed" / 201 "created"
with the same `Location` header. Errors add `403 invalid-op`,
`404 no-team`, `403 not-connected`.

**(c) MLS 1:1** — `GET` the conversation, it is conjured on demand.

| Version | Path |
| --- | --- |
| `v5` | `GET /conversations/one2one/:domain/:userid` → bare `Conversation` |
| `v6` | `GET /conversations/one2one/:domain/:userid` → `{conversation, public_keys}` |
| `>= v7` | `GET /one2one-conversations/:domain/:userid?format=raw\|jwk` → `{conversation, public_keys}` |

(`Conversation.hs:828-879`; client at `conversationApi.ts:442-453`.)
Note the **user** ID in the path, not a conversation ID.

Response for v6+:
```json
{
  "conversation": { "...OwnConversation, protocol \"mls\", group_id, epoch 0..." },
  "public_keys": {"removal": {"ed25519": "<base64>", "ecdsa_secp256r1_sha256": "<base64>"}}
}
```
`public_keys.removal` is keyed by signature scheme
(`wire-webapp/libraries/api-client/src/client/clientApi.ts:40-51`); `?format`
selects `raw` (default) or `jwk` encoding
(`wire-server/libs/wire-api/src/Wire/API/MLS/Keys.hs:105-118`).
The v5 response has no `public_keys` at all — the TS client sniffs for it with
`isMLS1to1Conversation()` (`conversation.ts:137-143`) and wraps the bare form.

The conversation object is **created on the fly and not persisted** — "The
conversation will only be stored in the database when its first commit arrives"
(`wire-server/libs/wire-subsystems/src/Wire/ConversationSubsystem/Query.hs:764-771`).
Its ID is deterministic on both backends: SHA-256 over
`namespace ‖ uuid(a) ‖ domain(a) ‖ uuid(b) ‖ domain(b)` with the pair sorted by
`(domain, uuid)`, truncated to 128 bits and stamped as a UUIDv5; the owning
domain is `A` if bit 128 of the hash is 0, else `B`
(`wire-server/libs/galley-types/src/Galley/Types/Conversations/One2One.hs:54-119`).
Namespace UUIDs (`One2One.hs:43-45`):
* Proteus `9a51edb8-060c-0d9a-0c29-50a85d152982`
* MLS `95589dd5-b045-40dc-a6aa-dd9c4fad1c2f`

Client establishment logic: if `epoch > 0` the group already exists — join by
external commit; otherwise wipe any local state and register the group with the
other user (`conversationService.ts:987-1048`).

**(d) Self conversation** — `POST /conversations/self` creates the personal
notes conversation (`type: 1`), 200 if it already existed
(`Conversation.hs:595-603`; client `conversationApi.ts:743-751`).

---

## 5. Membership changes

### 5.1 Add members — `POST /conversations/:domain/:id/members`

Route: `Conversation.hs:931-954` (`From 'V2`). Client: `conversationApi.ts:861-889`.

```json
{"qualified_users": [{"id": "<uuid>", "domain": "wire.com"}],
 "conversation_role": "wire_member"}
```
`qualified_users` is required and **must be non-empty**; `conversation_role`
defaults to `wire_admin` if omitted (`Conversation.hs:1123-1137`). The webapp
always sends `wire_member` explicitly (`conversationApi.ts:864`).

Older shapes (both `Until 'V2`):
* `POST /conversations/:id/members/v2` — same body, unqualified conversation ID
  (`Conversation.hs:906-930`); the client falls back to it below v2
  (`conversationApi.ts:869-871`).
* `POST /conversations/:id/members` with `{"users": ["<uuid>"], "conversation_role": "..."}`
  (`Invite`, `Conversation.hs:1105-1121`; TS `Invite`, `invite.ts:20-22`,
  used by `postAddMembers`, `conversationApi.ts:461-480`).

**Responses**: `200` "Conversation unchanged" (nobody was actually added) or
`200`/`201` with a `conversation.member-join` event
(`ConvUpdateResponses`, `Conversation.hs:105`). Event data
(`conversationMemberJoinData.ts:22-25`):
```json
{"user_ids": ["<uuid>"], "users": [{"qualified_id": {...}, "conversation_role": "wire_member", "status": 0}]}
```

**Errors**: `403 action-denied` (missing `add_conversation_member`),
`404 no-conversation`, `403 invalid-op`, `403 too-many-members`,
`403 access-denied`, `403 no-team-member`, `403 not-connected`,
`403 missing-legalhold-consent`, plus `409`/`533` federation failures
(`Conversation.hs:935-946`).

### 5.2 Replace members — `PUT /conversations/:domain/:id/members`

Route: `Conversation.hs:990-1021` (`From 'V17`; `From 'V13` variant at `:958-989`).
Same `InviteQualified` body. Semantics per the server's own description:

> "This will add any members not already in the conversation, and remove any
> members not in the provided list except users that are associated via a user
> group. The given role in the request body will be applied to all added
> members. The roles of already existing members will not be changed even if
> these members are included in the request body and their role differs from the
> role provided in this request."

Returns `200` with an **empty body**. Client: `conversationApi.ts:896-907`.
Adds `AdminlessConversation` to the possible errors from v17.

### 5.3 Remove a member — `DELETE /conversations/:domain/:id/members/:domain/:userid`

Route: `Conversation.hs:1233-1248`. Client: `conversationApi.ts:122-130`.

Both the conversation and the user are qualified. Responses
(`RemoveFromConversationVerb`, `Conversation.hs:109-116`):
* `204 No Content` — no change (the user was not a member)
* `200` — a `conversation.member-leave` event:
  ```json
  {
    "conversation": "<uuid>",
    "qualified_conversation": {"id": "<uuid>", "domain": "wire.com"},
    "from": "<uuid>",
    "qualified_from": {"id": "<uuid>", "domain": "wire.com"},
    "time": "2026-06-15T09:00:00.000Z",
    "type": "conversation.member-leave",
    "data": {
      "qualified_user_ids": [{"id": "<uuid>", "domain": "wire.com"}],
      "user_ids": ["<uuid>"],
      "reason": "user-deleted"
    }
  }
  ```
  `reason` is optional: `"legalhold-policy-conflict"` or `"user-deleted"`
  (`conversationMemberLeaveData.ts:22-35`). Envelope fields:
  `BaseConversationEvent`, `wire-webapp/libraries/api-client/src/event/conversationEvent.ts:115-124`.

**Errors**: `403 action-denied` (`remove_conversation_member`),
`404 no-conversation`, `403 invalid-op`, and from v16 `AdminlessConversation`.

Pre-v2 alias: `DELETE /conversations/:id/members/:userid` (`Conversation.hs:1199-1213`).

### 5.4 Leaving a conversation

**There is no dedicated "leave" endpoint.** You remove yourself with the same
`DELETE .../members/<your-domain>/<your-id>` call; the permission checked is
`leave_conversation`, which `wire_member` has (`Role.hs:169-172`). Reference:
`ConversationRepository.leaveConversation()` calls
`removeMembersFromConversation(conversation, [selfQualifiedId])`
(`wire-webapp/apps/webapp/src/script/repositories/conversation/ConversationRepository.ts:3041-3050`).

### 5.5 Change a member's role — `PUT /conversations/:domain/:id/members/:domain/:userid`

Route: `Conversation.hs:1275-1296`. Client: `conversationApi.ts:916-931`.

```json
{"conversation_role": "wire_admin"}
```
`conversation_role` is the **only** accepted field and is required — the parser
rejects an empty object with `"'conversation_role' is required"`
(`Member.hs:245-265`). Returns `200` with an empty body; members receive a
`conversation.member-update` event.

Below v7 the path is unqualified: `PUT /conversations/:id/members/:userid`
(`Conversation.hs:1251-1274`, marked deprecated; client switch at
`conversationApi.ts:924-928`).

**Errors**: `404 no-conversation`, `404 no-conversation-member`,
`403 action-denied` (`modify_other_conversation_member`), `403 invalid-op`.

### 5.6 Services (bots)

* Add: `POST /bot/conversations/:id` (v7+) or `POST /conversations/:id/bots`
  (older), body `{"provider": "<uuid>", "service": "<uuid>"}` → a
  `conversation.member-join` event (`conversationApi.ts:495-514`).
* Remove: `DELETE /bot/conversations/:id/:serviceid` (v7+) or
  `DELETE /conversations/:id/bots/:serviceid` (`conversationApi.ts:104-114`).

### 5.7 How MLS differs

For `protocol: "mls"` conversations the REST membership endpoints are **not** the
way membership changes:

* Membership is derived from the MLS group. You add users by claiming their key
  packages and sending an **Add** commit via `POST /mls/commit-bundles`; you
  remove users with a **Remove** commit
  (`conversationService.ts:504-530` for add, `:560-605` for remove).
* After a successful commit the client must **re-`GET` the conversation** to
  observe the new `members`, `epoch`, `epoch_timestamp` and `cipher_suite`
  (`conversationService.ts:432-438`, `:604`).
* `POST /conversations/:d/:id/members` on an MLS conversation is rejected —
  `400 non-empty-member-list` / `403 invalid-op` depending on the path taken.
* Other clients learn about the change through
  `conversation.mls-message-add` / `conversation.mls-welcome` events, not through
  `conversation.member-join`.
* Joining a group you were not welcomed into: fetch the public group state with
  `GET /conversations/:domain/:id/groupinfo` (returns raw MLS bytes, content type
  `message/mls`, `Conversation.hs:212-231`; client `conversationApi.ts:322-329`)
  and send an external commit.
* A broken group is recovered with `POST /mls/reset-conversation`, body
  `{"group_id": "<base64>", "epoch": <int>}` (`conversationApi.ts:1004-1012`;
  swagger `MLSReset`, both fields required). It emits
  `conversation.mls-reset` whose data is `{"group_id", "new_group_id"}`
  (`wire-webapp/libraries/api-client/src/conversation/data/conversationMlsResetData.ts`).

Leaving an MLS conversation still uses the plain
`DELETE .../members/<self>` call; the backend then removes your clients from the
group.

---

## 6. Conversation settings

All of these emit an event to the other members and answer with that event, or
with `200` and no change when the value was already what you sent
(`UpdateResponses`, `Conversation.hs:105`).

### 6.1 Name — `PUT /conversations/:domain/:id/name`

Route: `Conversation.hs:1340-1357`. Body `{"name": "New name"}` (1..256 chars,
`Conversation.hs:1168-1172`; TS `ConversationNameUpdateData`,
`data/conversationNameUpdateData.ts:20-22`). Emits `conversation.rename`.

Deprecated forms, both `Until 'V8`: `PUT /conversations/:id/name`
(`Conversation.hs:1319-1339`) and even `PUT /conversations/:id` with the same body
(`Conversation.hs:1299-1318`). The client picks the qualified path only when the
negotiated version is `>= 8` (`conversationApi.ts:803-807`).

Errors: `403 action-denied` (`modify_conversation_name`), `404 no-conversation`,
`403 invalid-op`.

### 6.2 Self membership (mute / archive) — `PUT /conversations/:domain/:id/self`

Route: `Conversation.hs:1577-1593`. Client: `conversationApi.ts:939-950`.

Accepted fields — **and only these** (`MemberUpdate`, `Member.hs:198-222`;
swagger `MemberUpdate_...`):

| Field | Type |
| --- | --- |
| `otr_muted_status` | int32 |
| `otr_muted_ref` | string |
| `otr_archived` | bool |
| `otr_archived_ref` | string |
| `hidden` | bool |
| `hidden_ref` | string |

**At least one must be present**, otherwise the request is rejected
(`validateMemberUpdate`, `Member.hs:229-241`). Note that `conversation_role`
appears in the TS `ConversationMemberUpdateData`
(`data/conversationMemberUpdateData.ts:24-40`) and in the error message string,
but the server schema does **not** accept it here — use §5.5 instead. The extra
TS fields `target` / `qualified_target` are event-only.

Mute:
```json
{"otr_muted_status": 3, "otr_muted_ref": "2026-06-15T09:00:00.000Z"}
```
Archive:
```json
{"otr_archived": true, "otr_archived_ref": "2026-06-15T09:00:00.000Z"}
```
(exactly what the webapp sends: `conversationService.ts:273-305`).

Returns `200` with an empty body; your **other devices** get a
`conversation.member-update` event. Error: `404 no-conversation`.

`GET /conversations/:domain/:id/self` returns your `Member` object or `null` when
you are not a member (`Conversation.hs:1567-1576`; client
`conversationApi.ts:410-418`). The unqualified variants of both are deprecated
`Until 'V8` (`Conversation.hs:1536-1566`) with the note "Use
`/conversations/:domain/:conv` instead and get the self member from
`response.members.self`."

### 6.3 Message timer — `PUT /conversations/:domain/:id/message-timer`

Route: `Conversation.hs:1382-1400`. Body
`{"message_timer": 86400000}` or `{"message_timer": null}` to switch it off
(int64 milliseconds, nullable — `Conversation.hs:1226-1228`; TS
`data/conversationMessageTimerUpdateData.ts:20-22`). Emits
`conversation.message-timer-update`. Unqualified path deprecated `Until 'V8`
(`Conversation.hs:1360-1381`); client switches at version 8
(`conversationApi.ts:826-830`).

Errors: `403 action-denied` (`modify_conversation_message_timer`),
`403 access-denied`, `404 no-conversation`, `403 invalid-op`.

### 6.4 Receipt mode — `PUT /conversations/:domain/:id/receipt-mode`

Route: `Conversation.hs:1426-1445`. Body `{"receipt_mode": 1}`
(`Conversation.hs:1206-1208`; TS `RECEIPT_MODE.OFF = 0`, `RECEIPT_MODE.ON = 1`,
`data/conversationReceiptModeUpdateData.ts:24-31`). Emits
`conversation.receipt-mode-update`. The client always uses the qualified path
(`conversationApi.ts:849`).

Errors: as above plus `MLSReadReceiptsNotAllowed`.

### 6.5 Access — `PUT /conversations/:domain/:id/access`

Route: `Conversation.hs:1494-1515` (`From 'V3`). Body:

```json
{"access": ["invite", "code"],
 "access_role": ["team_member", "non_team_member", "guest", "service"]}
```
Both keys are required (swagger `ConversationAccessData`). On **v2** the shape is
`{"access": [...], "access_role": "activated", "access_role_v2": [...]}`
(`Conversation.hs:1472-1493`; TS union `ConversationAccessV2UpdateData` /
`ConversationAccessV3UpdateData`, `data/conversationAccessUpdateData.ts:23-36`).

Emits `conversation.access-update`, and additionally
`conversation.member-leave` for any member who no longer qualifies (e.g.
removing `guest` kicks the guests).

Errors: `403 action-denied` (`modify_conversation_access` or
`remove_conversation_member`), `403 access-denied`, `404 no-conversation`,
`403 invalid-op`, `403 invalid-op` for `InvalidTargetAccess`.

### 6.6 Channel add-permission — `PUT /conversations/:domain/:id/add-permission`

Route: `Conversation.hs:1615-1640`. Body `{"add_permission": "admins"}` or
`"everyone"` (`Conversation.hs:1335-1347`; TS
`data/conversationAddPermissionUpdateData.ts:22-24`). Emits
`conversation.add-permission-update`. Client: `conversationApi.ts:958-972`.

### 6.7 Protocol migration — `PUT /conversations/:domain/:id/protocol`

Route: `Conversation.hs:1594-1614` (`From 'V5`). Body `{"protocol": "mixed"}` or
`{"protocol": "mls"}`. `proteus → mixed` assigns a `group_id`;
`mixed → mls` finalises the migration. **`204 No Content` means the protocol was
already that value** — the client maps it to `null`
(`conversationApi.ts:984-1002`). Emits `conversation.protocol-update`.

### 6.8 History — `PUT /conversations/:domain/:id/history`

Route: `Conversation.hs:1516-1535`. Body `{"history": {...}}`. Newer feature; not
exposed by the TS client. **UNVERIFIED** in detail.

### 6.9 Typing — `POST /conversations/:domain/:id/typing`

Body `{"status": "started"}` / `{"status": "stopped"}`
(`data/conversationTypingData.ts:20-27`), `200` empty. Qualified path from v3
(`conversationApi.ts:759-769`).

### 6.10 Guest links

All four guest-link endpoints use the **unqualified** conversation ID.

**Create / recreate — `POST /conversations/:id/code`**
(`Conversation.hs:1103-1120`, `From 'V4`; client `conversationApi.ts:549-565`)

Body (v4+): `{}` or `{"password": "<8..1024 chars>"}`
(`CreateConversationCodeRequest`, `wire-server/libs/wire-api/src/Wire/API/Conversation/Code.hs:49-64`).
Before v4 there is no body at all (`Conversation.hs:1084-1100`).

* `200` — the code already existed; body is a `ConversationCodeInfo`
* `201` — created; body is a `conversation.code-update` event whose `data` is the
  same `ConversationCodeInfo`

```json
{
  "key":  "T-Wgpo3-e7XgOwsLqWY6",
  "code": "l9Kzo0-Kn2Zx0Egs5S3f",
  "uri":  "https://account.wire.com/conversation-join/?key=T-Wgpo3-e7XgOwsLqWY6&code=l9Kzo0-Kn2Zx0Egs5S3f",
  "has_password": false
}
```
(`Code.hs:110-133`; TS `ConversationCode`, `conversationCode.ts:20-30`. The
server builds `uri` by appending `key`/`code` as query params to a configured
prefix, `Code.hs:128-133`.)

**Read — `GET /conversations/:id/code`** (`Conversation.hs:1151-1169`) — same
`ConversationCodeInfo`; `404 no-conversation-code` if none exists.

**Revoke — `DELETE /conversations/:id/code`** (`Conversation.hs:1135-1150`) —
`200` with a `conversation.code-delete` event whose `data` is `null`
(`conversationEvent.ts:136-139`).

**Validate — `POST /conversations/code-check`**, body `{"key", "code"}`,
`200` empty on success, `404 no-conversation-code` otherwise
(`Conversation.hs:1063-1081`; client `conversationApi.ts:572-590`). Requires an
`X-Forwarded-For` header on the server side.

**Preview — `GET /conversations/join?key=…&code=…`** (`Conversation.hs:391-406`;
client `conversationApi.ts:626-647`). Returns a `ConversationCoverView`:
```json
{"id": "<uuid>", "name": "Design team", "has_password": true}
```
(`Conversation.hs:444-464`; TS `ConversationJoinData`, `data/conversationJoinData.ts:20-24`.)

**Join — `POST /conversations/join`** (`Conversation.hs:1042-1062`; client
`conversationApi.ts:597-619`):
```json
{"key": "T-Wgpo3-e7XgOwsLqWY6", "code": "l9Kzo0-Kn2Zx0Egs5S3f", "password": "hunter22"}
```
`password` is optional, 8..1024 chars (`Code.hs:66-80`; TS
`JoinConversationByCodePayload`, `conversationCode.ts:34-42`).
`200` "unchanged" or `200`/`201` with a `conversation.member-join` event.
Errors: `404 no-conversation-code`, `403 invalid-conversation-password`,
`409 guest-links-disabled`, `403 too-many-members`, `403 access-denied`,
`403 no-team-member`.

Note the deliberate inconsistency the server documents itself: when guest links
are disabled, `POST /conversations/join` answers `409 guest-links-disabled` while
`POST /conversations/code-check` answers `404 no-conversation-code`
(`Conversation.hs:1045-1047`, `:1066-1068`).

**Join by ID (link access)** — `POST /conversations/:id` (`Conversation.hs:1024-1039`,
deprecated `Until 'V5`; client `conversationApi.ts:654-662`). Works when
`access` contains `"link"`.

**Per-conversation feature flag** — `GET /conversations/:id/features/conversationGuestLinks`
returns `{"status": "enabled" | "disabled", ...}`
(`Conversation.hs:1121-1132`; client `conversationApi.ts:151-159`, marked
deprecated in favour of the team feature list).

---

## 7. Fetching a single conversation

`GET /conversations/:domain/:id` — `Conversation.hs:190-200` (`From 'V16`),
`:178-189` (v10..v15), `:166-177` (v6..v9). Client: `conversationApi.ts:161-169`,
which falls back to the unqualified `/conversations/:id` only when `domain` is
empty (`conversationApi.ts:71-75`).

Response `200`: a `Conversation` object as in §2. From v10 it is the
**`Conversation`** variant — no top-level `id`, and `members.self` is absent when
you are not a member (§2.7).

Errors, verbatim from swagger v16:

```json
{"code": 404, "label": "no-conversation", "message": "Conversation not found"}
```
```json
{"code": 403, "label": "access-denied", "message": "Conversation access denied"}
```

Definitions: `wire-server/libs/wire-api/src/Wire/API/Error/Galley.hs:249` and
`:251`.

---

## 8. Error labels

`wire-server/libs/wire-api/src/Wire/API/Error/Galley.hs`. Every body is
`{"code", "label", "message"}`.

| HTTP | `label` | Meaning | Line |
| --- | --- | --- | --- |
| 404 | `no-conversation` | conversation not found | `:249` |
| 403 | `access-denied` | conversation access denied | `:251` |
| 404 | `no-conversation-member` | member not found in conversation | `:320` |
| 403 | `invalid-op` | invalid operation / invalid target / invalid target access | `:245,247,219` |
| 403 | `too-many-members` | conversation member limit reached | `:318` |
| 403 | `not-connected` | users are not connected | `:243` |
| 403 | `no-team-member` | requester is not a team member | `:229` |
| 403 | `missing-legalhold-consent` | someone is under legal hold without consent | `:356` |
| 403 | `missing-legalhold-consent-old-clients` | as above, old clients | `:358` |
| 403 | `channels-not-enabled` | channels feature off for this team | `:380` |
| 404 | `no-conversation-code` | guest-link code not found | `:324` |
| 403 | `invalid-conversation-password` | wrong guest-link password | `:326` |
| 409 | `guest-links-disabled` | guest links revoked for the team | `:322` |
| 409 | `create-conv-code-conflict` | code exists with a different password setting | `:328` |
| 400 | `non-empty-member-list` | tried to add members while creating an MLS conversation | `:266` |
| 400 | `mls-not-enabled` | MLS not configured on this backend | `:260` |
| 409 | `mls-stale-message` | epoch in the message is too old | `:282` |
| 400 | `mls-group-conversation-mismatch` | group ID does not resolve to the given conversation | `:288` |
| 403 | `invalid-protocol-transition` | illegal `proteus`/`mixed`/`mls` transition | `:253` |
| 403 | `action-denied` | role lacks the required action (message names it) | see `MapError ('ActionDenied a)` |
| 409 | *(body `{"non_federating_backends": [...]}`)* | the two users' backends do not federate | `federatedBackendsError.ts:29` |
| 533 | *(body `{"unreachable_backends": [...]}`)* | a remote backend is unreachable | `federatedBackendsError.ts:30` |

The TS client maps a few of these to typed errors in
`wire-webapp/libraries/api-client/src/conversation/conversationError.ts`:
`ConversationCodeNotFoundError` (`no-conversation-code`, `:67-77`),
`ConversationFullError` (`too-many-members`, `:79-89`),
`ConversationLegalholdMissingConsentError` (`:55-65`),
`MLSStaleMessageError` (`:115-125`),
`MLSGroupOutOfSyncError` (carries `missing_users`, `:127-141`).

---

## 9. MLS self conversation and subconversations

### 9.1 `GET /conversations/mls-self`

Route: `Conversation.hs:641-657` (`From 'V16`; identical from `From 'V5`).
Client: `conversationApi.ts:171-179`.

Returns an `OwnConversation` with `type: 1` (SelfConv) and `protocol: "mls"`.
It is **created on demand** by the backend if it does not exist yet
(`wire-server/libs/wire-subsystems/src/Wire/ConversationSubsystem/Query.hs:741-762`).
Its conversation ID is deterministic: UUIDv5 of the user's UUID under the
namespace `3eac2a2c-3850-510b-bd08-8a98e80dd4d9`
(`Conversation.hs:1297-1305`). Members: just you, role `wire_admin`.

Purpose: a private single-member MLS group used to carry client-to-own-clients
traffic (e.g. self-notes). Error: `400 mls-not-enabled`.

There is no `GET /conversations/self`; the *Proteus* self conversation is created
with `POST /conversations/self` (§4.3d) and then appears in the normal list.

### 9.2 Subconversations

**There is no listing endpoint.** Subconversations are addressed by a fixed,
known ID. The only value the client knows is `"conference"`
(`wire-webapp/libraries/api-client/src/conversation/subconversation.ts:22-24`),
used for conference calling.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/conversations/:d/:id/subconversations/:subconv` | fetch the subconversation |
| `DELETE` | `/conversations/:d/:id/subconversations/:subconv` | reset it; body `{"group_id", "epoch"}` |
| `DELETE` | `/conversations/:d/:id/subconversations/:subconv/self` | leave it |
| `GET` | `/conversations/:d/:id/subconversations/:subconv/groupinfo` | raw MLS group info (`message/mls`) |

(Routes `Conversation.hs:658-740`, all `From 'V5`; client
`conversationApi.ts:181-240`. The full swagger v16 path list confirms no
collection endpoint exists.)

`GET` response (`PublicSubConversation`, TS `Subconversation`,
`subconversation.ts:32-40`):
```json
{
  "parent_qualified_id": {"id": "<uuid>", "domain": "wire.com"},
  "subconv_id": "conference",
  "group_id": "<base64>",
  "epoch": 7,
  "epoch_timestamp": "2026-06-15T09:00:00.000Z",
  "cipher_suite": 1,
  "members": [{"user_id": "<uuid>", "domain": "wire.com", "client_id": "<hex>"}]
}
```
Required per swagger: `parent_qualified_id`, `subconv_id`, `group_id`, `epoch`,
`members`. `epoch_timestamp` and `cipher_suite` follow the same "only once
epoch > 0" rule as the parent conversation.

Errors: `404 no-conversation`, `403 access-denied`,
`mls-subconv-unsupported-convtype`, `409 mls-stale-message`, `400 mls-not-enabled`.

---

## 10. Recommended client flow after login

```
1.  GET  /api-version                        -> pick version N, prefix /vN
2.  POST /conversations/list-ids   {size:1000}
    repeat with {paging_state} while has_more == true
3.  POST /conversations/list       {qualified_ids: <=500 per call}
    -> found[]     : store
    -> not_found[] : delete locally
    -> failed[]    : keep, retry later
4.  (MLS-capable clients) GET /conversations/mls-self
5.  For every found conversation with protocol "mls"|"mixed" and epoch > 0
    that is not established locally: GET .../groupinfo -> external commit
6.  Connect the notification stream; from then on apply
    conversation.create / .rename / .member-join / .member-leave /
    .member-update / .access-update / .receipt-mode-update /
    .message-timer-update / .code-update / .code-delete / .delete /
    .protocol-update / .add-permission-update incrementally.
```

Event type strings: `wire-webapp/libraries/api-client/src/event/conversationEvent.ts:44-68`.

Notes:
* Never sort by `last_event_time` — it is the constant epoch (§2.1). Order by
  your own record of the newest message, or by the notification stream.
* `POST /conversations/list` is not a "get all" — you must go through `list-ids`
  first, because the ID list is the only paginated source and it is the only one
  that includes remote (federated) conversations.
* A conversation in `failed` is *not* deleted; retrying it later is the whole
  point of the separate bucket.

---

## 11. Things intentionally not covered here

* Message send/receive and the Proteus/MLS crypto (`POST /conversations/:d/:id/proteus/messages`,
  `POST /mls/messages`, `POST /mls/commit-bundles`) — separate document.
* The notification stream (`GET /notifications`, WebSocket) — separate document.
* Team-scoped conversation admin (`GET /teams/:tid/conversations`,
  `DELETE /teams/:tid/conversations/:cid`).
* `cells_state` beyond the enum: what Wire Cells does with a conversation is
  outside the conversation API. **UNVERIFIED** in detail.
* `history` / `parent` semantics — recent additions, only the field shapes are
  documented above. **UNVERIFIED** in detail.
