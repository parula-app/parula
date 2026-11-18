# Wire implementation — design and module contract

The map from the protocol documents in this directory onto our code. Read this
before touching `app/logic/Chat/Wire/`. It fixes the file layout and the API
between the modules, so that the pieces fit together.

MLS itself is **not** here: it lives in `app/logic/Chat/MLS/` and knows nothing
about Wire. This directory holds only what is Wire-specific — the REST API, the
session, the event stream, the delivery-service glue that carries MLS messages,
and the mapping onto our `ChatAccount` / `ChatRoom` / `ChatMessage` objects.

## Ground rules

- **Clean room.** No code copied from wire-webapp, wire-android or core-crypto.
  The documents in this directory are the spec.
- **Code style** follows `Mail/IMAP/` and `Mail/JMAP/`, *not* `Chat/WhatsApp/` or
  `Chat/Signal/`: `let` not `const` (except hardcoded literals), `ID` spelled
  uppercase, `x?.y()` not `x ? x.y() : undefined`, the main class first in the
  file, comments short and only where the code surprises.
- **Object orientation.** Nouns are classes, verbs are their methods. No bag of
  free exported functions; a new global function only if it is a generic helper.
- **Reuse the app.** `Attachment`, `Person`, `Group`, `ChatPersonUID`, the SQL
  chat storage, `Observable`/`notifyChangedProperty`, `sanitize`, `gt`,
  `ArrayColl`/`MapColl`, `Lock`/`Throttle`/`RunOnce` from `util/flow/`,
  `netUtil`'s `isTransientError`/`retryOnTransientError`/`waitUntilOnline`.
  The protobuf codec is `Chat/Signal/Proto/codec.ts`, which `Chat/WhatsApp/`
  already reuses — do not write another one.
- **Sanitize at the boundary.** Everything that comes off the network goes
  through `sanitize.*` once, where it is parsed. Values read back out of our own
  objects or DB are already clean; do not re-sanitize them.
- **Identify as Parula.** Every place the official client sends its own name, we
  send ours. Collected in `clientInfo.ts`; nothing else may hardcode it.
- **All platforms.** Electron (macOS/Linux/Windows) and Capacitor (Android/iOS).
  Nothing may depend on a desktop-only API without a fallback.

## File layout

| Path | Holds |
|---|---|
| `WireTransport.ts` | HTTP: base URL, API version, the `zuid` cookie, error mapping |
| `WireSession.ts` | login (password and SSO), access-token refresh, our client (device) registration |
| `WireAPI.ts` | every REST call, typed. No state beyond the transport. |
| `TWire.ts` | the JSON shapes the server returns, as `type`s |
| `WireEventStream.ts` | the WebSocket plus the `/notifications` catch-up |
| `WireAccount.ts` | `ChatAccount` subclass: login, rooms, roster, wiring it all together |
| `WireChatRoom.ts`, `Wire1to1ChatRoom.ts`, `WireGroupChatRoom.ts` | `ChatRoom` subclasses |
| `WireChatMessage.ts`, `WireRoomEvent.ts` | `ChatMessage` / `ChatRoomEvent` subclasses |
| `WirePerson.ts` | `ChatPersonUID` subclass |
| `WireMLSService.ts` | the Wire side of MLS: key packages, commit bundles, group info, welcomes |
| `WireMedia.ts` | asset upload/download and their encryption |
| `Proto/messages.ts` | the `GenericMessage` protobuf, in the codec DSL |
| `clientInfo.ts` | our product name, version, device class and label |

## Transport

`WireTransport` is the only place that talks HTTP. It owns three things the rest
of the code must not duplicate: the API version prefix, the bearer token, and the
`zuid` cookie.

The `zuid` cookie is the long-lived credential — for an SSO account it is the
*only* one, since there is no password to log in with again. Node's `fetch` has no
cookie jar, so we read `Set-Cookie` ourselves and send `Cookie: zuid=…` back, the
same way Wire's own api-client does in Node. That needs the response headers,
which the app's `remoteApp.kyCreate()` did not expose, so it gained a
`result: "response"` mode returning `{ok, status, statusText, headers, body}` with
the body as bytes. Combined with `throwHttpErrors: false` this also gives us the
error body, which Wire needs: its failures are distinguished by the `label` field
of a `{code, label, message}` JSON body, not by the HTTP status alone.

