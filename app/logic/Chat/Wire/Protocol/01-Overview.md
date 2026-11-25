# Wire protocol — 01 Overview

Architecture, terminology, ID model, federation, backend discovery, API conventions.

Everything here is derived from the official sources. Citations are repo-relative paths into the
reference clones:

| Prefix | Repo |
| --- | --- |
| `wire-webapp/` | Official web client monorepo. `libraries/api-client/src/` = TypeScript REST client (authoritative for endpoint paths as used by a real client), `libraries/core/src/` = client logic, `apps/webapp/src/script/` = UI. |
| `wire-server/` | Haskell backend. `libs/wire-api/` = API types (authoritative for JSON field names), `services/*` = the individual services, `charts/nginz/` = the public routing table, `docs/src/` = prose docs. |
| `core-crypto/` | Rust MLS + Proteus implementation used by the official clients. |

Anything marked **UNVERIFIED** could not be confirmed in the sources.

---

## 1. System architecture

### 1.1 Services

Wire's backend is a set of independent Haskell services. **Clients never talk to them directly.**
A single nginx-based reverse proxy called **nginz** is the only public entry point; it validates the
auth token, applies rate limits and CORS, and routes by URL path prefix.

| Service | Responsibility | Notable public prefixes |
| --- | --- | --- |
| **brig** | Users, accounts, auth/tokens, clients (devices), Proteus prekeys, MLS key packages, connections, search, properties, providers/bots-registry, OAuth, `/api-version` | `/api-version`, `/access`, `/login`, `/register`, `/activate`, `/delete`, `/password-reset`, `/cookies`, `/self`, `/users`, `/handles`, `/list-users`, `/list-connections`, `/connections`, `/clients`, `/properties`, `/search`, `/calls`, `/invitations`, `/mls/key-packages*`, `/providers`, `/services`, `/provider/*`, `/bot/self`, `/bot/client`, `/bot/users`, `/oauth/*`, `/verification-code/send`, `/user-groups*` |
| **galley** | Conversations, messages (Proteus + MLS), teams, team features, broadcast, meetings | `/conversations*`, `/one2one-conversations/`, `/broadcast`, `/teams*`, `/feature-configs`, `/mls/welcome`, `/mls/messages`, `/mls/commit-bundles`, `/mls/reset-conversation`, `/mls/public-keys`, `/legalhold/conversations/*`, `/meetings*`, `/bot/conversation`, `/bot/messages` |
| **cargohold** | Asset (file/image) upload and download | `/assets`, `/assets/{domain}/{key}`, `/conversations/{c}/assets`, `/conversations/{c}/otr/assets`, `/bot/assets`, `/provider/assets` |
| **gundeck** | Notification queue, push tokens, presences | `/notifications`, `/push`, `/presences`, `/time` |
| **cannon** | WebSocket event delivery | `/await` (legacy), `/events` (from API v8) |
| **spar** | SAML SSO, SCIM provisioning, identity providers | `/sso*`, `/scim`, `/scim/v2`, `/identity-providers` |
| **proxy** | Credential-hiding proxy to third parties (Giphy, YouTube, Google Maps, Spotify, SoundCloud) | `/proxy/*` — **optional**, off by default |
| **federator** | Backend↔backend federation. **Not reachable through nginz**; it has its own mTLS ingress. | — |
| **background-worker**, **stern**, **ibis**, **galeb** | Internal / billing / consent. Not part of a chat client. | — |

Source for the routing table: `wire-server/charts/nginz/values.yaml` (`nginx_conf.upstreams`, lines
157–842) and `wire-server/charts/nginz/templates/conf/_nginx.conf.tpl`.

Notable routing surprises (all real, all verified):

* `/mls/key-packages*` is **brig**, but every other `/mls/*` path is **galley**
  (`wire-server/charts/nginz/values.yaml:270,284` vs `:758-772`).
* `/teams/...` is split: `/teams/{t}/invitations`, `/services`, `/size`, `/search`, `/apps`,
  `/registered-domains` → **brig**; everything else `/teams` → **galley**.
* `/bot/...` is split three ways: brig (`/bot/self`, `/bot/client`, `/bot/users`,
  `/bot/conversations/…`), galley (`/bot/conversation`, `/bot/messages`), cargohold (`/bot/assets`).
* `/calls/config/v2` (the TURN/SFT config) is served by **brig** via the `/calls` prefix
  (`wire-server/charts/nginz/values.yaml:483`).
* nginz locations are **prefix regexes** `~* ^(/v[0-9]+)?<path>`, matched in upstream-alphabetical
  order (brig, cannon, cargohold, galley, gundeck, spar), first match wins. Where brig and galley
  declare the same path, brig wins.
* A set of legacy paths is hard-404'd by nginz before any routing:
  `/conversations/last-events`, `/conversations/{c}/{knock,hot-knock,messages,client-messages,events,call,call/state}`,
  `/search/top`, `/search/common` (`wire-server/charts/nginz/values.yaml:89-99`).

### 1.2 Client-side layering (what to copy)

The official web stack is two layers, and it is a good shape to mirror:

* `wire-webapp/libraries/api-client/` — a thin, stateless-ish REST/WS transport: one `*Api.ts`
  class per domain area, plus `HttpClient` (axios + auth-token refresh + retry) and
  `WebSocketClient`.
* `wire-webapp/libraries/core/` — protocol logic on top: crypto (Proteus/MLS via core-crypto),
  session/prekey management, conversation and message services, notification-stream handling.

---

## 2. Base URLs and backend discovery

### 2.1 The two hosts

A Wire backend is addressed by **two** URLs, not one:

* `rest` — the HTTPS API base, e.g. `https://prod-nginz-https.wire.com`
* `ws` — the WebSocket base, e.g. `wss://prod-nginz-ssl.wire.com`

Hard-coded environments (`wire-webapp/libraries/api-client/src/env/backend.ts:26-40`):

