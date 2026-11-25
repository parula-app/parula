# Wire protocol — 02: Authentication, session lifecycle, device registration

Scope: everything between "the user typed an email address and a password" and "we hold a valid
access token bound to a registered device (client) and may start syncing".

Everything below was read out of these source trees (paths in citations are relative to the clone
root, e.g. `wire-server/…` = `<clone>/wire-server/…`):

- `wire-webapp/libraries/api-client/src/` — TypeScript REST client, authoritative for *what the
  official clients actually send*.
- `wire-webapp/libraries/core/src/` — client logic layer (login → register client → init).
- `wire-webapp/apps/webapp/src/script/auth/` — UI-level flow, error handling, 2FA, too-many-clients.
- `wire-server/libs/wire-api/src/Wire/API/` — Haskell API types, authoritative for **JSON field
  names**, enum spellings and route paths.
- `wire-server/services/brig/`, `wire-server/libs/wire-subsystems/` — server behaviour
  (throttling, cookie renewal, client limits).
- `wire-server/docs/src/understand/api-client-perspective/authentication.md` — Wire's own prose doc.

The wire-server clone is at master, commit `f2a9c1dfd08d` (2026-08-20). Where master differs from
what deployed backends do, this is called out.

---

## 1. Transport preliminaries

### 1.1 Base URL and API versioning

All REST calls go to the backend's HTTPS host (nginz). For wire.com production that is
`https://prod-nginz-https.wire.com`; the client config carries `rest` and `ws` URLs
(`wire-webapp/libraries/api-client/src/config.ts:22`).

Versioning: `GET /api-version` returns `{supported: number[], development?: number[], federation?:
bool, domain: string}` (`wire-webapp/libraries/api-client/src/apiClient.ts:166`). Pick the highest
supported version in your range and prefix every path with `/v<N>`
(`wire-webapp/libraries/api-client/src/http/httpClient.ts:179`). The webapp asks for
`[MINIMUM_API_VERSION .. MAX_API_VERSION]` = `[1 .. 17]`
(`wire-webapp/libraries/api-client/src/config.ts:27`,
`wire-webapp/libraries/config/src/client.config.ts:47`).

**Two endpoints are deliberately unversioned:** `/api-version` and `/access`.
Reason, quoted from `wire-server/docs/src/developer/developer/api-versioning.md:69`: *"the `/access`
endpoint; this is so that access cookie paths can be set to the same value regardless of the
version, which avoids invalidating logins across version upgrades."* The api-client implements
exactly this — it skips the version prefix for any URL starting with `/access`
(`wire-webapp/libraries/api-client/src/http/httpClient.ts:240-244`). The reference nginz config
likewise has a plain `location /access` while everything else is `^(/v[0-9]+)?/…`
(`wire-server/services/nginz/integration-test/conf/nginz/nginx.conf:226`).

`POST /login` **is** versioned (`^(/v[0-9]+)?/login`, same file line 236), even though the cookie it
sets has `Path=/access`.

### 1.2 Headers

| Header | Direction | Notes |
|---|---|---|
| `Authorization: Bearer <access_token>` | request | On every authenticated call (`wire-webapp/libraries/api-client/src/http/httpClient.ts:225-233`). |
| `Cookie: zuid=<token>` | request | Only on `/access`, `/access/logout` (`wire-webapp/libraries/api-client/src/shims/node/cookie.ts:61`). |
| `Content-Type: application/json` | request | `wire-webapp/libraries/api-client/src/http/httpClient.ts:432-436`. |
| `Content-Encoding: gzip` | request | Optional; the webapp gzips JSON bodies of POST/PUT/PATCH. Plain JSON is fine. |
| `Wire-Client`, `Wire-Client-Version` | request | Informational client identification, e.g. `Wire-Client: Web` (`wire-webapp/apps/webapp/src/script/service/apiClientSingleton.ts:28-29,51-52`). Optional. |
| `Set-Cookie: zuid=…` | response | From `/login`, `/register`, and *sometimes* `/access`. |
| `Location: <client-id>` | response | From `POST /clients` (`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:926`). |
| `Retry-After: <seconds>` | response | On 429 / throttled 403s. |

**Never send `Z-User` or `Z-Connection` yourself.** nginz derives them from the validated zauth
access token and strips the client's `Authorization`
(`wire-server/services/nginz/integration-test/conf/nginz/common_response_with_zauth.conf`).

### 1.3 Error envelope

Every backend error is JSON:

```json
{"code": 403, "label": "invalid-credentials", "message": "Authentication failed"}
```

`code` = HTTP status, `label` = stable machine-readable string, `message` = human text. Branch on
`label` (plus `code`), never on `message` — except for the handful of documented `invalid-credentials`
sub-messages in §5.3. See `wire-webapp/libraries/api-client/src/http/backendError.ts:364`.

---

## 2. The three secrets

| Secret | Lifetime | Where it lives | Sent as |
|---|---|---|---|
| Password | user-owned | never persisted by the client | JSON body field `password`, plaintext over TLS |
| User token ("access cookie") | ~1 day–1 week (session) / ~14 days (persistent), configurable | `zuid` cookie, `Path=/access`, `HttpOnly`, `Secure` | `Cookie: zuid=…` |
| Access token | ~15 min (production) | memory | `Authorization: Bearer …` |

`wire-server/docs/src/understand/api-client-perspective/authentication.md:15,134-180`.

Explicit instruction from the same doc, line 31: *"Both access token and cookie must be stored safely
and kept confidential. User passwords should not be stored."*

### 2.1 Token wire format (zauth)

Both the access token and the `zuid` cookie value are **zauth tokens**, not JWTs. Format
(`wire-server/libs/zauth/src/Data/ZAuth/Token.hs:241-280`):

```
<base64(ed25519-signature)>.v=1.k=<keyIndex>.d=<expiryUnixSeconds>.t=<type>.l=<tag>.<body fields>
```

- `t` = `a` (access), `u` (user/cookie), `la`/`lu` (legalhold variants), `b` (bot), `p` (provider).
- `l` = `s` for a session-scoped user token, empty otherwise.
- Access body: `u=<userUuid>` [`.i=<clientId>`] `.c=<connectionWord64>`.
- User (cookie) body: `u=<userUuid>.r=<randomHexWord32>` [`.i=<clientId>`].

Two consequences worth knowing:

1. `d=` lets you read the real server-side expiry of a token without trusting `expires_in`.
2. `i=` is the **client ID bound to the session** (see §3.4). Note the webapp's own
   `parseAccessToken` reads the client id from key `c`
   (`wire-webapp/libraries/api-client/src/auth/parseAccessToken.ts:61`), which per `Token.hs` is the
   *connection* id, not the client id — that helper is only used to extract `u` (the user id) in
   `loginWithToken`, so the bug is inert. Use `i=`, not `c=`.

Do not attempt to parse or forge tokens beyond reading `d` / `u` / `i`. Treat them as opaque strings
otherwise; `access_token` must be URL-decoded before re-use in a header
(`wire-webapp/libraries/api-client/src/http/httpClient.ts:359`).

---

## 3. Login and session lifecycle

### 3.1 `POST /login`

Route: `wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:1826-1841`.
Body type `Login`: `wire-server/libs/wire-api/src/Wire/API/User/Auth.hs:336-353`.
Identifier type `LoginId`: same file, lines 96-124.

Query parameter:

| Param | Type | Default | Meaning |
|---|---|---|---|
| `persist` | bool | `false` | `true` → persistent cookie (has `Expires`, is renewed on refresh). `false`/absent → session cookie (no `Expires`, never renewed). `Brig.hs:1834`. |

Body fields:

| Field | Required | Type | Notes |
|---|---|---|---|
| `email` | one of | string | Verified email address. Mutually exclusive with `handle`. |
| `handle` | one of | string | Username **without** the leading `@`. |
| `password` | yes | string | 6…1024 characters (`PlainTextPassword6`, `wire-server/libs/types-common/src/Data/Misc.hs:518,534-535`). |
| `label` | no | string \| null | Cookie label — see §3.6. |
| `verification_code` | no | string \| null | 6-digit 2FA code — see §4. |

`Auth.hs:123` — if neither `email` nor `handle` parses, the request fails with
`'email' or 'handle' required`.

**Phone login is gone.** `LoginId` in master has only `LoginByEmail` and `LoginByHandle`
(`Auth.hs:96-98`); the SMS code endpoint `POST /login/send` is annotated `Until 'V6'`
(`Brig.hs:1807-1822`) and its own description now says: *"For 2nd factor authentication login with
email and password, use the `/verification-code/send` endpoint."* Do not implement phone login.

Request:

```http
POST /v8/login?persist=true HTTP/1.1
Host: prod-nginz-https.wire.com
Content-Type: application/json

{
  "email": "alice@example.com",
  "password": "correct horse battery staple",
  "label": "aa1f2b7c-2b6f-4c0e-9b6a-1a5f3d1c2e77",
  "verification_code": "123456"
}
```

Handle variant — replace `"email"` with `"handle": "alice"`.

Response `200 OK`:

```http
HTTP/1.1 200 OK
Set-Cookie: zuid=<zauth-user-token>; Path=/access; Expires=Thu, 10-Jan-2019 10:43:28 GMT; Domain=wire.com; HttpOnly; Secure
Content-Type: application/json

{
  "user": "3f27a1d0-1a0b-4b1e-9d2f-7c5a4e6b8d90",
  "access_token": "fmmLpDSjArpksFv57r5rDrzZZlj...",
  "token_type": "Bearer",
  "expires_in": 900
}
```

Response type `AccessToken`: `wire-server/libs/wire-api/src/Wire/API/User/Auth.hs:398-428`, mirrored
by `wire-webapp/libraries/api-client/src/auth/accessTokenData.ts:22-26`. Golden example:
`wire-server/libs/wire-api/test/golden/testObject_AccessToken_user_1.json`.

- `user` — the self user's UUID (unqualified; the domain comes from `GET /self`).
- `token_type` — always the literal `"Bearer"` (`Auth.hs:441-447`).
- `expires_in` — seconds of validity **from issuance**, not an absolute time.

Wire's own prose example (`authentication.md:110-120`) omits `user`; the schema and the golden test
both have it. Trust the schema.

### 3.2 The `zuid` cookie — and why you need a cookie jar

Set-Cookie attributes are built in `wire-server/libs/wire-api/src/Wire/API/User/Auth.hs:536-545`:

```haskell
setCookieName     = "zuid"
setCookieValue    = <zauth user token>
setCookiePath     = Just "/access"
setCookieExpires  = <Just t for persistent, Nothing for session>
setCookieSecure   = <True unless the backend is configured with cookieInsecure>
setCookieHttpOnly = True
```

`Domain` is added by the deployment and varies per backend (`authentication.md:122`). A non-browser
client should therefore **not** hardcode a domain; store the cookie against the backend host you got
it from.

Why a cookie jar and not just a variable:

1. `POST /access` may return a **new** `Set-Cookie` at any time (cookie renewal, §3.3). The doc is
   explicit: *"A client must expect a new `zuid` cookie as part of any access token refresh and
   replace the existing cookie appropriately"* (`authentication.md:204-206`).
2. `POST /register` also sets a cookie, and it is always persistent (`authentication.md:151`).
3. Path scoping matters: the cookie is only valid for `/access*`. Sending it elsewhere leaks it.

The official Node-side implementation is minimal and worth copying: parse every `set-cookie` header
of the login/register/access response with a real cookie parser, keep `value` and `expires`, and
re-attach it as `Cookie: zuid=<value>` only on `/access` and `/access/logout`
(`wire-webapp/libraries/api-client/src/shims/node/cookie.ts:32-65`;
storage in `wire-webapp/libraries/api-client/src/auth/cookieStore.ts:95-120`; the persisted shape is
just `{zuid, expiration}`, `wire-webapp/libraries/core/src/account.ts:279-282`).

The cookie must survive process restarts if you want silent re-login. In the webapp core it is
written to the local DB on every `COOKIE_REFRESH` event (`account.ts:236-245`).

**Session vs persistent cookie** (`Auth.hs:299-309`):

| | `persist=false` (session) | `persist=true` (persistent) |
|---|---|---|
| `Expires` attribute | absent | present |
| Server-side lifetime | short (1 day–1 week, configurable) | ~14 days in production, configurable |
| Renewed on `POST /access` | **no** | yes, once older than `userCookieRenewAge` |

A background/daemon client that wants to stay logged in must use `persist=true`.

**Cookie limits and login throttling** (`authentication.md:63-85`,
`wire-server/libs/wire-subsystems/src/Wire/AuthenticationSubsystem/Cookie.hs:101-111`): the server
keeps at most `setUserCookieLimit` (default **32**) cookies *per type per user*. When the limit is
reached it evicts oldest-expiring cookies, and it applies a throttle: if the standard deviation of
cookie creation timestamps drops below `stdDev` (default 3000 s), the login is rejected with
`429 client-error` + `Retry-After` (default 86400 s)
(`wire-server/docs/src/how-to/install/infrastructure-configuration.md:505-533`). The doc's verdict:
*"Being throttled is a clear indicator of incorrect API usage. There is no need to login many times
in a row on the same device. Instead, the cookie should be re-used."* Log in once; refresh forever.

### 3.3 `POST /access` — refreshing the access token

Route: `wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:1790-1801`.
Client: `wire-webapp/libraries/api-client/src/http/httpClient.ts:343-365`.

```http
POST /access?client_id=4d0d4e0b17f0bd21 HTTP/1.1
Authorization: Bearer <old, possibly expired, access token>
Cookie: zuid=<user token>
Content-Length: 0
```

Notes:

- **No version prefix** (§1.1). No request body.
- The cookie is mandatory; the old access token is optional but *strongly recommended*:
  *"Providing the old access token is not required but strongly recommended as it will link the new
  access token to the old, enabling the API to see the new access token as a continued session of
  the same client"* (`authentication.md:199-201`).