```ts
export class WireTransport {
  /** e.g. `https://prod-nginz-https.wire.com` */
  baseURL: string;
  /** The negotiated API version, used as the `/vN` path prefix */
  version: number;
  accessToken: string | null;
  /** The `zuid` cookie value, persisted across restarts */
  cookie: string | null;

  constructor(baseURL: string);

  /** `GET /api-version`, picks the highest version we both support.
   * Not version-prefixed. Also learns the backend's own `domain`. */
  async negotiateVersion(): Promise<void>;
  get domain(): string;

  /** The versioned calls. `path` starts with a slash and has no version prefix. */
  async get(path: string, options?: WireRequestOptions): Promise<any>;
  async post(path: string, json: any, options?: WireRequestOptions): Promise<any>;
  async put(path: string, json: any, options?: WireRequestOptions): Promise<any>;
  async delete(path: string, json?: any, options?: WireRequestOptions): Promise<any>;
  /** For `message/mls` and `application/x-protobuf` bodies */
  async postBinary(path: string, body: Uint8Array, contentType: string,
    options?: WireRequestOptions): Promise<any>;
  async getBinary(path: string, options?: WireRequestOptions): Promise<Uint8Array>;

  /** Called on 401 by the callers above; supplied by `WireSession`. */
  onTokenExpired: (() => Promise<void>) | null;
}

export interface WireRequestOptions {
  /** Skip the `/vN` prefix, for `/api-version` and `/access` */
  unversioned?: boolean;
  /** Send `Cookie: zuid=…`. Only `/access` and `/cookies` need it. */
  withCookie?: boolean;
  /** Do not try to refresh the token and retry on a 401 */
  noRetryOnExpiry?: boolean;
  query?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
}

/** A `{code, label, message}` error from the backend. Callers switch on `label`. */
export class WireError extends Error {
  readonly httpCode: number;
  readonly label: string;
  readonly serverMessage: string;
  /** Anything else the body carried, e.g. the missing/redundant client lists */
  readonly data: any;
}
```

## Session

```ts
export class WireSession {
  readonly transport: WireTransport;
  /** Our own qualified user ID and the client (device) ID */
  userID: string;
  domain: string;
  clientID: string | null;

  /** Email address + password. Handles the 2FA round trip via `onVerificationCode`. */
  async loginWithPassword(email: string, password: string): Promise<void>;
  /** SSO. Opens the browser flow and waits for the cookie. */
  async loginWithSSO(code: string): Promise<void>;
  /** From the stored cookie, at startup. No user interaction. */
  async resume(): Promise<void>;
  /** `POST /access`, unversioned, with the cookie. Also rotates the cookie. */
  async refreshToken(): Promise<void>;
  async logout(): Promise<void>;

  /** Registers this device if we do not have one yet, else verifies ours is still
   * there. Uploads the MLS signature public key. */
  async ensureClient(mlsPublicKeys: Record<string, string>): Promise<void>;

  /** Asked for when the backend demands a 2FA code. Set by the account. */
  onVerificationCode: (() => Promise<string>) | null;

  toJSON(): any;
  fromJSON(json: any): void;
}
```

## Event stream

```ts
export class WireEventStream {
  constructor(session: WireSession, api: WireAPI);
  /** Connects, catches up on missed notifications, then goes live.
   * Reconnects by itself until `stop()`. */
  async start(lastNotificationID: string | null): Promise<void>;
  async stop(): Promise<void>;
  /** Called for every event, in order, one at a time. Must not run concurrently:
   * MLS epochs only advance correctly in sequence. */
  onEvent: (event: TWireEvent) => Promise<void>;
  /** The stream was lost and we could not catch up; the caller must refetch
   * conversations and users from scratch. */
  onDesynchronized: (() => Promise<void>) | null;
  /** Persisted, so the next start resumes where we stopped */
  lastNotificationID: string | null;
}
```

## The MLS delivery service

`WireMLSService` is the only place that knows both MLS and Wire. `MLSGroup` and
`MLSClient` come from `Chat/MLS/` and never learn what a conversation is; the REST
calls come from `WireAPI` and never learn what an epoch is.

```ts
export class WireMLSService {
  constructor(account: WireAccount, api: WireAPI);
  readonly client: MLSClient;

  /** At login: register our signature key, then top the key packages back up. */
  async setup(): Promise<void>;
  /** Uploads new key packages when the server's count dropped below the mark. */
  async replenishKeyPackages(): Promise<void>;

