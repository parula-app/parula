# Wire Protocol — Assets (files, images, audio, video, profile pictures) + calling signalling

> Sources read 2026-08-20. Citations are `path:line` into these trees:
> * `wire-webapp/` @ `fb0db6aca396300c16603dfb45a185ad31bb4b86` — official web client monorepo.
> * `wire-web-packages/` @ `426fb4f0f385f30f18479f01d092137b140c3ebc` — older standalone `@wireapp/*`.
> * `wire-server/` @ `f2a9c1dfd08d8203f447605dfda180ff750da1bf` — the backend (`services/cargohold`).
> * `messages.proto` — `wireapp/generic-message-proto`, `proto/messages.proto`, master. **Not in the
>   clones** (consumed as npm `@wireapp/protocol-messaging`, pinned `1.56.0` in
>   `wire-webapp/libraries/core/package.json:34`); fetched from GitHub raw. Line numbers are that file's.
>
> Unverifiable claims are marked **UNVERIFIED**.

Wire's asset service is **cargohold**: a dumb blob store in front of S3. It never sees plaintext.
The client encrypts, uploads ciphertext as an opaque blob, and puts the AES key + digest into the
(already end-to-end encrypted) protobuf message. Profile pictures are the one exception — those are
uploaded in the clear, on purpose.

---

## 1. Upload — `POST /assets`

### 1.1 Route table and the `/v3` / `/v4` confusion

Two independent version numbers collide in these URLs:

* **API version** — a `/vN` path prefix stripped by a WAI middleware, which converts it to the
  internal header `X-Wire-API-Version` (`wire-server/libs/wire-api/src/Wire/API/Routes/Version/Wai.hs:35-91`,
  `libs/wire-api/src/Wire/API/VersionInfo.hs:55-58`). A client-supplied `X-Wire-API-Version` is
  stripped first (`Wai.hs:82-85`), so it cannot be spoofed. **A request with no `/vN` prefix is
  treated as v0** (`VersionInfo.hs:72-78`). Versions are `V0…V17`
  (`libs/wire-api/src/Wire/API/Routes/Version.hs:106`); V17 is the development version (`:294`).
  `Until 'V2` means "≤ V1", `From 'V2` means "≥ V2" (`VersionInfo.hs:63-67,91-106,151-158`).
* **Asset API generation** — the fossilised `v3` / `v4` *path segment*. **CONFIRMED not the API
  version**: `wire-server/libs/wire-api/src/Wire/API/Routes/Public/Cargohold.hs:134-137` — *"This was
  introduced before API versioning, and the user endpoints contain a v3 suffix, which is removed
  starting from API V2"* — and `:260-262`, plus `wire-server/CHANGELOG.md:5165-5174`. `v3` =
  unqualified, `v4` = domain-qualified. The `3` in the asset key (§1.6) is the same generation.

So a v1 upload is literally `POST /v1/assets/v3`, and a v2+ upload is `POST /v2/assets`.

| Path (after `/vN` strip) | Method | API versions | Params | Success |
|---|---|---|---|---|
| `/assets/v3` | POST | v0, v1 | body `multipart/mixed` | 201 `Asset` + `Location` |
| `/assets/v3/{key}` | GET | v0, v1 | `Asset-Token` hdr, `asset_token` query, `Z-Host` hdr | 302 + `Location` |
| `/assets/v3/{key}` | DELETE | v0, v1 | — | 200 empty |
| `/assets/v3/{key}/token` | POST / DELETE | v0, v1 | — | 200 `{token}` / 200 empty |
| `/assets/v4/{domain}/{key}` | GET | v0, v1 | as above | 302 **or** 200 stream |
| `/assets/v4/{domain}/{key}` | DELETE | v0, v1 | — | 200 empty |
| `/assets/{id}?conv_id=` | GET | v0, v1 | `conv_id` **required** | 302 |
| `/conversations/{cnv}/assets/{id}`, `…/otr/assets/{id}` | GET | v0, v1 | — | 302 |
| **`/assets`** | **POST** | **v2+** | body `multipart/mixed` | **201 `Asset` + `Location`** |
| **`/assets/{domain}/{key}`** | **GET** | **v2+** | `Asset-Token`, `asset_token`, `Z-Host` | **302 or 200 stream** |
| `/assets/{domain}/{key}` | DELETE | v2+ | — | 200 empty |
| `/assets/{key}/token` | POST / DELETE | v2+ | — | 200 `{token}` / 200 empty |
| `/bot/assets`, `/bot/assets/{key}` | POST / GET / DELETE | **all** | `Z-Bot` auth | as above |
| `/provider/assets`, `/provider/assets/{key}` | POST / GET / DELETE | **all** | `Z-Provider` auth | as above |

Route source: `wire-server/libs/wire-api/src/Wire/API/Routes/Public/Cargohold.hs:101-350`; the
principal→path expansion (`Until 'V2` applies **only** to the user variant) at `:59-65`; auth header
names `Z-User` / `Z-Bot` / `Z-Provider` at `libs/wire-api/src/Wire/API/Routes/Public.hs:120,157,176`;
optional nginz-injected `Z-Host` at `Public.hs:224-234`.

**There is no `HEAD` route and no `Z-Asset-Token` header.** An exhaustive grep of `wire-server` for
`'HEAD` and `Z-Asset` returns nothing. The only two token transports are the **`Asset-Token` request
header** and the **`asset_token` query parameter**, and the header wins:
`wire-server/services/cargohold/src/CargoHold/API/Public.hs:210` — `let tok = tok1 <|> tok2`.

The api-client stores `versionPrefix = version > 0 ? '/v'+version : ''` and prepends it to every URL
except `/access` (`wire-webapp/libraries/api-client/src/http/httpClient.ts:179-181,241-244`). Version
negotiation is `GET /api-version` → `{supported, development?, domain, federation}`
(`libraries/api-client/src/apiClient.ts:314-330`); `MINIMUM_API_VERSION = 1`
(`libraries/api-client/src/config.ts:27`). The client only knows the modern paths — `/assets` and
`/bot/assets` (`libraries/api-client/src/asset/assetApi.ts:255-261`).

### 1.2 The multipart/mixed body — exact construction

Request header: `Content-Type: multipart/mixed; boundary=<BOUNDARY>`. The body is hand-built:

```ts
// wire-webapp/libraries/api-client/src/asset/assetApi.ts:138-181
    const BOUNDARY = `Frontier${unsafeAlphanumeric()}`;

    const metadataObject: {…} = {
      public: options?.public ?? true,
      retention: options?.retention ?? AssetRetentionPolicy.PERSISTENT,
      domain: options?.domain,
    };
    if (options?.auditData !== undefined) {
      metadataObject.convId = options.auditData.conversationId;
      metadataObject.filename = options.auditData.filename;
      metadataObject.filetype = options.auditData.filetype;
    }
    const metadata = JSON.stringify(metadataObject);

    const body =
      `--${BOUNDARY}\r\n` +
      'Content-Type: application/json;charset=utf-8\r\n' +
      `Content-length: ${metadata.length}\r\n` +
      '\r\n' +
      `${metadata}\r\n` +
      `--${BOUNDARY}\r\n` +
      'Content-Type: application/octet-stream\r\n' +
      `Content-length: ${asset.length}\r\n` +
      `Content-MD5: ${base64MD5FromBuffer(asset.buffer as ArrayBuffer)}\r\n` +
      '\r\n';

    const footer = `\r\n--${BOUNDARY}--\r\n`;
    …
      data: concatToBuffer(body, asset, footer),
      headers: {'Content-Type': `multipart/mixed; boundary=${BOUNDARY}`},
```
```ts
// wire-webapp/libraries/api-client/src/shims/node/buffer.ts:24-28
export const base64MD5FromBuffer = (buffer: ArrayBuffer): string =>
  createHash('md5').update(Buffer.from(buffer)).digest('base64');
export const concatToBuffer = (...items: any[]) => Buffer.concat(items.map(item => Buffer.from(item)));
```
```ts
// wire-webapp/libraries/api-client/src/shims/node/random.ts:48-53  (default length = 32)
export const unsafeAlphanumeric = (length: number = 32): string => { /* [A-Za-z0-9] */ };
```

