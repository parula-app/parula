# Wire protocol — 03: Single Sign-On (SAML2), team login codes, desktop/web SSO flow

Scope: everything a client must do when the user does **not** have a Wire password, but instead a
company login code (`wire-<UUID>`) or a company email address whose domain is bound to a SAML
identity provider. Ends at the point where the client holds a `zuid` cookie and can call
`POST /access` — from there `02-Authentication.md` takes over.

Sources (paths relative to the clone root, e.g. `wire-server/…` = `<clone>/wire-server/…`):

- `wire-server/services/spar/` — the SSO service. Owns every `/sso/*` and `/identity-providers/*`
  route. Haskell; authoritative for server behaviour.
- `wire-server/libs/wire-api/src/Wire/API/Routes/Public/Spar.hs` — the route table (paths, methods,
  query parameters, response content types).
- `wire-server/libs/wire-api/src/Wire/API/User/Saml.hs` — `VerdictFormat`, placeholder substitution,
  `SsoSettings`.
- `wire-server/libs/saml2-web-sso/` — Wire's own SAML2 Web-SSO implementation (clean, small, and the
  authoritative description of the HTML that `initiate-login` returns).
- `wire-webapp/libraries/api-client/src/` — TypeScript REST client; authoritative for *what the
  official clients actually send*.
- `wire-webapp/apps/webapp/src/script/auth/` — the login UI, incl. the popup/`postMessage` dance.
- `wire-desktop/electron/src/sso/SingleSignOn.ts` — the Electron wrapper's SSO window. **This repo
  was not in the local clone set**; it was read from
  `https://raw.githubusercontent.com/wireapp/wire-desktop/main/…` and is cited as
  `wire-desktop/…` below.

Clone commits: `wire-server` at `f2a9c1d`, `wire-webapp` at `fb0db6a` (both 2026-08-20).

Wire's SSO is **SAML 2.0 Web SSO, SP-initiated, HTTP-POST binding, only**. There is no OIDC login
path — see §11 for what the `oauth`/`oidc` identifiers in the tree actually are.

---

## 1. The shape of the flow in one paragraph

The user types a login code `wire-<uuid>` (or an email address that resolves to one). The client
strips the `wire-` prefix, leaving the **IdP ID** (a UUID). It opens
`GET <backend>/sso/initiate-login/<idpID>` **in a browser context** (popup, `BrowserWindow`,
`WebView`, system browser). Spar answers with a small HTML page that auto-POSTs a base64
`SAMLRequest` to the IdP. The user authenticates at the IdP. The IdP POSTs a `SAMLResponse` back to
`POST <backend>/sso/finalize-login/<teamID>`. Spar validates it, finds or auto-provisions the Wire
user, asks brig for a session cookie, and then answers **in the format the client asked for at
initiate time**: either an HTML page carrying `Set-Cookie: zuid=…` plus a
`window.opener.postMessage({type:'AUTH_SUCCESS'})`, or a `303` redirect to a client-chosen
`wire…://` URL with the cookie substituted into the URL. The client takes the `zuid` cookie,
calls `POST /access` to get an access token, `GET /self`, and registers a device with
`POST /clients` **without a password**.

---

## 2. Transport preliminaries specific to SSO

### 2.1 Versioning

`/sso/*` and `/identity-providers/*` are served by spar behind the same nginz as everything else and
are **versioned like the rest of the API** — the api-client prefixes `/v<N>`
(`wire-webapp/libraries/api-client/src/http/httpClient.ts:240-244`). The integration suite likewise
builds them as `Versioned` (`wire-server/integration/test/API/Spar.hs:245,251,261,270`).

Two exceptions, both deliberate and both documented in the route table as
`DeprecateSSOAPIV1 :> Deprecated`:

- `GET /sso/metadata` (no team ID) — the legacy SP metadata endpoint.
- `POST /sso/finalize-login` (no team ID) — the legacy assertion-consumer endpoint.

The comment on both says they "should exist independently of the API version" because they are used
by the IdP, not by a client (`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Spar.hs:80-84`,
`163-176`).

**Important practical detail:** `wire-webapp` opens the browser window at the *unversioned* path —
`` `${Config.getConfig().BACKEND_REST}/sso/initiate-login/${code}` ``
(`wire-webapp/apps/webapp/src/script/auth/page/login/singleSignOn.tsx:148`) — while the
`HEAD` precheck goes through the api-client and therefore *is* version-prefixed
(`wire-webapp/libraries/api-client/src/auth/authApi.ts:133-138`). Both work; spar mounts the route
under both the versioned and unversioned prefix.

### 2.2 `Z-Host`

Several spar routes take `ZHostOpt`, i.e. an optional `Z-Host: <domain>` header
(`wire-server/libs/wire-api/src/Wire/API/Routes/Public.hs:231-234`). **A client never sets this.**
nginz sets it from the request's `Host`: `proxy_set_header Z-Host $host;`
(`wire-server/deploy/dockerephemeral/federation-v1/nginz/conf/common_response_with_zauth.conf:3`).
It only matters for "multi-ingress" backends, where one wire-server serves several public domains
and an IdP is pinned to one of them; see §5.4.

---

## 3. Entry points — turning user input into an IdP ID

### 3.1 The login code format: `wire-<UUID>`

Constant: `export const SSO_CODE_PREFIX = 'wire-'`
(`wire-webapp/apps/webapp/src/script/auth/util/urlUtil.ts:67`).

The input field's HTML `pattern` is built from
`const SSO_CODE_PREFIX_REGEX = '[wW][iI][rR][eE]-'`
(`wire-webapp/apps/webapp/src/script/auth/page/login/singleSignOnForm.tsx:58`) plus

```
UUID_V4: '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
```

(`wire-webapp/libraries/commons/src/util/ValidationUtil.ts:23`), combined as

```ts
const inputPattern = enableDomainDiscovery
  ? `(${SSO_CODE_PREFIX_REGEX}${PATTERN.UUID_V4}|${PATTERN.EMAIL})`
  : `${SSO_CODE_PREFIX_REGEX}${PATTERN.UUID_V4}`;
```

(`wire-webapp/apps/webapp/src/script/auth/page/login/singleSignOnForm.tsx:308-310`)

So: case-insensitive `wire-` prefix, then a **version-4** UUID. When "domain discovery" is on, an
email address is accepted in the same field.

Stripping, verbatim
(`wire-webapp/apps/webapp/src/script/auth/page/login/singleSignOnForm.tsx:294-296`):

```ts
const stripPrefix = (prefixedCode: string) => {
  return prefixedCode.trim().toLowerCase().replace(SSO_CODE_PREFIX, '');
};
```

Note the semantics: trim, **lowercase**, then `String.replace` with a *string* argument — which
replaces only the **first** occurrence anywhere in the string, not necessarily a prefix. Reimplement
this as "trim, lowercase, strip a leading `wire-`"; that is what it means in practice.

Example: `WIRE-cb6e4dfc-a4b0-4c59-a31d-303a7f5eb5ab` → `cb6e4dfc-a4b0-4c59-a31d-303a7f5eb5ab`
(the literal test fixture is
`wire-webapp/apps/webapp/src/script/auth/page/login/singleSignOnForm.test.tsx:58,87`).

The resulting UUID **is** the `IdPId` — the same value that appears as `"id"` in
`GET /identity-providers` (§8) and as the `:idp` capture in `/sso/initiate-login/:idp`
(`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Spar.hs:146,158`).

A distributable URL form exists for the webapp:
`https://<webapp>/auth#sso/3c4f050a-f073-11eb-b4c9-931bceeed13e`
(`wire-server/docs/src/understand/single-sign-on/trouble-shooting.md:345`), and the desktop app
registers a deep link `wire://start-sso/<code>` (§7.5).

### 3.2 `GET /sso/settings` — the backend's default SSO code

Route: `"sso" :> "settings" :> Get '[JSON] SsoSettings`
(`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Spar.hs:90`, `235-238`).
No authentication. Client call:
`wire-webapp/libraries/api-client/src/account/accountApi.ts:191-199`.

Response body — the key is always present and may be `null`
(`wire-server/libs/wire-api/src/Wire/API/User/Saml.hs:108-124`):

```json
{"default_sso_code": "cb6e4dfc-a4b0-4c59-a31d-303a7f5eb5ab"}
```

```json
{"default_sso_code": null}
```

TypeScript type: `interface SSOSettings { default_sso_code: string }`
(`wire-webapp/libraries/api-client/src/account/ssoSettings.ts:20-21`).

Semantics: if non-null, the whole backend is a single-team SSO installation and the client should
jump straight to the SSO screen with the code pre-filled. The webapp does exactly that on the index
page: `return <Navigate to={`${ROUTE.SSO}/${getPrefixedSSOCode(defaultSSOCode)}`} />`
(`wire-webapp/apps/webapp/src/script/auth/page/index.tsx:83-86`), where `getPrefixedSSOCode` re-adds
the `wire-` prefix (`wire-webapp/apps/webapp/src/script/auth/util/urlUtil.ts:69-71`). It also hides
the "back" button (`hasDefaultSSOCode`,
`wire-webapp/apps/webapp/src/script/auth/module/selector/authSelector.ts:54-58`).

Failures are swallowed: `doGetSSOSettings` dispatches a failure action and does not rethrow
(`wire-webapp/apps/webapp/src/script/auth/module/action/authAction.ts:371-382`). Do the same — an
old backend without the endpoint must not block login.

