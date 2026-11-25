# Wire protocol, part 4: Users, self profile, connections, teams, search

Everything here is plain JSON over HTTPS against the Wire backend (`nginz` → `brig` for
users/connections/search, `galley` for teams/features, `cargohold` for assets).
All calls need the bearer access token from part 1 (`Authorization: Bearer <token>`).

**Sources.** Citations are repo-relative:
`wire-webapp/…` = the official web client monorepo (`libraries/api-client/src` is the
TypeScript REST client, authoritative for paths and wire types; `apps/webapp/src/script`
is the app logic), `wire-server/…` = the Haskell backend (`libs/wire-api` has the JSON
schemas, which are the actual definition of the wire format).

## 0. Conventions that apply to every endpoint in this document

### 0.1 API version prefix

Every path below is written *without* the version prefix. The real request path is
`/v{N}{path}` where `N` is the negotiated API version, except for `N == 0` where the
prefix is empty:

```ts
// wire-webapp/libraries/api-client/src/http/httpClient.ts:179-180
public useVersion(version: number): void {
  this.versionPrefix = version > 0 ? `/v${version}` : '';
}
```

Version gates in this document are quoted from the Haskell route table, which annotates
routes with `From 'Vn'` / `Until 'Vn'` (`Until 'V4` means "served for versions < 4").
Anything documented without a gate exists in all currently supported versions.
Pick the highest version your backend advertises; the modern (qualified/federated)
shapes below all require **V4 or newer**, and the MLS pieces require **V5 or newer**.

### 0.2 Qualified IDs

Since federation, every user, conversation and asset is identified by a *qualified* ID:

```ts
// wire-webapp/libraries/api-client/src/user/qualifiedId.ts:20-23
export interface QualifiedId {
  domain: string;
  id: string;      // UUID v4
}
```

Backends still emit the bare `id` alongside `qualified_id` for backwards compatibility,
marked `deprecatedSchema "qualified_id"` on the server
(`wire-server/libs/wire-api/src/Wire/API/User.hs:564-566`). **A new client must key off
`qualified_id`**, because two users on different backends can never be distinguished by
the bare UUID.

Handles are qualified the same way:

```ts
// wire-webapp/libraries/api-client/src/user/qualifiedHandle.ts:20-23
export interface QualifiedHandle {
  domain: string;
  handle: string;
}
```

---

## 1. Self profile

### 1.1 `GET /self`

`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:449-456` — returns
`SelfProfile`, which is serialised exactly as the internal `User` record
(`wire-server/libs/wire-api/src/Wire/API/User.hs:621-636`: `toJSON (SelfProfile u) = toJSON u`).

Client side: `wire-webapp/libraries/api-client/src/self/selfApi.ts:115-126`
(`url: '/self'`, method `get`).

The TypeScript type is `User` plus three self-only fields:

```ts
// wire-webapp/libraries/api-client/src/self/self.ts:24-32
export interface Self extends User {
  locale: string;
  /** What is the source of truth for this user; if it's SCIM
   *  then the profile can't be edited via normal means. */
  managed_by?: ManagedSource;
  sso_id?: SSOSignature;
}
```

The authoritative field list is the server object schema
(`wire-server/libs/wire-api/src/Wire/API/User.hs:698-728`):

| Field | Type | Notes |
|---|---|---|
| `qualified_id` | `{domain, id}` | always present |
| `id` | UUID string | deprecated duplicate of `qualified_id.id` |
| `type` | `"regular"` \| `"app"` \| `"bot"` | `wire-webapp/libraries/api-client/src/user/user.ts:30-34` |
| `email` | string | only if an email identity is set/verified |
| `email_unvalidated` | string | pending email change |
| `sso_id` | `{tenant, subject}` or `{scim_external_id}` | see §1.4 |
| `name` | string | display name, required, non-unique |
| `text_status` | string | short free-text status line |
| `picture` | `Picture[]` | **legacy**, see §8.3; defaults to `[]` |
| `assets` | `Asset[]` | profile pictures, see §8; defaults to `[]` |
| `accent_id` | int | see §1.3 |
| `status` | `"active"` \| `"suspended"` \| `"deleted"` \| `"ephemeral"` | `AccountStatus`; **only on `/self`** |
| `locale` | string, e.g. `"en"`, `"gl-PA"` | language[-country] |
| `service` | `{id, provider}` | set iff this "user" is a bot/service |
| `handle` | string | unique username, lower-case, `a-z0-9_.-` |
| `expires_at` | ISO-8601 UTC ms | set iff the user is an ephemeral guest |
| `team` | UUID string | team ID, absent for personal accounts |
| `managed_by` | `"wire"` \| `"scim"` | defaults to `"wire"` if absent |
| `supported_protocols` | `["proteus"]` \| `["mls"]` \| `["proteus","mls"]` | defaults to `["proteus"]`, see §6 |
| `deleted` | `true` | **only emitted when true**, never `false` |
| `searchable` | bool | defaults to `true` |

`managed_by` values: `wire-server/libs/wire-api/src/Wire/API/User/Profile.hs:239-240`
(`"wire"`, `"scim"`) — mirrored as
`wire-webapp/libraries/api-client/src/user/managedSource.ts:20-23`.
If `managed_by == "scim"`, `PUT /self` and `PUT /self/handle` will be rejected
(`name-managed-by-scim`, `wire-server/libs/wire-api/src/Wire/API/User.hs:1503-1511`).

### 1.2 Real `GET /self` response