  /** Creates the group for a conversation the server just minted for us. */
  async createGroup(room: WireChatRoom, invite: WirePerson[]): Promise<void>;
  /** Adds or removes members, as one commit, sent as a commit bundle. */
  async addMembers(room: WireChatRoom, persons: WirePerson[]): Promise<void>;
  async removeMembers(room: WireChatRoom, persons: WirePerson[]): Promise<void>;
  /** An `update` commit that rotates our own leaf key. */
  async rotateOurKey(room: WireChatRoom): Promise<void>;

  async sendMessage(room: WireChatRoom, plaintext: Uint8Array): Promise<void>;
  /** From a `conversation.mls-message-add` event. */
  async processMessage(room: WireChatRoom, message: Uint8Array): Promise<ProcessResult>;
  /** From a `conversation.mls-welcome` event. */
  async processWelcome(welcome: Uint8Array): Promise<WireChatRoom>;
  /** Recovery: rejoin a group whose epoch we lost, via GroupInfo + external commit. */
  async rejoin(room: WireChatRoom): Promise<void>;
  /** The MLS 1:1 group for a person, creating it if we are the one to create it. */
  async oneToOneGroup(person: WirePerson): Promise<WireChatRoom>;
}
```

Rules that the protocol documents call out and that this class must enforce, because
getting them wrong fails silently:

- Never merge our own commit before the delivery service answered `201` — a
  concurrent commit would fork us unrecoverably.
- Handshake messages go out as `PublicMessage`, application data as
  `PrivateMessage`. A commit sent as a `PrivateMessage` is silently treated as the
  bundle's application-message slot and the bundle is then rejected for a missing
  commit.
- The backend's removal key goes into `external_senders`, at index 0. Without it
  server-side removals silently never happen.
- The `ratchet_tree` extension must be in the GroupInfo, or external commits — and
  with them all recovery — become impossible.
- `mls_public_keys` must be registered on our client before any key package upload.
- `capabilities.credentials` must not be empty, or every key package is rejected.
- `group_id` is arbitrary bytes: base64 in JSON, length-prefixed inside MLS. Never
  treat it as text.
- `cipher_suite` is absent on a fresh conversation until epoch ≥ 1.
- A stale-epoch or missing-reference error is a signal to rejoin, not to retry.

## The chat object model

| Wire concept | Our class |
|---|---|
| conversation, type 0 (group) | `WireGroupChatRoom` with a `Group` contact |
| conversation, type 2 (1:1) | `Wire1to1ChatRoom` with a `WirePerson` contact |
| conversation, type 3 (connect request) | `Wire1to1ChatRoom`, shown as a pending invite |
| user | `WirePerson extends ChatPersonUID`, `chatID` = `<userID>@<domain>` |
| `GenericMessage` with `text` | `WireChatMessage extends ChatMessage` |
| `GenericMessage` with `asset` | `WireChatMessage` with an `Attachment` |
| member join/leave, rename, call | `WireRoomEvent extends ChatRoomEvent` |

The payload layer is shared: a `GenericMessage` is byte-identical whether it
arrived over MLS or Proteus, so message handling is written once and only the
transport differs.

## Persistence

- Account-level state (base URL, API version, user ID, domain, client ID, the
  `zuid` cookie, `lastNotificationID`, our MLS signature key pair and published
  key packages) goes into `WireAccount.toConfigJSON()` / `fromConfigJSON()`, like
  `SignalAccount` does.
- Per-conversation MLS group state goes into `WireChatRoom.toExtraJSON()` /
  `fromExtraJSON()`, which the SQL chat storage merges into the room's `json`
  column. The ratchet tree is stored as base64 of its `ratchet_tree` encoding, not
  as expanded JSON.
- Messages and rooms use the existing `SQLChatStorage`; nothing new in the DB
  schema.

## What we do not implement

- **Proteus.** Wire's legacy per-device encryption. See `09-Proteus.md` for when
  it is still needed; MLS is the path we take.
- **Calls.** Call signalling rides in the `Calling` protobuf; the media layer is
  Wire's own AVS/SFT. Out of scope.
- **E2EI / x509 credentials.** Basic credentials only, which is what the cloud
  backend uses unless a team turns E2EI on.

## Status: what is proven, and what is not

### Proven
- **MLS itself** passes the official interop vectors from
  <https://github.com/mlswg/mls-implementations> for all five cipher suites we
  implement — including `passive-client-*`, which drives the whole state machine
  through scripted epochs and checks the `epoch_authenticator` after every one.
- **The layers compose.** `endToEnd.test.ts` runs four real `WireAccount`s against
  an in-process backend with nothing mocked above HTTP and the WebSocket: login,
  device registration, key packages, an MLS group, Proteus 1:1, attachments, a
  restart from the saved config, and adding and removing members. The fake
  enforces the backend's strictness rather than being lenient, and reads MLS
  membership out of each commit's ratchet tree instead of bookkeeping it.
- **It talks to a real wire-server.** `live.test.ts` runs the same story against
  brig, galley, gundeck, cannon, cargohold and nginz — release 5.34.101, stock
  configuration. Password login and token refresh, device registration, key
  packages, an MLS group over the real delivery service, a Proteus 1:1 with a
  peer whose team has no MLS, an MLS 1:1, an attachment through cargohold, a
  restart on the stored cookie, and a removed member who stops being able to
  read. See `test/logic/Chat/Wire/liveBackend.ts` for how to point it at one.
- **SSO works against real spar**, with a real SAML identity provider that signs
  its assertions (`liveSSO.test.ts`): the login-code pre-check, the browser
  round trip through `initiate-login` → provider → `finalize-login`, the
  `wire-…://` verdict, auto-provisioning, a device registered without a
  password, and the next start resuming from the cookie alone.