- `client_id` (query param) associates the session with a device — see §3.4.
- Sending *neither* cookie nor token, or both-but-mismatched, is an error
  (`Brig.hs:1793-1796`: "You can provide only a cookie or a cookie and token. Every other
  combination is invalid.").

Response `200 OK`: same `AccessToken` JSON as `/login`, **plus optionally** a fresh
`Set-Cookie: zuid=…`. Cookie renewal happens when (`wire-server/services/brig/src/Brig/User/Auth/Cookie.hs:93-110`):

- the cookie is a `PersistentCookie` **and** its age exceeds `userCookieRenewAge`; **or**
- the bound client id changes (i.e. the first `/access?client_id=…` after device registration) —
  renewed regardless of age.

Errors: `403 invalid-credentials` with message `Missing cookie` / `Missing cookie and token` /
`Invalid zauth token` / `Zauth token expired` (see §5.3). A `403` on `/access` means the session is
dead — wipe local session state and send the user back to the login screen. That is exactly what the
api-client does: it maps those errors to `MissingCookieError` / `InvalidTokenError` and emits
`ON_INVALID_TOKEN`, which triggers a local logout
(`wire-webapp/libraries/api-client/src/http/httpClient.ts:280-292`,
`wire-webapp/libraries/api-client/src/apiClient.ts:214-223`).

**When to call it — how the official clients schedule refresh.** There is no timer. The strategy is
lazy + reactive:

1. **On startup with a stored cookie**: call `POST /access` *first thing*, before anything else.
   `APIClient.init()` does `refreshAccessToken()` then `createContext()`
   (`wire-webapp/libraries/api-client/src/apiClient.ts:350-359`). This both validates the cookie and
   yields the user id.
2. **On any `401` response**: refresh once and retry the request exactly once
   (`httpClient.ts:264-266`, `:253-260`; the retry is marked `isFirstTry: false` so it cannot loop).
3. **On a `403` whose mapped error is `TokenExpiredError`**: same one-shot refresh + retry
   (`httpClient.ts:273-278`).
4. **Before every WebSocket (re)connect**: `hasValidAccessToken()` checks
   `expiresAt - 10 s > now`, and if not, refreshes with backoff until it succeeds or the session is
   proven dead (`wire-webapp/libraries/api-client/src/http/httpClient.ts:317-324`,
   `wire-webapp/libraries/api-client/src/tcp/webSocketClient.ts:216-268`).
5. **On WebSocket error**: refresh (`webSocketClient.ts:143-154`).

An independent client can do the same: store `expiresAt = now + expires_in*1000` on receipt
(`wire-webapp/libraries/api-client/src/auth/accessTokenStore.ts:190-198`), treat the token as
invalid 10 s early, and refresh proactively before long-lived operations plus reactively on 401.
A pure "refresh at `expires_in * 0.9`" timer is also acceptable and avoids 401 round-trips, but must
still handle 401 because the server may revoke early.

### 3.4 Binding the session to a device — `client_id`

After registering (or loading) the device client, call `/access` once more with the client id:

```http
POST /access?client_id=4d0d4e0b17f0bd21
Authorization: Bearer <current access token>
Cookie: zuid=<user token>
```

`wire-webapp/libraries/core/src/account.ts:437` (`associateClientWithSession`) →
`wire-webapp/libraries/api-client/src/http/httpClient.ts:372-377`.

Server behaviour (`wire-server/services/brig/src/Brig/User/Auth.hs:200-209`,
`wire-server/services/brig/src/Brig/User/Auth/Cookie.hs:93-99`):

- the client id must exist for this user, else `403 invalid-credentials` (`checkClientId`,
  `Brig/User/Auth.hs:471-473`);
- if the cookie already carries a *different* client id, the request fails with
  `ZAuth.Invalid` → `403 invalid-credentials "Invalid zauth token"`. **A cookie/session can be bound
  to exactly one device, permanently.**
- the returned access token then carries `i=<clientId>` and the cookie is renewed.

Practical rule: register/load the client, then bind it once, then never pass `client_id` again for
that session (harmless if you do, since old==new).

### 3.5 `POST /access/logout` (this is the real logout endpoint)

Route: `wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:1845-1857`.
Client: `wire-webapp/libraries/api-client/src/auth/authApi.ts:100-108`.

```http
POST /access/logout HTTP/1.1
Authorization: Bearer <access token>
Cookie: zuid=<user token>
Content-Length: 0
```

`200 OK`, empty body. It revokes **the cookie that was sent**, nothing else — subsequent `/access`
with that cookie returns 403 (`Brig.hs:1850-1852`). The access token remains technically valid until
it expires; drop it locally.

**There is no bare `POST /logout`** in the brig public API — the only logout routes are
`/access/logout` (users) and `/provider/logout` (service providers). If you have seen `POST /logout`
in older documentation, it is the same endpoint under its pre-versioning alias. Treat
`/access/logout` as canonical.

The api-client's `postLogout()` is best-effort: failures are swallowed and the local state is dropped
anyway (`wire-webapp/libraries/api-client/src/apiClient.ts:405-418`). Do the same — but *do* call it,
the doc calls an explicit logout mandatory when your UI offers one (`authentication.md:231`).

### 3.6 Cookie labels

`CookieLabel` is *"A device-specific identifying label for one or more cookies. Cookies can be listed
and deleted based on their labels."* (`wire-server/libs/wire-api/src/Wire/API/User/Auth.hs:260-263`).

Three places refer to the same string:

1. `POST /login` body field `label` — tags the cookie being created.
2. `POST /clients` body field `cookie` — *"The cookie label, i.e. the label used when logging in."*
   (`wire-server/libs/wire-api/src/Wire/API/User/Client.hs:764-769`). This is what ties a device
   record to its session cookie.
3. `GET /cookies?labels=…` and `POST /cookies/remove` `{labels: [...]}` — selective revocation.

Server side, issuing a new cookie with a label **revokes all other cookies with the same label** for
that user (`SameLabelPolicy = RevokeSameLabel` on login,
`wire-server/libs/wire-subsystems/src/Wire/AuthenticationSubsystem/Cookie.hs:77-82`, called from
`Brig/User/Auth.hs:283`). Cookie *renewal* uses `KeepSameLabel` instead
(`Brig/User/Auth/Cookie.hs:137`). So: **a stable per-installation label makes repeated logins
self-cleaning** and dodges the 32-cookie throttle.

Recommendation for a new client: generate a random UUID once at install time, persist it, and send
it as `label` on every `/login` and as `cookie` on `/clients`.

Caveats from the reference implementations:

- The webapp's api-client `LoginData` has no `label` field at all
  (`wire-webapp/libraries/api-client/src/auth/loginData.ts:22-29`), so the webapp sends no label and
  passes `cookieLabel: ''` to `/clients`
  (`wire-webapp/apps/webapp/src/script/auth/module/action/clientAction.ts:123`). It keeps a local
  storage *key* derived from `murmurhash(email)` for unrelated bookkeeping
  (`wire-webapp/apps/webapp/src/script/repositories/client/ClientRepository.ts:244-250`).
- Whether the iOS/Android clients send a `label` on login is **UNVERIFIED** (those repos are not in
  the reference clones). The backend has supported the field since the beginning.

### 3.7 `GET /cookies`

Route: `wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:1880-1889`. Requires the access
token (`ZLocalUser`), **not** the cookie.

```http
GET /v8/cookies?labels=my-label,other-label
Authorization: Bearer <access token>
```

`labels` is an optional comma-separated filter (`wire-webapp/libraries/api-client/src/auth/authApi.ts:48-60`).

```json
{
  "cookies": [
    {
      "id": 967153183,
      "type": "persistent",
      "created": "2026-06-04T14:29:23.000Z",
      "expires": "2026-06-18T14:29:23.000Z",
      "label": "aa1f2b7c-2b6f-4c0e-9b6a-1a5f3d1c2e77",
      "successor": null
    }
  ]
}
```

Schema: `wire-server/libs/wire-api/src/Wire/API/User/Auth.hs:242-252` — fields `id` (Word32),
`type` (`"session"` | `"persistent"`, lines 324-328), `created`, `expires` (both UTC ISO-8601),
`label` (nullable), `successor` (nullable cookie id set during renewal). The TS mirror
(`wire-webapp/libraries/api-client/src/auth/cookieList.ts:22-30`) omits `successor`.

Note the prose doc's example (`authentication.md:264-285`) shows a `time` field — that is stale; the
schema says `created`/`expires`. Also: *"expired cookies are not automatically removed when they
expire, only as new cookies are issued"* (`authentication.md:287`).

### 3.8 `POST /cookies/remove`

Route: `Brig.hs:1891-1900`. Requires the access token. Body type `RemoveCookies`
(`wire-server/libs/wire-api/src/Wire/API/User/Auth.hs:358-392`):

```http
POST /v8/cookies/remove
Authorization: Bearer <access token>
Content-Type: application/json

{
  "password": "correct horse battery staple",
  "labels": ["old-laptop"],
  "ids": [967153183, 942451749]
}
```

- `password` — required (6…1024 chars). It is skipped only for SAML-only users
  (`wire-server/services/brig/src/Brig/User/Auth.hs:221-231`).
- `labels` — array of label strings, optional (defaults to `[]`).
- `ids` — array of **numeric cookie ids** from `GET /cookies`, optional.
- Empty `labels` **and** empty `ids` revokes *all* cookies of the user
  (`Cookie.hs:134`: `revokeCookiesMatchingExcept u Nothing [] [] = deleteAllCookies`). Be careful.

Returns `200` with an empty body. `403 invalid-credentials` on a wrong password.

The prose doc example (`authentication.md:299-309`) shows `email`/`password` and cookie objects in
`ids`; the current schema takes only `password` plus numeric `ids`. Trust `Auth.hs`.

The TS client signature is `postCookiesRemove(password, labels?, ids?)`
(`wire-webapp/libraries/api-client/src/auth/authApi.ts:62-75`).

### 3.9 `PUT /access/self/email`

Route: `Brig.hs:1859-1878`. Requires **both** cookie and access token (unlike the other `/self`
endpoints). Body `{"email": "new@example.com"}`
(`wire-webapp/libraries/api-client/src/auth/authApi.ts:122-131`).

Responses: `202` (accepted, pending activation of the new address), `204` (no change / already
activated). Errors: `invalid-email` (400), `key-exists` (409), `blacklisted-email` (403),
`invalid-credentials` (403). Not needed for a login flow; listed because it lives under `/access`
and therefore needs the cookie jar.

---

## 4. Two-factor authentication (email verification codes)

Wire's 2FA is not TOTP: the backend mails a 6-digit code to the account's verified email address.
It is a **team feature**, `sndFactorPasswordChallenge`
(`wire-webapp/libraries/api-client/src/team/feature/featureList.types.ts:87`).

### 4.1 When it applies

`wire-server/libs/wire-subsystems/src/Wire/AuthenticationSubsystem/Interpreter.hs:429-441`:

- if the user is in a team → required iff that team's `sndFactorPasswordChallenge` feature is
  enabled;
- if the user has no team → required iff the *server default* for that feature is enabled (normally
  disabled);
- **SAML/SSO users are exempt** regardless.

You cannot know in advance. The correct client design is *reactive*: attempt the login without a
code, and if it fails with `code-authentication-required`, request a code and retry.

### 4.2 `POST /verification-code/send`

Route: `wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:255-261`. **Unauthenticated.**
Body type `SendVerificationCode` (`wire-server/libs/wire-api/src/Wire/API/User.hs:2037-2052`):

```http
POST /v8/verification-code/send
Content-Type: application/json

{"email": "alice@example.com", "action": "login"}
```

`action` enum (`wire-server/libs/wire-api/src/Wire/API/User.hs:1989-2004`, mirrored in
`wire-webapp/libraries/api-client/src/auth/verificationActionType.ts:20-24`):

| Value | Use |
|---|---|
| `login` | 2FA for `POST /login` **and** for `POST /clients` |
| `create_scim_token` | team SCIM token creation |
| `delete_team` | team deletion |

Response: `200 OK` with an empty body — **always**, even when the address is unknown or the feature
is off (`wire-server/services/brig/src/Brig/API/Public.hs:1631-1645`: the `_ -> pure ()` branch). No
user enumeration; a 200 does *not* mean a mail was sent.

Code properties (`Brig/API/Public.hs:1633-1641`): 6 decimal digits, 3 verification attempts,
TTL = `verificationCodeTimeout`, default **600 s / 10 minutes**
(`wire-server/services/brig/src/Brig/Options.hs:581-585`). A new request overwrites the previous
pending code (`createCodeOverwritePrevious`).

Throttling: `429` with `label: "too-many-requests"` and a `Retry-After` header
(`wire-server/libs/wire-api/src/Wire/API/Error/Brig.hs:137`,
`wire-server/libs/wire-subsystems/src/Wire/VerificationCodeSubsystem.hs:41-46`). The webapp swallows
this and lets the user type the code they already received
(`wire-webapp/apps/webapp/src/script/auth/module/action/authAction.ts:158-164`).

Sending a *handle* instead of an email yields `400 bad-request`; the webapp rewrites that to a
synthetic `email-required` for the UI (`authAction.ts:166-171`). 2FA login therefore effectively
requires knowing the email address.

Client call site: `wire-webapp/libraries/api-client/src/user/userApi.ts:472-479` (URL constant
`verification-code` + `send` at line 100).

### 4.3 Using the code

Put it in the login body as `verification_code`
(`wire-webapp/libraries/api-client/src/auth/authApi.ts:78-84` — the TS field `verificationCode` is
renamed to snake_case `verification_code`, and is omitted entirely when empty).

**The same code is used a second time** for `POST /clients` when this login also registers a new
device. From `wire-server/libs/wire-subsystems/src/Wire/ClientSubsystem/Interpreter.hs:162-165`:

> this only happens inside the login flow (in particular, when logging in from a new device)
> the code obtained for logging in is used a second time for adding the device

So the client must **keep the code in memory** across the login → register-client sequence. The
webapp threads it through explicitly
(`wire-webapp/apps/webapp/src/script/auth/module/action/authAction.ts:112-117` →
`clientAction.ts:63-90` → `wire-webapp/libraries/core/src/client/clientService.ts:196`), and stashes
it in local storage across the too-many-clients detour
(`wire-webapp/apps/webapp/src/script/auth/page/login/login.tsx:302-312`,
`wire-webapp/apps/webapp/src/script/auth/component/clientList.tsx:82-88`).

### 4.4 Error labels to react to

| Label | Status | Meaning | Client action |
|---|---|---|---|
| `code-authentication-required` | 403 | 2FA is on, no code supplied | `POST /verification-code/send` with `action: "login"`, prompt for the code, retry the identical request with `verification_code` |
| `code-authentication-failed` | 403 | code wrong, expired, or no pending code exists | Show "wrong code", let the user re-enter or resend. Do **not** auto-resubmit |

Definitions: `wire-server/libs/wire-api/src/Wire/API/Error/Brig.hs:167,169`;
server-side messages `Code authentication failed (no such code).` /
`(no such email).` in `wire-server/libs/wire-subsystems/src/Wire/AuthenticationSubsystem/Error.hs:117-125`.
Both labels are thrown by `POST /login` **and** `POST /clients`
(`Brig.hs:1838-1839`, `Brig.hs:936-937`).

The webapp's handling is at
`wire-webapp/apps/webapp/src/script/auth/page/login/login.tsx:314-336`; note it deliberately stops
auto-submitting after the first failure (`twoFactorSubmitFailedOnce`).

---

## 5. Login error labels

### 5.1 Table

All mappings from `wire-server/libs/wire-api/src/Wire/API/Error/Brig.hs` and
`wire-server/services/brig/src/Brig/API/Error.hs:86-102`.

| Label | HTTP | Raised by | Meaning | Client should |
|---|---|---|---|---|
| `invalid-credentials` | 403 | `/login`, `/access`, `/cookies/remove`, `DELETE /clients/:id` | Wrong password, unknown user — *or* an invalid/expired/missing token or cookie (see §5.3) | On `/login`: show "wrong email or password" (never distinguish the two). On `/access`: session is dead → local logout |
| `pending-activation` | 403 | `/login` | Account exists but the email was never activated / invitation not accepted | Tell the user to check their mailbox; offer to resend activation |
| `suspended` | 403 | `/login`, `/access` | Account suspended by an admin, or auto-suspended for inactivity | Dead end — show a support message. Do not retry |
| `ephemeral` | 403 | `/login` | Account is a temporary guest account; it cannot log in with a password | Not applicable to a normal client |
| `code-authentication-required` | 403 | `/login`, `/clients` | 2FA enabled, code missing | §4.4 |
| `code-authentication-failed` | 403 | `/login`, `/clients` | 2FA code wrong/expired | §4.4 |
| `password-is-stale` | 403 | `/login` | Password older than the backend's mandatory-rotation policy | Send the user through password reset. `Error/Brig.hs:318` |
| `client-error` | 403 | `/login` | **Too many failed logins** — account temporarily blocked. `Brig/API/Error.hs:96-99,256-257` (`"Too many failed logins"`) | Read `Retry-After` (seconds), disable the login button that long |
| `client-error` | 429 | `/login` | **Logins too frequent** (cookie throttle). `Brig/API/Error.hs:91-94,253-254` (`"Logins too frequent"`) | Read `Retry-After` (default 86400!), stop logging in, re-use the stored cookie instead |
| `too-many-requests` | 429 | `/verification-code/send`, generic rate limiter | Code generation / request rate limited | Honour `Retry-After`; for 2FA, let the user use the code already mailed |
| `missing-auth` | 403 | `POST /clients`, `DELETE /clients/:id` | *"Re-authentication via password required"* — the account already has ≥1 client of this type and no `password` was supplied | Prompt for the password and retry with `password` in the body |
| `too-many-clients` | 403 | `POST /clients` | Permanent-client limit reached (default 7) | §6.4 — list, delete one, retry |
| `invalid-code` | 403 | account-deletion / activation flows | Wrong verification code (**not** the 2FA login code — that is `code-authentication-failed`) | Re-prompt |
| `pending-login` | — | *(phone SMS login, removed)* | Legacy label from the retired SMS login flow | Not reachable on a current backend. The closest live label is `no-pending-login` (404, `Brig/API/Error.hs:194-195`) |
| `blacklisted-email` | 403 | registration / email change | Address blacklisted after a hard bounce or spam complaint | Ask for a different address; nothing the client can retry |
| `key-exists` | 409 | registration / email change | Email already in use | Offer login instead of registration |
| `unauthorized` | 403 | `/login` on allowlisted backends | Email domain not on the backend's allowlist (`Brig/API/Error.hs:209-210`) | Show "this backend does not accept this address" |
| `not-found` | 404 | `GET /clients/:id` | Client was deleted server-side | Wipe local crypto identity, re-register the device (§7) |
| `unknown-client` | 403 | messaging endpoints | The `client_id` you claim does not exist | Re-register the device |

Note the deliberate ambiguity: brig maps both "unknown user" and "wrong password" to the same
`invalid-credentials` (`Brig/API/Error.hs:86-87`: `LoginFailed` for both `AuthInvalidUser` and
`AuthInvalidCredentials`). Never tell the user which one it was.

**Account deletion**: a deleted account behaves as an unknown user on login → `invalid-credentials`.
There is no dedicated login label for it. (Related labels `pending-delete` / `no-self-delete-for-team-owner`
belong to the *initiate deletion* flow, not login.)

### 5.2 Rate limiting mechanics

Two independent limiters, both signalled with `label: "client-error"`:

1. **Failed-login budget** — `limitFailedLogins: {timeout, retryLimit}`. After `retryLimit`
   consecutive failures for a user, further attempts get `403 client-error "Too many failed logins"`
   with `Retry-After` until the budget refills
   (`wire-server/services/brig/src/Brig/User/Auth.hs:136-160`). The budget is decremented on wrong
   password *and* on a wrong/missing 2FA code (`Brig/User/Auth.hs:121-131`).
2. **Successful-login throttle** — the cookie-count/std-dev throttle of §3.2, giving
   `429 client-error "Logins too frequent"` with `Retry-After`
   (`Brig/API/Error.hs:90-94`). The comment at `Brig/API/Error.hs:252` spells out the distinction:
   *"In contrast to 'tooManyFailedLogins', this is about too many **successful** logins."*

The TS client collapses only the 429 case into a typed `LoginTooFrequentError`
(`wire-webapp/libraries/api-client/src/http/backendErrorMapper.ts:115-118`). Your client must read
the `Retry-After` header itself — the JSON body does not carry the delay.

Also present at the platform level: `RateLimitExceeded` → `429 too-many-requests` with `Retry-After`
computed from microseconds (`wire-server/libs/wire-subsystems/src/Wire/RateLimit.hs:62-66`).

### 5.3 `invalid-credentials` sub-cases (message matters here)

For token/cookie problems the label is always `invalid-credentials`; only the `message` distinguishes
them. The official client switches on these exact strings
(`wire-webapp/libraries/api-client/src/http/backendErrorMapper.ts:66-71,158-176`):

| `message` | Source | Means |
|---|---|---|
| `Authentication failed` | `Error/Brig.hs:157` | Bad email/password (the login case) |
| `Missing cookie` | `Brig/API/Error.hs:221` | No `zuid` sent to `/access` |
| `Missing cookie and token` | `Brig/API/Error.hs:227` | Neither credential sent |
| `Missing token` / `Missing access token` | `Brig/API/Error.hs:224,230` | Cookie present, token missing where required |
| `Invalid zauth token` | `AuthenticationSubsystem/Error.hs:104` | Malformed/for-another-purpose token, or client-id mismatch on `/access` |
| `Zauth token expired` | `AuthenticationSubsystem/Error.hs:102` | Refresh needed (retry once after `/access`) |
| `Zauth token falsified` | `AuthenticationSubsystem/Error.hs:106` | Bad signature — treat as fatal |
| `Token mismatch` | `Brig/API/Error.hs:233` | Cookie and access token belong to different sessions |

Rule of thumb: `Zauth token expired` → refresh and retry once. Anything else on `/access` → session
is unrecoverable, drop the cookie, require a fresh login.

---

## 6. Device (client) registration

A Wire "client" is a device. It owns the Proteus/MLS key material, so the *device*, not the account,
is the messaging identity. You cannot send or receive messages without one.

### 6.1 `POST /clients`

Route: `wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:977-997` (the `From 'V8'`
variant; `@v6` and `@v7` variants exist for older versions, see §6.3). Body type `NewClient`:
`wire-server/libs/wire-api/src/Wire/API/User/Client.hs:719-803`. TS mirror `CreateClientPayload`:
`wire-webapp/libraries/api-client/src/client/newClient.ts:39-51`.

Requires the access token. Nginz injects `Z-User` and `Z-Connection` from it.

| Field | Required | Type | Notes |
|---|---|---|---|
| `prekeys` | yes | `{id: number, key: string}[]` | Proteus prekeys for others to start sessions. `key` is base64. The webapp uploads 100 by default (`wire-webapp/libraries/core/src/account.ts:213`). |
| `lastkey` | yes | `{id: number, key: string}` | Last-resort prekey. *"This key must have the ID 0xFFFF and is never deleted."* (`Client.hs:748-753`) → `id: 65535`. |
| `type` | yes | `"permanent"` \| `"temporary"` \| `"legalhold"` | See below. |
| `class` | no | `"desktop"` \| `"phone"` \| `"tablet"` \| `"legalhold"` | Device class (`Client.hs:686-693`). The TS payload restricts creation to desktop/phone/tablet. |
| `label` | no | string | Free-form device name, e.g. `"macOS 15.2"`. |
| `model` | no | string | Free-form model, e.g. `"Wire macOS"`, `"Chrome"`. |
| `cookie` | no | string | **The cookie label**, i.e. the `label` used at `/login` (`Client.hs:764-769`). |
| `password` | no | string | *"Required for registration of the 2nd, 3rd, … client."* (`Client.hs:772-780`) |
| `capabilities` | no | string[] | See §6.2. |
| `mls_public_keys` | no | `{<sigScheme>: base64}` | MLS signature public keys; `ed25519`, `ecdsa_secp256r1_sha256`, `ecdsa_secp384r1_sha384`, `ecdsa_secp521r1_sha512`, `ed448` (`wire-webapp/libraries/api-client/src/client/clientApi.ts:40-47`). Omit for a Proteus-only client. |
| `verification_code` | no | string | The same 6-digit 2FA code used at login (§4.3). |
| `location` | no | `{lat, lon}` | Legacy, optional (`wire-webapp/libraries/api-client/src/client/location.ts`). |

`type` values (`Client.hs:661-674`):

- `permanent` — a real, persistent device. Counted against the per-user limit. Requires a password
  from the 2nd one onwards. This is what a desktop app registers.
- `temporary` — an ephemeral device (webapp "this is a public computer"). **Not** counted against the
  limit, and *"When a temporary client already exists, it is replaced"* (`Client.hs:742-746`). Needs
  no password to delete.
- `legalhold` — created only by the legal-hold service. `POST /clients` explicitly refuses it from a
  user: `wire-server/services/brig/src/Brig/API/Public.hs:753-755`.

Request:

```http
POST /v8/clients HTTP/1.1
Authorization: Bearer <access token>
Content-Type: application/json

{
  "type": "permanent",
  "class": "desktop",
  "label": "Linux 6.18",
  "model": "My New Client",
  "cookie": "aa1f2b7c-2b6f-4c0e-9b6a-1a5f3d1c2e77",
  "password": "correct horse battery staple",
  "verification_code": "123456",
  "lastkey": {"id": 65535, "key": "pQABARhtAqEAWCB...="},
  "prekeys": [
    {"id": 0, "key": "pQABAQACoQBYIL...="},
    {"id": 1, "key": "pQABAQECoQBYIH...="}
  ],
  "capabilities": ["legalhold-implicit-consent", "consumable-notifications"],
  "mls_public_keys": {"ed25519": "Zm9vYmFy..."}
}
```

Response `201 Created`:

```http
HTTP/1.1 201 Created
Location: 4d0d4e0b17f0bd21
Content-Type: application/json

{
  "id": "4d0d4e0b17f0bd21",
  "type": "permanent",
  "class": "desktop",
  "label": "Linux 6.18",
  "model": "My New Client",
  "cookie": "aa1f2b7c-2b6f-4c0e-9b6a-1a5f3d1c2e77",
  "time": "2026-08-20T12:34:56.789Z",
  "capabilities": ["legalhold-implicit-consent", "consumable-notifications"],
  "mls_public_keys": {"ed25519": "Zm9vYmFy..."},
  "last_active": null
}
```

Response type `Client`: `wire-server/libs/wire-api/src/Wire/API/User/Client.hs:544-557`; TS mirror
`RegisteredClient`: `wire-webapp/libraries/api-client/src/client/registeredClient.ts:22-39`.
Golden examples: `wire-server/libs/wire-api/test/golden/testObject_Client_user_1.json`, `_2.json`.

- `id` — *"A 64-bit unsigned integer, represented as a hexadecimal numeral … the backend will only
  produce representations with lowercase digits and no leading zeros"*
  (`wire-server/libs/types-common/src/Data/Id.hs:358-394`). Store it as the string the server gave
  you; do not zero-pad or upcase it.
- `time` — ISO-8601 registration timestamp with milliseconds.
- `last_active` — nullable UTC timestamp, present on `GET /clients`.
- `address` — the registering IP; documented in the TS type
  (`registeredClient.ts:23-24`) but **not** in the current Haskell `Client` schema, so treat it as
  optional/legacy.

**Client id derivation (master).** On current master brig derives the client id deterministically:
`clientId = first 8 bytes of SHA-256(utf8(lastkey.key)) interpreted big-endian as a Word64`
(`wire-server/libs/wire-api/src/Wire/API/User/Client/Prekey.hs:160-173`, used at
`wire-server/libs/wire-subsystems/src/Wire/ClientSubsystem/Interpreter.hs:159`). Consequence: posting
the *same* `lastkey` again is an **upsert** of the same client rather than a new device
(`upsertClient`, `Interpreter.hs:170-215` — `upsert = any exists typed`, and an upsert bypasses both
the re-auth requirement and the client limit). Older backends generated a random id. **Always use
the `id` from the response; never compute it yourself.**

Master also validates every prekey as a CBOR "prekey bundle" whose embedded id matches the JSON `id`
(`checkPrekeyBundle`, `Prekey.hs:155-157`; `Interpreter.hs:213-215` throws `MalformedPrekeys` →
`400 bad-request "Malformed prekeys uploaded"`). Whether this validation is active on a given
deployed backend is version-dependent — **UNVERIFIED** for production. The prekey encoding itself is
covered in the Proteus/crypto document, not here.

Side effects of a successful registration: a `user.client-add` event to the self user, and — if this
was not the account's first client — a "new device" notification email
(`Interpreter.hs:146-156`).

### 6.2 `capabilities`

Enum (`wire-server/libs/wire-api/src/Wire/API/User/Client.hs:147-160`;
`wire-webapp/libraries/api-client/src/client/clientCapability.ts:21-22`):

| Value | Meaning |
|---|---|
| `legalhold-implicit-consent` | *"Clients have minimum support for LH, but not for explicit consent."* Declaring it means the user implicitly consents to conversations with legal-hold devices. Without it, the backend blocks such conversations with `missing-legalhold-consent`. Every official client sends it (`wire-webapp/libraries/core/src/client/clientService.ts:182`). |
| `consumable-notifications` | The client uses the new consumable (ack-based) notification stream instead of the legacy `/notifications` paging. Only send it if you implement that protocol. Gated on the team feature `consumableNotifications` (`wire-webapp/apps/webapp/src/script/auth/module/action/clientAction.ts:69-73`). |

**Serialisation differs by API version** (`Client.hs:186-224`):

- API ≤ v6: the `capabilities` field of a `Client` is an *object*:
  `"capabilities": {"capabilities": ["legalhold-implicit-consent"]}`.
- API v7: a plain array, but `consumable-notifications` is filtered out (only
  `legalhold-implicit-consent` is representable — `capabilitySchemaV7`, `Client.hs:162-171`).
- API ≥ v8: a plain array carrying both values.

Parse defensively: accept either an array or `{capabilities: [...]}`.

`GET /clients/:id/capabilities` returns the same list on its own
(`Brig.hs:1120-1170`, `wire-webapp/libraries/api-client/src/client/clientApi.ts:101-109`).
Removing a capability via `PUT` is rejected with `409 client-feature-cannot-be-removed`
(`clientApi.ts:92-96`, label at
`wire-webapp/libraries/api-client/src/http/backendErrorLabel.ts:60`).

### 6.3 Version-specific `POST /clients`

Three routes share the path (`Brig.hs:932-997`): `add-client@v6` (`Until 'V7'`),
`add-client@v7` (`From 'V7' Until 'V8'`), `add-client` (`From 'V8'`). They differ **only** in the
`capabilities` encoding described above. Same for `PUT /clients/:id`, `GET /clients`,
`GET /clients/:id`.

### 6.4 The "too-many-clients" flow

Limit: `userMaxPermClients`, default **7** permanent clients per user
(`wire-server/services/brig/src/Brig/Options.hs:746-747`;
`wire-server/libs/wire-subsystems/src/Wire/ClientSubsystem/Interpreter.hs:196-203`). `temporary` and
`legalhold` clients are unlimited (`limit` returns `Nothing` for them).

Exceeding it → `403 too-many-clients` (`wire-server/libs/wire-api/src/Wire/API/Error/Brig.hs:163`).

The flow the official clients implement
(`wire-webapp/apps/webapp/src/script/auth/page/login/login.tsx:302-312` →
`wire-webapp/apps/webapp/src/script/auth/component/clientList.tsx:81-97`):

1. `POST /clients` → `403 too-many-clients`. **Do not treat this as a failed login** — you are
   already authenticated; only device creation failed. The webapp explicitly dispatches
   `successfulLogin()` on this label
   (`wire-webapp/apps/webapp/src/script/auth/module/action/authAction.ts:121-122`).
2. Stash the password and the 2FA `verification_code` — you need both again.
3. `GET /clients` → show the list, sorted by `time` ascending
   (`clientList.tsx:64-70`), so the oldest device is offered first.
4. User picks one → `DELETE /clients/:id` with `{"password": "…"}`.
5. Retry `POST /clients` with the *same* payload, password and `verification_code`.

### 6.5 `DELETE /clients/:id`

Route: `Brig.hs:1034-1045`. Body type `RmClient`
(`wire-server/libs/wire-api/src/Wire/API/User/Client.hs:900-920`):

```http
DELETE /v8/clients/4d0d4e0b17f0bd21
Authorization: Bearer <access token>
Content-Type: application/json

{"password": "correct horse battery staple"}
```

`200 OK`, empty body. Password rules
(`wire-server/libs/wire-subsystems/src/Wire/ClientSubsystem/Interpreter.hs:356-372`):

- `legalhold` clients cannot be deleted by the user at all;
- `temporary` clients need **no** password;
- everything else requires it, unless the user is SAML-only
  (`AuthenticationSubsystem/Interpreter.hs:191-201`). A missing password gives
  `403 missing-auth`; a wrong one `403 invalid-credentials`.

Deleting your *own* current client also invalidates the session bound to it — the api-client marks
this request `skipLogout: true` so the resulting auth error does not trigger a global logout
(`wire-webapp/libraries/api-client/src/client/clientApi.ts:116-129`).

### 6.6 `GET /clients` and `GET /clients/:id`

```http
GET /v8/clients
Authorization: Bearer <access token>
```

Returns a JSON array of the same `Client` objects as `POST /clients` (including `cookie` and
`capabilities` — those fields are only visible on *your own* clients; other users' clients come back
as `PubClient` = `{id, class}` from `/users/:id/clients`).

`GET /clients/:id` returns one client, or `404` if it no longer exists — that 404 is the canonical
signal that your device was remotely deleted
(`wire-webapp/apps/webapp/src/script/repositories/client/ClientRepository.ts:131-140`).

Client: `wire-webapp/libraries/api-client/src/client/clientApi.ts:131-149`.

### 6.7 `PUT /clients/:id`

Route: `Brig.hs:1022-1032`. Body type `UpdateClient`
(`wire-server/libs/wire-api/src/Wire/API/User/Client.hs:838-887`), all fields optional:

```json
{
  "prekeys": [{"id": 100, "key": "..."}],
  "lastkey": {"id": 65535, "key": "..."},
  "label": "New device name",
  "capabilities": ["legalhold-implicit-consent", "consumable-notifications"],
  "mls_public_keys": {"ed25519": "..."}
}
```

`200 OK`, empty body. Uses: replenishing prekeys when `GET /clients/:id/prekeys` shows the pool
running low, renaming the device, and adding MLS public keys after the fact. Note `mls_public_keys`
can only be *added*, not changed — a second, different key for the same scheme gives
`400 mls-duplicate-public-key` (`Error/Brig.hs`, `Brig.hs:1028`).

The api-client disables its infinite retry for this call
(`wire-webapp/libraries/api-client/src/client/clientApi.ts:83-87`).

---

## 7. Client id ↔ device: persistence and reuse

The client id is the durable identity of the installation. It must be persisted alongside the crypto
store, and the crypto store is meaningless without it.

**What the official clients persist per installation:**

| Item | Why |
|---|---|
| client id | addressing, `client_id` on `/access`, message envelopes |
| the whole `Client` record | to render device info offline |
| Proteus/MLS key store | the actual identity |
| `zuid` cookie (+ expiry) | silent re-login |
| cookie label | so a repeat login revokes the *previous* cookie of this device, not a stranger's |
| client type (`permanent`/`temporary`) | decides `persist=true` and delete-without-password |

`wire-webapp/libraries/core/src/client/clientService.ts` uses a fixed primary key for "this device"
in its local DB (`ClientRepository.PRIMARY_KEY_CURRENT_CLIENT = 'local_identity'`,
`wire-webapp/apps/webapp/src/script/repositories/client/ClientRepository.ts:67-69`).

**Reuse vs. create — the decision procedure**
(`wire-webapp/apps/webapp/src/script/auth/module/action/clientAction.ts:62-90`, backed by
`wire-webapp/libraries/core/src/client/clientService.ts:118-145`):

```
localClient = load client record from local storage
if localClient exists:
    try GET /clients/<localClient.id>
        200 -> reuse it; refresh the local copy from the response
        404 -> the device was deleted remotely:
                 wipe the Proteus store,
                 wipe the CoreCrypto/MLS keystore (it is scoped per *user*, not per client,
                   so a plain Proteus wipe would let a re-registered client inherit stale
                   MLS key material — clientService.ts:128-133),
                 if the client was `temporary`, clear all local tables,
                 fall through to "create"
else:
    create: generate a fresh identity + prekeys, POST /clients
finally:
    core.initClient(client)  ->  POST /access?client_id=<id>
```

So: **the client id is not re-derived from the password or the account; it is created once and then
proved to still exist on every start.**

On re-login with an existing local client, `POST /clients` is *not* called again — which is why the
password is not needed at startup, only the cookie.

Two subtleties:

- Because the local DB is keyed per user, switching accounts on the same installation produces a
  *different* client. The cookie label should therefore be per (installation, account, client type),
  which is exactly what the webapp's `constructCookieLabelKey(login, clientType)` encodes
  (`ClientRepository.ts:244-250`).
- A `temporary` client is meant to be thrown away: the official clients call
  `DELETE /clients/:id` (no password) at logout for temporary clients and only prompt about data
  deletion for permanent ones (`ClientRepository.ts:288-300`,
  `wire-webapp/libraries/core/src/client/clientService.ts:85-99`).

---

## 8. `GET /self`

Route name `get-self` (`wire-server/services/brig/src/Brig/API/Public.hs:472`);
client `wire-webapp/libraries/api-client/src/self/selfApi.ts:115-124` (URL constant `/self`, line 39).

```http
GET /v8/self
Authorization: Bearer <access token>
```

```json
{
  "id": "3f27a1d0-1a0b-4b1e-9d2f-7c5a4e6b8d90",
  "qualified_id": {"id": "3f27a1d0-1a0b-4b1e-9d2f-7c5a4e6b8d90", "domain": "example.com"},
  "name": "Alice",
  "handle": "alice",
  "email": "alice@example.com",
  "locale": "en",
  "accent_id": 1,
  "assets": [{"key": "3-1-abc…", "size": "preview", "type": "image"}],
  "team": "5a1f…",
  "type": "regular",
  "supported_protocols": ["proteus", "mls"],
  "managed_by": "wire"
}
```

Types: `wire-webapp/libraries/api-client/src/self/self.ts:24-32` (extends
`wire-webapp/libraries/api-client/src/user/user.ts:36-53`).

**Call it immediately after login/`/access`.** It is the only way to learn your own **domain**, which
every federated identifier needs. `APIClient.createContext()` does exactly this and stores
`qualified_id.domain` in the session context
(`wire-webapp/libraries/api-client/src/apiClient.ts:424-438`); note it tolerates a failure there and
leaves `domain` undefined rather than aborting login.

Other fields you need downstream: `team` (drives all team-feature lookups, including 2FA and
consumable notifications) and `supported_protocols` (Proteus vs MLS).

---

## 9. Passwords on the wire, and localisation

**Passwords are sent as plaintext JSON over TLS.** There is no client-side hashing, no challenge,
no SRP. The server hashes with Argon2id (`wire-server/libs/wire-api/src/Wire/API/Password/Argon2id.hs`,
`wire-server/libs/wire-api/src/Wire/API/Password.hs`) and rate-limits verification per user
(`RateLimitUser`, `wire-server/libs/wire-subsystems/src/Wire/AuthenticationSubsystem/Interpreter.hs:190-201`).
Consequences for a new client: pin/validate TLS properly, never log request bodies, never persist the
password, and zero it from memory once `POST /clients` has consumed it.

**Length limits** (`wire-server/libs/types-common/src/Data/Misc.hs:518-535`):

| Context | Type | Min | Max |
|---|---|---|---|
| `POST /login`, `POST /clients`, `DELETE /clients/:id`, `POST /cookies/remove` | `PlainTextPassword6` | 6 | 1024 |
| Registration, password change/reset (new password) | `PlainTextPassword8` | 8 | 1024 |

Anything outside the range is rejected as a schema error (`400`), not as `invalid-credentials`.

**Input sanitising.** The official core strips *all whitespace* from `email` and `handle` before
sending, and coerces `password` to a string, but does **not** touch the password's content
(`wire-webapp/libraries/core/src/auth/loginSanitizer.ts:25-40`). Copy that: users paste addresses
with stray spaces, but a password's spaces are significant.

**Localisation.** There is no `Accept-Language` handling in the auth path. Server-sent mails
(activation, 2FA code, new-device notice) are rendered in the user's stored `locale`
(`wire-server/services/brig/src/Brig/API/Public.hs:1652-1657` passes `userLocale account`). The
locale is set at registration (`locale` field of the register body,
`wire-webapp/libraries/api-client/src/auth/registerData.ts:31`) and changed later via
`PUT /self/locale` (`wire-webapp/libraries/api-client/src/self/selfApi.ts:148-156`). If your client
has a UI language, mirror it into `PUT /self/locale` so verification mails arrive in that language.

The `label` fields discussed here are **not** headers and are not localised — `label` on `/login` is
the cookie label, `label` on `/clients` is the device name shown in the UI. Do not translate stored
device labels; other devices will display the string verbatim.

---

## 10. Putting it together

### 10.1 Cold start, fresh installation

```
1.  GET  /api-version                       -> pick version N, learn `domain`
2.  POST /vN/login?persist=true             {email, password, label}
        403 code-authentication-required ->  POST /vN/verification-code/send {email, action:"login"}
                                             prompt user, repeat step 2 with verification_code
        403 invalid-credentials / suspended / pending-activation -> §5
        429 client-error -> honour Retry-After, stop
    <- 200 {user, access_token, expires_in, token_type} + Set-Cookie: zuid=…  (store in cookie jar)
3.  GET  /vN/self                           -> qualified_id.domain, team, supported_protocols
4.  (if team) GET /vN/teams/:team/features  -> consumableNotifications, sndFactorPasswordChallenge
5.  generate Proteus identity + N prekeys + lastkey(id 0xFFFF) [+ MLS keys]
6.  POST /vN/clients                        {type, class, label, model, cookie, password,
                                             verification_code, prekeys, lastkey, capabilities}
        403 too-many-clients -> GET /vN/clients ; DELETE /vN/clients/:id {password} ; retry 6
        403 missing-auth     -> supply `password`, retry 6
    <- 201 {id, …}  + Location: <client-id>     (persist id + client record)
7.  POST /access?client_id=<id>             (unversioned!)  Cookie: zuid=…  Authorization: Bearer …
    <- 200 fresh access_token (now carrying i=<clientId>) + possibly a new Set-Cookie
8.  ready: open the WebSocket / notification stream with the access token and client id
```

### 10.2 Warm start, cookie already stored

```
1.  GET  /api-version
2.  POST /access                            Cookie: zuid=…   (no body, unversioned)
        403 invalid-credentials -> cookie dead: drop it, go to 10.1
    <- 200 {user, access_token, …} [+ new Set-Cookie -> replace stored cookie]
3.  GET  /vN/self
4.  GET  /vN/clients/<stored client id>
        404 -> device deleted remotely: wipe Proteus + MLS stores, go to 10.1 step 5
5.  POST /access?client_id=<id>             (binds/refreshes; no-op if already bound)
6.  ready
```

### 10.3 Steady state

- Refresh via `POST /access` whenever the token is within ~10 s of `expires_in`, on any `401`, and
  before every WebSocket reconnect. Always re-store a returned `Set-Cookie`.
- Never re-run `POST /login` while a cookie is alive — that is what triggers the 429 throttle.
- On explicit logout: `POST /access/logout` (cookie + token), then drop the cookie, the access token
  and — for `temporary` clients — the client itself via `DELETE /clients/:id`.