Boundary = literal `Frontier` + 32 random `[A-Za-z0-9]`, e.g. `FrontierhQ2mZ8XkP1sV0bNcRuLtWyEjDgAf`.

**Byte layout** (`CRLF` = `0D 0A`; `<J>` = UTF-8 JSON bytes; `<A>` = raw asset bytes = the *ciphertext*):

```
--<BOUNDARY>CRLF
Content-Type: application/json;charset=utf-8CRLF
Content-length: <len(J)>CRLF
CRLF
<J>CRLF
--<BOUNDARY>CRLF
Content-Type: application/octet-streamCRLF
Content-length: <len(A)>CRLF
Content-MD5: <base64(md5(A))>CRLF
CRLF
<A>CRLF
--<BOUNDARY>--CRLF
```

A byte-exact real request, captured from the web app and frozen as a regression test — copy this shape:

```haskell
-- wire-server/integration/test/Test/Cargohold/API.hs:272-287  (testUploadCompatibility, expects 201)
    exampleMultipart =
        "--FrontierIyj6RcVrqMcxNtMEWPsNpuPm325QsvWQ\r\n\
        \Content-Type: application/json;charset=utf-8\r\n\
        \Content-length: 37\r\n\
        \\r\n\
        \{\"public\":true,\"retention\":\"eternal\"}\r\n\
        \--FrontierIyj6RcVrqMcxNtMEWPsNpuPm325QsvWQ\r\n\
        \Content-Type: application/octet-stream\r\n\
        \Content-length: 4\r\n\
        \Content-MD5: CY9rzUYh03PK3k6DJie09g==\r\n\
        \\r\n\
        \test\r\n\
        \--FrontierIyj6RcVrqMcxNtMEWPsNpuPm325QsvWQ--\r\n\
        \\r\n"
```

That test posts it to `/v1/assets/v3` with `Content-Type: multipart/mixed` — **with no `boundary=`
parameter at all** (`wire-server/integration/test/API/Cargohold.hs:81-83`,
`integration/test/Testlib/HTTP.hs:124-125`) — and still gets 201. See §1.3 for why.

**Gotcha — real bug in the reference client.** `Content-length` for the JSON part is
`metadata.length`, the JS **string** length (UTF-16 code units), but the server reads exactly that
many **bytes**. Fine for ASCII; breaks as soon as the optional audit `filename` contains non-ASCII.
A new client must send the UTF-8 **byte** length. The server's own builder gets it right
(`wire-server/libs/wire-api/src/Wire/API/Asset.hs:256-284`, using `LBS.length settingsJson`; it also
uses the literal boundary `frontier` and omits `Content-MD5`).

### 1.3 How strictly the server parses it

Cargohold uses a hand-written streaming attoparsec parser, not a MIME library
(`wire-server/services/cargohold/src/CargoHold/API/V3.hs:151-259`). What matters:

```haskell
-- wire-server/services/cargohold/src/CargoHold/API/V3.hs:225-253
boundary :: Parser ()
boundary = char '-' *> char '-' *> takeTill isEOL *> eol <?> "MIME boundary"

-- | Not all listed headers must be found, but other headers (or duplicates) raise an error.
headers :: [HeaderName] -> Parser [(HeaderName, ByteString)]
headers allowed = do
  optional (CI.mk <$> takeWhile1 (\c -> isAlphaNum c || c == '-') <?> "header name") >>= \case
    Nothing -> pure []
    Just name
      | name `notElem` allowed -> fail $ "Unexpected header: " ++ show (CI.original name)
      | otherwise -> do
          _ <- char ':'; skipSpace
          value <- takeTill isEOL <?> "header value"; eol
          ((name, value) :) <$> headers (List.delete name allowed)
```
```haskell
-- wire-server/services/cargohold/src/CargoHold/API/V3.hs:180-209  (abridged)
assetSettings = do
  (ct, cl) <- metadataHeaders
  unless (MIME.mimeType ct == MIME.Application "json") $
    fail "Invalid metadata Content-Type. Expected 'application/json'."
  bs <- take (fromIntegral cl)          -- reads exactly Content-Length BYTES
  either fail pure (eitherDecodeStrict' bs)
metadataHeaders = optional eol *> boundary *> (headers [hContentType, hContentLength] >>= go) <* eol
assetHeaders    = eol *> boundary *> (headers [hContentType, hContentLength, hContentMD5] >>= go) <* eol
  where go hdrs = AssetHeaders <$> contentType hdrs <*> contentLength hdrs
```

1. **The boundary value is never validated** — `--` then anything to CRLF. The `boundary=` parameter
   of the request `Content-Type` is never consulted. Any token works; `Frontier…`/`frontier` are
   conventions.
2. Header names are **case-insensitive** (`CI.mk`), values left-trimmed (`skipSpace`). Hence
   `Content-length` works.
3. **Only allowlisted headers, none twice**: part 1 = `Content-Type` + `Content-Length`; part 2 =
   those plus `Content-MD5`. Anything else (`Content-Disposition`, `Content-Transfer-Encoding`) or a
   duplicate ⇒ **400 `client-error`**. `Content-MD5` on part 1 is also a 400.
4. Both headers are **required** in both parts (`V3.hs:211-223`; note the copy-paste bug: a missing
   `Content-Length` reports `"Missing Content-Type"`).
5. Part 1's `Content-Type` must have media type `application/json`; **parameters are ignored** (only
   `MIME.mimeType` is compared) — so `;charset=utf-8` is fine.
6. **`Content-MD5` is accepted but never verified.** It is allowlisted at `V3.hs:203` then discarded
   by `go` (`:206-209`); no other use exists in `services/cargohold/src`. Optional; a wrong value is
   ignored.
7. **Part 2's `Content-Type` is discarded and forced to `application/octet-stream`** before storage —
   Note `[overrideMimeTypeAsOctetStream]`, `wire-server/services/cargohold/src/CargoHold/S3.hs:114-124`,
   applied at `:194` and on download at `:216`. **Never trust the HTTP `Content-Type` of a
   downloaded asset**; the real type is `Asset.Original.mime_type`.
8. **Exactly `Content-Length` bytes are consumed**; the trailer is never read, and a short body is an
   error:
   ```haskell
   -- wire-server/services/cargohold/src/CargoHold/S3.hs:159-180
         src .| chunksOfCE (fromIntegral defaultChunkSize) .| isolate (fromIntegral cl) .| countC
             .| SU.streamUpload awsEnv.amazonkaEnv Nothing createReq
   …
         bytesSeen <- liftIO $ readIORef cntRef
         when (bytesSeen /= (fromIntegral cl)) $ throwE incompleteBody
   ```
   Excess bytes are silently dropped by `isolate` — which is why the closing `--boundary--` is
   cosmetic. Send it anyway for any intermediary that does parse MIME.
9. Sizes: `cl <= 0` ⇒ 400 `invalid-length`; `cl > maxBytes` ⇒ **413 `client-error`**
   (`V3.hs:82-86`). `maxBytes` is per-principal (`CargoHold/API/Public.hs:178-186`): team `Active`
   users get `maxTotalBytes`, non-team `Active` and `Ephemeral` get `maxTotalBytesStrict`, any other
   status ⇒ 403 `unverified-user`; bots/providers always get `maxTotalBytes`. Chart defaults:
   `maxTotalBytes: 104857632` (100 MiB + 32), `maxTotalBytesStrict: 26214432` (25 MiB + 32)
   (`wire-server/charts/wire-server/values.yaml:475-476`). Client ceilings: 25 MB personal / 100 MB
   team / 500 MB Cells / 15 MB image (`wire-webapp/apps/webapp/src/script/Config.ts:49-58`), HTTP
   layer caps the body at 100 MB (`libraries/api-client/src/http/httpClient.ts:83,245-246`).