```ts
const PRODUCTION: BackendData = {
  name: 'production',
  rest: 'https://prod-nginz-https.wire.com',
  ws: 'wss://prod-nginz-ssl.wire.com',
};

const STAGING: BackendData = {
  name: 'staging',
  rest: 'https://staging-nginz-https.zinfra.io',
  ws: 'wss://staging-nginz-ssl.zinfra.io',
};
```

Note that Wire's *staging* backend is on `zinfra.io`, not on `wire.com`
(`wire-webapp/.env.localhost:25-38` uses the same two pairs). The naming convention for on-prem is
`https://nginz-https.<domain>` and `https://nginz-ssl.<domain>`
(`wire-server/docs/src/understand/associate/deeplink.md:57-66`).

### 2.2 Custom backend / deeplink JSON

A user is pointed at a non-Wire backend by a **deeplink** of the form

```
wire://access/?config=https://example.com/wire.json
```

(`wire-server/docs/src/understand/associate/deeplink.md:36`,
`wire-webapp/apps/webapp/src/script/util/messageRenderer.test.ts:272`). The client fetches that URL
over HTTPS and reads the endpoint set from it. Real, complete example
(`wire-server/docs/src/understand/associate/deeplink.md:207-224`):

```json
{
   "endpoints" : {
      "backendURL" : "https://prod-nginz-https.wire.com",
      "backendWSURL" : "https://prod-nginz-ssl.wire.com",
      "blackListURL" : "https://clientblacklist.wire.com/prod",
      "teamsURL" : "https://teams.wire.com",
      "accountsURL" : "https://accounts.wire.com",
      "websiteURL" : "https://wire.com"
   },
   "apiProxy" : {
      "host" : "socks5.proxy.com",
      "port" : 1080,
      "needsAuthentication" : true
   },
   "title" : "Production"
}
```

Field semantics (`wire-server/docs/src/understand/associate/deeplink.md:57-104`,
`wire-server/charts/nginz/templates/configmap.yaml:34-52`):

| Key | Meaning |
| --- | --- |
| `endpoints.backendURL` | REST base — becomes `rest` |
| `endpoints.backendWSURL` | WebSocket base — becomes `ws`. **The docs and the Helm chart write it with an `https://` scheme**; the web client stores `wss://`. Accept both and normalise `https:`→`wss:`. |
| `endpoints.teamsURL` | Team-settings web app |
| `endpoints.accountsURL` | Account-pages web app |
| `endpoints.blackListURL` | Prefix; client appends `/ios` or `/android` to check whether its own version is blacklisted |
| `endpoints.websiteURL` | Base for in-app FAQ/help links |
| `title` | Human-readable backend name, shown in a "custom backend" pill |
| `supportEmail` | Optional; omitted entirely when unset |
| `apiProxy.{host,port,needsAuthentication}` | Optional SOCKS5 proxy for all API calls |

The doc states clients require **all** `endpoints` keys to be present. There is **no
`webSocketURL` key** anywhere in wire-server or wire-webapp — the WebSocket key is
`backendWSURL`. The TypeScript mirror of this object is
`wire-webapp/libraries/api-client/src/account/backendConfigData.ts:20-29` (`BackendConfigData`),
which also lists `websiteURL` and `title` but not `supportEmail`/`apiProxy`.

Where an operator hosts it: nginz serves `/deeplink.json` and `/deeplink.html` from the backend
domain when `nginx_conf.deeplink` is configured
(`wire-server/docs/src/understand/associate/deeplink.md:129-132`).