### 3.3 `POST /sso/get-by-email` — email → SSO code (the current "enterprise login" path)

Route (`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Spar.hs:91-104`):

```haskell
Named "sso-get-by-email"
  ( "get-by-email" :> From 'V15 :> ZHostOpt
      :> ReqBody '[JSON] GetByEmailReq
      :> MultiVerb 'POST '[JSON]
           '[ Respond 200 "SSO code found" GetByEmailResp
            , Respond 404 "SSO code not found or feature disabled" GetByEmailResp ]
           (Maybe SAML.IdPId) )
```

Available from **API version 15**. Request:

```
POST /v16/sso/get-by-email
Content-Type: application/json

{"email": "alice@example.com"}
```

Response `200`:

```json
{"sso_code": "cb6e4dfc-a4b0-4c59-a31d-303a7f5eb5ab"}
```

Response `404` (no code): the `sso_code` field is an `optField` over a `Maybe`
(`Spar.hs:119-123`), so the body is `{}` when there is no code. The api-client's zod schema is
`z.object({sso_code: z.string().nullable()})` and any failure — HTTP error *or* schema mismatch —
is mapped to `{sso_code: null}`
(`wire-webapp/libraries/api-client/src/account/ssoCode.ts:26-30`,
`wire-webapp/libraries/api-client/src/account/accountApi.ts:253-270`). Do the same: treat
"anything other than a well-formed non-null `sso_code`" as "no SSO for this email".

Server behaviour (`wire-server/libs/wire-subsystems/src/Wire/IdPSubsystem/Interpreter.hs:79-125`):
gated on a server config flag `enableIdPByEmailDiscovery`; looks up **activated** users by that
email; requires exactly one; requires that user to have an `sso_id`; then finds the team's IdP
whose `extraInfo.domain` matches the request's `Z-Host`. Two or more users with that email →
`InconsistentUsers`. So this endpoint is a *lookup of an existing SSO user*, not a domain-policy
lookup.

### 3.4 `POST /get-domain-registration` — email domain → what to do

This is brig's "enterprise login v2" endpoint. Route
(`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig/DomainVerification.hs:456-467`):
`"get-domain-registration" :> From V10 :> ReqBody '[JSON] GetDomainRegistrationRequest :> Post '[JSON] DomainRedirectResponseV10`.

Request: `{"email": "alice@example.com"}` (`DomainVerification.hs:157-165`).
Client call: `wire-webapp/libraries/api-client/src/account/accountApi.ts:230-251`, URL constant
`GET_DOMAIN_REGISTRATION: '/get-domain-registration'` (`accountApi.ts:49`).

Response is a tagged union on `domain_redirect`
(`wire-server/libs/wire-api/src/Wire/API/EnterpriseLogin.hs:55-160`,
`wire-webapp/libraries/api-client/src/account/domainRedirect.ts:22-47`):

| `domain_redirect` | Extra fields | Client action |
|---|---|---|
| `none` | — | Normal login screen; registration allowed. |
| `locked` | — | Normal login screen; registration allowed. |
| `pre-authorized` | — | Normal login screen; registration allowed. |
| `no-registration` | `due_to_existing_account`: bool (optional) | Login screen, registration disabled; warn if `due_to_existing_account`. |
| `sso` | `sso_code`: UUID string | Start the SSO flow with this code. |
| `backend` | `backend`: `{config_url, webapp_url}` | This email belongs to a *different* Wire installation; switch backends. |

Real examples:

```json
{"domain_redirect": "none"}
{"domain_redirect": "no-registration", "due_to_existing_account": true}
{"domain_redirect": "sso", "sso_code": "cb6e4dfc-a4b0-4c59-a31d-303a7f5eb5ab"}
{"domain_redirect": "backend",
 "backend": {"config_url": "https://example.com/config.json",
             "webapp_url": "https://app.example.com"}}
```

(For API ≤ V9 the `backend` variant is flat: `{"backend_url": "…"}` and the webapp URL is dropped —
`EnterpriseLogin.hs:120-124`.)

`503 Service Unavailable` is mapped by the api-client to `{domain_redirect: 'none'}`
(`accountApi.ts:242-250`) — i.e. a disabled feature must not break login.

The webapp's dispatcher on this response is `handleEnterpriseLogin`
(`wire-webapp/apps/webapp/src/script/auth/page/login/util.ts:94-148`) and runs
`getSSOCodeByEmail` **first**, falling through to `getDomainRegistration` only if that returned
`null` (`util.ts:109-116`).

### 3.5 `GET /custom-backend/by-domain/:domain` — the older email→backend redirect

Route (`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Galley/CustomBackend.hs:28-37`):

```
GET /custom-backend/by-domain/<URL-encoded email domain>
```

Response (`wire-server/libs/wire-api/src/Wire/API/CustomBackend.hs:45-46`,
`wire-webapp/libraries/api-client/src/account/domainData.ts:20-25`):

```json
{"config_json_url": "https://example.com/config.json",
 "webapp_welcome_url": "https://app.example.com/auth"}
```

`404` with label `custom-backend-not-found` when the domain is unknown
(`wire-server/libs/wire-api/src/Wire/API/Error/Galley.hs:336`); the api-client turns that into a
`CustomBackendNotFoundError` (`accountApi.ts:171-189`).

This is the **pre-v8 path**. The webapp uses it only when
`core.backendFeatures.version < MIN_ENTERPRISE_LOGIN_V2_AND_CHANNELS_SUPPORTED_API_VERSION` (= 8)
(`wire-webapp/apps/webapp/src/script/auth/util/helpers.ts:25-27`,
`wire-webapp/apps/webapp/src/script/Config.ts:87`). It then builds a redirect URL:

```ts
const domain = email.split('@')[1];
const {webapp_welcome_url} = await doGetDomainInfo(domain);
const [, query = ''] = webapp_welcome_url.split('?');
const redirectUrl = buildDomainRedirectUrl(webapp_welcome_url, query, clientType);
```

(`wire-webapp/apps/webapp/src/script/auth/page/login/singleSignOnForm.tsx:246-257`), where
`buildDomainRedirectUrl` appends `clienttype=<permanent|temporary>&sso_auto_login=true`
(`wire-webapp/apps/webapp/src/script/auth/page/login/util.ts:47-55`). The unit test pins the exact
result: input `http://localhost:8080?test=true` →
`http://localhost:8080?test=true&clienttype=permanent&sso_auto_login=true`
(`wire-webapp/apps/webapp/src/script/auth/page/login/singleSignOnForm.test.tsx:173-180`).

`sso_auto_login=true` makes the *target* webapp submit the pre-filled SSO code automatically
(`wire-webapp/apps/webapp/src/script/auth/page/login/singleSignOnForm.tsx:142-147,288-292`;
query key `'sso_auto_login'` at `wire-webapp/apps/webapp/src/script/auth/route.ts:33`).

### 3.6 There is no `POST /login/domain-verification`

Grepping the whole route table for `login/domain-verification` finds nothing. The endpoints that do
exist under `/domain-verification` are **team-admin** operations for proving DNS ownership of a
domain, not login operations
(`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig/DomainVerification.hs:322-419`;
client side `wire-webapp/libraries/api-client/src/team/sso/ssoApi.ts:37-131`):

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/domain-verification/:domain/challenges` | Create a DNS challenge → `{dns_verification_token, id, token}` |
| `POST` | `/domain-verification/:domain/challenges/:challengeId` | Verify (unauthenticated) → `{domain_ownership_token}` |
| `POST` | `/domain-verification/:domain/team/challenges/:challengeId` | Verify (as team) → `{domain_ownership_token}` |
| `POST` | `/domain-verification/:domain/authorize-team` | Body `{domain_ownership_token}` |
| `POST` | `/domain-verification/:domain/team` | Body `{sso, team, team_invite, domain_redirect}` — **this is where a team binds `sso_code` to a domain** |
| `POST` | `/domain-verification/:domain/backend` | Body `{domain_redirect, backend:{config_url, webapp_url}}`; requires `Authorization: Bearer <domain ownership token>` |
| `GET` | `/teams/:teamId/registered-domains` | `{registered_domains: [{authorized_team, backend:{…}, dns_verification_token, domain, domain_redirect, sso_code, team, team_invite}]}` |
| `DELETE` | `/teams/:teamId/registered-domains/:domain` | — |

Types: `wire-webapp/libraries/api-client/src/team/sso/ssoApi.types.ts:20-71`. A login client needs
none of these; they are how the `sso` / `backend` answers of §3.4 get configured.

---

## 4. `HEAD /sso/initiate-login/:idpID` — validate a code before opening a window

Route (`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Spar.hs:138-149`):

```haskell
type CheckOK = Verb 'HEAD 200