Error labels, all from `wire-server/libs/wire-api/src/Wire/API/Error/Cargohold.hs:37-54`:
404 `not-found` · 403 `unauthorised` · 413 `client-error` (too large) · 400 `invalid-length` ·
400 `incomplete-body` · 400 `missing-audit-metadata` · 403 `unverified-user`. A **malformed** token
(unparseable base64url) is 400, from servant's param parser
(`wire-server/services/brig/docs/swagger-v2.json:4906-4908`: *"Invalid `asset_token` or `Asset-Token`"*).

### 1.4 The JSON metadata part

| Field | Type | Client default | Meaning |
|---|---|---|---|
| `public` | bool | `true` (`assetApi.ts:148`) | true ⇒ no token minted, anyone authenticated may fetch |
| `retention` | enum string | `"persistent"` (`assetApi.ts:149`) | storage class / lifetime, §1.5 |
| `domain` | string, opt | `options.domain` | federation; accepted and **ignored** by cargohold's decoder |
| `convId` | `{id, domain}` | audit mode only | audit metadata |
| `filename` | string | audit mode only | audit metadata |
| `filetype` | string | audit mode only | audit metadata (auditing only — see §1.3 point 7) |

Server schema (exactly these keys, all optional) at `wire-server/libs/wire-api/src/Wire/API/Asset.hs:316-324`.
**Server defaults differ from the client's**: `public` defaults to `false` (`Asset.hs:320`), missing
`retention` defaults to `AssetPersistent` (`CargoHold/API/V3.hs:89`). Send both explicitly.
When `assetAuditLogEnabled`, all three audit fields are mandatory or you get 400
`missing-audit-metadata` (`V3.hs:74-81`).

The server documents the canonical format, including an example body, in the OpenAPI description at
`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Cargohold.hs:357-369`.

### 1.5 `retention` values

```ts
// wire-webapp/libraries/api-client/src/asset/assetRetentionPolicy.ts:61-67
export enum AssetRetentionPolicy {
  ETERNAL = 'eternal', ETERNAL_INFREQUENT_ACCESS = 'eternal-infrequent_access',
  EXPIRING = 'expiring', PERSISTENT = 'persistent', VOLATILE = 'volatile',
}
```

| Wire string | Key digit | TTL | Doc comment (`wire-server/libs/wire-api/src/Wire/API/Asset.hs:339-353`) |
|---|---|---|---|
| `eternal` | 1 | none | "Typically used for profile pictures / assets frequently accessed" |
| `persistent` | 2 | none | "**DEPRECATED**: should not be used by clients for new assets" |
| `volatile` | 3 | 28 days | "retained for a short period of time" |
| `eternal-infrequent_access` | 4 | none | "retained indefinitely, storage optimised for infrequent access" |
| `expiring` | 5 | 365 days | "retained for an extended period of time, but not indefinitely" |

Strings at `Asset.hs:390-395`, digits at `:372-388`, TTLs at `:359-370`
(`assetVolatileSeconds = 28*24*3600`, `assetExpiringSeconds = 365*24*3600`).

**Which one a message attachment uses:**

```ts
// wire-webapp/apps/webapp/src/script/repositories/assets/assetRepository.ts:235-244
  getAssetRetention(userEntity, conversationEntity): AssetRetentionPolicy {
    const isTeamMember = this.teamState.isInTeam(userEntity);
    const isTeamConversation = this.teamState.isInTeam(conversationEntity);
    const isTeamUserInConversation = conversationEntity
      .participating_user_ets().some(p => this.teamState.isInTeam(p));
    const isEternalInfrequentAccess = isTeamMember || isTeamConversation || isTeamUserInConversation;
    return isEternalInfrequentAccess ? AssetRetentionPolicy.ETERNAL_INFREQUENT_ACCESS : AssetRetentionPolicy.EXPIRING;
  }
```

⇒ **`eternal-infrequent_access`** if the sender is a team member, or the conversation is a team
conversation, or any participant is a team member; otherwise **`expiring`** (1 year). Profile
pictures use **`eternal`** (§5). `persistent` is only the library default and is deprecated.

Message attachments are also uploaded with **`public: true`**
(`wire-webapp/apps/webapp/src/script/repositories/conversation/MessageRepository.ts:866-871`), so no
token exists and none is needed to download. Confidentiality rests entirely on the AES key in the
protobuf. Send `public: false` if you want token-gated assets.

### 1.6 Asset key format

```haskell
-- wire-server/libs/wire-api/src/Wire/API/Asset.hs:162-178
      -- AssetKeyV3 ::= Retention "-" uuid
      -- Retention  ::= decimal
instance ToByteString AssetKey where
  builder (AssetKeyV3 i r) =
    builder '3' <> builder '-' <> builder r <> builder '-' <> builder (UUID.toASCIIBytes (toUUID i))
```

`3-<retention-digit>-<uuid>`, documented example `3-1-47de4580-ae51-4650-acbb-d10c028cb0ac`
(`Asset.hs:187`). Only leading `3` parses (`:156-160`), and the UUID must be the full 36-char
hyphenated ASCII form. The retention digit is authoritative — expiry sweeps run on it, and you can
read the retention straight off the key. The **S3 object key** is derived differently:
`v3/<retention-text>/<uuid>` (`wire-server/services/cargohold/src/CargoHold/S3.hs:332-336`).

Client-side pre-flight validation:

```ts
// wire-webapp/libraries/api-client/src/asset/assetUtil.ts:87-89
export const isValidUUID = (id: string): boolean => /^[A-Za-z0-9-]+$/.test(id);   // misnomer: whole key
export const isValidToken = (token: string): boolean => /^[A-Za-z0-9+/=_\-]+$/.test(token);
```

---

## 2. Upload response → `Asset.RemoteData`

```ts
// wire-webapp/libraries/api-client/src/asset/assetApi.schema.ts:26-35
export const PostAssetsResponseSchema = z.object({
  domain: z.string().min(1),                     // "example.com"
  expires: z.string().datetime().optional(),     // ISO 8601
  key: z.string().min(1),                        // "3-1-47de4580-ae51-4650-acbb-d10c028cb0ac"
  token: z.string().min(1).optional(),           // base64url, e.g. "aGVsbG8"
});
```

Server side, same four fields (`wire-server/libs/wire-api/src/Wire/API/Asset.hs:129-141`).
`expires` only appears for `volatile` / `expiring` (`CargoHold/API/V3.hs:98-100`). `token` only when
`public: false`:

```haskell
-- wire-server/services/cargohold/src/CargoHold/API/V3.hs:88, 123-124
  tok <- if sets ^. V3.setAssetPublic then pure Nothing else Just <$> randToken
randToken = liftIO $ V3.AssetToken . Ascii.encodeBase64Url <$> getRandomBytes 16
```

The token is stored as S3 user metadata (`x-amz-meta-token`, `S3.hs:338-345,359-360,378`) and can be
rotated (`POST /assets/{key}/token`) or removed (`DELETE …/token`, which "makes the asset public")
by the owner only (`V3.hs:106-121`; non-owner ⇒ 403 `unauthorised`).

The 201 also carries a `Location` header. **Note the quirk:** even on v2+ `POST /assets` it is the
*relative* reference `assets/v4/<domain>/<key>` — `mainAPI` binds the upload to
`uploadAssetV3 @'UserPrincipalTag` (`wire-server/services/cargohold/src/CargoHold/API/Public.hs:90`)
and `HasLocation 'UserPrincipalTag` hardcodes the `v4` segment (`Public.hs:116-122`, used at `:188`).
Prefer the JSON body; the integration tests build the download path from the JSON, not from
`Location` (`wire-server/integration/test/API/Cargohold.hs:229-232`). **UNVERIFIED** whether the
stale `v4` in that header is intentional.

Mapping into the protobuf:

```ts
// wire-webapp/libraries/core/src/conversation/message/messageBuilder.ts:129-135
  const remoteData = Asset.RemoteData.create({
    assetId: asset.key, assetToken: asset.token, otrKey: asset.keyBytes,
    sha256: asset.sha256, assetDomain: asset.domain,
  });
```
```proto
// messages.proto:370-378
  message RemoteData {
    required bytes otr_key = 1;
    required bytes sha256 = 2; // obsolete but required for backward compatibility
    optional string asset_id = 3;
    // optional bytes asset_token = 4; // deprecated - changed type to string
    optional string asset_token = 5;
    optional string asset_domain = 7;
    optional EncryptionAlgorithm encryption = 6;
  }
```