### 2.3 Runtime discovery endpoints

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/api-version` | GET | none | Version + federation + own domain (§4) |
| `/config.json` | GET | none | Same `BackendConfigData` shape, served next to the web app (`wire-webapp/libraries/api-client/src/account/accountApi.ts:37,216-224`) |
| `/custom-backend/by-domain/{domain}` | GET | none | Given an email domain, returns `{"config_json_url": …, "webapp_welcome_url": …}` (`wire-webapp/libraries/api-client/src/account/domainData.ts:20-25`; galley, `wire-server/charts/nginz/values.yaml:714`). 404 label `custom-backend-not-found`. |
| `/get-domain-registration` | POST `{"email": …}` | none | Enterprise-login v2 redirect. Response is a tagged union on `domain_redirect` ∈ `none`, `locked`, `sso`, `backend`, `no-registration`, `pre-authorized`; for `backend` it carries `{"backend": {"config_url": …, "webapp_url": …}}` (`wire-webapp/libraries/api-client/src/account/domainRedirect.ts:22-70`) |

---

## 3. Domain objects and vocabulary

Wire's vocabulary does not map 1:1 onto a generic chat app. Exact meanings:

| Wire term | Definition | Chat-app equivalent |
| --- | --- | --- |
| **user** | An account. Has a UUID, a `name` (display name), an optional unique `handle` (@-name), `assets` (avatar), `accent_id`, optional `team`, optional `service` ref if it is a bot. `wire-webapp/libraries/api-client/src/user/user.ts:36-54` | Person / contact |
| **client** | A **device**, i.e. one installation with its own key material. Every user has 1..n clients. Messages are encrypted per-client, not per-user. Fields: `id`, `class` (`desktop`/`phone`/`tablet`/`legalhold`/`?`), `type` (`permanent`/`temporary`), `label`, `model`, `time`, `capabilities`, `mls_public_keys`, `cookie`. `wire-webapp/libraries/api-client/src/client/registeredClient.ts:22-39`, `clientClassification.ts:20-26`, `clientType.ts:20-25` | Device / session |
| **conversation** | Any message container. `type` is an integer: `0` REGULAR (group), `1` SELF (notes-to-self), `2` ONE_TO_ONE, `3` CONNECT (a pending connection request's conversation), `4` GLOBAL_TEAM. `wire-webapp/libraries/api-client/src/conversation/conversation.ts:28-34` | Room / chat |
| **channel / group / meeting** | Sub-flavours of a group conversation, carried in `group_conv_type` ∈ `channel`, `group_conversation`, `meeting` (`conversation.ts:57-61`) | Public channel vs private group |
| **team** | An organisation. Owns members, conversations, feature flags, billing. `{id, name, creator, icon, icon_key, splash_screen, currency}` (`wire-webapp/libraries/api-client/src/team/team/teamData.ts:22-36`) | Workspace / org |
| **connection** | The pairwise relationship between two non-team users. It **gates 1:1 messaging**: you must be `accepted` before you can message. `status` ∈ `pending`, `sent`, `accepted`, `blocked`, `ignored`, `cancelled`, `missing-legalhold-consent`, `unknown` (`wire-webapp/libraries/api-client/src/connection/connectionStatus.ts:20-29`). Payload `{conversation, qualified_conversation, from, to, qualified_to, status, last_update, message}` (`connection.ts:23-31`) | Friend request |
| **asset** | An uploaded blob (image, file, avatar, team icon). Referenced by key + domain + an access token; encrypted client-side for conversation content | Attachment |
| **service** / **bot** | A **service** is a bot definition registered by a **provider** (`{id, provider}` — `wire-webapp/libraries/api-client/src/conversation/serviceRef.ts:20-23`). Adding a service to a conversation creates a **bot**, which is a user with `type: "bot"` and its own token type | Integration / app user |
| **provider** | A third party who registers services. Has its own account type and token type | App developer account |

`User.type` ∈ `regular`, `app`, `bot` (`wire-webapp/libraries/api-client/src/user/user.ts:30-34`).
Conversation transport protocol: `CONVERSATION_PROTOCOL` ∈ `proteus`, `mls`, `mixed`
(`wire-webapp/libraries/api-client/src/team/feature/featureList.types.ts:122-126`).

**Mapping to a chat app:** a *room* is a Wire conversation; a *contact* is a Wire user, but the
addressable crypto endpoint is a *client*, so the sending path is
`room → members (users) → clients → per-client ciphertext`. There is no Wire concept equivalent to
a "message ID" assigned by the server for Proteus: message identity lives inside the encrypted
payload.

---

## 4. The ID model

### 4.1 Unqualified IDs

* **user ID**, **conversation ID**, **team ID**, **asset ID**, **provider ID**, **service ID**,
  **invitation ID** are all **UUIDs** rendered lowercase with hyphens
  (`wire-server/libs/types-common/src/Data/Id.hs:26-46`, the tagged `Id` newtype). The webapp types
  them as `type UUID = string` (`wire-webapp/libraries/api-client/src/conversation/conversation.ts:74`).
  Version 4 in practice (`randomId = Id <$> nextRandom`), but treat them as opaque strings.
* **client ID** is **a `Word64` rendered as hexadecimal**, *not* a UUID:

  ```haskell
  newtype ClientId = ClientId { clientToWord64 :: Word64 }
  clientToText = toStrict . toLazyText . hexadecimal . clientToWord64
  ```
  `wire-server/libs/types-common/src/Data/Id.hs:358-373`. The schema documentation is explicit:

  > "A 64-bit unsigned integer, represented as a hexadecimal numeral. Any valid hexadecimal numeral
  > is accepted, but the backend will only produce representations with **lowercase digits and no
  > leading zeros**"

  **So a client ID is 1–16 hex characters, not always 16.** Parsing must be
  case-insensitive hex with a `<= 2^64-1` bound (`Id.hs:387-394`); comparison must be on the numeric
  value or on the canonical (lowercase, unpadded) text — never on a zero-padded string.
* **connection ID** (`ConnId`) is an opaque short byte string, *not* a UUID. It identifies a
  client's *session*, and appears only as the `Z-Connection` header (§7.3).

### 4.2 Qualified IDs

Federation makes every user/conversation/asset ID meaningful only together with a **domain**.
The wire format is a two-field object:

```json
{ "id": "39b7f597-dfd1-4dff-86f5-fe1b79cb70a0", "domain": "wire.com" }
```

`wire-server/libs/types-common/src/Data/Qualified.hs:205-211` (`qualifiedObjectSchema` emits the
value under `"id"` and the domain under `"domain"`);
`wire-webapp/libraries/api-client/src/user/qualifiedId.ts:19-22`:

```ts
export interface QualifiedId {
  domain: string;
  id: string;
}
```

A **domain** is a lower-cased FQDN, ≥ 2 labels (except the literal `localhost`), each label ≤ 63
chars, whole domain ≤ 253 chars, last label must not start with a digit
(`wire-server/libs/types-common/src/Data/Domain.hs:46-64,98-120`). It is *not* necessarily the
hostname of the API — it is a separate, immutable per-backend identifier configured as
`federationDomain` in brig, cargohold and galley
(`wire-server/docs/src/developer/reference/config-options.md:590-625`).

Two shapes of qualified maps appear repeatedly:

```jsonc
// QualifiedUserClients — domain → user → client ids
{ "example.com": { "39b7f597-dfd1-4dff-86f5-fe1b79cb70a0": ["deadbeef", "a1b2c3d4"] } }
```
`wire-webapp/libraries/api-client/src/conversation/qualifiedUserClients.ts:22-24`;
`wire-server/libs/wire-api/src/Wire/API/User/Client.hs:467-489`.

### 4.3 Qualified vs unqualified coexistence

Both forms exist in the API and the choice is version-dependent. Rules:

* Objects carry **both**: `User` has `id` *and* `qualified_id`
  (`wire-webapp/libraries/api-client/src/user/user.ts:44,48`), `Connection` has `conversation`/`to`
  *and* `qualified_conversation`/`qualified_to` (`connection.ts:23-30`). Always prefer the
  qualified field and fall back only if absent.
* Paths gained a domain segment: `GET /users/{id}` → `GET /users/{domain}/{id}`. The client picks
  by whether it has a domain:

  ```ts
  const url = typeof userId === 'string'
    ? `/${UserAPI.URL.USERS}/${userId}`
    : `/${UserAPI.URL.USERS}/${userId.domain}/${userId.id}`;
  ```
  `wire-webapp/libraries/api-client/src/user/userApi.ts:324-329`; same pattern for conversations in
  `conversation/conversationApi/conversationApi.ts:130-134`.
* Some endpoints simply moved between versions. The client keeps a small breakpoint table
  (`conversationApi.ts:84-89` and `userApi.ts:69-74`, identical):

  ```ts
  const apiBreakpoint = {
    version2: 2,
    // API V7 and up introduce new endpoints to conversations and users
    version7: 7,
    version8: 8,
  };
  ```
  e.g. handle checks moved `/users/handles` → `/handles` at v7 (`userApi.ts:500-528`), and
  `POST /users/list-clients/v2` became `POST /users/list-clients` at v2 (`userApi.ts:611-620`).
* Assets: the unqualified path `/assets/v3/...` exists only **until** v2; from v2 the path is
  `/assets` / `/assets/{domain}/{key}`
  (`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Cargohold.hs:59-61`).

### 4.4 MLS client identity

MLS credentials use a single flat string built from the three IDs:

```
<userId>:<clientId>@<domain>            // e.g. 39b7f597-…-70a0:deadbeef@wire.com
```

`wire-webapp/libraries/core/src/util/fullyQualifiedClientIdUtils.ts:25-32`.

---

## 5. API versioning

### 5.1 Discovery

`GET /api-version` — unauthenticated, unversioned, unrate-limited
(`wire-server/charts/nginz/values.yaml:200-204`). Served by brig
(`wire-server/services/brig/src/Brig/Version.hs:28-42`), route defined at
`wire-server/libs/wire-api/src/Wire/API/Routes/Version.hs:263-268`.

Response object, exact field names from
`wire-server/libs/wire-api/src/Wire/API/Routes/Version.hs:236-256` and
`wire-server/libs/wire-api/src/Wire/API/VersionInfo.hs:52-53`:

```json
{
  "supported": [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],
  "development": [],
  "federation": true,
  "domain": "wire.com"
}
```

* `supported` — array of **integers** (`VersionNumber` serialises to `<n>`, whereas `Version`
  serialises to `"v<n>"` — `Version.hs:186,212-214`).
* `development` — array of integers. **Disjoint from `supported`.**
* `federation` — `true` iff a federator is configured on this backend.
* `domain` — this backend's federation domain.

Current version universe: `V0 … V17`
(`wire-server/libs/wire-api/src/Wire/API/Routes/Version.hs:106`), with `V17` the only development
version (`Version.hs:276-297`). The shipped Helm default disables development versions
(`disabledAPIVersions: [development]`, `wire-server/charts/wire-server/values.yaml:115`), so a
default production deployment answers `"supported": [0..16], "development": []`.

> **Contradiction with the prose docs.** `wire-server/docs/src/developer/developer/api-versioning.md:19-26`
> shows `{"supported":[0,1,2,3,4],"development":[4]}` and says "Stable versions are all supported
> versions that are not development", i.e. development ⊂ supported. The **implementation does the
> opposite**: `supported = allVersions \ devVersions`
> (`wire-server/services/brig/src/Brig/Version.hs:33-35`), and an integration test asserts the two
> lists are disjoint (`wire-server/integration/test/Test/Version.hs:69-70`). Trust the code: to use
> a development version you must merge both arrays yourself.

### 5.2 Choosing a version

Recommended flow (`wire-server/docs/src/developer/developer/api-versioning.md:213-224`) and what
the official client does (`wire-webapp/libraries/api-client/src/apiClient.ts:309-345`):

1. `GET /api-version`.
2. `available = allowDev ? supported ∪ development : supported`.
3. Pick the **numerically highest** element of `available` within your own `[min, max]` range.
4. If none: hard error ("No compatible API version in range…").

```ts
const {supported, development = [], domain, federation} = response.data;
const availableVersions = allowDev ? [...supported, ...development] : supported;
const compatibleVersion = this.findHighestCompatibleVersion(availableVersions, min, max);
```

The webapp's range is `[MINIMUM_API_VERSION, MAX_API_VERSION]` =
`[1, 17]` — `MINIMUM_API_VERSION = 1` (`wire-webapp/libraries/api-client/src/config.ts:27`),
`MAX_API_VERSION: Number(env.MAX_API_VERSION) || 17`
(`wire-webapp/libraries/config/src/client.config.ts:47`),
combined in `wire-webapp/apps/webapp/src/script/Config.ts:93`. With `ENABLE_DEV_BACKEND_API` unset
it ignores `development`, so **against today's wire-server the current webapp negotiates v16**.

> The `useVersion` doc-comment claims "a hard minimum of version 8 enforced"
> (`wire-webapp/libraries/api-client/src/apiClient.ts:300-308`) but the code checks against
> `MINIMUM_API_VERSION`, which is `1`. The comment is stale.

The webapp re-runs the negotiation once a day and on window focus
(`wire-webapp/apps/webapp/src/script/lifecycle/updateRemoteConfigs.ts:39-60`).

### 5.3 Putting the version in the path

A negotiated version `N` is applied as a path prefix `/vN`:

```ts
public useVersion(version: number): void {
  this.versionPrefix = version > 0 ? `/v${version}` : '';
}
```
`wire-webapp/libraries/api-client/src/http/httpClient.ts:179-181`; the same is done for the
WebSocket base (`tcp/webSocketClient.ts:113-117`).

So `/conversations` at v5 is `GET /v5/conversations`.

Two endpoints are **unversioned** and must not be prefixed
(`wire-server/docs/src/developer/developer/api-versioning.md:62-71`):

* `/api-version` itself,
* `/access` — so that the auth cookie's `Path` stays stable across version upgrades.

The web client special-cases exactly `/access`:

```ts
url: config.url !== undefined && config.url.startsWith(AuthAPI.URL.ACCESS)
  ? config.url
  : `${this.versionPrefix}${config.url}`,