Copied from the backend's own golden serialisation test
`wire-server/libs/wire-api/test/golden/testObject_SelfProfile_user_1.json`
(the escapes in `name` are the test's random unicode; here replaced by an ordinary name):

```json
{
    "accent_id": 1,
    "assets": [],
    "email": "some@example",
    "expires_at": "1864-05-07T21:09:29.342Z",
    "handle": "do9-5",
    "id": "00000001-0000-0000-0000-000000000002",
    "locale": "gl-PA",
    "managed_by": "scim",
    "name": "Jane Roe",
    "picture": [],
    "qualified_id": {
        "domain": "n0-994.m-226.f91.vg9p-mj-j2",
        "id": "00000001-0000-0000-0000-000000000002"
    },
    "searchable": true,
    "service": {
        "id": "00000000-0000-0001-0000-000000000000",
        "provider": "00000000-0000-0001-0000-000000000001"
    },
    "status": "active",
    "supported_protocols": ["proteus"],
    "team": "00000001-0000-0002-0000-000000000002",
    "text_status": "text status",
    "type": "regular"
}
```

A realistic team account with a profile picture and MLS looks like:

```json
{
  "qualified_id": {"id": "d5a39ffb-6ce3-4cc8-9048-0e15d031b4c5", "domain": "wire.com"},
  "id": "d5a39ffb-6ce3-4cc8-9048-0e15d031b4c5",
  "type": "regular",
  "name": "John Doe",
  "handle": "johndoe",
  "email": "jd@wire.com",
  "locale": "en",
  "accent_id": 1,
  "assets": [
    {"key": "3-1-47de4580-ae51-4650-acbb-d10c028cb0ac", "size": "preview",  "type": "image", "domain": "wire.com"},
    {"key": "3-1-0d095659-68b7-477e-a7d2-7cecd876617f", "size": "complete", "type": "image", "domain": "wire.com"}
  ],
  "picture": [],
  "status": "active",
  "team": "537992e5-3782-4b6c-8718-a5db2cc786ee",
  "managed_by": "wire",
  "supported_protocols": ["proteus", "mls"],
  "searchable": true
}
```

### 1.3 `accent_id`

Small integer, client-side colour palette. Known IDs
(`wire-webapp/libraries/commons/src/util/AccentColor.ts:22-31`):
`1` strong blue, `2` strong lime green, `3` yellow (**deprecated**), `4` vivid red,
`5` bright orange, `6` soft pink, `7` violet. Server default is `0`
(`wire-server/libs/wire-api/src/Wire/API/User/Profile.hs:112-113`), which maps to no
colour — clients pick a fallback.

### 1.4 `sso_id`

Only present for SAML/SCIM-provisioned accounts. It is *one of two* shapes
(`wire-server/libs/wire-api/src/Wire/API/User/Identity.hs:201-204`):

```json
{"tenant": "<SAML issuer>", "subject": "<SAML NameID>"}
```
or
```json
{"scim_external_id": "someone@example.com"}
```

The web client only models the first (`wire-webapp/libraries/api-client/src/self/ssoSignature.ts:20-23`:
`{subject, tenant}`), so **a client must tolerate the `scim_external_id` variant**.

### 1.5 `PUT /self` and friends

`PUT /self` — `wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:485-493`,
200 empty body on success. Request body is `UserUpdate`, every field optional
(`wire-server/libs/wire-api/src/Wire/API/User.hs:1488-1501`):

```json
{"name": "John Doe", "accent_id": 5, "assets": [], "text_status": "on holiday", "picture": []}
```

The TS client narrows this further to just `name`, `assets`, `accent_id`
(`wire-webapp/libraries/api-client/src/user/userUpdate.ts:22`), which is what a modern
client actually needs. Fields left out are **not** cleared.

Everything else about the self account is a dedicated sub-resource — you cannot change
handle, locale, email or password through `PUT /self`
(`wire-webapp/libraries/api-client/src/self/selfApi.ts:31-40, 133-200`;
`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:494-585`):

| Method | Path | Body | Notes |
|---|---|---|---|
| `PUT` | `/self/handle` | `{"handle": "johndoe"}` | 409 `handle-exists`, 400 `invalid-handle` |
| `PUT` | `/self/locale` | `{"locale": "en"}` | |
| `PUT` | `/self/password` | `{"old_password": "…", "new_password": "…"}` | `old_password` optional if none set |
| `HEAD` | `/self/password` | – | 200 = password set, 404 = not set |
| `DELETE` | `/self/email` | – | only if another identity remains |
| `PUT` | `/self/supported-protocols` | `{"supported_protocols": ["proteus","mls"]}` | V5+; see §6 |
| `DELETE` | `/self` | `{"password": "…"}` or `{"code": "…"}` | schedules account deletion |
| `GET`/`PUT` | `/self/consent` | consent objects | marketing consent etc. |

Handle availability can be probed without changing anything:
`HEAD /handles/:handle` (V7+) or `HEAD /users/handles/:handle` (older), and
`POST /users/handles` with `{"handles": [...], "return": 1}` returns the free ones
(`wire-webapp/libraries/api-client/src/user/userApi.ts:501-530`).

---

## 2. Fetching other users

### 2.1 `GET /users/:domain/:id` — one user

`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:171-177`; the response is
`UserProfile` with 404 `user-not-found` if absent
(`GetUserVerb`, ibid. `:125-132`).
Client: `wire-webapp/libraries/api-client/src/user/userApi.ts:324-336`. The unqualified
form `GET /users/:id` exists only `Until 'V2`.

`HEAD /users/:domain/:id` (`wire-webapp/libraries/api-client/src/user/userApi.ts:421-433`)
is an existence check.

### 2.2 The `UserProfile` shape (other users)

`wire-server/libs/wire-api/src/Wire/API/User.hs:559-595`:

```json
{
    "accent_id": 2,
    "assets": [],
    "id": "00000002-0000-0001-0000-000000000000",
    "legalhold_status": "disabled",
    "name": "Jane Roe",
    "picture": [],
    "qualified_id": {"domain": "v.ay64d", "id": "00000002-0000-0001-0000-000000000000"},
    "searchable": true,
    "supported_protocols": ["proteus"],
    "text_status": "text status",
    "type": "regular"
}
```
(from `wire-server/libs/wire-api/test/golden/testObject_UserProfile_user_1.json`,
`name` de-obfuscated.)

**Present on `UserProfile` but not on `Self`:**

* `legalhold_status`: `"enabled"` | `"pending"` | `"disabled"` | `"no_consent"`
  (`wire-server/libs/types-common/src/Data/LegalHold.hs:40-47`; default `"no_consent"`).
  A client **must** surface `"enabled"` in the UI — that user's messages are recorded.
* `contact_status`: `{"state": "contactable" | "non-contactable"}`, only returned by
  `POST /list-users?include-contact-status=true`
  (`wire-server/libs/wire-api/src/Wire/API/User.hs:595, 598-618`).

**Present on `Self` but not on `UserProfile`:** `locale`, `status`, `managed_by`,
`sso_id`, `email_unvalidated`. `email` is on both but is only filled in for other users
when the backend's team email-visibility policy allows it
(`wire-server/libs/wire-api/src/Wire/API/User.hs:761-769`, `mkUserProfile`).

`supported_protocols` is *always* materialised — if the stored set is empty the schema
substitutes `["proteus"]` (`wire-server/libs/wire-api/src/Wire/API/User.hs:2095-2101`).

### 2.3 `POST /list-users` — bulk, qualified (V4+)

`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:232-252`;
client `wire-webapp/libraries/api-client/src/user/userApi.ts:562-604`.

Body is **exactly one of** `qualified_ids` or `qualified_handles`
(`wire-server/libs/wire-api/src/Wire/API/User.hs:1848-1865`):

```json
{"qualified_ids": [
  {"domain": "wire.com",  "id": "d5a39ffb-6ce3-4cc8-9048-0e15d031b4c5"},
  {"domain": "other.example", "id": "7025598b-ffac-4993-8a81-af3f35b7147f"}
]}
```
```json
{"qualified_handles": [{"domain": "wire.com", "handle": "johndoe"}]}
```
`qualified_handles` is limited to **1..4 entries** (`Range 1 4`, ibid. `:230`).

Response (V4+, `ListUsersById`,
`wire-server/libs/wire-api/src/Wire/API/User.hs:2127-2139`):

```json
{
  "found": [
    {"qualified_id": {"domain": "wire.com", "id": "d5a39ffb-6ce3-4cc8-9048-0e15d031b4c5"},
     "id": "d5a39ffb-6ce3-4cc8-9048-0e15d031b4c5",
     "name": "John Doe", "handle": "johndoe", "accent_id": 1,
     "assets": [], "picture": [], "legalhold_status": "no_consent",
     "supported_protocols": ["proteus"], "searchable": true, "type": "regular"}
  ],
  "failed": [
    {"domain": "unreachable.example", "id": "7025598b-ffac-4993-8a81-af3f35b7147f"}
  ]
}
```

`failed` is *omitted* when empty and lists users whose **backend was unreachable**, not
users who do not exist — non-existent users are silently missing from `found`.
Note the TS client additionally models a `not_found` key
(`wire-webapp/libraries/api-client/src/user/userApi.ts:60-64`); the current server
schema does not emit it, so treat it as optional.
Below V4 the same endpoint returns a bare `UserProfile[]`
(`wire-server/…/Brig.hs:249-258`), which the TS client normalises to `{found: […]}`.

A federation-related failure (`federation-not-available`, `srv-record-not-found`,
`federation-remote-error`, `federation-tls-error`) from an old backend is handled by
retrying with only same-domain IDs and reporting the rest as `failed`
(`wire-webapp/libraries/api-client/src/user/userApi.ts:585-606`).

Chunk size used by the web client for the deprecated variants: 50 by default,
100 for `getUsersByIds` (`wire-webapp/libraries/api-client/src/user/userApi.ts:77, 414`).

### 2.4 Deprecated unqualified lookups (`Until 'V2`)

`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:221-230`,
client `wire-webapp/libraries/api-client/src/user/userApi.ts:359-411`:

* `GET /users?ids=<uuid>,<uuid>,…` → `UserProfile[]`
* `GET /users?handles=<h>,<h>,…` → `UserProfile[]` (**max 4 handles**, "the check for
  handles is rather expensive")

`ids` and `handles` are mutually exclusive. Both are marked
`@deprecated use getUser, getSearchContacts or postListUsers instead`.

### 2.5 Handle lookups

* `GET /users/handles/:handle` (`Until 'V2`,
  `wire-server/…/Brig.hs:188-203`; client `…/userApi.ts:232-240`) → `UserHandleInfo`:

  ```ts
  // wire-webapp/libraries/api-client/src/user/handleInfo.ts:22-25
  export interface HandleInfo {
    qualified_id?: QualifiedId;
    user: string;               // the bare user UUID
  }
  ```
  404 `handle-not-found` when free. Marked
  *"(deprecated, use /search/contacts)"* in the route summary.

* `GET /users/by-handle/:domain/:handle` (`Until 'V2`,
  `wire-server/…/Brig.hs:204-219`; client `…/userApi.ts:533-543`) → full `UserProfile`,
  404 `handle-not-found`.

For V2+ the supported replacements are `POST /list-users` with `qualified_handles`
(exact) or `GET /search/contacts` (fuzzy, §7).

### 2.6 `GET /users/:domain/:id/supported-protocols` (V5+)

`wire-server/…/Brig.hs:276-289`; client `…/userApi.ts:351-361`. Returns a bare JSON
array, e.g. `["proteus","mls"]`. This is the cheap way to re-check one peer without
re-fetching the whole profile. See §6.

### 2.7 `GET /users/:id/rich-info`

`wire-server/…/Brig.hs:263-275`; client `…/userApi.ts:713-720`. Team-admin-configured
extra profile fields, requires team permissions:

```ts
// wire-webapp/libraries/api-client/src/user/richInfo.ts:20-28
export interface RichInfoField { type: string; value: string; }
export interface RichInfo { fields: RichInfoField[]; version: number; }
```

---

## 3. Other users' clients (devices)

You need these to encrypt Proteus messages (one ciphertext per recipient device) and to
show the device list / verification UI.

### 3.1 Endpoints

| Method | Path | Response | Source |
|---|---|---|---|
| `GET` | `/users/:domain/:id/clients` | `PubClient[]` | `wire-server/…/Brig.hs:1238-1247` (going away in V16), client `…/userApi.ts:214-226` |
| `GET` | `/users/:domain/:id/clients/:clientid` | `PubClient` | `wire-server/…/Brig.hs:1258-1267`, client `…/userApi.ts:179-190` |
| `POST` | `/users/list-clients` | `{qualified_user_map: …}` | V2+, `wire-server/…/Brig.hs:1290-1299`, client `…/userApi.ts:612-624` |
| `POST` | `/users/list-clients/v2` | same | below V2 only |

The bulk endpoint is the one to use. Body
(`wire-webapp/libraries/api-client/src/user/limitedQualifiedUserIdList.ts:22-24`),
max **500** users (`MaxUsersForListClientsBulk`, `wire-server/…/Brig.hs:123`):

```json
{"qualified_users": [{"domain": "wire.com", "id": "d5a39ffb-6ce3-4cc8-9048-0e15d031b4c5"}]}
```

Response
(`wire-webapp/libraries/api-client/src/client/qualifiedPublicClients.ts:22-30`):

```json
{
  "qualified_user_map": {
    "wire.com": {
      "d5a39ffb-6ce3-4cc8-9048-0e15d031b4c5": [
        {"id": "93fa36b916a91118", "class": "desktop"},
        {"id": "2b22b7c59aab5f8",  "class": "phone"}
      ]
    }
  }
}
```

*"If a backend is unreachable, the clients from that backend will be omitted from the
response"* (`wire-server/…/Brig.hs:1294`) — there is no `failed` list here, so compare
the request set with the response keys yourself.

### 3.2 Returned shape, and where `mls_public_keys` actually lives

For *other users* the backend returns `PubClient`, which has **only two fields**
(`wire-server/libs/wire-api/src/Wire/API/User/Client.hs:616-630`):

```haskell
PubClient
  <$> pubClientId    .= field "id" schema
  <*> pubClientClass .= maybe_ (optField "class" schema)
```

```ts
// wire-webapp/libraries/api-client/src/client/publicClient.ts:22-25
export interface PublicClient {
  class: ClientClassification;
  id: string;
}
```

`class` (`wire-webapp/libraries/api-client/src/client/clientClassification.ts:20-26`,
server `wire-server/libs/wire-api/src/Wire/API/User/Client.hs:698-701`):
`"desktop"`, `"phone"`, `"tablet"`, `"legalhold"`; the TS client adds a synthetic
`"?"` for unknown. `class` is optional — treat a missing `class` as unknown.
A `"legalhold"` device means the conversation is being recorded.

**`mls_public_keys` is a field of the full `Client` record, i.e. of *your own* devices**
(`GET /clients`, `GET /clients/:id`), not of `PubClient`
(`wire-server/libs/wire-api/src/Wire/API/User/Client.hs:544-557, 590-591`). Its shape is
a map from signature scheme tag to base64 key (ibid. `:520, 526-538`):

```json
{
    "capabilities": [],
    "class": "desktop",
    "id": "2",
    "label": "%*",
    "mls_public_keys": {"ed25519": "base64=="},
    "model": "Chrome",
    "time": "1864-05-06T19:39:12.770Z",
    "type": "permanent"
}
```
(structure from `wire-server/libs/wire-api/test/golden/testObject_Client_user_1.json`;
the `mls_public_keys` value there is `{}`, the key/value example is the schema's own
documented example at `Client.hs:526-538`.)

`type`: `"permanent" | "temporary" | "legalhold"`
(`wire-server/…/User/Client.hs:671-673`;
`wire-webapp/libraries/api-client/src/client/clientType.ts:20-25` adds a client-only
`"none"`). `capabilities`: `"legalhold-implicit-consent"`, `"consumable-notifications"`
(`wire-server/…/User/Client.hs:159-160`;
`wire-webapp/libraries/api-client/src/client/clientCapability.ts:20-23`).

Brig's own integration test asserts that `mls_public_keys` is **absent** from other
users' client payloads (`wire-server/services/brig/test/integration/API/User/Client.hs:1157,1166`).
To learn a peer's MLS signature key you fetch a KeyPackage instead (part on MLS).

### 3.3 Related: prekeys

Same URL family, listed here so the shapes are not confused:
`GET /users/:domain/:id/prekeys` (all devices),
`GET /users/:domain/:id/prekeys/:clientid` (one device),
`POST /users/list-prekeys` (bulk, body is a qualified user→clients map, response
`{qualified_user_client_prekeys: …, failed_to_list?: […]}`)
— `wire-webapp/libraries/api-client/src/user/userApi.ts:197-210, 339-348, 546-556`.
Bulk chunk size 128 (ibid. `:78`).

---

## 4. Connections (contact requests)

Wire has no address book: **your contacts are your accepted connections plus your team
members.** A connection is a directed row; the backend keeps two rows per pair
(`wire-server/libs/wire-api/src/Wire/API/Connection.hs:97-101`:
"if A sends a connection request to B, we'll create connections (A, B, Sent) and (B, A, Pending)").

### 4.1 States

`wire-server/libs/wire-api/src/Wire/API/Connection.hs:198-208` /
`wire-webapp/libraries/api-client/src/connection/connectionStatus.ts:20-29`:

| Value | Meaning (from *your* row's point of view) |
|---|---|
| `sent` | you sent a request, awaiting their answer |
| `pending` | they sent you a request, awaiting your answer |
| `accepted` | connected — a 1:1 conversation exists and is usable |
| `blocked` | you blocked them |
| `ignored` | you ignored their incoming request (they still see `sent`) |
| `cancelled` | you withdrew your own request |
| `missing-legalhold-consent` | connection frozen because one side is under legal hold and the other has not consented |

`"unknown"` in the TS enum is a client-side sentinel, never sent by the backend.
`missing-legalhold-consent` cannot be set by a client: any `PUT` that mentions it, or
that starts from it, fails with 403 `bad-conn-update`
(`wire-server/services/brig/src/Brig/API/Connection.hs:270-273`). The backend remembers
the pre-freeze state internally (`RelationWithHistory`,
`wire-server/libs/wire-api/src/Wire/API/Connection.hs:156-181`) and restores it when
consent is given (ibid. `:518-523`) — clients never see those `*WithHistory` values.

### 4.2 `UserConnection` JSON

Server schema `wire-server/libs/wire-api/src/Wire/API/Connection.hs:114-126`:

| Field | Type | Notes |
|---|---|---|
| `from` | UUID string | **unqualified** — always you, on your own backend |
| `qualified_to` | `{domain, id}` | the other user |
| `to` | UUID string | deprecated duplicate of `qualified_to.id` |
| `status` | see §4.1 | |
| `last_update` | ISO-8601 UTC ms | when `status` last changed |
| `qualified_conversation` | `{domain, id}` | optional; the 1:1 conversation |
| `conversation` | UUID string | deprecated duplicate |
| `message` | string | legacy greeting text, no longer set by the backend |

Two real payloads, from
`wire-server/libs/wire-api/test/golden/testObject_UserConnection_user_{1,2}.json`:

```json
{
    "from": "00000000-0000-0004-0000-000100000001",
    "last_update": "1864-05-07T21:52:21.955Z",
    "qualified_to": {"domain": "farway.golden.example.com",
                     "id": "00000001-0000-0001-0000-000300000002"},
    "status": "pending",
    "to": "00000001-0000-0001-0000-000300000002"
}
```
```json
{
    "conversation": "00000002-0000-0001-0000-000000000004",
    "from": "00000004-0000-0002-0000-000000000004",
    "last_update": "1864-05-11T10:43:38.227Z",
    "qualified_conversation": {"domain": "nice-and-close-to-home.golden.example.com",
                               "id": "00000002-0000-0001-0000-000000000004"},
    "qualified_to": {"domain": "faraway.golden.example.com",
                     "id": "00000001-0000-0003-0000-000100000000"},
    "status": "cancelled",
    "to": "00000001-0000-0003-0000-000100000000"
}
```

The TS mirror is `wire-webapp/libraries/api-client/src/connection/connection.ts:23-32`.
Note it types `conversation: string` as required while the server marks it optional —
**treat it as optional** and prefer `qualified_conversation`.

### 4.3 Listing connections

**`POST /list-connections`** (the one to use; federated + paginated)
— `wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:1363-1371`,
client `wire-webapp/libraries/api-client/src/connection/connectionApi.ts:76-110`.

Request:
```json
{"size": 500, "paging_state": null}
```
`size` max **500**, default 100
(`ListConnectionsRequestPaginated = GetMultiTablePageRequest "Connections" LocalOrRemoteTable 500 100`,
`wire-server/libs/wire-api/src/Wire/API/Connection.hs:65`).

Response (`MultiTablePage`,
`wire-server/libs/wire-api/src/Wire/API/Routes/MultiTablePaging.hs:159-166`):
```json
{"connections": [], "has_more": true, "paging_state": "<opaque>"}
```
Loop while `has_more` is `true`, feeding the previous `paging_state` back in.
`paging_state` is always present in the response; it is opaque base64 — do not parse it.

**`GET /connections?start=<uuid>&size=<n>`** (`Until 'V2`,
`wire-server/…/Brig.hs:1358-1367`, client `…/connectionApi.ts:57-69`) returns
`{connections: [...], has_more: bool}` and is local-users-only. Do not use on V2+.

**`GET /connections/:domain/:id`** — one connection, 404 with an empty body when there
is none (`wire-server/…/Brig.hs:1391-1404`).
⚠ The TS client's `getConnection` builds the URL as
`` `${CONNECTIONS}/${userId.domain}/${userId}` `` — interpolating the object, not
`userId.id` (`wire-webapp/libraries/api-client/src/connection/connectionApi.ts:41`).
That is a bug in the reference client; build `/connections/{domain}/{id}`.

### 4.4 Creating and updating a connection

**`POST /connections/:domain/:id`** — no request body
(`wire-server/…/Brig.hs:1334-1352`; client
`wire-webapp/libraries/api-client/src/connection/connectionApi.ts:118-135`).
Returns the resulting `UserConnection` with **201** if it was created and **200** if one
already existed (`ResponsesForExistedCreated`,
`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Util.hs:57-60`).

The legacy unqualified form `POST /connections` (`Until 'V2`) takes a body
(`wire-server/libs/wire-api/src/Wire/API/Connection.hs:268-288`):
```json
{"user": "7025598b-ffac-4993-8a81-af3f35b7147f", "name": "Jane Roe"}
```
`name` is required, 1–256 chars, and is *ignored* by the backend
("clients started ignoring it", ibid. `:271-277`). The TS type also carries `message`
(`wire-webapp/libraries/api-client/src/connection/connectionRequest.ts:20-24`), also
ignored.

**`PUT /connections/:domain/:id`** — `{"status": "accepted"}`
(`wire-server/…/Brig.hs:1441-1461`; client `…/connectionApi.ts:144-155`).
**200** with the new `UserConnection`, or **204 with no body** if nothing changed
(`UpdateResponses`, `wire-server/libs/wire-api/src/Wire/API/Routes/Public/Util.hs:70-73`)
— a client must handle the empty 204.

Allowed transitions, from the backend state machine
(`wire-server/services/brig/src/Brig/API/Connection.hs:275-310`); anything else is
403 `bad-conn-update`:

```
pending   -> blocked | ignored | accepted
ignored   -> accepted | blocked
accepted  -> blocked
sent      -> blocked | cancelled | accepted
cancelled -> blocked
blocked   -> accepted | sent      (resolved against the other side's row)
```

So the UI verbs map as: *accept* = `accepted` from `pending`/`ignored`;
*ignore* = `ignored`; *cancel my request* = `cancelled` from `sent`;
*block* = `blocked`; *unblock* = `accepted` from `blocked`
(`wire-webapp/apps/webapp/src/script/repositories/connection/connectionRepository.ts:157,169,181,336,346`).

Errors: 403 `connection-limit` ("Too many sent/accepted connections", cap 1000),
403 `not-connected`, 400 `invalid-user`, 403 `no-identity`, 403 `bad-conn-update`,
`missing-legalhold-consent`, `federation-denied`
(`wire-server/libs/wire-api/src/Wire/API/Error/Brig.hs:151,185,191,193,195,179-183`;
`wire-webapp/libraries/api-client/src/http/backendErrorLabel.ts:112,120`).

### 4.5 Connections and 1:1 conversations

The conversation is created **when the request is sent, not when it is accepted**:
`createConnectionToLocalUser` calls `Intra.createConnectConv` and then inserts both rows
with that conversation ID (`wire-server/services/brig/src/Brig/API/Connection.hs:128-140`).
That conversation starts as **type 3 (`CONNECT`)** and becomes a normal **type 2
(`ONE_TO_ONE`)** when accepted (`acceptConnectConv`, ibid. `:161`; type numbers:
`wire-webapp/libraries/api-client/src/conversation/conversation.ts:28-34`).

Consequences for a client:

* `connection.qualified_conversation` **is** the Proteus 1:1 conversation ID for that
  peer. That is how you find the 1:1 conversation for a user: look up your connection
  row, take `qualified_conversation`.
* While `status` is `sent`, render the type-3 conversation as an outgoing request, not
  as a chat (`wire-webapp/apps/webapp/src/script/repositories/conversation/ConversationRepository.ts:2251-2259`).
* An accepted connection creates the conversation on both sides; both parties receive
  conversation member-join / connect-request events.
* The MLS 1:1 conversation is a **different** conversation with the same peer and is
  *not* referenced by the connection row — see §6.3.

### 4.6 Events

Connection changes arrive on the notification stream as
`user.connection` (`wire-webapp/libraries/api-client/src/event/userEvent.ts:39`):

```json
{"type": "user.connection",
 "connection": {"from": "…", "qualified_to": {"domain": "…", "id": "…"}, "status": "pending", "last_update": "…"},
 "user": {"name": "Jane Roe"}}
```
`user` is present only for some statuses
(`wire-webapp/libraries/api-client/src/user/data/userConnectionData.ts:22-28`) — it is
filled in for the *recipient* of a new request so the UI can name the sender without an
extra fetch (`wire-server/services/brig/src/Brig/API/Connection.hs:136-137`).

Other user-scoped events you must handle:
`user.update` (partial `User`, at least `{user: {id}}`,
`wire-webapp/libraries/api-client/src/user/data/userUpdateData.ts:22-26`),
`user.delete`, `user.client-add`, `user.client-remove`,
`user.legalhold-request` / `-enable` / `-disable`,
`user.properties-set` / `user.properties-delete`, `user.push-remove`, `user.activate`
(`wire-webapp/libraries/api-client/src/event/userEvent.ts:35-48`).

---

## 5. Teams

A user belongs to at most one team; `self.team` holds its UUID. Team membership implies
an *implicit* connection: team members can message each other without any
`UserConnection` row, which is why §11 lists them as a second contact source.

### 5.1 `GET /teams/:teamid`

`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Galley/Team.hs:113-120`, client
`wire-webapp/libraries/api-client/src/team/team/teamApi.ts:75-83`.
Schema `wire-server/libs/wire-api/src/Wire/API/Team.hs:108-118`:

```json
{
  "id": "537992e5-3782-4b6c-8718-a5db2cc786ee",
  "creator": "d5a39ffb-6ce3-4cc8-9048-0e15d031b4c5",
  "name": "Acme Inc.",
  "icon": "3-1-47de4580-ae51-4650-acbb-d10c028cb0ac",
  "icon_key": "…",
  "splash_screen": "default",
  "binding": true
}
```

`icon` / `splash_screen` are asset keys or the literal `"default"`; `binding` is
documented as *"Deprecated, please ignore… will always be `true`"*
(`wire-server/libs/wire-api/src/Wire/API/Team.hs:118-123`).
TS mirror: `wire-webapp/libraries/api-client/src/team/team/teamData.ts:22-37`.

### 5.2 `GET /teams` (deprecated)

`Until 'V4` — *"Get teams (deprecated); use `GET /teams/:tid`"*
(`wire-server/…/Galley/Team.hs:105-111`). Returns
`{"teams": [], "has_more": false}`
(`wire-server/libs/wire-api/src/Wire/API/Team.hs:171-172`;
`wire-webapp/libraries/api-client/src/team/team/teamChunkData.ts:22-25`).
On V4+ read `self.team` and call `GET /teams/:teamid`.

Also available: `GET /teams/:teamid/size` → `{"teamSize": 42}`
(`wire-webapp/libraries/api-client/src/team/team/teamApi.ts:98-104`).

### 5.3 Members

| Method | Path | Notes |
|---|---|---|
| `GET` | `/teams/:tid/members?maxResults=&pagingState=` | paginated page |
| `GET` | `/teams/:tid/members/:uid` | single member |
| `POST` | `/teams/:tid/get-members-by-ids-using-post?maxResults=` | bulk by ID, body `{"user_ids": [ … ]}` |
| `GET` | `/teams/:tid/members/csv` | admin CSV export |

Routes: `wire-server/libs/wire-api/src/Wire/API/Routes/Public/Galley/TeamMember.hs:40-98`.
Client: `wire-webapp/libraries/api-client/src/team/member/memberApi.ts:58-154`
(`maxResults` default 2000 for the page endpoint, chunk size 1600 for the bulk POST —
*"Maximum 1600 due to '413 Request Entity Too Large' response"*, ibid. `:48-49, 109`).

Paginated response (`TeamMembersPage`,
`wire-server/libs/wire-api/src/Wire/API/Team/Member.hs:250-261`) — note the **camelCase**
`hasMore`/`pagingState` here, unlike the snake_case used by `/list-connections`:

```json
{
    "hasMore": false,
    "members": [
        {
            "user": "00000000-0000-0000-0000-000000000001",
            "created_at": "1864-05-09T06:07:36.175Z",
            "created_by": "00000001-0000-0001-0000-000100000000",
            "legalhold_status": "pending",
            "permissions": {"copy": 0, "self": 0}
        },
        {
            "user": "00000000-0000-0001-0000-000100000001",
            "created_at": null,
            "created_by": null,
            "legalhold_status": "pending",
            "permissions": {"copy": 0, "self": 0}
        }
    ]
}
```
(from `wire-server/libs/wire-api/test/golden/testObject_TeamMemberList_team_3.json`;
the paginated variant adds `"pagingState": "<opaque>"`.)

`permissions` is **omitted entirely** unless you hold `GetMemberPermissions`
(`wire-server/libs/wire-api/src/Wire/API/Team/Member.hs:193-206`), so it is optional
in practice. `created_by`/`created_at` are `null` for founding members.
TS mirror: `wire-webapp/libraries/api-client/src/team/member/memberData.ts:24-32`,
`…/members.ts:22-26`.

### 5.4 Permission bitmask and roles

`permissions.self` = what this member may do; `permissions.copy` = what they may grant
to others (always a subset)
(`wire-webapp/libraries/api-client/src/team/member/permissionsData.ts:22-27`).

Bit values (`wire-server/libs/wire-api/src/Wire/API/Team/Permission.hs:173-186`, identical
to `wire-webapp/libraries/api-client/src/team/member/permissions.ts:20-35`):

| Bit | Hex | Permission |
|---|---|---|
| 0 | `0x0001` | `CreateConversation` |
| 1 | `0x0002` | `DeleteConversation` |
| 2 | `0x0004` | `AddTeamMember` |
| 3 | `0x0008` | `RemoveTeamMember` |
| 4 | `0x0010` | `AddRemoveConvMember` |
| 5 | `0x0020` | `ModifyConvName` |
| 6 | `0x0040` | `GetBilling` |
| 7 | `0x0080` | `SetBilling` |
| 8 | `0x0100` | `SetTeamData` |
| 9 | `0x0200` | `GetMemberPermissions` |
| 10 | `0x0400` | `GetTeamConversations` |
| 11 | `0x0800` | `DeleteTeam` |
| 12 | `0x1000` | `SetMemberPermissions` |

Roles are exactly four bitmask values
(`wire-server/libs/wire-api/src/Wire/API/Team/Role.hs:143-149`):

| Role name | `permissions.self` |
|---|---|
| `owner` | `8191` |
| `admin` | `5951` |
| `member` | `1587` |
| `partner` (a.k.a. "external") | `1025` |

Any other value has **no** role (`permissionsToRole` returns `Nothing`). The web client
instead classifies by subset test — "is at least admin" etc.
(`wire-webapp/libraries/api-client/src/team/member/role.ts:31-119`) — which is the more
forgiving approach and what a new client should copy. Role strings on the wire:
`"owner" | "admin" | "member" | "partner"` (`wire-server/…/Team/Role.hs:104-108`);
the TS enum spells the last one `EXTERNAL = 'partner'`
(`wire-webapp/libraries/api-client/src/team/member/role.ts:23-29`).
Default role for a new member is `member` (`wire-server/…/Team/Role.hs:123-124`).

### 5.5 Feature configs

Two equivalent reads:

* **`GET /feature-configs`** — the whole map for the *current user*; works for personal
  accounts too, where it returns server defaults
  (`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Galley/Feature.hs:250-265`;
  client `wire-webapp/libraries/api-client/src/team/feature/featureApi.ts:75-106`).
  **This is what a client should call at startup.**
* **`GET /teams/:teamid/features`** — same map, addressed by team
  (`wire-server/…/Galley/Feature.hs:267-280`).
* `GET|PUT /teams/:teamid/features/<name>` — one feature
  (`wire-server/…/Galley/Feature.hs:167-190`; the client has a getter per feature,
  `wire-webapp/libraries/api-client/src/team/feature/featureApi.ts:108-477`).

Every feature object has the same envelope
(`wire-webapp/libraries/api-client/src/team/feature/featureList.schema.ts:62-66`):

```json
{"status": "enabled", "lockStatus": "unlocked", "ttl": "unlimited", "config": {}}
```
`status` is `"enabled"` | `"disabled"`; `lockStatus` is `"locked"` | `"unlocked"`;
`ttl` is `"unlimited"` or a number of seconds. `lockStatus` and `ttl` are optional;
`config` exists only for features that have one.
Enum sources: `wire-webapp/libraries/api-client/src/team/feature/featureList.types.ts:96-104`,
server `wire-server/libs/wire-api/src/Wire/API/Team/Feature.hs:2487-2488`.

Feature keys are camelCase
(`wire-webapp/libraries/api-client/src/team/feature/featureList.types.ts:60-94`). The
ones a chat client actually needs:

| Key | Config | Why the client cares |
|---|---|---|
| `mls` | see below | whether MLS may be used at all, and the default protocol |
| `mlsMigration` | `{startTime?, finaliseRegardlessAfter?}` (ISO-8601) | Proteus→MLS migration window |
| `mlsE2EId` | `{verificationExpiration, acmeDiscoveryUrl?, crlProxy?, useProxyOnMobile?}` | end-to-end identity / ACME enrolment |
| `fileSharing` | – | disable attachment send/receive |
| `conferenceCalling` | `{useSFTForOneToOneCalls?}` | group calls; route 1:1 calls via SFT |
| `appLock` | `{enforceAppLock, inactivityTimeoutSecs}` | force a passcode/biometric lock |
| `selfDeletingMessages` | `{enforcedTimeoutSeconds}` | forced ephemeral timer (0 = user choice) |
| `conversationGuestLinks` | – | may create guest links |
| `enforceFileDownloadLocation` | `{enforcedDownloadLocation?}` | forced download directory (desktop) |
| `classifiedDomains` | `{domains: [...]}` | "classified" banner in conversations |
| `digitalSignatures`, `sso`, `legalhold`, `validateSAMLemails`, `searchVisibility`, `searchVisibilityInbound`, `channels`, `cells`, `consumableNotifications`, `preventAdminlessGroups`, `outlookCalIntegration`, `sndFactorPasswordChallenge`, `exposeInvitationURLsToTeamAdmin`, `limitedEventFanout`, `domainRegistration`, `apps`, `assetAuditLog`, `chatBubbles`, `stealthUsers`, `meetings`, `allowedGlobalOperations`, `simplifiedUserConnectionRequestQRCode` | various | see `featureList.types.ts:140-177` |

Config schemas: `wire-webapp/libraries/api-client/src/team/feature/featureList.schema.ts:70-124`.
`selfDeletingMessages` timeouts the UI offers: 0, 10 s, 5 min, 1 h, 1 d, 1 w, 4 w
(`…/featureList.types.ts:112-120`).
Unknown feature keys must be tolerated — the schema is `.passthrough()` and validation
failures are logged but never thrown (`…/featureApi.ts:83-105`).

The `mls` config (`wire-server/libs/wire-api/src/Wire/API/Team/Feature.hs:1144-1159`,
TS `…/featureList.schema.ts:100-106`):

```json
{
  "status": "enabled",
  "lockStatus": "unlocked",
  "config": {
    "protocolToggleUsers": [],
    "defaultProtocol": "proteus",
    "allowedCipherSuites": [1],
    "defaultCipherSuite": 1,
    "supportedProtocols": ["proteus", "mls"]
  }
}
```

Backend defaults when a team has never configured it
(`wire-server/libs/wire-api/src/Wire/API/Team/Feature.hs:1133-1142`): feature
`status: "disabled"` (ibid. `:1160-1161`), `defaultProtocol: "proteus"`,
`allowedCipherSuites: [MLS_128_DHKEMP256_AES128GCM_SHA256_P256]`,
`supportedProtocols: ["proteus","mls"]`.

**How a client learns whether MLS is on, and what the default protocol is:**

```ts
// wire-webapp/apps/webapp/src/script/repositories/team/TeamState.ts:124-126
this.isMLSEnabled = ko.pureComputed(() => {
  return this.teamFeatures()?.mls?.status === FEATURE_STATUS.ENABLED;
});
```
i.e. `feature-configs.mls.status === "enabled"`. The default protocol for *new group*
conversations is `feature-configs.mls.config.defaultProtocol` (`"proteus"` | `"mls"`;
`"mixed"` also exists as a conversation protocol during migration,
`wire-webapp/libraries/api-client/src/team/feature/featureList.types.ts:122-126`).
`protocolToggleUsers` is an allowlist of user IDs permitted to flip the protocol
manually (`wire-server/…/Team/Feature.hs:1148-1152`;
`wire-webapp/apps/webapp/src/script/repositories/team/TeamState.ts:128-130`).

Team-wide protocol support, with the "old team" fallback, is derived like this
(`wire-webapp/apps/webapp/src/script/repositories/team/TeamRepository.ts:571-589`):

```ts
const mlsFeature = this.teamState.teamFeatures()?.mls;
if (!mlsFeature || mlsFeature.status === FEATURE_STATUS.DISABLED) {
  return [CONVERSATION_PROTOCOL.PROTEUS];
}
const teamSupportedProtocols = mlsFeature.config.supportedProtocols;
// For old teams … supportedProtocols field might not exist or be empty,
// we fallback to proteus in this case.
return teamSupportedProtocols?.length > 0 ? teamSupportedProtocols : [CONVERSATION_PROTOCOL.PROTEUS];
```

Migration status is derived from `mlsMigration` plus wall-clock time
(`wire-webapp/apps/webapp/src/script/mls/MLSMigration/migrationStatus.ts:52-76`):
`DISABLED` (feature off) → `NOT_STARTED` (`startTime` in the future) →
`ONGOING` (past `startTime`) → `FINALISED` (past `finaliseRegardlessAfter`).

### 5.6 Team events

`team.create`, `team.delete`, `team.update`, `team.member-join`, `team.member-leave`,
`team.member-update`, `team.conversation-create`, `team.conversation-delete`
(`wire-webapp/libraries/api-client/src/event/teamEvent.ts:32-39`). Feature changes arrive
as a feature-config update event whose payload is described by
`wire-webapp/libraries/api-client/src/team/data/teamFeatureConfigurationUpdateEventData.ts`.

---

## 6. `supported_protocols` and the 1:1 protocol decision

### 6.1 The field

`supported_protocols` is a **set** of `"proteus"` and/or `"mls"`
(`wire-server/libs/wire-api/src/Wire/API/User.hs:2086-2092`), present on both `Self` and
`UserProfile`, defaulting to `["proteus"]` when the stored value is empty
(ibid. `:2095-2101`). Legal values in practice: `["proteus"]`, `["mls"]`,
`["proteus","mls"]`.

### 6.2 Publishing your own

`PUT /self/supported-protocols` (V5+), body
(`wire-server/libs/wire-api/src/Wire/API/User.hs:2114-2124`):

```json
{"supported_protocols": ["proteus", "mls"]}
```
Client: `wire-webapp/libraries/api-client/src/self/selfApi.ts:192-200`. 200 empty on
success; can fail with `mls-removal-not-allowed`
(`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:576-586`) — **you may add
`mls` but not take it away** once MLS conversations exist.

The web client recomputes this set on every startup and pushes it if it changed
(`wire-webapp/apps/webapp/src/script/repositories/self/SelfSupportedProtocols/SelfSupportedProtocols.ts:104-125`):

* include `proteus` if the team supports Proteus **or** migration is `NOT_STARTED`/`ONGOING`
  (ibid. `:39-48`);
* include `mls` if the environment supports MLS **and** the team supports MLS **and**
  (all of your own active clients have registered an MLS device **or** migration is
  `FINALISED`) (ibid. `:83-99`);
* also include `mls` if the team forces MLS without migration (team lists `mls`, not
  `proteus`, migration `DISABLED`, and some clients still lack MLS — ibid. `:57-76`),
  **or** if you previously advertised `mls` (ibid. `:120-122`, the no-downgrade rule).

A minimal Proteus-only client simply publishes `["proteus"]` (or leaves the default) and
never calls this endpoint.

### 6.3 Negotiating the protocol for a 1:1

This is the exact algorithm the official client uses
(`wire-webapp/apps/webapp/src/script/repositories/conversation/ConversationRepository.ts:1757-1792`):

```ts
const otherUserSupportedProtocols = await this.userRepository.getUserSupportedProtocols(otherUserId, …);
const selfUserSupportedProtocols  = await this.selfRepository.getSelfSupportedProtocols();

const commonProtocols = otherUserSupportedProtocols.filter(p => selfUserSupportedProtocols.includes(p));

if (commonProtocols.includes(CONVERSATION_PROTOCOL.MLS))     return {protocol: MLS};
if (commonProtocols.includes(CONVERSATION_PROTOCOL.PROTEUS)) return {protocol: PROTEUS};

// if common protocol can't be found, we use preferred protocol of the self user
return {protocol: selfUserSupportedProtocols.includes(MLS) ? MLS : PROTEUS};
```

In words:

1. Read the peer's `supported_protocols` (from the cached profile, or freshly via
   `GET /users/:domain/:id/supported-protocols`).
2. Intersect with your own set.
3. **MLS wins** if it is in the intersection; else Proteus; else fall back to your own
   preference (MLS if you support it, otherwise Proteus).

Then, when the connection is `accepted`
(`…/ConversationRepository.ts:2246-2270`):

* **Proteus** → use `connection.qualified_conversation` — the type-2 conversation that
  already exists.
* **MLS** → look for a local MLS 1:1 with that user, otherwise fetch it:
  **`GET /one2one-conversations/:domain/:id`** (V7+) or
  **`GET /conversations/one2one/:domain/:id`** (below V7)
  (`wire-webapp/libraries/api-client/src/conversation/conversationApi/conversationApi.ts:442-452`).
  The response is either a plain MLS conversation or the wrapper
  (`wire-webapp/libraries/api-client/src/conversation/conversation.ts:130-135`):

  ```json
  {"conversation": {"group_id": "…", "epoch": 0, "cipher_suite": 1, "protocol": "mls"},
   "public_keys": {"removal": {}}}
  ```
  The MLS group is then established/joined; `group_id` is what you feed to the MLS stack.

Two rules that are easy to get wrong, both stated in the reference client:

* *"As of how backend works now (August 2023), proteus 1:1 conversations will always be
  created, even if both users support MLS… Therefore, `conversationId` on connectionEntity
  will always indicate the proteus 1:1 conversation. We need to manually check if mls 1:1
  conversation can be used instead. If mls 1:1 conversation is used, proteus 1:1
  conversation will be deleted locally."*
  (`…/ConversationRepository.ts:2222-2227`)
* **No downgrade.** *"we do not support switching back to proteus after mls conversation
  was established, only proteus → mls migration is supported, never the other way around"*
  (`…/ConversationRepository.ts:2273-2276`). If you already know an MLS 1:1 with a peer,
  keep using it even if the intersection now says Proteus.

Short-circuits before any of this: if the other user is `deleted` or is a service/bot,
just open the Proteus conversation
(`…/ConversationRepository.ts:2194-2205`).

A peer changing their protocols shows up as a `user.update` event; the client re-runs
the decision and emits `supportedProtocolsUpdated`
(`wire-webapp/apps/webapp/src/script/repositories/user/userRepository.ts:731-748`).

---

## 7. Searching for users

### 7.1 `GET /search/contacts`

`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:1462-1492`, client
`wire-webapp/libraries/api-client/src/user/userApi.ts:277-314`.

Query parameters:

| Param | Required | Notes |
|---|---|---|
| `q` | yes | search string |
| `domain` | no | *"optional only for backwards compatibility, future versions will mandate this"* — pass it |
| `size` | no | 1..500, default 15 |
| `type` | no | comma-separated `regular` / `app`; empty = no filter (`wire-server/libs/wire-api/src/Wire/API/User/Search.hs:339-340`) |

Matching semantics, quoted from the route description
(`wire-server/…/Brig.hs:1472-1482`): the query is normalised (lower-cased, diacritics
removed — `"Björn"` → `"bjorn"`), then matched, in this priority order, against
(1) the full normalised **handle**, (2) the full normalised **display name**,
(3) handle prefix, (4) display name prefix. *"NB: '@' does NOT do anything special."*

Response (`SearchResult Contact`,
`wire-server/libs/wire-api/src/Wire/API/User/Search.hs:117-127`):

```json
{
  "found": 1,
  "returned": 1,
  "took": 12,
  "search_policy": "full_search",
  "documents": [
    {
      "qualified_id": {"domain": "example.com", "id": "00000018-0000-0020-0000-000e00000002"},
      "id": "00000018-0000-0020-0000-000e00000002",
      "name": "Foobar",
      "handle": "foobar1",
      "accent_id": 1,
      "team": "00000018-0000-0020-0000-000e00000002",
      "type": "regular"
    }
  ]
}
```
(the `documents` entry is verbatim from
`wire-server/libs/wire-api/test/golden/testObject_Contact_1.json`.)

`found` = total hits, `returned` = hits in this page, `took` = ms
(ibid. `:120-123`). `paging_state` / `has_more` may also appear (ibid. `:125-126`);
the TS type omits them (`wire-webapp/libraries/api-client/src/user/searchResult.ts:22-27`).

A `Contact` is a **strict subset** of a user — `qualified_id`, `id`, `name`,
`accent_id`, `handle`, `team`, `type`, where `accent_id`/`handle`/`team` may be
JSON `null` (`wire-server/libs/wire-api/src/Wire/API/User/Search.hs:146-168`;
TS `wire-webapp/libraries/api-client/src/user/contact.ts:22`). There are no `assets` —
fetch the full profile with `GET /users/:domain/:id` before showing an avatar.

The web client makes search requests cancellable via an Axios cancel token and surfaces
cancellation as `RequestCancellationError`
(`wire-webapp/libraries/api-client/src/user/userApi.ts:281-314`) — worth copying, since
search is typed-into.

### 7.2 Federated search

Pass `domain=<remote domain>` to search another backend. What comes back depends on the
**per-domain search policy** the two backends agreed on, echoed in `search_policy`
(`wire-server/libs/wire-api/src/Wire/API/User/Search.hs:358-372`):

* `no_search` — the remote backend returns nothing;
* `exact_handle_search` — only an exact handle match is returned;
* `full_search` — name and prefix matching, as for local users.

TS mirror: `wire-webapp/libraries/api-client/src/team/search/teamSearchResult.ts:32-36`.
So a federated search UI must show "type the full handle" hints when the policy is
`exact_handle_search`, and must not treat an empty result as "user does not exist".
`insufficient-permissions` (403) is possible when the backend restricts outbound search
(`wire-server/…/Brig.hs:1466`).

### 7.3 Team member search

`GET /teams/:teamid/search?q=&size=&sortby=&sortorder=&frole=&searchable=&pagingState=`
(`wire-webapp/libraries/api-client/src/team/search/teamSearchApi.ts:44-77`). Returns
`SearchResult TeamContact` — a richer contact with `email`, `created_at`, `managed_by`,
`role`, `saml_idp`, `scim_external_id`, `sso`, `email_unvalidated`, `searchable`
(`wire-server/libs/wire-api/src/Wire/API/User/Search.hs:216-231`;
`wire-webapp/libraries/api-client/src/team/search/teamContact.ts:23-34`).
`sortorder` is `asc` / `desc`
(`wire-webapp/libraries/api-client/src/team/search/teamSearchOptions.ts:24-27`),
`frole` is a comma-joined list of role names.

### 7.4 Search visibility of yourself

`POST /users/:id/searchable` with `{"set_searchable": true}` (V12+)
(`wire-server/…/Brig.hs:290-300`, `…/User/Search.hs:431`;
client `wire-webapp/libraries/api-client/src/user/userApi.ts:743-750`). The resulting
flag is the `searchable` field on `User`/`TeamContact`.

---

## 8. Profile pictures

### 8.1 The `assets` array

```ts
// wire-webapp/libraries/api-client/src/user/userAsset.ts:20-30
export enum UserAssetType { COMPLETE = 'complete', PREVIEW = 'preview' }
export interface UserAsset {
  key: string;
  domain?: string;
  size: UserAssetType;
  type: 'image';
}
```

Server schema (`wire-server/libs/wire-api/src/Wire/API/User/Profile.hs:129-139`):
`key` required, `size` optional (`"preview"` | `"complete"`, ibid. `:184-190`),
`type` a constant `"image"`. **The server-side `Asset` schema has no `domain` field** —
the TS type carries it because federated payloads may include it and because the client
needs *some* domain to build the download URL. When it is missing, use the owning user's
domain:

```ts
// wire-webapp/apps/webapp/src/script/repositories/assets/assetMapper.ts:30-43
const sizeMap = {complete: 'medium', preview: 'preview'};
return assets
  .filter(asset => asset.type === 'image')
  .reduce((mappedAssets, asset) => {
    const domain = asset.domain ?? userId.domain;
    …
  }, {});
```

So: `preview` = the small avatar (list rows, message bubbles), `complete` = the large
one (profile page). Anything whose `type` is not `"image"` is ignored. A user with no
picture has `assets: []`.

### 8.2 From asset key to a download

`key` is an **asset key**, format `3-<retention>-<uuid>`, e.g.
`"3-1-47de4580-ae51-4650-acbb-d10c028cb0ac"`
(`wire-server/libs/wire-api/src/Wire/API/Asset.hs:149-186`, example at `:185`).

Download (cargohold, V2+):

```
GET /assets/{domain}/{key}
```
(`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Cargohold.hs:312-330`;
client `wire-webapp/libraries/api-client/src/asset/assetApi.ts:213-231`, which builds
`/assets/${assetDomain}/${assetId}`). Local assets answer with a redirect, remote ones
are streamed through your own backend. An optional `Asset-Token` header or
`asset_token` query parameter authorises non-public assets — **profile pictures are
public assets and need no token**. The detailed asset/upload protocol is documented
elsewhere in this series.

Uploading a new avatar: `POST /assets`, then `PUT /self` with the two returned keys as
`assets` (`wire-webapp/libraries/api-client/src/asset/assetApi.ts:253-256`).

### 8.3 The legacy `picture` array

`picture` is the pre-2016 profile-picture format and is **deprecated**
(`wire-server/libs/wire-api/src/Wire/API/User.hs:656-657, 714`; the TS type is
`wire-webapp/libraries/api-client/src/self/picture.ts:20-36`, with
`content_length`, `content_type`, `data`, `id`, and an `info` object carrying
`tag: "smallProfile" | "medium"`, `width`, `height`, `original_width`,
`original_height`, `correlation_id`, `nonce`, `public`, `name`). Modern backends emit
`"picture": []`. **A new client should ignore it entirely** and send `[]` (or omit it)
when updating.

---

## 9. Presence, read receipts, client-side settings

### 9.1 Availability

Availability is **not** a REST resource. It is a `GenericMessage` with an `availability`
field, broadcast over the encrypted broadcast endpoint
(`wire-webapp/apps/webapp/src/script/repositories/conversation/MessageRepository.ts:1461-1492`):

```
POST /broadcast/proteus/messages     (federated; body = protobuf QualifiedNewOtrMessage)
POST /broadcast/otr/messages         (legacy)
```
(`wire-webapp/libraries/api-client/src/broadcast/broadcastApi.ts:30-57`.)

Recipients are chosen client-side: self, then team members, then other connected users,
sorted by user ID, capped at **500** recipients
(`MAXIMUM_TEAM_SIZE_BROADCAST`,
`wire-webapp/apps/webapp/src/script/repositories/user/userRepository.ts:110-116`;
selection at `MessageRepository.ts:1468-1483`). Federated users are deliberately
excluded: *"For the moment, we do not want to send status in federated env"*.

Values are `NONE`, `AVAILABLE`, `AWAY`, `BUSY`
(`wire-webapp/apps/webapp/src/script/repositories/user/availabilityMapper.ts:25-30`).
The numeric protobuf enum values are **UNVERIFIED** here — the
`@wireapp/protocol-messaging` package is not part of these clones.

Incoming availability is surfaced to the app as a synthetic event
`{"type": "user.availability", "from": "<uuid>", "fromDomain": "<domain>", "data": {"availability": 1}}`
(`wire-webapp/apps/webapp/src/script/repositories/user/userRepository.ts:101-106, 164-171`),
produced by the crypto layer when it decodes a `GenericMessage` with an `availability`
field (`…/repositories/cryptography/CryptographyMapper.ts:177, 462`). There is no
backend-side presence store: if you were offline when a peer broadcast, you never learn
their status.

### 9.2 Properties (`GET/PUT/DELETE /properties/:key`)

Server-side key/value store for client settings, per user, synced across your devices.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/properties` | list of key names (`string[]`) |
| `GET` | `/properties/:key` | the stored JSON value; **404 if never set** |
| `PUT` | `/properties/:key` | body is the raw JSON value |
| `DELETE` | `/properties/:key` | remove one |
| `DELETE` | `/properties` | remove all |

Routes: `wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:1495-1530`;
client `wire-webapp/libraries/api-client/src/user/userApi.ts:113-131, 246-269, 698-706`.
Changes on other devices arrive as `user.properties-set` / `user.properties-delete`
(`wire-webapp/libraries/api-client/src/event/userEvent.ts:44-45`).

Keys used by the official clients
(`wire-webapp/apps/webapp/src/script/repositories/properties/propertiesRepository.ts:48-64`):

| Key | Value | Default when absent |
|---|---|---|
| `WIRE_RECEIPT_MODE` | receipt mode (`0` = off, `1` = on) | off |
| `WIRE_TYPING_INDICATOR_MODE` | typing-indicator mode | on |
| `WIRE_MARKETING_CONSENT` | consent value | not given |
| `webapp` | one JSON blob of web-client settings | client defaults |

Note the asymmetric convention: the client **deletes** the key when the value equals the
default and **PUTs** it otherwise
(`…/propertiesRepository.ts:293-305`). So "key missing" is meaningful, and a 404 from
`GET /properties/:key` is a normal outcome, not an error (ibid. `:225-232`).

The `webapp` blob is namespaced dotted keys such as
`settings.notifications`, `settings.sound.alerts`, `settings.interface.theme`,
`settings.interface.markdown_preview`, `settings.previews.send`,
`settings.emoji.replace_inline`, `settings.privacy.telemetry_data_sharing`,
`settings.privacy.marketing_consent`, `settings.call.enable_vbr_encoding`,
`settings.call.enable_soundless_incoming_calls`,
`settings.call.enable_press_space_to_unmute`, `enable_debugging`, `version`
(`wire-webapp/apps/webapp/src/script/repositories/properties/propertiesType.ts:20-58`).
It is versioned: the blob is merged only if its `version` matches the client's
(`…/propertiesRepository.ts:284-289`). A non-web client should **not** write this key.

### 9.3 Read receipts

`WIRE_RECEIPT_MODE` above is the *user-level* preference for 1:1 conversations. Group
conversations carry their own `receipt_mode` field on the conversation object
(`wire-webapp/libraries/api-client/src/conversation/conversation.ts:104-110`). Sending
an actual read confirmation is a `GenericMessage` (`confirmation`), documented with
messaging.

---

## 10. Errors you will actually hit

Backend errors are `{"code": <http status>, "label": "<label>", "message": "…"}`.
Labels relevant to this document:

| Label | Status | Where |
|---|---|---|
| `user-not-found` | 404 | `GET /users/:domain/:id` |
| `handle-not-found` | 404 | handle lookups |
| `handle-exists` | 409 | `PUT /self/handle` |
| `invalid-handle` | 400 | `PUT /self/handle` (`<2` or `>256` chars, chars outside `a-z0-9_.-`, or blocklisted) |
| `name-managed-by-scim` | 403 | `PUT /self` on a SCIM-managed account |
| `connection-limit` | 403 | >1000 sent+accepted connections |
| `bad-conn-update` | 403 | illegal connection transition |
| `not-connected` | 403 | acting on a non-connection |
| `invalid-user` | 400 | connecting to yourself / a nonexistent user |
| `no-identity` | 403 | account has no verified email |
| `missing-legalhold-consent` | – | connect blocked by legal hold |
| `federation-denied` | – | remote backend not federating with yours |
| `federation-not-available`, `srv-record-not-found`, `federation-remote-error`, `federation-tls-error` | – | remote backend unreachable |
| `insufficient-permissions` | 403 | search restricted |
| `no-team-member`, `operation-denied` | 403 | team endpoints |
| `mls-removal-not-allowed` | – | `PUT /self/supported-protocols` dropping `mls` |
| `feature-locked` | – | `PUT /teams/:tid/features/*` while `lockStatus == "locked"` |

Sources: `wire-server/libs/wire-api/src/Wire/API/Error/Brig.hs:151-199`,
`wire-webapp/libraries/api-client/src/http/backendErrorLabel.ts:25-124`.

---

## 11. Recipe: enumerate a user's contacts

There is no single "contacts" endpoint. Build the list from three sources and merge on
`qualified_id`:

1. **Connections** — `POST /list-connections` with `{"size": 500}`, looping on
   `has_more`/`paging_state`. Keep the rows whose `status` is `accepted` for the contact
   list, and the `pending` / `sent` rows for the incoming/outgoing request UI. Each row's
   `qualified_to` is the peer and `qualified_conversation` is the Proteus 1:1
   conversation.
2. **Team members** — if `self.team` is set, page
   `GET /teams/:teamid/members?maxResults=2000&pagingState=…` until `hasMore` is false.
   Team members are reachable **without** a connection, so they belong in the contact
   list even though no `UserConnection` row exists. The official client also treats
   non-`accepted` connections *to team members* as stale ("dead connections") and hides
   them (`wire-webapp/apps/webapp/src/script/repositories/connection/connectionRepository.ts:301-333`).
3. **Profiles** — neither source returns profile data. Collect the qualified IDs from
   (1) and (2) and hydrate with `POST /list-users` `{"qualified_ids": [...]}`, chunked
   (the web client uses 50–100 per request). Watch the `failed` array for unreachable
   backends and retry those later; render them from cache meanwhile.

Then keep the list live from the notification stream: `user.connection` for connection
changes, `user.update` / `user.delete` for profile changes,
`team.member-join` / `team.member-leave` for team changes.

To open a chat with a contact, resolve the protocol as in §6.3, then use either
`connection.qualified_conversation` (Proteus) or
`GET /one2one-conversations/:domain/:id` (MLS).