| proto field | # | source | note |
|---|---|---|---|
| `otr_key` | 1 | `keyBytes` | **required**, 32 raw bytes, the AES-256 key |
| `sha256` | 2 | `sha256` | **required**, 32 raw bytes, digest of `IV ‖ ciphertext` |
| `asset_id` | 3 | `key` | the `3-x-uuid` string |
| ~~`asset_token`~~ | 4 | — | dead (was `bytes`); never emit field 4 |
| `asset_token` | 5 | `token` | absent for public assets |
| `encryption` | 6 | — | absent ⇒ `AES_CBC` (§3.3) |
| `asset_domain` | 7 | `domain` | absent on pre-federation senders |

`otr_key` and `sha256` are proto2 `required` — omit either and the peer fails to parse. `expires` is
**not** carried in the protobuf; a receiver that gets a 404 must assume expiry.

---

## 3. Asset encryption

**Verified**: AES-256-**CBC**, **PKCS#7** padding, fresh random 16-byte IV **prepended** to the
ciphertext, SHA-256 taken over **`IV ‖ ciphertext`** — i.e. over the *ciphertext*, not the plaintext.

```ts
// wire-webapp/libraries/core/src/cryptography/assetCryptography/assetCryptography.ts:53-70
export const encryptAsset = async ({plainText, algorithm = 'AES-256-CBC'}: EncryptOptions): Promise<EncryptedAsset> => {
  const initializationVector = crypto.getRandomValues(16);
  const rawKeyBytes = crypto.getRandomValues(32);

  const {key, cipher} = await crypto.encrypt(plainText, rawKeyBytes, initializationVector, algorithm);

  const ivCipherText = new Uint8Array(cipher.byteLength + initializationVector.byteLength);
  ivCipherText.set(initializationVector, 0);
  ivCipherText.set(new Uint8Array(cipher), initializationVector.byteLength);

  const sha256 = await crypto.digest(ivCipherText);

  return {cipherText: ivCipherText, keyBytes: key, sha256};
};
```
```ts
// wire-webapp/libraries/core/src/cryptography/assetCryptography/assetCryptography.ts:39-51
export const decryptAsset = async ({cipherText, keyBytes, sha256: referenceSha256}: EncryptedAsset): Promise<Uint8Array> => {
  const computedSha256 = await crypto.digest(cipherText);
  if (!isEqual(computedSha256, referenceSha256)) {
    throw new Error('Encrypted asset does not match its SHA-256 hash');
  }
  return crypto.decrypt(cipherText, keyBytes);
};
```