```
`wire-webapp/libraries/api-client/src/http/httpClient.ts:241-244`.

Backends that still support v0 also accept unversioned paths and rewrite them to `/v0/`.
Requesting a version the backend does not support yields **404** with
`{"code":404,"label":"unsupported-version","message":"Version vN is not supported"}`
(`wire-server/libs/wire-api/src/Wire/API/Routes/Version/Wai.hs:47-48`).

### 5.4 Feature gates derived from the version

`wire-webapp/libraries/api-client/src/apiClient.ts:288-296`:

| Capability | Condition |
| --- | --- |
| `federationEndpoints` (qualified paths available) | `version > 0` |
| `supportsGuestLinksWithPassword` | `version >= 4` |
| `supportsMLS` | `version >= 5` **and** `GET /mls/public-keys` returns a `removal` key (`apiClient.ts:479-497`) |
| `isFederated` | from the `federation` field of `/api-version` |
| team creation from the client | `version >= 7` (`wire-webapp/apps/webapp/src/script/Config.ts:84`) |
| enterprise-login v2 + channels | `version >= 8` (`Config.ts:87`) |
| async notification WebSocket `/events` | `version >= 8` (`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Cannon.hs:44-46`) |

---

## 6. Federation — what a client must know

The backend-to-backend protocol is out of scope for a client. What matters:

1. **Every backend has a domain.** Discover your own from `/api-version`'s `domain` field, and/or
   from `GET /self` → `qualified_id.domain` (the official client does the latter,
   `wire-webapp/libraries/api-client/src/apiClient.ts:424-431`). Store it; you need it to
   qualify locally-created IDs and to decide "local vs remote".
2. **Use qualified endpoints and qualified IDs everywhere.** A federated conversation can contain
   users whose UUIDs collide with local ones; only `{id, domain}` is unique.
3. **Partial failure is normal.** Federated list endpoints return three buckets instead of failing:

   ```jsonc
   // GET /conversations/list (RemoteConversations)
   { "found": [ /* Conversation */ ], "not_found": [ /* QualifiedId */ ], "failed": [ /* QualifiedId */ ] }
   ```
   `wire-webapp/libraries/api-client/src/conversation/remoteConversations.ts:24-28`; user lists use
   `found` / `failed` / `not_found` (`wire-webapp/libraries/api-client/src/user/userApi.ts:54-63`).
   `failed` means "that backend was unreachable", not "does not exist" — retry later, do not delete
   local state.
4. **Two dedicated failure statuses** the client must special-case
   (`wire-webapp/libraries/api-client/src/conversation/federatedBackendsError.ts:23-32,51-66`):

   | HTTP | Body | Meaning |
   | --- | --- | --- |
   | **533** | `{"unreachable_backends": ["b.example.com", …]}` | One or more remote backends are down. Body has **no `code`/`label`/`message`** (`wire-server/libs/wire-api/src/Wire/API/Error/Galley.hs:619-644`). |
   | **409** | `{"non_federating_backends": ["a.example.com", "b.example.com"]}` | The two users' backends do not federate with each other. Exactly two entries. (`Error/Galley.hs:566-596`) |

   533 is a non-standard status (`HTTP.Status 533 "Unreachable backends"` /
   `"Unexpected Federation Response"`). Other federation statuses in use: **521**
   ("Remote Federator Connection Refused") and **525** ("SSL Handshake Failure")
   (`wire-server/libs/wire-api-federation/src/Wire/API/Federation/Error.hs:235-244,324-328`).
5. **Message sending reports per-client outcomes.** `POST .../proteus/messages` returns
   `MessageSendingStatus` on both `201` and `412`:

   ```json
   { "time": "2024-01-01T00:00:00.000Z",
     "missing": {}, "redundant": {}, "deleted": {},
     "failed_to_send": {}, "failed_to_confirm_clients": {} }
   ```
   All five maps are `QualifiedUserClients`.
   `wire-server/libs/wire-api/src/Wire/API/Message.hs:497-545`;
   `wire-webapp/libraries/api-client/src/conversation/messageSendingStatus.ts:22-29`.
   `failed_to_send` is the federation-specific bucket: the message reached some clients but a remote
   backend could not be reached for others.
6. **Search takes an optional domain.** `GET /search/contacts?q=…&domain=…`
   (`wire-webapp/libraries/api-client/src/user/userApi.ts:278-290`).
7. Federation can be **disabled per protocol** on a backend (`federationProtocols: ["mls"]`), and a
   backend can run an allow-list of partner domains
   (`wire-server/docs/src/developer/reference/config-options.md:629-690`). A client sees this as
   `federation-denied` / `federation-disabled-for-protocol` errors.

---

## 7. HTTP conventions

### 7.1 Content types

Request `Content-Type` values the official client sends
(`wire-webapp/libraries/api-client/src/http/contentType.ts:20-25`):

```ts
export enum ContentType {
  APPLICATION_JSON = 'application/json;charset=UTF-8',
  APPLICATION_PROTOBUF = 'application/x-protobuf',
  APPLICATION_XML = 'application/xml',
  MESSAGES_MLS = 'message/mls',
}
```

`message/mls` is used for MLS commit bundles / welcome messages
(`wire-webapp/libraries/api-client/src/http/httpClient.ts:460-469`); `application/x-protobuf` for
Proteus OTR message envelopes; `application/xml` for SAML/SCIM metadata.

The **backend** responds with bare `application/json` — no charset parameter
(`wire-server/libs/wai-utilities/src/Network/Wai/Utilities/Response.hs:42-43`). Do not string-match
on the full header.

Request bodies are **gzipped** by the official client when the method is POST/PUT/PATCH: it sets
`Content-Encoding: gzip` and sends a pako-gzipped JSON body
(`wire-webapp/libraries/api-client/src/http/httpClient.ts:421-436`). This is optional; plain JSON
works. Note nginz will answer `400 client-error "Invalid request body compression"` for a corrupt
gzip body (`wire-server/libs/wai-utilities/src/Network/Wai/Utilities/Server.hs:222`).

Body-size limits: nginz default `client_max_body_size 512k`, raised to `40m` for OTR/proteus message
and broadcast endpoints, `70m` for `/mls/commit-bundles`, `5m` for `/onboarding`, and unlimited
(`"0"`) for all cargohold asset routes
(`wire-server/charts/nginz/values.yaml:101-104,157-189,618-647,764-768`). The client additionally
caps itself at `FILE_SIZE_100_MB = 104857600`
(`wire-webapp/libraries/api-client/src/http/httpClient.ts:83,245-246`).

### 7.2 Authentication header

Every authenticated request carries:

```
Authorization: Bearer <access_token>
```

built from the stored token object (`wire-webapp/libraries/api-client/src/http/httpClient.ts:225-232`):

```ts
const {token_type, access_token} = this.accessTokenStore.accessTokenData;
config.headers = {...config.headers, Authorization: `${token_type} ${access_token}`};
```

`token_type` is always the literal string `"Bearer"`
(`wire-webapp/libraries/api-client/src/auth/accessTokenData.ts:20-27`).

The token is a **zauth token**, not a JWT. Its wire format is
`<base64url-signature>.v=1.k=<keyIdx>.d=<expiryUnixSeconds>.t=<type>.l=<tag>.<body fields>`
(`wire-server/libs/zauth/src/Data/ZAuth/Token.hs:245-300`). Real example from the client's own test
(`wire-webapp/libraries/api-client/src/auth/parseAccessToken.test.ts:22-23`):

```
ABC==.v=1.k=1.d=1618838628.t=a.l=.u=39b7f597-dfd1-4dff-86f5-fe1b79cb70a0.c=4720693440453917158
```

Field keys (`Token.hs:128-155,262-283`; `wire-server/libs/libzauth/libzauth/src/zauth.rs:73-84`):

| Key | Meaning |
| --- | --- |
| `v` | token format version, currently `1` |
| `k` | signing-key index |
| `d` | expiry, Unix seconds |
| `t` | token type: `a` access, `u` user (cookie), `b` bot, `p` provider, `la`/`lu` legal-hold |
| `l` | tag; `s` = session token (non-refreshable), empty otherwise |
| `u` | user UUID |
| `i` | **client ID** (hex), optional |
| `c` | on an access token: the **connection ID** (u64, decimal). On a bot token: conversation UUID. |
| `r` | on a user/cookie token: random |

> **Gotcha.** `wire-webapp/libraries/api-client/src/auth/parseAccessToken.ts:61` reads
> `clientId: parseValue(accessToken, 'c')` — that is the **connection**, not the client. The client
> ID lives under `i`. Don't copy that mapping.

Token lifetime is short; `expires_in` is in **seconds**
(`wire-webapp/libraries/api-client/src/auth/accessTokenData.ts:24`). Refresh is
`POST /access` with `withCredentials: true` (the `zuid` cookie) and the *expired* access token still
in the `Authorization` header (`wire-webapp/libraries/api-client/src/http/httpClient.ts:326-341,343-370`).
On `401` the client refreshes once and retries the original request
(`httpClient.ts:264-266,273-277`).

WebSocket auth is **not** a header — the token goes in the query string:

```
wss://prod-nginz-ssl.wire.com/v5/events?access_token=<token>&client=<clientId>[&sync_marker=<marker>]
wss://prod-nginz-ssl.wire.com/await?access_token=<token>&client=<clientId>      # legacy
```
`wire-webapp/libraries/api-client/src/tcp/webSocketClient.ts:388-420`. Omitting `client` subscribes
to *all* of the user's clients' notifications.

### 7.3 `Z-*` headers — do not send them

`Z-User`, `Z-Client`, `Z-Connection`, `Z-Type`, `Z-Provider`, `Z-Bot`, `Z-Conversation`,
`Z-Timestamp`, `Z-Host`, `Request-Id` are **injected by nginz** after it validates the token, and
they are the only thing the Haskell services trust
(`wire-server/charts/nginz/templates/conf/_nginx.conf.tpl:339-352`):

```nginx
proxy_set_header   Authorization  "";     # on zauth-protected locations
proxy_set_header   Z-Type         $zauth_type;
proxy_set_header   Z-User         $zauth_user;
proxy_set_header   Z-Client       $zauth_client;
proxy_set_header   Z-Connection   $zauth_connection;
proxy_set_header   Z-Provider     $zauth_provider;
proxy_set_header   Z-Bot          $zauth_bot;
proxy_set_header   Z-Conversation $zauth_conversation;
proxy_set_header   Z-Timestamp    $zauth_timestamp;
proxy_set_header   Request-Id     $request_id;
proxy_set_header   Z-Host         $host;
```

Because each name appears in a `proxy_set_header`, **anything the client sends under those names is
discarded**. There is nothing to spoof and nothing to set. The official web client sends none of
them (grep confirms zero occurrences in `wire-webapp/`). Server-side header names are declared at
`wire-server/libs/wire-api/src/Wire/API/Routes/Public.hs:120,129,138,147,157,166,176,186`;
`Z-Type` values are `bot`, `access`, `user`, `legal_hold_access`, `legal_hold_user`, `provider`,
`unknown`.

The token type also gates which paths a token may reach, via nginz's ACL
(`wire-server/charts/nginz/static/conf/zauth.acl`): an ordinary access token (`a`) is blacklisted
from `/provider*`, `/bot/*` and `/i/*`; bot tokens (`b`) may reach only `/bot/*`; provider tokens
(`p`) only `/provider/*`. A valid token on a forbidden path gives **403**; a missing/expired/bad
token gives **401**.

### 7.4 Headers the client *does* set

There is no meaningful `User-Agent` control from a browser, so the web client identifies itself with
two custom headers passed as `Config.headers` into every request
(`wire-webapp/apps/webapp/src/script/service/apiClientSingleton.ts:28-30,49-53`):

```ts
const wireClientHeaderName = 'Wire-Client';
const wireClientVersionHeaderName = 'Wire-Client-Version';
const wireClientIdentifier = 'Web';
…
headers: {
  [wireClientHeaderName]: wireClientIdentifier,
  [wireClientVersionHeaderName]: webAppConfiguration.VERSION,
},
```

They are attached by the axios instance (`wire-webapp/libraries/api-client/src/http/httpClient.ts:112-115`).
**These are where our own product name goes.**

### 7.5 Error responses

The canonical body is exactly three keys
(`wire-server/libs/wai-utilities/src/Network/Wai/Utilities/Error.hs:74-85`):

```json
{ "code": 403, "label": "invalid-credentials", "message": "Authentication failed." }
```

* `code` is the numeric HTTP status, duplicated in the body.
* `label` is the stable machine-readable identifier — **switch on this, never on `message`**
  (except for the handful of legacy cases below).
* `message` is human text and *not* stable. On **every 500 the backend overwrites it** with the
  literal `"Internal Server Error"` (`.../JSONResponse.hs:55-63`).

Two optional extra keys exist:

* `"data": {"type":"federation","domain":"…","path":"…"}` on federation errors
  (`Error.hs:54-66`).
* `"inner": { …recursive error… }` when a remote federator's own error is wrapped
  (`wire-server/libs/wire-api-federation/src/Wire/API/Federation/Error.hs:270-294`).

Additional **top-level** keys can appear when the backend uses `RichError`, which shallow-merges an
arbitrary object into the body (`wire-server/libs/wire-subsystems/src/Wire/Error.hs:70-73`). A
tolerant parser is required.

The client's own test for "is this a Wire error" is the presence of all three keys
(`wire-webapp/libraries/api-client/src/http/httpClient.ts:305-312`).

Common `label` values a chat client will actually hit
(`wire-webapp/libraries/api-client/src/http/backendErrorLabel.ts:24-134`):

| Area | Labels |
| --- | --- |
| Generic | `bad-request`, `client-error`, `server-error`, `internal-error`, `not-found`, `unauthorized`, `access-denied`, `invalid-payload`, `invalid-op`, `operation-denied`, `insufficient-permissions`, `queue-full` |
| Auth | `invalid-credentials`, `invalid-code`, `missing-auth`, `pending-activation`, `pending-login`, `suspended`, `password-exists`, `key-exists`, `blacklisted-email`, `code-authentication-required`, `code-authentication-failed`, `password-authentication-failed` |
| Clients | `too-many-clients`, `unknown-client`, `client-feature-cannot-be-removed` |
| Conversations | `no-conversation`, `no-conversation-code`, `not-connected`, `too-many-members`, `invalid-conversation-password`, `mls-stale-message`, `mls-group-out-of-sync`, `mls-invalid-leaf-node-signature`, `mls-invalid-leaf-node-index` |
| Handles | `handle-exists`, `invalid-handle` |
| Teams | `no-team`, `no-team-member`, `too-many-team-members`, `email-exists`, `invalid-team-status-update` |
| Federation | `federation-denied`, `federation-not-available`, `srv-record-not-found`, `federation-remote-error`, `federation-tls-error`, `federation-connection-refused`, `federation-disabled-for-protocol`, `federation-not-enabled` |
| Features / legal hold | `feature-locked`, `missing-legalhold-consent`, `legalhold-unavailable` |
| Rate limits | `too-many-requests`, `rate-limit-exceeded` |
| Versioning | `unsupported-version` |
| Custom backend | `custom-backend-not-found` |

Three bodies that break the three-key contract and must be matched by status first:

| Status | Body | Where |
| --- | --- | --- |
| 533 | `{"unreachable_backends":[…]}` | `wire-server/libs/wire-api/src/Wire/API/Error/Galley.hs:619-644` |
| 409 | `{"non_federating_backends":[d,d]}` | `Error/Galley.hs:566-596` |
| 409 | `{"missing_users":[…],"label":"mls-group-out-of-sync","message":"Group is out of sync","code":409}` | `Error/Galley.hs:749-776` |

Two legacy cases where the label is generic and only the **status** disambiguates
(`wire-server/services/brig/src/Brig/API/Error.hs:252-257`):

```haskell
loginsTooFrequent   = Wai.mkError status429 "client-error" "Logins too frequent"
tooManyFailedLogins = Wai.mkError status403 "client-error" "Too many failed logins"
```

### 7.6 Rate limiting and retries

Two independent layers:

**nginz (edge).** Default budgets (`wire-server/charts/nginz/values.yaml:104-121`,
`templates/conf/_nginx.conf.tpl:169-185,280-309`):

* authenticated locations: `30r/s` per user, burst 20; plus 75 concurrent connections per user;
* unauthenticated locations: `15r/m` per (IP, path), burst 10; plus 20 concurrent connections;
* per-endpoint zones, e.g. `/mls/key-packages/claim` = `3000r/m` per user and `100r/m` per
  (user, target), SSO `50r/s` per IP, `/sso/get-by-email` `5r/m`;
* exempt (no limit at all): `/api-version`, `/access`, `/assets/(.*)`, `/one2one-conversations/`.

On throttle nginz returns **HTTP 420**, not 429:

```yaml
# The status code that is returned on throttling.
# 420 is the legacy status code and should be changed to 429 once all client support this
rate_limit_status: 420
```

and it sends **no `Retry-After`** and **no JSON body**. A client must treat a bare 420 as
"back off" on its own.

**Application (behind nginz).** brig/galley/spar return **429** with the normal error body and
*do* set `Retry-After`, in **integer seconds**
(`wire-server/libs/wire-subsystems/src/Wire/RateLimit.hs:61-66`):

```haskell
rateLimitExceededToHttpError (RateLimitExceeded micros) =
  RichError (errorToWai @E.RateLimitExceeded) () [("Retry-After", toByteString' (micros `div` 1_000_000))]
```

Labels: `too-many-requests` (brig/galley, `Error/Brig.hs:348`, `Error/Galley.hs:466`),
`rate-limit-exceeded` (spar, `services/spar/src/Spar/Error.hs:171`), `client-error` for the login
throttle. Also emitted with `Retry-After`: `VerificationCodeThrottled` (429),
`PasswordResetInProgress` (409 `code-exists`), `LoginBlocked` (**403** `client-error`).

**The official web client ignores `Retry-After` entirely** (zero occurrences in `wire-webapp/`) and
uses its own doubling backoff
(`wire-webapp/libraries/api-client/src/http/incrementalRetryBackoff.ts:34-40,66-80`): retry on
**420, 429, and 5xx except 503**; delay starts at 100 ms, doubles, caps at 600 000 ms. Our client
should honour `Retry-After` when present and fall back to that policy otherwise.

Separately, `axios-retry` is configured to retry indefinitely on network errors and on 401/403
(where the token refresh kicks in) — `wire-webapp/libraries/api-client/src/http/httpClient.ts:116-146`.

### 7.7 CORS and other response headers

nginz answers `OPTIONS` itself with 204 and never forwards it. On every response it sets
`Access-Control-Allow-Origin` (from an allow-list), `Access-Control-Expose-Headers: Request-Id,
Location, Replay-Nonce`, `Request-Id`, and HSTS
(`wire-server/charts/nginz/templates/conf/_nginx.conf.tpl:312-362`). `Request-Id` is worth logging:
it is the correlation ID in the backend's own access log.

nginz also returns a blanket **403 for any request whose `User-Agent` matches `Franz`**
(`_nginx.conf.tpl:237-240`) — avoid that substring.

---

## 8. Client identification strings (what we replace)

| What | Value in the official clients | Source |
| --- | --- | --- |
| HTTP header `Wire-Client` | `Web` | `wire-webapp/apps/webapp/src/script/service/apiClientSingleton.ts:30,51` |
| HTTP header `Wire-Client-Version` | the web app's build version | `apiClientSingleton.ts:29,52` |
| Device `model` (web) | capitalised browser name, e.g. `Chrome`; `+ " (Temporary)"` for temporary clients; `+ " (Staging)"` / `" (Edge)"` on non-prod | `wire-webapp/apps/webapp/src/script/auth/module/action/clientAction.ts:98-120` |
| Device `model` (desktop) | `Wire macOS` / `Wire Windows` / `Wire Linux` | `clientAction.ts:107-114` |
| Device `label` | `<OS name> <OS version>` | `clientAction.ts:98` |
| Device `class` | `desktop` for web/desktop | `clientAction.ts:122` |
| Device `model` (headless `@wireapp/core` SDK) | `@wireapp/core` | `wire-webapp/libraries/core/src/account.ts:138-142` |
| Desktop `User-Agent` suffix | `Wire/<version>` or `WireInternal/<version>` appended to the Electron UA | inferred from the parser `/Wire(?:Internal)?\/(\S+)/i` at `wire-webapp/apps/webapp/src/script/util/environment.ts:42-46` and `Runtime.isDesktopApp()` = Electron + UA contains `wire` (`wire-webapp/libraries/commons/src/util/Runtime.ts:243-245`) |
| Mobile (iOS/Android) `User-Agent` | **UNVERIFIED** — those clients are not in the reference clones |

`model` and `label` are user-visible in the "Devices" list of every other participant, so they are a
product decision, not a protocol one. There is no server-side allow-list of `model` values.

Registration payload for a device (`wire-webapp/libraries/api-client/src/client/newClient.ts:39-51`):

```json
{
  "class": "desktop",
  "type": "permanent",
  "cookie": "<cookie label>",
  "label": "Linux 6.1",
  "model": "OurProduct Linux",
  "lastkey": { "id": 65535, "key": "…" },
  "prekeys": [ { "id": 0, "key": "…" }, … ],
  "capabilities": ["legalhold-implicit-consent"],
  "password": "…",
  "verification_code": "…"
}
```

---

## 9. Implementation checklist

1. Resolve `rest` + `ws` — from a built-in constant, a `wire://access/?config=…` deeplink JSON, or
   `/config.json`. Normalise `backendWSURL` to `wss:`.
2. `GET /api-version` (no prefix, no auth) → pick the highest version in your range from
   `supported` (merge `development` only if explicitly opted in). Remember `domain` and `federation`.
3. Set `versionPrefix = "/v" + N` for everything except `/api-version` and `/access`.
4. Authenticate → store `{access_token, expires_in, token_type: "Bearer", user}` plus the `zuid`
   cookie. Send `Authorization: Bearer <token>`; refresh via `POST /access` on 401 or before expiry.
5. Register a client (device) → you now have a hex client ID; put it in the WebSocket `client=`
   query param.
6. Connect the WebSocket (`/vN/events?...` from v8, `/await?...` otherwise) and drain
   `GET /notifications` for anything missed.
7. Use qualified IDs (`{id, domain}`) and qualified paths (`/users/{domain}/{id}`,
   `/conversations/{domain}/{id}`) throughout; keep the unqualified fallbacks only for pre-v1
   backends.
8. Parse errors as `{code, label, message}` with `data`/`inner`/extra keys tolerated; special-case
   533 `unreachable_backends`, 409 `non_federating_backends`, 409 `missing_users`, and bare 420.
9. Honour `Retry-After` (seconds) on 429; otherwise exponential backoff on 420/429/5xx-except-503.
10. Send `Wire-Client` / `Wire-Client-Version` (renamed to our product) and pick our own device
    `model`/`label`.