- **Proteus interoperates with Wire's own implementation.**
  `proteus/interop.test.ts` replays vectors produced by `@wireapp/proteus` — the
  library the official clients use — and, when that package is present, runs
  both implementations against each other in both directions, including
  out-of-order delivery and repeated ratcheting. A prekey bundle our client
  uploaded to a real brig was claimed by a third party and used by that library
  to start a session.

### Not proven, in rough order of how likely it is to bite
- **Federation.** Everything above is single-domain, so the `failed` /
  `failed_to_send` buckets and remote removal keys are untested.
- **2FA.** The verification-code round trip is implemented but never exercised:
  it needs a team with the second factor turned on, and an email.
- **The `/vN/events` socket is dead code today**: `WireSession` deliberately does
  not declare the `consumable-notifications` capability, because with the team
  feature alone the server keeps writing to the legacy stream and the new queue
  silently stays empty. Turning it on means declaring the capability *and*
  draining the legacy stream once, in that order.
- **Proteus `External`** (the >256 KB path) is only implemented for receiving. A
  very large text message would be refused; attachments are unaffected, since
  they go through the asset store.
- **One device per user** is all the tests cover.
- Untested: subconversations and calls, `resetConversation`, key-package replace
  and delete, the 30-day rotation timer, x509 / E2EI credentials, guest links,
  teams and search.

### What talking to the real backend changed
Five things passed against the fake and failed against wire-server. They are
worth remembering, because each is a place where a second implementation of the
same document disagreed with ours:

- `Message` inside a Proteus `Envelope` is a tag **followed by** the body, not a
  2-element CBOR array. Every first contact with a real client would have failed
  to decrypt. See `09-Proteus.md` §2.
- Nothing published that we speak MLS. `PUT /self/supported-protocols` has to be
  called; a peer sees only that, never our team's feature flag, so every 1:1
  with us would silently have been Proteus.
- An MLS 1:1 does not exist as a conversation until its first commit:
  `GET /conversations/…` answers 404, and the stub from
  `/one2one-conversations/…` has nobody in its member list. Both the
  conversation and the peer have to come from that answer.
- We put ourselves in our own contact list, because a team of one lists us as
  its only member.
- `HEAD /sso/initiate-login/…` is the one route that answers `text/plain`, and
  the backend is strict: our usual `Accept: application/json` got a 406.

Two more were the backend's own edges rather than ours, and are worth knowing
when running one: wire-server's *integration* nginz config only exact-matches
`/one2one-conversations`, where the production chart routes the whole prefix, so
the MLS 1:1 GET 404s behind it; and cargohold parses the `Host` that nginz
passes on as `Z-Host`, so a backend reached by IP address rather than by name
answers 400 for every asset.

### Known design limits
- Wire has *two* 1:1 conversations per peer, Proteus and MLS, but
  `ChatAccount.rooms` is keyed by contact and holds one room per contact. The MLS
  one wins, and a Proteus message arriving on the abandoned conversation
  afterwards is dropped. Fixing it properly means letting a contact have more
  than one room.
- `ChatMessage.createEdit()` returns a `ChatMessage`, which
  `WireChatRoom.sendMessage()` will not take without a cast, though it works at
  runtime.