Node backend (OpenSSL; `createCipheriv` auto-padding = PKCS#7 for CBC):

```ts
// wire-webapp/libraries/core/src/cryptography/assetCryptography/crypto.node.ts:25-58
  async digest(cipherText) { return cryptoLib.createHash('SHA256').update(cipherText).digest(); },

  async decrypt(cipherText, keyBytes) {
    const initializationVector = cipherText.slice(0, 16);
    const assetCipherText = cipherText.slice(16);
    const decipher = cryptoLib.createDecipheriv('AES-256-CBC', keyBytes, initializationVector);
    return Buffer.concat([decipher.update(assetCipherText), decipher.final()]);
  },

  getRandomValues(size) { return cryptoLib.randomBytes(size); },

  async encrypt(plainText, keyBytes, initializationVector, algorithm) {
    const cipher = cryptoLib.createCipheriv(algorithm, keyBytes, initializationVector);
    return {key: keyBytes, cipher: Buffer.concat([cipher.update(plainText), cipher.final()])};
  },
```

The browser backend is the same algorithm via WebCrypto — `subtle.importKey('raw', keyBytes,
'AES-CBC', …)` then `subtle.encrypt/decrypt({iv, name: 'AES-CBC'}, …)`, with the same
`slice(0,16)` / `slice(16)` IV split, and `digest('SHA-256', …)`
(`wire-webapp/libraries/core/src/cryptography/assetCryptography/crypto.browser.ts:35-79`). WebCrypto's
`AES-CBC` is *defined* to use PKCS#7, so the two backends are byte-compatible.

### Exact byte layout

```
plaintext          = the raw file bytes
otrKey (32 bytes)  = CSPRNG                       -> Asset.RemoteData.otr_key
iv     (16 bytes)  = CSPRNG                       -> not transmitted separately
ct                 = AES-256-CBC(key=otrKey, iv=iv, PKCS#7(plaintext))
blob               = iv || ct                     -> the bytes POSTed to /assets
sha256 (32 bytes)  = SHA-256(blob)                -> Asset.RemoteData.sha256

blob:
  [0 .. 15]        IV                       16 bytes
  [16 .. 16+n-1]   AES-CBC ciphertext       n = ceil((len+1)/16)*16   (PKCS#7 always pads,
                                             so n > len even when len % 16 == 0)
  total            16 + n
```

**No MAC, no AEAD.** Integrity is the SHA-256 over the whole blob, which the receiver checks
*before* decrypting (`assetCryptography.ts:44-48`). The digest is over ciphertext, so it is
verifiable without the key — it is only meaningful because it arrives inside the E2E-encrypted,
sender-authenticated Proteus/MLS envelope. Refusing to decrypt when the digest is missing or empty
is pinned by tests (`assetCryptography.test.ts:34-50`).

⚠️ Do **not** copy the reference comparison:

```ts
// wire-webapp/libraries/core/src/cryptography/assetCryptography/assetCryptography.ts:25-33
const isEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  const arrayA = new Uint32Array(a);
  const arrayB = new Uint32Array(b);
  …
};
```
`new Uint32Array(uint8Array)` converts element-wise (32 elements of value 0-255) rather than
reinterpreting the buffer. It happens to be correct, but it is not constant-time. Use a
constant-time compare.

### 3.3 `EncryptionAlgorithm`

```proto
// messages.proto:432-435
enum EncryptionAlgorithm { AES_CBC = 0; AES_GCM = 1; }
```

Carried by `Asset.RemoteData.encryption` (6) and `External.encryption` (3). **The web client never
sets it** (`messageBuilder.ts:129-135,434-440`, `messageToProtoMapper.ts:62-68` all omit it) and
never reads it (`CryptographyMapper.ts:412-421`). An absent proto2 `optional` enum reads back as
`0` = `AES_CBC`. Treat **`AES_CBC` as the only algorithm in use**. **UNVERIFIED** whether any Wire
client emits `AES_GCM`; nothing in these clones produces or consumes it, and no nonce/tag layout is
specified anywhere — a new client should reject it rather than guess.

---

## 4. Download

### 4.1 The request

```ts
// wire-webapp/libraries/api-client/src/asset/assetApi.ts:220-231 + :93-109
    if (!isValidUUID(assetId)) throw new TypeError(…);
    const isValidDomain = (domain: string) =>
      !!Boolean(domain) && /^([a-zA-Z0-9]+(-[a-zA-Z0-9]+)*\.)+[a-zA-Z]{2,}$/.test(domain);
    if (!isValidDomain(assetDomain)) throw new TypeError(`Invalid asset domain ${assetDomain}`);
    return this.getAssetShared(`/assets/${assetDomain}/${assetId}`, token, forceCaching, progressCallback);
    …
    const config = {method: 'get', params: {}, responseType: 'arraybuffer', url: assetUrl, …};
    if (token !== null && token !== undefined && token.length > 0) { config.params.asset_token = token; }
    if (forceCaching) { config.params.forceCaching = forceCaching; }
```

```
GET /v{N}/assets/{domain}/{key}?asset_token={token}
Authorization: Bearer <access_token>
```

* `{domain}` is `Asset.RemoteData.asset_domain` and must look like a hostname.
* `asset_token` is appended only when non-empty and is pre-validated (`assetUtil.ts:89`); a bad token
  raises a `TypeError` client-side before any request (`assetApi.ts:88-90`). Equivalent header form:
  **`Asset-Token: <token>`**, which takes precedence server-side (`CargoHold/API/Public.hs:210`).
  The web client only ever uses the query parameter.
* `forceCaching=true` is added for **preview/thumbnail** resources only (`EventMapper.ts:231,1030`).
  It is **not** a cargohold parameter (`grep forceCaching wire-server` → nothing); it keys the local
  service-worker/Electron cache. Safe to omit.
* `Authorization: Bearer` is added by the HTTP layer to every request (`httpClient.ts:225-233`).

### 4.2 Authorisation — the entire model

```haskell
-- wire-server/services/cargohold/src/CargoHold/API/V3.hs:137-142
checkMetadata qown key tok = do
  let own = qUnqualified qown
  s3 <- lift (S3.getMetadataV3 key) >>= maybe mzero pure
  guard $ own == S3.v3AssetOwner s3 || tok == S3.v3AssetToken s3
  pure s3
```

* Allowed if the caller **is the uploader**, or if the supplied token **equals** the stored token.
* A **public** asset has stored token `Nothing`, so a caller sending **no** token matches
  (`Nothing == Nothing`). Sending a token for a public asset *fails* the comparison — do not send
  `asset_token` unless you have one.
* Any failure (missing object, wrong token, no token) ⇒ `mzero` ⇒ **404 `not-found`**, deliberately
  opaque, never 401/403. The integration tests assert exactly this four times, each annotated
  `(opaque 404)`: `wire-server/integration/test/Test/Cargohold/API.hs:139-146`. 403 `unauthorised` is
  reserved for delete-asset / renew-token / delete-token by a non-owner (`V3.hs:115-121,144-149`).

### 4.3 Redirect to S3, or a stream

```haskell
-- wire-server/libs/wire-api/src/Wire/API/Routes/Public/Cargohold.hs:82-92
type AssetRedirect =
  WithHeaders (AssetLocationHeader Absolute) (AssetLocation Absolute) (RespondEmpty 302 "Asset found")
type AssetStreaming =
  RespondStreaming 200 "Asset returned directly with content type `application/octet-stream`" OctetStream
```

* **It is `302 Found`, unconditionally** — the status is baked into the servant type. Grepping
  cargohold for `307`, `status302`, `seeOther`, `temporaryRedirect` finds nothing.
* The 302 body is **empty**; the bytes live at `Location`. **You must follow the redirect.** Tests
  assert `body == ""` and then issue a second GET (`Test/Cargohold/API.hs:82-86,263-267`).
* `Location` is a **pre-signed S3 URL** (SigV4) or a signed CloudFront URL
  (`wire-server/services/cargohold/src/CargoHold/Util.hs:34-42`,
  `CargoHold/S3.hs:280-297`, `CargoHold/CloudFront.hs:73-102`). TTL is `settings.downloadLinkTTL`
  seconds, **default 300** (`wire-server/charts/wire-server/values.yaml:477`). Re-issue the
  `GET /assets/...` when it expires. **Do not forward your `Authorization` header to the redirect
  target** — the pre-signed URL carries its own credentials.
* A **federated (remote-domain)** asset cannot be redirected to another backend's S3, so cargohold
  proxies the bytes: the response is **200 with the body**, not a 302
  (`wire-server/libs/wire-api/src/Wire/API/Asset.hs:433-448`;
  `CargoHold/Federation.hs:38-79` — only the "all-the-way" streaming strategy is implemented; test
  `Test/Cargohold/API.hs:325-338` asserts 200). **Handle both shapes on the same request.** A remote
  asset in an unknown domain ⇒ 422; unknown remote asset ⇒ 404 `Asset not found`. `DELETE` of a
  remote asset is refused (`federation-not-implemented`, `CargoHold/API/Util.hs:36-39`).
* The response `Content-Type` is always `application/octet-stream` (§1.3 point 7). Render using
  `Asset.Original.mime_type`.
* With multi-ingress deployments the `Z-Host` header selects the S3 endpoint; no match ⇒ 404
  `not-found`, deliberately aliased so the multi-ingress setup stays hidden
  (`wire-server/libs/wire-api/src/Wire/API/Error/Cargohold.hs:49-50`).

### 4.4 Verify-then-decrypt

```ts
// wire-webapp/libraries/core/src/conversation/assetService/assetService.ts:127-142
    const request = this.downloadRawAsset(assetData, progressCallback);
    return {
      response: request.response.then(async response => {
        const decrypted = await decryptAsset({
          cipherText: new Uint8Array(response.buffer), keyBytes: otrKey, sha256: sha256,
        });
        return {...response, buffer: toBufferSource(decrypted).buffer};
      }),
      cancel: request.cancel,
    };
```

Whether to decrypt at all is decided by the presence of key material:

```ts
// wire-webapp/apps/webapp/src/script/repositories/assets/assetRepository.ts:127-137
    const isEncryptedAsset = !!asset.otrKey && !!asset.sha256;
    if (!isEncryptedAsset) { return this.core.service!.asset.downloadRawAsset(asset.urlData, progressCallback); }
    …
    return this.core.service!.asset.downloadAsset(asset.urlData, otrKey, sha256, progressCallback);
```

Failure taxonomy worth reproducing (`assetRepository.ts:161-170`): cancel ⇒ `CANCELED`; message
ending in `'Encrypted asset does not match its SHA-256 hash'` ⇒ `DOWNLOAD_FAILED_HASH`; anything else
⇒ `DOWNLOAD_FAILED_DECRPYT`. 404 and 500 are swallowed as "asset gone" and yield no blob
(`assetRepository.ts:111-123`) — expected for `expiring`/`volatile` assets past their TTL.

---

## 5. Profile pictures

### 5.1 Unencrypted public assets on the user object

```ts
// wire-webapp/libraries/api-client/src/user/userAsset.ts:20-30
export enum UserAssetType { COMPLETE = 'complete', PREVIEW = 'preview' }
export interface UserAsset { key: string; domain?: string; size: UserAssetType; type: 'image'; }
```
```json
"assets": [
  {"key": "3-1-6f2a…", "size": "preview",  "type": "image", "domain": "example.com"},
  {"key": "3-1-91c4…", "size": "complete", "type": "image", "domain": "example.com"}
]
```

`assets?: UserAsset[]` sits on `User` alongside the superseded `picture?: Picture[]`
(`wire-webapp/libraries/api-client/src/user/user.ts:36-46`). `domain` is optional; when absent, fall
back to the **user's** domain:

```ts
// wire-webapp/apps/webapp/src/script/repositories/assets/assetMapper.ts:30-43
  const sizeMap = {complete: 'medium', preview: 'preview'};
  return assets
    .filter(asset => asset.type === 'image')
    .reduce((mappedAssets, asset) => {
      const domain = asset.domain ?? userId.domain;
      const assetRemoteData = new AssetRemoteData({assetKey: asset.key, assetDomain: domain, otrKey: new Uint8Array()});
      return !sizeMap[asset.size] ? mappedAssets : {...mappedAssets, [sizeMap[asset.size]]: assetRemoteData};
    }, {});
```

Note the exact `type === 'image'` filter, and that `otrKey` is an **empty** array while `sha256` stays
`undefined` — so `isEncryptedAsset` is false (§4.4) and the bytes are used verbatim. **Profile
pictures are not encrypted.**

### 5.2 Upload

```ts
// wire-webapp/apps/webapp/src/script/repositories/assets/assetRepository.ts:179-203
    const strippedImage = await stripImageExifData(image);
    const [{compressedBytes: previewImage}, {compressedBytes: mediumImage}] = await Promise.all([
      this.compressImage(strippedImage),
      this.compressImage(strippedImage, true),
    ]);
    …
    const options: AssetUploadOptions = {
      public: true,
      retention: AssetRetentionPolicy.ETERNAL,
      ...(isAuditLogEnabled && {auditData: {
        filename: image.name, filetype: image.type,
        conversationId: {domain: this.teamState.teamDomain(), id: NilUuid},
      }}),
    };
    const [previewImageKey, mediumImageKey] = await Promise.all([
      this.assetCoreService.uploadRawAsset(previewImage, options).response,
      this.assetCoreService.uploadRawAsset(mediumImage, options).response,
    ]);
```

* `uploadRawAsset` = **no encryption** (`libraries/core/src/conversation/assetService/assetService.ts:69-71`).
* `public: true` ⇒ no token, any authenticated caller may fetch.
* `retention: 'eternal'` ⇒ key digit `1`, never expires.
* EXIF stripped first; audit `convId.id` is the **nil UUID** (a profile picture belongs to no
  conversation) — which the server's own docs recommend
  (`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Cargohold.hs:366`).

Resizing (`wire-webapp/apps/webapp/src/script/repositories/assets/imageWorker.ts:28-43`): default
`MAX_SIZE = 1448` with `scaleToFit`; with `useProfileImageSize` it is `MAX_SIZE = 280` with `cover`
(square centre-crop); JPEG quality 80 above the size threshold. Reading that together with
`uploadProfileImage`: the variable called `previewImage` is the **1448 px scale-to-fit** one and
`mediumImage` is the **280×280 crop** — yet they are published as `size: "preview"` and
`size: "complete"` respectively, which is inverted relative to what the renderer expects
(`avatarImage.tsx:65-67` uses `previewPicture` for small avatars and `mediumPicture` for hi-res).
Treat the *semantics* as normative and the webapp's sizing as a quirk: **`preview` = small
thumbnail, `complete` = full-size**, and tolerate any actual dimensions.

### 5.3 Publishing and downloading

```ts
// wire-webapp/apps/webapp/src/script/repositories/user/userRepository.ts:1012-1018
      const {previewImageKey, mediumImageKey} = await this.assetRepository.uploadProfileImage(picture);
      const assets: APIClientUserAsset[] = [
        {domain: previewImageKey.domain, key: previewImageKey.key, size: APIClientUserAssetType.PREVIEW, type: 'image'},
        {domain: mediumImageKey.domain, key: mediumImageKey.key, size: APIClientUserAssetType.COMPLETE, type: 'image'},
      ];
      await this.selfService.putSelf({assets, picture: []} as any);
      return await this.updateUser(selfUser.qualifiedId, {assets});
```

```
PUT /v{N}/self          (wire-webapp/libraries/api-client/src/self/selfApi.ts:178-186)
Content-Type: application/json
{"assets":[{"domain":"…","key":"3-1-…","size":"preview","type":"image"},
           {"domain":"…","key":"3-1-…","size":"complete","type":"image"}], "picture":[]}
```

`UserUpdate = Partial<Pick<User,'name'> & Pick<User,'assets'|'accent_id'>>`
(`libraries/api-client/src/user/userUpdate.ts:22`). `"picture": []` clears the pre-v3 array so old
clients stop showing a stale avatar. Peers learn about the change from a `user.update` event.

**Download URL**: nothing special — the ordinary §4 request with no token and no decryption.

```
GET https://<backend-rest-host>/v{N}/assets/{domain}/{key}
Authorization: Bearer <access_token>
```

`{key}`/`{domain}` come from the `assets` entry (`{domain}` defaulting to the user's domain). The
client never hand-builds asset URLs — grepping `wire-webapp` for `/assets/${…}` string building finds
none; everything routes through `AssetAPI.getAsset`. Because these are `public: true`, `checkMetadata`
grants access to any authenticated caller with **no** token; appending `asset_token` would break it.

---

## 6. Image metadata, previews, legacy `ImageAsset`

```proto
// messages.proto:322-389
message Asset {
  message Original {
    required string mime_type = 1;
    required uint64 size = 2;
    optional string name = 3;
    oneof meta_data { ImageMetaData image = 4; VideoMetaData video = 5; AudioMetaData audio = 6; }
    optional string source = 7;    // e.g. http://giphy.com/234245
    optional string caption = 8;   // e.g. "dog" for a Giphy "dog" search result
  }
  message Preview {
    required string mime_type = 1;
    required uint64 size = 2;
    optional RemoteData remote = 3;
    oneof meta_data { ImageMetaData image = 4; }
  }
  message ImageMetaData { required int32 width = 1; required int32 height = 2; optional string tag = 3; }
  message VideoMetaData { optional int32 width = 1; optional int32 height = 2; optional uint64 duration_in_millis = 3; }
  message AudioMetaData {
    optional uint64 duration_in_millis = 1;
    // repeated float normalized_loudness = 2 [packed=true]; // deprecated - Switched to bytes instead
    optional bytes normalized_loudness = 3; // each byte represent one loudness value … range from 0 to 255.
  }
  enum NotUploaded { CANCELLED = 0; FAILED = 1; }
  message RemoteData { … }                       // see §2

  optional Original original = 1;
  // optional Preview preview = 2;  // deprecated - preview was completely replaced
  oneof status { NotUploaded not_uploaded = 3; RemoteData uploaded = 4; }
  optional Preview preview = 5;
  optional bool expects_read_confirmation = 6 [default = false];
  optional LegalHoldStatus legal_hold_status = 7 [default = UNKNOWN];
}
```

Field **2 is burned** (the first `preview` design); the live `preview` is field 5.

### 6.1 Sending image dimensions

```ts
// wire-webapp/libraries/core/src/conversation/message/messageBuilder.ts:422-432
  const imageMetadata = Asset.ImageMetaData.create({height: image.height, width: image.width});
  const original = Asset.Original.create({
    [GenericMessageType.IMAGE]: imageMetadata,   // 'image' — the oneof member inside Original
    mimeType: image.type, name: null, size: image.data.length,
  });
```

* `Original.mime_type` — the real type (`image/jpeg`, …); this is what the receiver renders with.
* `Original.size` — the **plaintext** byte length (before encryption).
* `Original.name` — `null` for images, the file name for file sends.
* `Original.image = {width, height}` — pixel dimensions of the plaintext image, measured by decoding
  it before upload (`assetMetaDataBuilder.ts:70-89`; video `:91-113`, audio `:60-68`).
* **`tag` is never set by the web client.** It is a leftover of legacy `ImageAsset.tag`
  (`"preview"`/`"medium"`). On receive the webapp synthesises it:
  ```ts
  // wire-webapp/apps/webapp/src/script/repositories/cryptography/CryptographyMapper.ts:406-410
      const isImage = original?.image !== null && original?.image !== undefined;
      if (isImage) { data.info.tag = 'medium'; }
  ```
  Informational only; do not depend on it.

Audio loudness is a 200-byte waveform, values 0-255, chronological
(`assetMetaDataBuilder.ts:148-160`: 200 buckets, RMS × 700, capped to a byte), carried in
`AudioMetaData.normalized_loudness` via `FileMetaDataContent {audio, length, name, type, video, image}`
(`libraries/core/src/conversation/content/fileContent.ts:51-58` →
`messageBuilder.ts:137-144`). Only one of `image`/`video`/`audio` is ever set — they share a `oneof`,
and mutual exclusivity is enforced at the source (`MessageRepository.ts:820-828`).

### 6.2 `Asset.Preview` — thumbnails

`Preview` is a **second, independently encrypted asset**: its own `RemoteData` (`messages.proto:339`)
and therefore its own `otr_key`, `sha256`, `asset_id`, `asset_token`, `asset_domain`, plus
`mime_type`, `size` and optional `ImageMetaData`. Typical use: a video poster frame or PDF page.

Receive is implemented (`CryptographyMapper.ts:392-404` → `preview_domain` / `preview_key` /
`preview_otr_key` / `preview_sha256` / `preview_token`; turned into an `AssetRemoteData` with
`forceCaching: true` at `EventMapper.ts:1023-1032`). **Send is not**: grepping `wire-webapp` for
`Asset.Preview` / `Preview.create` finds only `LinkPreview.create`. The mobile clients emit it. A new
client must **consume** `preview` (download + verify + decrypt with the preview's *own* key and
digest, exactly as in §3-4) but may skip producing it.

`LinkPreview.image` is a different thing: a whole `Asset` (with `original` + `uploaded`, no `status`)
embedded in a text message's link preview (`messageToProtoMapper.ts:48-76`).

### 6.3 Legacy `ImageAsset`

```proto
// messages.proto:250-263
// deprecated in favour of Asset.Original.ImageMetaData
message ImageAsset {
  required string tag = 1; required int32 width = 2; required int32 height = 3;
  required int32 original_width = 4; required int32 original_height = 5;
  required string mime_type = 6; required int32 size = 7;
  optional bytes otr_key = 8;
  optional bytes mac_key = 9;   // deprecated - use sha256
  optional bytes mac = 10;      // deprecated - use sha256
  optional bytes sha256 = 11;   // sha256 of ciphertext
}
```

It is `GenericMessage.image` (field 3, `messages.proto:29`) and `Ephemeral.image` (field 3, `:118`).
Historically an image was two `ImageAsset` messages, `tag: "preview"` and `tag: "medium"`, integrity
via `mac_key`/`mac` and later `sha256`. It has **no `asset_id`** — the key travelled outside the
protobuf in the event's `data.id`, which is why the design was replaced.

Current status: **neither sent nor received** by the reference client. `GenericMessageType` still
declares `IMAGE = 'image'` (`genericMessageType.ts:39`) but `CryptographyMapper._mapGenericMessage`
has no `case GenericMessageType.IMAGE` (`CryptographyMapper.ts:170ff`), so legacy images fall through
to the unknown-message path. `ASSET_META = 'assetMeta'` and `ASSET_ABORT = 'assetAbort'`
(`genericMessageType.ts:23-24`) name `GenericMessage` fields that no longer exist in the proto at all
— stale enum entries; ignore them. **A new client should not implement `ImageAsset`.**

---

## 7. Message flow for sending an attachment

### 7.1 The two-message pattern

The documented pattern — and what every client must be able to **receive** — is: send an `Asset`
`GenericMessage` carrying only `original` (no `status`) as soon as the user picks the file, then a
**second** `Asset` message with the **same `message_id`** carrying `original` + `uploaded` once the
upload completes. The receiver treats the second as an in-place update, so it shows a placeholder
with name/type/size that turns into a downloadable attachment.

```ts
// wire-web-packages/packages/core/src/demo/sender.ts:187-206  (abridged)
    const metadataPayload = MessageBuilder.createFileMetadata({… metaData: {length, name, type}});
    await account.service!.conversation.send({payloadBundle: metadataPayload, sendAsProtobuf});
    const filePayload = await MessageBuilder.createFileData({
      … file, asset: await (await account.service.asset.uploadAsset(file.data)).response,
      originalMessageId: metadataPayload.id,        // <-- ties the two together
    });
    await account.service!.conversation.send({payloadBundle: filePayload, sendAsProtobuf});
```

**Message 1 — metadata only**, `status` oneof unset (neither field 3 nor field 4):

```ts
// wire-webapp/libraries/core/src/conversation/message/messageBuilder.ts:169-187
  const original = Asset.Original.create({
    audio: metaData.audio, mimeType: metaData.type, name: metaData.name,
    size: metaData.length, video: metaData.video, image: metaData.image,
  });
  const assetMessage = Asset.create({expectsReadConfirmation, legalHoldStatus, original});
  const genericMessage = GenericMessage.create({[GenericMessageType.ASSET]: assetMessage, messageId});
```

**Message 2 — the upload result**, same `messageId`:

```ts
// wire-webapp/libraries/core/src/conversation/message/messageBuilder.ts:146-158
  const assetMessage = Asset.create({expectsReadConfirmation, legalHoldStatus, uploaded: remoteData, original});
  assetMessage.status = AssetTransferState.UPLOADED;
  const genericMessage = GenericMessage.create({[GenericMessageType.ASSET]: assetMessage, messageId});
```

**Message 3 (failure/cancel only) — abort**, same `messageId`, and **no `original`**:

```ts
// wire-webapp/libraries/core/src/conversation/message/messageBuilder.ts:198-209
  const assetMessage = Asset.create({expectsReadConfirmation, legalHoldStatus, notUploaded: reason});
  assetMessage.status = AssetTransferState.NOT_UPLOADED;
  const genericMessage = GenericMessage.create({[GenericMessageType.ASSET]: assetMessage, messageId});
```

The receiver must keep the `original` learned from message 1 and just flip the state.

### 7.2 `status` / `not_uploaded` on the wire

`assetMessage.status = 'uploaded'` is **not** a protobuf field. protobufjs exposes a `oneof` as a
virtual property named after the oneof, whose value is the name of the currently-set member:

```ts
// wire-webapp/libraries/core/src/conversation/assetTransferState.ts:93-96
export enum AssetTransferState { NOT_UPLOADED = 'notUploaded', UPLOADED = 'uploaded' }
```

matching `not_uploaded = 3` / `uploaded = 4` (`messages.proto:382-385`). **On the wire, "status" is
simply which of field 3 or field 4 is present.**

```proto
// messages.proto:365-368
  enum NotUploaded { CANCELLED = 0; FAILED = 1; }
```

* `CANCELLED` (0) — user aborted the upload.
* `FAILED` (1) — the upload errored; this is what the webapp sends
  (`MessageRepository.ts:909` — `reason = Asset.NotUploaded.FAILED`).

Since `CANCELLED = 0` is the proto2 enum default, a `not_uploaded` field with no explicit value must
be read as `CANCELLED`.

Receiver mapping (`CryptographyMapper.ts:412-424`): `uploaded` present ⇒ status `UPLOADED` plus
`{domain, key, otr_key, sha256, token}`; `notUploaded` present ⇒ `{reason, status: UPLOAD_FAILED}`;
neither ⇒ `UPLOAD_PENDING` (`EventMapper.ts:1035`). The receiving/UI enum is wider than the wire one
and is purely local (`apps/webapp/src/script/repositories/assets/assetTransferState.ts:136-145`:
`cancelled`, `downloading`, `upload-failed`, `upload-pending`, `uploaded`, `uploading`,
`download-failed-decrypt`, `download-failed-hash`).

### 7.3 What the current webapp actually does (differs!)

```ts
// wire-webapp/apps/webapp/src/script/repositories/conversation/MessageRepository.ts:830-831
      const message = MessageBuilder.buildFileMetaDataMessage({metaData: meta as FileMetaDataContent}, originalId);
      this.assetRepository.addToProcessQueue(message, conversation.id);
```

The metadata `GenericMessage` **is built but never sent** — `addToProcessQueue` only pushes it onto a
local knockout observable that renders the sender's own "uploading" row
(`assetRepository.ts:79-85`, consumed by `UploadAssets.tsx:33-42`,
`VirtualizedMessagesList.tsx:130-131`). The webapp then uploads and sends exactly **one** message,
reusing that id (`MessageRepository.ts:873-898`: `buildImageMessage` when `asImage`, else
`buildFileDataMessage`, both passed `messageId`, then `sendAndInjectMessage(..., {enableEphemeral: true})`).
On failure the abort message **is** sent with the same id (`MessageRepository.ts:713-715`) — so peers
can receive an abort for a message they never saw and must tolerate that.

**Recommendation:** send only the final message (one fan-out encryption pass), but *receive* all
three forms, keyed on `GenericMessage.message_id`.

### 7.4 Transport

Ordinary `GenericMessage`s: serialised, encrypted per recipient device with Proteus (or MLS), posted
to `POST /v{N}/conversations/{domain}/{conversationId}/proteus/messages`
(`wire-webapp/libraries/api-client/src/conversation/conversationApi/conversationApi.ts:698`, protobuf
body) or `POST /v{N}/mls/messages`. Ephemeral (timed) attachments wrap the `Asset` in `Ephemeral`
(`messages.proto:114-123`, `messageBuilder.ts:454-461`).

---

## 8. Calling signalling (brief)

> **The media layer is explicitly out of scope.** ICE/DTLS-SRTP, SDP negotiation, codecs, jitter
> buffers and the conference forwarding protocol live in **AVS** (`@wireapp/avs`, pinned `10.5.11` in
> `wire-webapp/apps/webapp/package.json:39`; a prebuilt wasm/JS blob whose C sources are in the
> separate `wireapp/wire-avs` repo) and in the **SFT** server. This section covers only the envelope.

### 8.1 Envelope

```proto
// messages.proto:412-415
message Calling {
  required string content = 1;
  optional QualifiedConversationId qualified_conversation_id = 2;
}
```

`Calling` is `GenericMessage.calling`, field **10** (`messages.proto:35`). `content` is a **JSON
document serialised to a string** — Wire deliberately kept the call protocol opaque to the messaging
layer. Proof at both ends:

```ts
// wire-webapp/apps/webapp/src/script/repositories/calling/CallingRepository.ts:2295
    const content = typeof payload === 'string' ? payload : JSON.stringify(payload);
```
```ts
// wire-webapp/apps/webapp/src/script/repositories/cryptography/CryptographyMapper.ts:466-473
  private _mapCalling(calling: Calling, event: EncryptedEvent) {
    return {
      content: JSON.parse(calling.content),
      targetConversation: calling.qualifiedConversationId,
      sender: event.type === CONVERSATION_EVENT.OTR_MESSAGE_ADD ? event.data.sender : undefined,
      senderClientId: event.type === CONVERSATION_EVENT.MLS_MESSAGE_ADD ? event.senderClientId : undefined,
      type: ClientEvent.CALL.E_CALL,
    };
  }
```

`qualified_conversation_id` is set only when a call message is routed through the **MLS
self-conversation** but concerns a different target conversation
(`MessageRepository.ts:1698-1703`). Built by `buildCallMessage` (`messageBuilder.ts:346-353`).

### 8.2 The JSON

A real `SETUP` payload, from the webapp's own fixture
(`wire-webapp/apps/webapp/src/script/repositories/calling/CallingRepository.test.ts:1009-1083`):

```json
{ "props": {"audiocbr": "false", "videosend": "false"},
  "resp": false,
  "sdp": "v=0\r\no=- …\r\na=x-KASEv1:q15D6p9nxIR37JjnOiXVyPqIXUZF9uASOlJ9Itye9B8=\r\n…",
  "sessid": "jEcO",
  "type": "SETUP",
  "version": "3.0" }
```

and a `CANCEL` (`CryptographyMapper.test.ts:623-628`): `{"resp": false, "sessid": "asd2", "type": "CANCEL", "version": "3.0"}`.

`version` is `"3.0"` in every observed payload. The TS envelope type models only `type`, `version`
and (for webapp-originated types) `data` / `emojis` / `isHandUp`; the comment at
`apps/webapp/src/script/repositories/event/CallingEvent.ts:51-53` states plainly that *"content is an
object that comes from avs"*. **UNVERIFIED**: the authoritative field list (`sessid`, `resp`, `sdp`,
`props`, `dest_*`/`src_*`) is produced inside AVS, which is not in these clones — and `dest*`/`src*`
have **zero** hits here.

Complete `type` list known to the web client — verbatim, no omissions
(`wire-webapp/apps/webapp/src/script/repositories/calling/enum/CallMessageType.ts:20-38`):

```ts
export enum CALL_MESSAGE_TYPE {
  CANCEL = 'CANCEL',        CONF_START = 'CONFSTART',  CONF_END = 'CONFEND',  CONFKEY = 'CONFKEY',
  GROUP_CHECK = 'GROUPCHECK', GROUP_LEAVE = 'GROUPLEAVE', GROUP_SETUP = 'GROUPSETUP',
  GROUP_START = 'GROUPSTART', HANGUP = 'HANGUP',       PROP_SYNC = 'PROPSYNC', REJECT = 'REJECT',
  REMOTE_KICK = 'REMOTEKICK', EMOJIS = 'EMOJIS',       HAND_RAISED = 'HANDRAISED',
  REMOTE_MUTE = 'REMOTEMUTE', SETUP = 'SETUP',         UPDATE = 'UPDATE',
}
```

Caveats: `REMOTECANDIDATES` has **zero hits** in any clone — retired, or handled entirely inside AVS.
`EMOJIS` / `HANDRAISED` are **not** transported as `Calling` messages any more; they have their own
GenericMessage types `inCallEmoji` (24) / `inCallHandRaise` (26) and are only normalised into this
shape on receipt (`CryptographyMapper.ts:648-666`). `REMOTEMUTE`/`REMOTEKICK` are built by the webapp
itself and carry **no `version`** field (`CallingRepository.ts:2334-2345`); `REMOTEMUTE` carries
`data.targets` as a `QualifiedUserClients` map `{domain: {userId: [clientId]}}`.

### 8.3 Delivery

Call messages go through the **ordinary encrypted pipeline** — there is no calling-specific endpoint.
AVS's `sendh` callback hands JS the payload, which is wrapped and posted to
`POST /conversations/{domain}/{cnv}/proteus/messages` or `POST /mls/messages`
(`CallingRepository.ts:2249-2306` → `MessageRepository.sendCallingMessage`).

* **Native push is NOT suppressed.** `nativePush` defaults to `true`
  (`MessageRepository.ts:1000`) and is set explicitly `true` for targeted sends
  (`CallingRepository.ts:2272,2339,2345`); on the backend `native_push` also defaults to `true`
  (`wire-server/libs/wire-api/src/Wire/API/Message.hs:105,116`). Only confirmations and button
  actions use `nativePush: false`.
* **Per-client targeting**: AVS supplies a `targets` JSON which becomes a `QualifiedUserClients` map
  (`CallingRepository.ts:2214-2223`), switching the send to `MessageTargetMode.USERS_CLIENTS`
  (`MessageRepository.ts:1727`) and `ignoreAll` mismatch handling.
* `skipInjection: true` (`MessageRepository.ts:1725`) is why call messages never appear in the
  timeline.
* On **MLS**, `nativePush` and per-client `recipients` are structurally dropped — MLS sends to the
  whole group (`MessageRepository.ts:1069-1084`).
* Receive: `conversation.otr-message-add` / `mls-message-add` → decrypt → `JSON.parse` → event type
  `call.e-call` (`Client.ts:21`) → re-serialised and pushed into AVS via
  `wCall.recvMsg(...)` (`CallingRepository.ts:1141,1153-1164`).

### 8.4 AVS / SFT boundary and `/calls/config/v2`

AVS registers its callbacks in one call (`CallingRepository.ts:598-627`): `sendh` = this messaging
channel, `sfth` = the SFT HTTP channel, `cfg_reqh` = fetch the calls config. The SFT request is a
plain `axios.post(url, data)` where **both URL and body are opaque strings produced by AVS**
(`CallingRepository.ts:2348-2366`); the HTTP status is handed back via `sftResp`. **The
`POST <sft>/sft/<convid>` path shape is not visible in JS** and could not be verified here.

Conference media keys: for **Proteus** conferences the key rides in the AVS-generated `CONFKEY` JSON
(JS only guarantees a fresh, verified device roster before letting AVS process it —
`CallingRepository.ts:974-990`, `:668-685`). For **MLS** conferences there is no `CONFKEY` at all —
the key is an MLS **subconversation exporter secret** passed via `setEpochInfo`
(`CallingRepository.ts:1831-1855`).

TURN/SFT discovery:

```
GET /v{N}/calls/config/v2?limit=1..10     (Z-User + Z-Connection required)
```
`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Brig.hs:1922-1935`; the unversioned
`GET /calls/config` is deprecated and removed `Until 'V8` (`:1906-1921`). Response
(`wire-server/libs/wire-api/src/Wire/API/Call/Config.hs:119-152`):

```json
{ "ice_servers": [{"urls": ["turn:host:3478?transport=udp"], "username": "…", "credential": "…"}],
  "sft_servers": [{"urls": ["https://sft.example.com:443"]}],
  "sft_servers_all": [{"urls": ["…"], "username": "…", "credential": "…"}],
  "ttl": 3600,
  "is_federating": false }
```

`ice_servers` and `ttl` are required; each `SFTServer.urls` must hold **exactly one**
`https://host:port` (`Config.hs:157-176`). Credentials are HMACs generated per request
(`wire-server/services/brig/src/Brig/Calling/API.hs:246-261`), gated on the `conferenceCalling` team
feature (`API.hs:85-89`). wire-server has **no** `Calling`-aware message handling at all — the
payload is opaque ciphertext to it.

A client that implements Wire messaging including attachments needs none of §8; it can simply ignore
incoming `Calling` messages.