type APIAuthReqPrecheck =
  Named "auth-req-precheck"
    ( QueryParam "success_redirect" URI.URI
        :> QueryParam "error_redirect" URI.URI
        :> QueryParam "label" CookieLabel
        :> Capture "idp" SAML.IdPId
        :> ZHostOpt
        :> CheckOK '[PlainText] NoContent )
```

Handler (`wire-server/services/spar/src/Spar/API.hs:314-330`): validates the redirect query params
(§5.2), loads the IdP config (404 if unknown), and checks the multi-ingress domain. No state is
created, no `AuthnRequest` is generated.

Client call — `HEAD /v<N>/sso/initiate-login/<code>`, no body, no auth
(`wire-webapp/libraries/api-client/src/auth/authApi.ts:133-138`):

```ts
public async headInitiateLogin(ssoCode: string): Promise<void> {
  const config: AxiosRequestConfig = {
    method: 'head',
    url: `${AuthAPI.URL.SSO}/${AuthAPI.URL.INITIATE_LOGIN}/${ssoCode}`,
  };
  await this.client.sendJSON(config);
}
```

Error mapping the webapp applies
(`wire-webapp/apps/webapp/src/script/auth/module/action/authAction.ts:226-247`):

| HTTP status | Synthesised label | Shown as |
|---|---|---|
| `404` | `not-found` | `BackendError.LABEL.SSO_NOT_FOUND` → "…(Error 7)." |
| `>= 500` | `server-error` | `BackendError.LABEL.SSO_SERVER_ERROR` → "…(Error 6)." |
| anything else | `generic-sso-error` | `BackendError.LABEL.SSO_GENERIC_ERROR` → "…(Error 0)." |

Because a `HEAD` reply has no body, you only get the status code — the `label` you show is
client-side.

Always do this before opening a browser window: an invalid code otherwise produces a popup showing a
raw JSON error page.

---

## 5. `GET /sso/initiate-login/:idpID` — starting the flow

### 5.1 Route and query parameters

(`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Spar.hs:151-161`)

```haskell
type APIAuthReq =
  Named "auth-req"
    ( QueryParam "success_redirect" URI.URI
        :> QueryParam "error_redirect" URI.URI
        :> QueryParam "label" CookieLabel
        :> Capture "idp" SAML.IdPId
        :> ZHostOpt
        :> Get '[SAML.HTML] (SAML.FormRedirect SAML.AuthnRequest) )
```

| Parameter | Type | Meaning |
|---|---|---|
| `success_redirect` | URI | Where to `303` on success. **Placeholders `$cookie` and `$userid` are substituted.** |
| `error_redirect` | URI | Where to `303` on failure. **Placeholder `$label` is substituted.** |
| `label` | string | Cookie label stored with the session cookie; shows up in `GET /cookies` and can be used with `POST /cookies/remove`. Type `CookieLabel` (`wire-server/libs/wire-api/src/Wire/API/User/Auth.hs:262-263`). |

### 5.2 The two verdict formats, and the validation rules

(`wire-server/services/spar/src/Spar/API.hs:402-415`, verbatim)

```haskell
redirectURLMaxLength :: Int
redirectURLMaxLength = 140

validateAuthreqParams msucc merr mlabel = case (msucc, merr) of
  (Nothing, Nothing) -> pure $ VerdictFormatWeb mlabel
  (Just ok, Just err) -> do
    validateRedirectURL `mapM_` [ok, err]
    pure $ VerdictFormatMobile ok err mlabel
  _ -> throwSparSem $ SparBadInitiateLoginQueryParams "need-both-redirect-urls"

validateRedirectURL uri = do
  unless ((SBS.take 4 . URI.schemeBS . URI.uriScheme $ uri) == "wire") $ do
    throwSparSem $ SparBadInitiateLoginQueryParams "invalid-schema"
  unless (SBS.length (URI.serializeURIRef' uri) <= redirectURLMaxLength) $ do
    throwSparSem $ SparBadInitiateLoginQueryParams "url-too-long"
```

Rules, restated:

- Give **both** `success_redirect` and `error_redirect`, or **neither**. One alone → `400` with
  label *and* message `need-both-redirect-urls`
  (`renderSparError (SparBadInitiateLoginQueryParams label) = mkError status400 label label`,
  `wire-server/services/spar/src/Spar/Error.hs:164`).
- The URI **scheme must start with the four bytes `wire`**. `wire:`, `wire-sso:`, `wireapp:` all
  pass; `https:`, `myapp:` do not → `400 invalid-schema`.
- The **serialised URI must be ≤ 140 bytes**, placeholders included → `400 url-too-long`.
  Budget carefully: `wire://login-granted/?cookie=$cookie&userid=$userid` is 47 bytes.

The chosen `VerdictFormat` is stored server-side keyed by the `AuthnRequest` ID, with the same TTL as
the request (`wire-server/services/spar/src/Spar/API.hs:354-371`;
`VerdictFormatStore.store authreqttl reqid vformat`). Type
(`wire-server/libs/wire-api/src/Wire/API/User/Saml.hs:60-64`):

```haskell
data VerdictFormat
  = VerdictFormatWeb {_cookieLabel :: Maybe CookieLabel}
  | VerdictFormatMobile {_formatGrantedURI :: URI, _formatDeniedURI :: URI, _cookieLabel :: Maybe CookieLabel}
```

If the stored format has expired by the time the IdP answers, `finalize-login` fails with
`500 server-error` / *"AuthRequest seems to have disappeared (could not find verdict format)."*
(`wire-server/services/spar/src/Spar/App.hs:319-325`,
`wire-server/services/spar/src/Spar/Error.hs:156`).

### 5.3 Placeholder substitution — exact rules

(`wire-server/libs/wire-api/src/Wire/API/User/Saml.hs:67-90`, verbatim)

```haskell
mkVerdictGrantedFormatMobile before cky uid =
  parseURI'
    . substituteVar "cookie" (decodeUtf8With lenientDecode . toStrict . Builder.toLazyByteString . renderSetCookie $ cky)
    . substituteVar "userid" (T.pack . show $ uid)
    $ renderURI before

mkVerdictDeniedFormatMobile before lbl =
  parseURI' . substituteVar "label" lbl $ renderURI before

substituteVar :: Text -> Text -> Text -> Text
substituteVar var val = substituteVar' ("$" <> var) val . substituteVar' ("%24" <> var) val

substituteVar' :: Text -> Text -> Text -> Text
substituteVar' var val = T.intercalate val . T.splitOn var
```

Consequences that matter:

- Placeholders are `$cookie`, `$userid` (success URL only) and `$label` (error URL only).
- **Both `$name` and the percent-encoded `%24name` are substituted**, so it is safe to URL-encode
  the whole redirect URI when putting it in the query string.
- `$cookie` is replaced by the **entire rendered `Set-Cookie` header value**, e.g.
  `zuid=abc123…; Path=/access; Expires=Wed, 19-Nov-2026 …; Secure; HttpOnly` — not just the token.
  You must parse it as a Set-Cookie string.
- `$userid` is the plain UUID of the Wire user.
- `$label` is a Wire error label string (see §10).
- Substitution happens *before* re-parsing the URI; if the result is not a valid URI, the request
  fails with `400 bad-success-redirect` / `400 bad-failure-redirect`
  (`wire-server/services/spar/src/Spar/App.hs:647-660`,
  `wire-server/services/spar/src/Spar/Error.hs:162-163`).

The canonical placeholder URLs, straight from Wire's own integration test
(`wire-server/services/spar/test-integration/Test/Spar/AppSpec.hs:131-136`):

```haskell
let succurl = [uri|wire://login-granted/?cookie=$cookie&userid=$userid|]
    errurl  = [uri|wire://login-denied/?label=$label|]
    mk = Builder.toLazyByteString . urlEncode [] . serializeURIRef'
    arQueries = cs $ "success_redirect=" <> mk succurl <> "&error_redirect=" <> mk errurl
    arPath = cs $ "/sso/initiate-login/" -/ SAML.idPIdToST idpid <> "?" <> arQueries
```

i.e. the full request is

```
GET /sso/initiate-login/cb6e4dfc-a4b0-4c59-a31d-303a7f5eb5ab
      ?success_redirect=wire%3A%2F%2Flogin-granted%2F%3Fcookie%3D%24cookie%26userid%3D%24userid
      &error_redirect=wire%3A%2F%2Flogin-denied%2F%3Flabel%3D%24label
```

and the same test asserts what comes back on success: `303`, `Location` scheme `wire`,
`userid` query param equal to the user's UUID, and a `cookie` query param that parses as a
`Set-Cookie` with `setCookieName == "zuid"` and `HttpOnly` set (`AppSpec.hs:100-121`).

### 5.4 Response body: the auto-POST form

The response content type is `SAML.HTML` and the value is `FormRedirect AuthnRequest`. Rendering
(`wire-server/libs/saml2-web-sso/src/SAML2/WebSSO/API.hs:265-281`, verbatim):

```haskell
instance (HasXMLRoot xml) => MimeRender HTML (FormRedirect xml) where
  mimeRender (Proxy :: Proxy HTML)
    (FormRedirect (cs . serializeURIRef' -> uri) (cs . EL.encode . cs . encode -> value)) =
      mkHtml
        [xml|
             <body onload="document.forms[0].submit()">
               <noscript>
                 <p>
                   <strong>
                     Note:
                   Since your browser does not support JavaScript, you must press the Continue button once to proceed.
               <form action=#{uri} method="post" accept-charset="utf-8">
                 <input type="hidden" name="SAMLRequest" value=#{value}>
                 <noscript>
                   <input type="submit" value="Continue">
         |]
```

So, concretely, a `200 text/html` whose body is equivalent to:

```html
<body onload="document.forms[0].submit()">
  <noscript><p><strong>Note:</strong> Since your browser does not support JavaScript,
    you must press the Continue button once to proceed.</p></noscript>
  <form action="https://login.microsoftonline.com/…/saml2" method="post" accept-charset="utf-8">
    <input type="hidden" name="SAMLRequest" value="PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz48c2FtbHA6QXV0aG5SZXF1ZXN0…">
    <noscript><input type="submit" value="Continue"></noscript>
  </form>
</body>
```

- `action` = the IdP's `requestURI` (from the IdP metadata; the same value exposed as
  `metadata.requestURI` in §8).
- `SAMLRequest` = **base64 of the raw XML** (`EL.encode` = `Data.ByteString.Base64.Lazy.encode`),
  *not* deflate+base64. This is the SAML **HTTP-POST binding**.
- The field name is fixed: `formRedirectFieldName _ = "SAMLRequest"`
  (`wire-server/libs/saml2-web-sso/src/SAML2/WebSSO/API.hs:262-263`).
- There is **no** `RelayState` field.

**This is not a `302`/`303` redirect.** A client that expects a `Location` header will break. You
must let a browser engine execute the page (or, if you insist on doing it yourself, parse the form
and POST it — that is exactly what `MimeUnrender` does at `API.hs:283-290`, matching
`{http://www.w3.org/1999/xhtml}form/@action` and `input[name=SAMLRequest]/@value`).

The `AuthnRequest` itself is minimal — ID, IssueInstant, Version, Issuer, and
`NameIdPolicy NameIDFUnspecified Nothing True` (AllowCreate)
(`wire-server/libs/saml2-web-sso/src/SAML2/WebSSO/SP.hs:146-152`); default TTL 15 minutes
(`wire-server/libs/saml2-web-sso/src/SAML2/WebSSO/API.hs:338-339`), overridden by spar's `maxttlAuthreqDiffTime`
(`wire-server/services/spar/src/Spar/API.hs:230`).

The `Issuer` (SP entity ID) and the `AssertionConsumerService`/`Audience` depend on the IdP's
`apiVersion` (`wire-server/services/spar/src/Spar/API.hs:363-370`):

- `WireIdPAPIV1` → SP issuer/ACS is `<backend>/sso/finalize-login`
- `WireIdPAPIV2` → SP issuer/ACS is `<backend>/sso/finalize-login/<teamID>`

(`wire-server/docs/src/understand/single-sign-on/trouble-shooting.md:140-153`.)

### 5.5 Multi-ingress guard

If the backend runs `isMultiIngressConfig`, spar compares the IdP's `extraInfo.domain` with the
`Z-Host` header and rejects a mismatch with `404 not-found` ("Could not find IdP: <uuid>")
(`wire-server/services/spar/src/Spar/API.hs:373-397`). Practical consequence for a third-party
client: **use the same public hostname for `/sso/initiate-login` that the user's team is configured
for**; do not silently rewrite the host.

---

## 6. `POST /sso/finalize-login/:teamID` — the IdP's callback

The client **never calls this**. The IdP's browser does, because the URL is baked into the SP
metadata the team admin uploaded.

Route (`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Spar.hs:178-187`):

```haskell
type APIAuthResp =
  Named "auth-resp"
    ( "finalize-login" :> Capture "team" TeamId
        :> MultipartForm Mem SAML.AuthnResponseBody
        :> ZHostOpt :> Post '[PlainText] Void )
```

plus the deprecated, unversioned, team-less `POST /sso/finalize-login` for `apiVersion = v1` IdPs
(`Spar.hs:166-176`).

Body: `multipart/form-data` with a single part `SAMLResponse` = base64 of the signed
`<samlp:Response>` (`wire-server/integration/test/API/Spar.hs:258-262`). Assertions must carry
`InResponseTo` — Wire supports **SP-initiated login only**; an IdP-initiated response makes spar
`303` back to `/sso/initiate-login/<idp>` to restart properly
(`wire-server/services/spar/src/Spar/API.hs:453-497`,
`wire-server/docs/src/understand/single-sign-on/trouble-shooting.md:353-390`).

What happens on the server (`wire-server/services/spar/src/Spar/App.hs:286-328`, `436-500`):

1. Extract the request ID from the assertions' `InResponseTo`; look up the stored `VerdictFormat`.
2. On `AccessGranted uref`: find the user by `UserRef` (issuer + NameID), fall back to the IdP's
   `oldIssuers` and migrate, else auto-provision a new user. Team mismatch → `403 bad-team`.
3. `cky <- BrigAPIAccess.ssoLogin uid mlabel` — spar asks brig, internally, for a session cookie:
   `POST /i/sso-login?persist=true` with body `{"user": …, "label": …}`, and takes the `Set-Cookie`
   header out of the reply
   (`wire-server/libs/wire-subsystems/src/Wire/BrigAPIAccess/Rpc.hs:1074-1092`). Note
   **`persist=true` is hard-coded** — an SSO session cookie is always a persistent one.
4. Render the verdict in the stored format.

The cookie brig produces (`wire-server/libs/wire-api/src/Wire/API/User/Auth.hs:537-545`):

```haskell
utcToSetCookie c =
  def { setCookieName = "zuid"
      , setCookieValue = toByteString' (utcToken c)
      , setCookiePath = Just "/access"
      , setCookieExpires = utcExpires c
      , setCookieSecure = utcSecure c
      , setCookieHttpOnly = True }
```

`Path=/access`, `HttpOnly`, `Secure` on HTTPS. Same cookie as a password login produces.

---

## 7. Getting the verdict back into the client

### 7.1 Web format (`VerdictFormatWeb`) — HTML + `postMessage` + `Set-Cookie`

(`wire-server/services/spar/src/Spar/App.hs:567-631`.) Both success and failure are HTTP **200**
`text/html;charset=utf-8`; the outcome is in the `<title>` and in a `postMessage`.

Success page, verbatim from the source (`App.hs:613-631`):

```haskell
successPage cky =
  SAML.ResponseVerdict ServerError
    { errHTTPCode = 200
    , errReasonPhrase = "success"
    , errBody = easyHtml $
        "<head>"
          <> "  <title>wire:sso:success</title>"
          <> "   <script type=\"text/javascript\">"
          <> "       const receiverOrigin = '*';"
          <> "       window.opener.postMessage({type: 'AUTH_SUCCESS'}, receiverOrigin);"
          <> "   </script>"
          <> "</head>"
    , errHeaders =
        [ ("Content-Type", "text/html;charset=utf-8")
        , ("Set-Cookie", toStrict . Builder.toLazyByteString . renderSetCookie $ cky) ] }
```

Failure page (`App.hs:580-612`) — same shape, `<title>wire:sso:error:<label></title>`, and

```js
window.opener.postMessage({"type":"AUTH_ERROR","payload":{"label":"forbidden","errors":[ …reasons… ]}}, '*');
```

The doc-comment above it states the contract explicitly (`App.hs:567-573`):

> The HTML page is empty and has two ways to communicate the verdict to the js app:
> - A title element with contents `wire:sso:<outcome>`. This is chosen to be easily parseable and
>   not be the title of any page sent by the IdP while it negotiates with the user.
> - The page broadcasts a message to `*`, to be picked up by the app.

So a client that owns the browser view has **two** detectors: watch the document title for the
prefix `wire:sso:`, or listen for the `postMessage`. The title is the more robust one for an
embedded webview.

Note the failure page also runs `window.opener.postMessage`, so a popup-less context throws inside
that page — but the title is still set, and the `Set-Cookie` on success is still applied to the
browsing context before the script runs.

### 7.2 Mobile format (`VerdictFormatMobile`) — `303` to a `wire…://` URL

(`wire-server/services/spar/src/Spar/App.hs:647-680`.)

Success: `303 See Other` with

```
Location: wire://login-granted/?cookie=zuid%3D…%3B%20Path%3D/access%3B%20…&userid=<uuid>
Set-Cookie: zuid=…; Path=/access; Expires=…; Secure; HttpOnly
```

(the `Set-Cookie` header is *also* present — `successPage cky uri` sets both, `App.hs:673-680`).

Failure: `303 See Other` with `Location: wire://login-denied/?label=<label>`,
`Content-Type: application/json`, and a JSON array of human-readable reason strings as the body
(`App.hs:663-672`; reason strings come from `explainDeniedReason`,
`wire-server/libs/saml2-web-sso/src/SAML2/WebSSO/XML.hs:195-233`).

This is the format a native app should use when it can register a custom URL scheme.

### 7.3 How **wire-webapp** captures the result — popup + `message` listener

`handleSSOWindow` (`wire-webapp/apps/webapp/src/script/auth/page/login/singleSignOn.tsx:77-192`) is
the whole mechanism. Key excerpts:

Opening the window (`singleSignOn.tsx:147-161`):

```ts
ssoWindowRef.current = window.open(
  `${Config.getConfig().BACKEND_REST}/sso/initiate-login/${code}`,
  'WIRE_SSO',
  `height=520, left=…, location=no, menubar=no, resizable=no, status=no, toolbar=no, top=…, width=480`,
);
```

Note: **no `success_redirect`/`error_redirect`** — the webapp uses `VerdictFormatWeb`. The window
name `'WIRE_SSO'` is load-bearing; the desktop wrapper keys off it (§7.4).

Receiving (`singleSignOn.tsx:98-143`):

```ts
onReceiveChildWindowMessage = (event: MessageEvent) => {
  const isExpectedOrigin = event.origin === Config.getConfig().BACKEND_REST;
  if (!isExpectedOrigin) { … reject(new BackendError(…, SyntheticErrorLabel.SSO_GENERIC_ERROR, 500)); }
  const eventType = isObject(event.data) && 'type' in event.data ? event.data.type : undefined;
  switch (eventType) {
    case 'AUTH_SUCCESS':      { … return resolve(); }
    case 'AUTH_ERROR':
    case 'AUTH_ERROR_COOKIE': { … return reject(new BackendError(…, event.data.payload.label ?? 'generic-sso-error', 401)); }
    default: logger.warn(`Received unmatched event type: "${eventType}"`);
  }
};
window.addEventListener('message', onReceiveChildWindowMessage, {once: false});
```

Cancellation: a 1 s `setInterval` polls `ssoWindowRef.current.closed`, and the parent's `unload`
also rejects; both with `SyntheticErrorLabel.SSO_USER_CANCELLED_ERROR`
(`singleSignOn.tsx:80,165-190`). A wrapper can force-close via the amplify event
`WebAppEvents.LIFECYCLE.SSO_WINDOW_CLOSED` (`singleSignOn.tsx:170-173`).

Because it is a same-browser popup, the `Set-Cookie: zuid=…` from the success page lands in the
shared cookie jar of the origin, and the *parent* window can immediately call `POST /access` with
`withCredentials: true` — it never needs to read the cookie value
(`wire-webapp/libraries/api-client/src/http/httpClient.ts:343-364`).

Then (`wire-webapp/apps/webapp/src/script/auth/page/login/singleSignOnForm.tsx:106-119`):

```ts
const strippedCode = stripPrefix(code);
await validateSSOCode(strippedCode);   // HEAD /sso/initiate-login/<code>
await doLogin(strippedCode);           // = handleSSOWindow: popup + postMessage
await doFinalizeSSOLogin({clientType});// = core.init(clientType) → POST /access, GET /self, POST /clients
```

### 7.4 How **wire-desktop** captures the result — isolated `BrowserWindow`, cookie copy, synthetic `message`

The Electron wrapper intercepts the popup by **window name**
(`wire-desktop/electron/src/main.ts:613-651`):

```ts
if (SingleSignOn.isSingleSignOnLoginWindow(details.frameName)) {
  return {action: 'allow',
          overrideBrowserWindowOptions: SingleSignOn.getSingleSignOnLoginWindowOptions(main, details.url)};
}
…
if (SingleSignOn.isSingleSignOnLoginWindow(frameName)) {
  const singleSignOn = new SingleSignOn(win, event, url, options).init();
  …
}
```

with `private static readonly SINGLE_SIGN_ON_FRAME_NAME = 'WIRE_SSO';`
(`wire-desktop/electron/src/sso/SingleSignOn.ts:51`) and a 480×600 child window
(`SingleSignOn.ts:196-205`).

`init()` (`SingleSignOn.ts:87-113`):

```ts
this.session = session.fromPartition(SingleSignOn.SSO_SESSION_NAME, {cache: false});   // 'sso'
this.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));               // no mic/cam
this.session.webRequest.onBeforeSendHeaders(({requestHeaders}, cb) => {
  requestHeaders['User-Agent'] = config.userAgent; cb({cancel: false, requestHeaders});
});
this.setupBrowserWindow();                       // deletes webPreferences.preload
await SingleSignOn.registerProtocol(this.session, type => this.finalizeLogin(type));
await this.ssoWindow?.loadURL(this.windowOriginUrl.toString());
```

`registerProtocol` (`SingleSignOn.ts:229-277`) registers the custom scheme
`` `${config.customProtocolName}-sso` `` — i.e. **`wire-sso:`** — inside the ephemeral session, and
accepts only `wire-sso://response/?secret=<48 hex chars>&type=<TYPE>`; the secret is 24 random bytes
hex-encoded per SSO window (`SingleSignOn.ts:223-231`), `type` must match `/^[A-Z_]{1,255}$/`
(`SingleSignOn.ts:303-308`). Response types (`SingleSignOn.ts:60-64`):

```ts
private static readonly RESPONSE_TYPES = {
  AUTH_ERROR_COOKIE: 'AUTH_ERROR_COOKIE',
  AUTH_ERROR_SESS_NOT_AVAILABLE: 'AUTH_ERROR_SESS_NOT_AVAILABLE',
  AUTH_SUCCESS: 'AUTH_SUCCESS',
};
```

On `AUTH_SUCCESS` it moves the cookie out of the isolated session
(`SingleSignOn.ts:211-221`, `283-301`):

```ts
private static async copyCookies(fromSession, toSession, url: URL) {
  const cookies = await fromSession.cookies.get({name: 'zuid'});
  for (const cookie of cookies) {
    if (cookie.domain) { await toSession.cookies.set({url: url.toString(), ...cookie}); }
  }
  await toSession.cookies.flushStore();
}
```

and then **fakes the `postMessage`** that the webapp is waiting for
(`SingleSignOn.ts:303-313`):

```ts
// Fake postMessage to the webview
const snippet = `window.dispatchEvent(new MessageEvent('message', {origin: '${this.windowOriginUrl.origin}', data: {type: '${type}'}}))`;
await executeJavaScriptWithoutResult(snippet, this.senderWebContents);
```

Note how `origin` is set to the *backend* origin — that is exactly the value the webapp compares
against `Config.getConfig().BACKEND_REST` (§7.3). `AUTH_ERROR_COOKIE` in the webapp's switch
statement exists only because of this code path.

Window close / focus are relayed both ways over IPC + amplify:
renderer `SSO_WINDOW_CLOSE`/`SSO_WINDOW_FOCUS` → main
(`wire-desktop/electron/src/preload/preload-webview.ts:105-113`,
`wire-desktop/electron/src/main.ts:583-584`), and main → renderer `SSO_WINDOW_CLOSED`
(`main.ts:605-608`, `preload-webview.ts:234-236`). Event names:
`'wire.webapp.lifecycle.sso_window_close' | '…closed' | '…focus'`
(`wire-webapp/libraries/webapp-events/src/index.ts:155-157`).

**Unresolved in the current sources:** nothing in `wire-desktop@main` or `wire-webapp@fb0db6a`
appends `success_redirect`/`error_redirect`, so nothing navigates the SSO window to
`wire-sso://response/?secret=…`. Either the `wire-sso:` protocol path is presently dead code and the
real signal is the page's own `window.opener.postMessage` reaching the opener across the partition,
or a component outside these two files supplies the redirect URLs. **UNVERIFIED** — do not copy
this ambiguity; for your own client, pass `success_redirect`/`error_redirect` explicitly (§7.2),
which is unambiguous and fully specified server-side.

### 7.5 Desktop deep link: `wire://start-sso/<code>`

`wire-desktop` registers itself as handler for the `wire:` scheme
(`wire-desktop/electron/src/lib/CoreProtocol.ts:130-136`) and routes by host
(`CoreProtocol.ts:36-40, 46-97`):

```ts
const CORE_PROTOCOL_PREFIX = `${config.customProtocolName}://`;   // 'wire://'
const CORE_PROTOCOL_MAX_LENGTH = 1024;
const START_SSO_FLOW = 'start-sso';
const JOIN_CONVERSATION_FLOW = 'conversation-join';
const START_LOGIN_FLOW = 'start-login';
…
private async handleSSOLogin(route: URL): Promise<void> {
  const code = route.pathname.trim().substr(1);
  await this.windowManager.sendActionAndFocusWindow(EVENT_TYPE.ACCOUNT.SSO_LOGIN, code);
}
```

So `wire://start-sso/wire-cb6e4dfc-a4b0-4c59-a31d-303a7f5eb5ab` opens the app and starts SSO with
that code. The event travels to the app shell, which dispatches
`EVENT_TYPE.ACTION.CREATE_SSO_ACCOUNT` with `{code}` and gets back
`CREATE_SSO_ACCOUNT_RESPONSE` `{reachedMaximumAccounts?: boolean}`
(`wire-desktop/electron/src/sso/AutomatedSingleSignOn.ts:26-70`,
`wire-desktop/electron/src/lib/eventType.ts:30,36-37`); the shell then loads the webapp with
`#sso/<code>` and `sso_auto_login=true`, which the webapp auto-submits (§3.5).

---

## 8. Listing IdPs: `GET /identity-providers`

Routes (`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Spar.hs:191-233`), client wrapper
`wire-webapp/libraries/api-client/src/team/identityprovider/identityProviderApi.ts:27-103`:

| Method | Path | Notes |
|---|---|---|
| `GET` | `/identity-providers` | `{"providers": [IdP, …]}` for the caller's team |
| `GET` | `/identity-providers/:id` | one `IdP` |
| `GET` | `/identity-providers/:id/raw` | the raw IdP metadata XML (`application/xml`) |
| `POST` | `/identity-providers?api_version=v2&replaces=<id>&handle=<name>` | body = IdP metadata XML or JSON |
| `PUT` | `/identity-providers/:id?handle=<name>` | replace metadata |
| `DELETE` | `/identity-providers/:id?purge=true` | |
| `GET` | `/sso/metadata/:teamID` | **Wire's own SP metadata XML**, for the IdP admin |

**All `/identity-providers` reads require a team admin.** `idpGet`/`idpGetAll` take `ZOptUser` but
the handlers immediately reject `Nothing`:
`authorizeIdP Nothing _ = throw (SparNoPermission …)`
(`wire-server/services/spar/src/Spar/API.hs:1101-1109`) and
`idpGetAll zusr = Intra.getZUsrCheckPerm zusr ReadIdp`
(`wire-server/services/spar/src/Spar/API.hs:578-582`).

> **Therefore: a login client cannot map a login code to an IdP before logging in.** The code *is*
> the IdP ID; you pass it straight to `/sso/initiate-login/<code>` and let `HEAD` tell you whether
> it exists. Use `GET /identity-providers` only in team-admin UI, after login.

`IdP` JSON shape — `IdPConfig WireIdP`
(`wire-server/libs/saml2-web-sso/src/SAML2/WebSSO/Types.hs:342-356`,
`304-321`, and `wire-server/libs/wire-api/src/Wire/API/User/IdentityProvider.hs:74-101`):

```json
{
  "id": "cb6e4dfc-a4b0-4c59-a31d-303a7f5eb5ab",
  "metadata": {
    "issuer": "https://sts.windows.net/682febe8-.../",
    "requestURI": "https://login.microsoftonline.com/682febe8-.../saml2",
    "certAuthnResponse": ["MIIC8DCCAdigAwIBAgIQ..."]
  },
  "extraInfo": {
    "team": "9bd1e0bb-2e5f-4b0e-9a5d-2f8b2a3f8ab1",
    "apiVersion": "WireIdPAPIV2",
    "oldIssuers": [],
    "replacedBy": null,
    "handle": "Azure AD",
    "domain": null
  }
}
```

Field notes:

- `id` — the IdP ID = the login code minus `wire-`.
- `metadata.certAuthnResponse` — non-empty array of base64 DER certificates (an IdP may sign with
  several keys; Azure does).
- `extraInfo.apiVersion` — `"WireIdPAPIV1"` or `"WireIdPAPIV2"`; decides whether the ACS URL carries
  the team ID (§5.4). Default when absent is **V1**
  (`IdentityProvider.hs:124-125`).
- `extraInfo.oldIssuers` — issuers this IdP replaced; a user still stored under an old issuer is
  migrated on login (`wire-server/services/spar/src/Spar/App.hs:385-412`).
- `extraInfo.replacedBy` — if non-null, no new users may be auto-provisioned here
  (`400 cannont-provision-on-replaced-idp`, sic —
  `wire-server/services/spar/src/Spar/Error.hs:167`).
- `extraInfo.domain` — multi-ingress pinning (§5.5).

The TypeScript mirror is *incomplete* — it omits `domain` and types `oldIssuers` as `[]`
(`wire-webapp/libraries/api-client/src/team/identityprovider/identityProvider.ts:20-36`); trust the
Haskell schema.

---

## 9. What is different after an SSO login

### 9.1 No `POST /login`

A password login does `POST /login?persist=<bool>` and reads the `zuid` cookie plus an
`AccessTokenData` body (`wire-webapp/libraries/api-client/src/auth/authApi.ts:76-96`). An SSO login
skips that entirely: the cookie is minted by spar via brig's internal `POST /i/sso-login?persist=true`
(§6). There is **no** endpoint where a client exchanges a SAML assertion for a token itself.

### 9.2 `POST /access` works exactly the same

`doFinalizeSSOLogin` calls `core.init(clientType)`
(`wire-webapp/apps/webapp/src/script/auth/module/action/authAction.ts:178-196`) →
`apiClient.init(clientType, cookie)` → `transport.http.refreshAccessToken()`
(`wire-webapp/libraries/api-client/src/apiClient.ts:350-359`) → `postAccess`
(`wire-webapp/libraries/api-client/src/http/httpClient.ts:343-364`):

```
POST /access                    (never version-prefixed)
Cookie: zuid=<token>            (Node/native; browsers send it automatically)
[Authorization: Bearer <expired token>]   (optional, only when refreshing)
```

→ `{"access_token": "...", "expires_in": 900, "token_type": "Bearer", "user": "<uuid>"}`
(`wire-webapp/libraries/api-client/src/auth/accessTokenData.ts:20-27`).

Optional `?client_id=<clientId>` binds the session to a device
(`httpClient.ts:349`, `372-377`). Nothing here is SSO-specific: after this point an SSO session and
a password session are indistinguishable on the wire.

In a native client, hold the cookie yourself and send it as a header:
`config.headers.set('Cookie', \`zuid=${cookie.zuid}\`)`
(`wire-webapp/libraries/api-client/src/shims/node/cookie.ts:54-65`); the `Cookie` type is just
`{zuid, expiration}` (`wire-webapp/libraries/api-client/src/auth/cookie.ts:20-32`).

### 9.3 `POST /clients` **without** `password`

`doFinalizeSSOLogin` calls `clientAction.doInitializeClient(clientType)` with **no password
argument** (`authAction.ts:178-186`), which reaches `core.registerClient({clientType, password: undefined, …})`
(`wire-webapp/apps/webapp/src/script/auth/module/action/clientAction.ts:62-92`) and builds

```ts
const newClient: CreateClientPayload = {
  class: clientInfo.classification,     // 'desktop' | 'phone' | 'tablet'
  capabilities,                          // ['legalhold-implicit-consent', …]
  cookie: clientInfo.cookieLabel,        // e.g. 'default'
  label: clientInfo.label,
  lastkey: lastPrekey,
  location: clientInfo.location,
  model: clientInfo.model,
  password: loginData.password !== undefined ? String(loginData.password) : undefined,  // → undefined
  verification_code: loginData.verificationCode,
  prekeys: prekeys,
  type: loginData.clientType,            // 'permanent' | 'temporary'
};
```

(`wire-webapp/libraries/core/src/client/clientService.ts:187-201`; the field is optional in the
type, `wire-webapp/libraries/api-client/src/client/newClient.ts:39-51`.)

The server allows this because re-authentication is a **no-op for SAML users**
(`wire-server/libs/wire-subsystems/src/Wire/AuthenticationSubsystem/Interpreter.hs:164-198`,
verbatim comment and code):

```haskell
-- | Password reauthentication. If the account has a password, reauthentication
-- is mandatory. If
-- * User has no password, re-auth is a no-op
-- * User is an SSO user and no password is given, re-auth is a no-op.
…
    maybeReAuth pw' = case plaintextMaybe of
      Nothing -> do
        …
        let isSaml = maybe False isSamlUser musr
        -- If this is a SAML user, re-auth should be no-op so no error is thrown.
        unless isSaml $ throw ReAuthMissingPassword
```

`isSamlUser` is true only for the SAML variant of the SSO identity — **not** for SCIM-only users
(`wire-server/libs/wire-api/src/Wire/API/User.hs:681-686`):

```haskell
isSamlUser usr = case usr.userIdentity of
  Just (SSOIdentity (UserSSOId _) _) -> True
  _ -> False
```

Client creation calls this through `upsertClient`
(`wire-server/libs/wire-subsystems/src/Wire/ClientSubsystem/Interpreter.hs:184-195`); if a password
*is* supplied for a passwordless account, it is rejected with `AuthInvalidCredentials`
(`Interpreter.hs:186`, the `Just (Nothing, _)` case).

### 9.4 `DELETE /clients/:id` without a password

Same mechanism (`wire-server/libs/wire-subsystems/src/Wire/ClientSubsystem/Interpreter.hs:357-372`):
`LegalHoldClientType` can never be removed, `TemporaryClientType` needs no re-auth, everything else
goes through `reauthenticateEither u pw` — which is a no-op for a SAML user with `pw = Nothing`.
The api-client sends `{"password": undefined}` as the DELETE body
(`wire-webapp/libraries/api-client/src/client/clientApi.ts:116-127`). This matters after
`too-many-clients`: the webapp navigates to its device-list screen and calls
`removeClient(clientId, password?)` with `password` left undefined for SSO users
(`wire-webapp/apps/webapp/src/script/auth/component/clientList.tsx:81-88`;
routing at `wire-webapp/apps/webapp/src/script/auth/page/login/util.ts:70-73`).

### 9.5 `sso_id` on the self user

`GET /self` gains an `sso_id` object
(`wire-webapp/libraries/api-client/src/self/self.ts:30-31`):

```ts
managed_by?: ManagedSource;
sso_id?: SSOSignature;
```

```ts
export interface SSOSignature {
  subject: string;
  tenant: string;
}
```

(`wire-webapp/libraries/api-client/src/self/ssoSignature.ts:20-22`.)

The server encodes **two mutually exclusive variants**
(`wire-server/libs/wire-api/src/Wire/API/User/Identity.hs:201-210`, verbatim):

```haskell
instance ToJSON UserSSOId where
  toJSON = \case
    UserSSOId (SAML.UserRef tenant subject) -> A.object ["tenant" A..= SAML.encodeElem tenant, "subject" A..= SAML.encodeElem subject]
    UserScimExternalId eid -> A.object ["scim_external_id" A..= eid]
```

so the real shapes are:

```json
{"sso_id": {"tenant": "<XML-encoded saml:Issuer>", "subject": "<XML-encoded saml:NameID>"}}
{"sso_id": {"scim_external_id": "alice@example.com"}}
```

`tenant` and `subject` are **XML fragments**, not plain strings — e.g.
`<Issuer xmlns="urn:oasis:names:tc:SAML:2.0:assertion">https://sts.windows.net/…/</Issuer>`.
Treat them as opaque. The TS type only models the SAML variant; the SCIM variant is missing there.

Client-side derivations (`wire-webapp/apps/webapp/src/script/auth/module/selector/selfSelector.ts:57-60`):

```ts
export const isSSOUser = (state) => getSelf(state).sso_id !== undefined;
export const isNoPasswordSSO = (state) => {
  const subject = getSelf(state).sso_id?.subject;
  return subject !== undefined && subject.length > 0;
};
```

i.e. **`sso_id.subject` present ⇒ SAML user ⇒ no password**; `sso_id` present without `subject`
⇒ SCIM-provisioned, may still have a password.

To ask the backend directly, `HEAD /self/password` → `200` = has a password, `404` = has none
(`wire-webapp/libraries/api-client/src/self/selfApi.ts:205-210`,
`wire-webapp/apps/webapp/src/script/auth/module/action/selfAction.ts:129-145`).

### 9.6 Other consequences

- The account has **no email** unless the IdP sends one and the team has email validation enabled
  (`wire-server/services/spar/src/Spar/App.hs:262-275`). The webapp guards its "set email" and "set
  password" pages with `isSelfSSOUser`
  (`wire-webapp/apps/webapp/src/script/auth/page/setEmail.tsx:135`,
  `setPassword.tsx:150`).
- Auto-provisioning: the first successful assertion for an unknown `UserRef` **creates** the Wire
  user inside the IdP's team (`Spar/App.hs:436-457`). No invitation is needed.
- `clientType` is still chosen by the client. The webapp offers the "public computer" checkbox
  (→ `temporary`) only when not running as the desktop app
  (`wire-webapp/apps/webapp/src/script/auth/page/login/singleSignOnForm.tsx:389-403`), and honours `?clienttype=temporary`
  (`singleSignOnForm.tsx:149-156`).
- Logout is the same `POST /access/logout` with the cookie
  (`wire-webapp/libraries/api-client/src/auth/authApi.ts:100-106`).

---

## 10. Error labels

### 10.1 Labels spar can put into `$label` / `AUTH_ERROR.payload.label` / an HTTP error body

From `wire-server/services/spar/src/Spar/Error.hs:155-240`, restricted to what a *login* client can
hit:

| Label | HTTP | Source | Meaning |
|---|---|---|---|
| `forbidden` | 403 | `SAML.Forbidden` | Assertion rejected (signature, audience, expiry, …). The `errors` array carries `explainDeniedReason` strings. |
| `not-found` | 404 | `SparIdPNotFound` / `SparSPNotFound` / `UnknownIdP` | Bad login code, or multi-ingress host mismatch. |
| `server-error` | 500 | `SparNoSuchRequest` | "AuthRequest seems to have disappeared" — verdict format expired. |
| `server-error-unsupported-saml` | 400 | `SparNoRequestRefInResponse` | IdP omitted `InResponseTo`. |
| `bad-success-redirect` | 400 | `SparCouldNotSubstituteSuccessURI` | Substituted `success_redirect` no longer parses. |
| `bad-failure-redirect` | 400 | `SparCouldNotSubstituteFailureURI` | Same for `error_redirect`. |
| `need-both-redirect-urls` | 400 | `SparBadInitiateLoginQueryParams` | Only one of the two redirect params given. |
| `invalid-schema` | 400 | idem | Redirect URI scheme does not start with `wire`. |
| `url-too-long` | 400 | idem | Redirect URI > 140 bytes. |
| `bad-team` | 403 | `SparUserRefInNoOrMultipleTeams` | Same `UserRef` in another/no team. |
| `bad-username` | 400 | `SparBadUserName` | NameID length outside `[1, 128]`. |
| `cannont-provision-on-replaced-idp` | 400 | `SparCannotCreateUsersOnReplacedIdP` | IdP was replaced; user must use the new one. (Spelling is the server's.) |
| `bad-upstream` | 502 | `SparCouldNotParseRfcResponse` / `SparCouldNotRetrieveCookie` | Spar↔brig failure. |
| `sso-disabled` | 403 | `SparSSODisabled` | Team feature off. |
| `idp-cert-not-allowed` | 403 | `SparIdPCertNotAllowed` | IdP cert not in the backend's allowlist. |
| `bad-response-encoding` / `bad-response-xml` / `bad-response-saml` / `bad-response-signature` | 400 | `SAML.BadSamlResponse*` | Malformed `SAMLResponse`. |
| `no-matching-auth-req` | — | — | Present in the client enum (`BackendErrorLabel.SSO_NO_MATCHING_AUTH`); no current `mkError` in spar emits this exact string. **UNVERIFIED** whether any deployed version still does. |

### 10.2 The client-side enums

`wire-webapp/libraries/api-client/src/http/backendErrorLabel.ts:126-133` (backend labels) and
`:141-143` (synthesised by the client):

```ts
// SSO errors
SSO_FORBIDDEN = 'forbidden',
SSO_INVALID_FAILURE_REDIRECT = 'bad-failure-redirect',
SSO_INVALID_SUCCESS_REDIRECT = 'bad-success-redirect',
SSO_INVALID_UPSTREAM = 'bad-upstream',
SSO_INVALID_USERNAME = 'bad-username',
SSO_NO_MATCHING_AUTH = 'no-matching-auth-req',
SSO_UNSUPPORTED_SAML = 'server-error-unsupported-saml',
…
SSO_GENERIC_ERROR = 'generic-sso-error',
SSO_NO_SSO_CODE = 'no-sso-code-found',
SSO_USER_CANCELLED_ERROR = 'user-cancelled-sso-error',
```

### 10.3 What to show the user

The official mapping (`wire-webapp/apps/webapp/src/script/util/errorUtil.ts:57-68` →
`wire-webapp/apps/webapp/src/i18n/en-US.json:35-45`) is deliberately opaque — one sentence plus a
number, so support can triage:

| Label | English string |
|---|---|
| `generic-sso-error` | "Something went wrong. Please contact your team administrator for details (Error 0)." |
| `server-error-unsupported-saml` | "… (Error 1)." |
| `bad-success-redirect` | "… (Error 2)." |
| `bad-failure-redirect` | "… (Error 3)." |
| `bad-username` | "… (Error 4)." |
| `bad-upstream` | "… (Error 5)." |
| `server-error` | "… (Error 6)." |
| `not-found` | "… (Error 7)." |
| `forbidden` | "… (Error 8)." |
| `no-matching-auth-req` | "… (Error 9)." |
| `insufficient-permissions` | "… (Error 10)." |

Plus validation strings: `"Please enter a valid SSO code"` (`ValidationError.FIELD.SSO_CODE.PATTERN_MISMATCH`)
and `"Please enter a valid email or SSO code"` (`…SSO_EMAIL_CODE.PATTERN_MISMATCH`)
(`en-US.json:93-94`).

Special-cased flows rather than messages
(`wire-webapp/apps/webapp/src/script/auth/page/login/util.ts:57-92`):

```ts
match(error.label)
  .with(BackendErrorLabel.TOO_MANY_CLIENTS, () => { resetAuthError(); navigate(ROUTE.CLIENTS); })
  .with(BackendErrorLabel.CUSTOM_BACKEND_NOT_FOUND, () => setSsoError(error))
  .with(P.union(BackendErrorLabel.INVALID_CONVERSATION_PASSWORD,
                SyntheticErrorLabel.SSO_USER_CANCELLED_ERROR,
                BackendErrorLabel.NOT_FOUND), noop)
  .otherwise(() => { setSsoError(error); … });
```

i.e. `too-many-clients` → device-removal screen; user-cancelled → say nothing at all.

---

## 11. OIDC / OAuth — what actually exists

**There is no OIDC identity provider support in spar.** Searching the whole `wire-server` tree for
`oidc` finds only two CHANGELOG entries about Kubernetes/AWS tooling
(`wire-server/CHANGELOG.md:239,3908`). `IdPMetadata` has exactly three fields — `issuer`,
`requestURI`, `certAuthnResponse` — all SAML
(`wire-server/libs/saml2-web-sso/src/SAML2/WebSSO/Types.hs:304-321`). `WireIdPAPIVersion` has only
`WireIdPAPIV1` / `WireIdPAPIV2`, both SAML.

The two things named "oauth"/"oidc" in the tree are unrelated to login:

**(a) Wire as an OAuth 2.0 authorization server**, so third-party apps can act *on behalf of* an
already-logged-in Wire user (`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig/OAuth.hs`,
client `wire-webapp/libraries/api-client/src/oauth/oAuthApi.ts:28-98`):

| Method | Path | Notes |
|---|---|---|
| `GET` | `/oauth/clients/:clientId` | `{application_name, client_id, redirect_url}` |
| `POST` | `/oauth/authorization/codes` | Needs `Z-User`. Body below. Reply's `Location` header is the redirect. |
| `POST` | `/oauth/token` | `application/x-www-form-urlencoded`, `grant_type=authorization_code|refresh_token` |
| `POST` | `/oauth/revoke` | |
| `GET` | `/oauth/applications` | |
| `DELETE` | `/oauth/applications/:clientId/sessions` | optional `{password}` |

Authorization-code request body
(`wire-webapp/libraries/api-client/src/oauth/oAuthBody.ts:118-126`):

```json
{"client_id": "...", "code_challenge": "...", "code_challenge_method": "S256",
 "redirect_uri": "...", "response_type": "code", "scope": "read:self read:feature_configs",
 "state": "..."}
```

Scopes are a closed set: `write:conversations`, `write:conversations_code`, `read:self`,
`read:feature_configs` (`wire-server/libs/wire-api/src/Wire/API/OAuth.hs:197-235`). PKCE `S256`
only (`OAuth.hs:266-269`). **This requires an existing Wire session — it is not a way to log in.**

**(b) OIDC in the webapp's E2E-identity enrollment** — `oidc-client-ts` used to satisfy the ACME
`oidc` challenge when issuing an end-to-end identity certificate
(`wire-webapp/apps/webapp/src/script/e2eIdentity/oidcService/oidcService.ts:21-42`, redirect URI
`` `${currentOrigin}/oidc` ``). This runs **after** login and does not produce a Wire session.

---

## 12. Step-by-step algorithm for a third-party Electron client

Assumptions: you have the backend base URL `B` (from `config.json` or the default), you have
negotiated an API version `V` via `GET /api-version`, and you have a persistent cookie/token store.

1. **Offer the SSO entry point.** Call `GET B/v{V}/sso/settings`. If `default_sso_code` is a
   non-null UUID, pre-fill the code field with `wire-<default_sso_code>` and consider skipping the
   password screen entirely. Ignore any error here.

2. **Read the user's input.** Accept either `wire-<uuid-v4>` (case-insensitive) or an email address.
   Validate against
   `([wW][iI][rR][eE]-<uuid-v4>|<email>)`.

3. **Resolve an email to a code** (only if the user typed an email):
   a. If `V >= 15`: `POST B/v{V}/sso/get-by-email` `{"email": …}`. On `200` with a non-null
      `sso_code`, that is your code — go to step 4.
   b. If `V >= 10`: `POST B/v{V}/get-domain-registration` `{"email": …}` and switch on
      `domain_redirect`:
      - `sso` → use `sso_code`, go to step 4.
      - `backend` → this user belongs to another installation: fetch `backend.config_url`, switch
        the app's backend, and restart the flow there. Ask the user first.
      - `no-registration` → password login only, registration disabled (mention
        `due_to_existing_account` if true).
      - `none` / `locked` / `pre-authorized` → fall back to password login.
   c. Otherwise (old backend): `GET B/custom-backend/by-domain/<domain>`; on `200`, offer to switch
      to `webapp_welcome_url` / `config_json_url`; on `404 custom-backend-not-found`, fall back to
      password login.

4. **Strip the prefix.** `code = input.trim().toLowerCase()`, remove a leading `wire-`. What's left
   is `idpID`.

5. **Pre-validate.** `HEAD B/v{V}/sso/initiate-login/{idpID}`. `200` → continue. `404` → "invalid
   SSO code". `>= 500` → "server error, try later". Anything else → generic SSO error. Do **not**
   open a window on failure.

6. **Choose how you will receive the verdict.** Two supported designs; pick one and stick to it.

   **(6-A) Recommended for Electron: `wire…://` redirect + your own `BrowserWindow`.**
   - Register a private scheme in a **dedicated, non-persistent Electron session**:
     `const s = session.fromPartition('sso-' + nonce, {cache: false})` and
     `s.protocol.registerStringProtocol('myapp-sso', handler)`. Use a per-attempt random secret in
     the URL so a malicious page cannot forge a verdict (this is precisely what
     `wire-desktop/electron/src/sso/SingleSignOn.ts:229-277` does).
   - Build, **URL-encoded**, and keeping each under 140 bytes and with a scheme starting with
     `wire`:
     ```
     success_redirect = wire-x://sso/?s=<secret>&c=$cookie&u=$userid
     error_redirect   = wire-x://sso/?s=<secret>&e=$label
     ```
     (`wire-x` is a legal scheme here only because its first four bytes are `wire`; a scheme like
     `myapp` is rejected with `invalid-schema`.)
   - Optionally add `label=<device label>`; it becomes the cookie label.
   - Open in a `BrowserWindow` bound to that session, `nodeIntegration: false`,
     `contextIsolation: true`, `sandbox: true`, no preload, permission handler denying
     mic/camera, and a `setWindowOpenHandler` that denies popups and sends them to the OS browser:
     ```
     GET B/sso/initiate-login/{idpID}?success_redirect=…&error_redirect=…[&label=…]
     ```
     Load the **unversioned** path, exactly as wire-webapp does; the IdP will be redirected
     through several hosts and a version prefix buys you nothing.
   - Wait for your protocol handler to fire. Validate scheme, host, and secret. On the success URL:
     `userid` is the plain UUID; `cookie` is a **whole Set-Cookie header value** — parse it and keep
     `zuid` plus its `Expires`. On the error URL: map `label` per §10 and abort.
   - Also handle: window closed by the user → "cancelled"; `will-navigate` to an absurdly long
     origin → block; a hard timeout (5–10 min) → abort and close.

   **(6-B) Web-format fallback (no custom scheme, e.g. an embedded `WebView` on a platform where
   you cannot register one).** Open `GET B/sso/initiate-login/{idpID}` with **no** redirect params.
   Then detect completion by watching the document title for the prefix `wire:sso:`
   — `wire:sso:success` or `wire:sso:error:<label>` — and read the `zuid` cookie out of the
   webview's cookie jar for the backend origin (`session.cookies.get({name: 'zuid'})`). Copy it into
   your app's session, as `SingleSignOn.copyCookies` does
   (`wire-desktop/electron/src/sso/SingleSignOn.ts:211-221`). Alternatively, if your host page is a
   real browser window that used `window.open(url, 'WIRE_SSO')`, listen for
   `message` events and check `event.origin === B` before trusting
   `event.data.type === 'AUTH_SUCCESS'`.

   **Do not** use the system browser (`shell.openExternal`) unless you also register an
   OS-level `wire…://` handler — the cookie would otherwise land in the user's browser, out of
   reach. If you do register one, the OS delivers the redirect via Electron's `open-url`
   (macOS) / second-instance `argv` (Windows/Linux), the way
   `wire-desktop/electron/src/lib/CoreProtocol.ts:126-145` handles `wire://start-sso/...`.

7. **Exchange the cookie for an access token.**
   ```
   POST B/access                    ← note: NO /v{V} prefix
   Cookie: zuid=<token>
   ```
   → `{"access_token", "expires_in", "token_type": "Bearer", "user"}`. Persist the cookie
   (`Path=/access`, `HttpOnly`, `Secure`) and schedule refresh before `expires_in`.

8. **Fetch the profile.** `GET B/v{V}/self` with `Authorization: Bearer …`. Record `sso_id`. If
   `sso_id.subject` is present, this is a SAML user with **no password** — hide every "change
   password" / "enter password" affordance and never send a `password` field again. Cross-check with
   `HEAD B/v{V}/self/password` (`200` = has one, `404` = has none) if you want certainty.

9. **Register the device.** `POST B/v{V}/clients` with `{class, type, cookie: <label>, label,
   lastkey, prekeys, capabilities}` and **no `password`**. Use `type: "permanent"` normally,
   `"temporary"` if the user ticked "public computer". On `403 too-many-clients`, list devices
   (`GET /clients`), let the user remove one with `DELETE /clients/:id` and **no password**, then
   retry.

10. **Continue as a normal session.** Bind the client to the session with
    `POST B/access?client_id=<clientId>` if you use that pattern, open the websocket, and hand off to
    the normal sync path. Nothing after this point is SSO-specific.

Additional hardening worth copying from wire-desktop:

- Isolate the SSO browsing context in its own ephemeral session and wipe it when the window closes
  (`clearStorageData`) — the IdP may set its own long-lived cookies you do not want
  (`SingleSignOn.ts:126-137, 315-317`).
- Normalise the `User-Agent` in that session (`SingleSignOn.ts:95-98`); some IdPs behave differently
  for unknown agents.
- Show the current origin in the window title so the user can see which IdP they are talking to, and
  blank it while still on the Wire backend (`SingleSignOn.ts:147-155, 207-209`).
- Give the user an explicit "continue in the login window" affordance — the webapp shows an overlay
  with a focus link because the popup often ends up behind the main window
  (`wire-webapp/apps/webapp/src/script/auth/page/login/singleSignOn.tsx:194-231`,
  `wire-webapp/apps/webapp/src/i18n/en-US.json:2048-2049`).
- If your IdP integration hangs at the redirect back to Wire with a CSP error, the IdP needs
  `form-action` to include `wire://*` — this is a documented, real customer problem
  (`wire-server/docs/src/understand/single-sign-on/trouble-shooting.md:383-400`).

---

## 13. Known gaps in this document

- Who navigates the wire-desktop SSO window to `wire-sso://response/?secret=…&type=…` is
  **UNVERIFIED** (§7.4). The server side of both verdict formats is fully specified regardless.
- `no-matching-auth-req` appears in the client enum but no `mkError` in `Spar/Error.hs@f2a9c1d`
  emits it — **UNVERIFIED** which server version does.
- The exact `Expires` / `Max-Age` on the `zuid` cookie is a server config value
  (`utcExpires`); not pinned here.
- Whether an installation has `enableIdPByEmailDiscovery` on (§3.3) or is multi-ingress (§5.5) is
  deployment configuration and cannot be probed from the client except by trying.
