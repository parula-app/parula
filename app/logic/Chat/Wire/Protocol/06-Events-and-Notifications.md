# Wire protocol — 06 Events and notifications

The event/notification system: the two WebSockets, the notification stream, the notification
envelope, and every event `type` a client must handle.

Citations are repo-relative into the reference clones:

| Prefix | Repo |
| --- | --- |
| `wire-webapp/` | Official web client monorepo. `libraries/api-client/src/` = TypeScript REST/WS client, `libraries/core/src/` = client logic, `apps/webapp/src/script/` = UI + event repository. |
| `wire-server/` | Haskell backend. `libs/wire-api/` = API types (authoritative for JSON field names), `services/gundeck` = notification storage/push, `services/cannon` = WebSocket, `charts/` = deployment/routing. |
| `core-crypto/` | Rust MLS + Proteus implementation used by the official clients. |

Anything marked **UNVERIFIED** could not be confirmed in the sources.

---

## 1. The two delivery channels

Wire has **two generations** of live event delivery, and both are alive on current servers:

| | Legacy | Consumable ("async") |
| --- | --- | --- |
| WebSocket path | `/await` | `/events` |
| Introduced | always | API **v8** (no `sync_marker`), extended in **v9** (`sync_marker`) |
| Backing store | Cassandra `gundeck` notification table | RabbitMQ per-client quorum queue |
| Server→client frame | **text**, one bare `Notification` JSON | **binary**, one tagged `MessageServerToClient` JSON |
| Client→server frame | the literal text `ping` (keepalive only) | JSON `MessageClientToServer` (`ack` / `ack_full_sync`) |
| Flow control | none (fire and forget) | per-message `delivery_tag` acknowledgement |
| Catch-up mechanism | `GET /notifications?since=…` before/while the socket is locked | the queue itself replays unacked messages; `sync_marker` marks the live boundary |
| "You missed data" signal | HTTP 404 on `GET /notifications` | `{"type":"notifications_missed"}` frame |
| Client opt-in | default | client capability `consumable-notifications` |

Both endpoints live on **cannon** and are routed by nginz as prefix regexes
`~* ^(/v[0-9]+)?/await` and `~* ^(/v[0-9]+)?/events`, both with `use_websockets: true`
(`wire-server/charts/nginz/values.yaml:191-198`; the concrete nginx location for `/await` is visible
in `wire-server/services/nginz/integration-test/conf/nginz/nginx.conf:623-630`, with
`proxy_read_timeout 1h`).

Servant route definitions: `wire-server/libs/wire-api/src/Wire/API/Routes/Public/Cannon.hs:29-105`
— `await-notifications` (`/await`), `websocket` (`/websocket`, explicitly documented as
"a temporary copy of await, please do not use it"), `consume-events@v8` and `consume-events`
(`/events`).

Handlers: `wire-server/services/cannon/src/Cannon/API/Public.hs:36-50` →
`Cannon.App.wsapp` for `/await`, `Cannon.RabbitMqConsumerApp.rabbitMQWebSocketApp` for `/events`.

---

## 2. The classic `/await` WebSocket

### 2.1 URL and authentication

```
wss://<backendWSURL>/await?access_token=<accessToken>&client=<clientId>
```

Built at `wire-webapp/libraries/api-client/src/tcp/webSocketClient.ts:388-437`:

```ts
const queryParams = new URLSearchParams({access_token: accessToken});
if (markerIncluded) { queryParams.append('sync_marker', markerToken); }   // /events only
if (this.clientId !== undefined && this.clientId.length > 0) {
  queryParams.append('client', this.clientId);
}
const websocketAddress = this.useLegacySocket
  ? `${this.baseUrl}/await?${queryString}`
  : `${this.baseUrl}${this.versionPrefix}/events?${queryString}`;
```

* **The token goes in the query string, not in an `Authorization` header.** Browsers cannot set
  headers on a WebSocket handshake, so nginz's zauth module accepts `access_token` as a query
  parameter and strips it from access logs:
  *"We allow passing access_token as query parameter for e.g. websockets / However we do not want to
  log access tokens."* (`wire-server/services/nginz/integration-test/conf/nginz/nginx.conf:60-63`).
  nginz then sets the upstream headers `Z-User`, `Z-Client`, `Z-Connection`
  (`.../conf/nginz/common_response.conf:10-12`), which is what the Servant route's `ZUser`/`ZConn`
  combinators read. **The connection ID (`Z-Connection`) is minted by nginz — a client cannot and
  need not supply it.**
* `baseUrl` is the backend's WS origin, e.g. `wss://prod-nginz-ssl.wire.com` for production and
  `wss://staging-nginz-ssl.zinfra.io` for staging
  (`wire-webapp/libraries/api-client/src/env/backend.ts:26-36`). Note this is a *different host*
  from the REST host (`https://prod-nginz-https.wire.com`).
* **No `/vN` prefix on `/await`** — the legacy branch above concatenates `baseUrl + '/await'`
  directly. (The client still refuses to build any URL before an API version has been negotiated;
  `webSocketClient.ts:396-398` throws `Missing backend API version` if `useVersion()` was never
  called. `MINIMUM_API_VERSION = 1`, `wire-webapp/libraries/api-client/src/config.ts:26`.)
* `client` is **optional**. Omitting it subscribes to *all* notifications for the user across all
  their devices; supplying it filters to notifications targeted at that device
  (`webSocketClient.ts:408-414`).

### 2.2 Frames

Server → client: one JSON object per **text** frame, the full internal `Notification`:

```json
{"id":"e1a7f5b0-...","transient":false,"payload":[ { …event… } ]}
```

Schema `wire-server/libs/wire-api/src/Wire/API/Internal/Notification.hs:56-70`:

```haskell
data Notification = Notification
  { ntfId :: !NotificationId, ntfTransient :: !Bool, ntfPayload :: !(NonEmpty Object) }
…
        <$> ntfId       S..= S.field "id" S.schema
        <*> ntfTransient S..= (fromMaybe False <$> S.optField "transient" S.schema)
        <*> ntfPayload  S..= S.field "payload" (S.nonEmptyArray S.jsonObject)
```

It is written by `encode n` in gundeck (`services/gundeck/src/Gundeck/Push/Websocket.hs:376`) and
forwarded verbatim by cannon (`services/cannon/src/Cannon/API/Internal.hs:78`). **`transient` is
therefore only ever visible on this socket** — never in the notification stream, never on `/events`
(see §4.3).

### 2.3 Keepalive: application-level `ping` / `pong`

The client sends the literal 4-byte text frame `ping` every **20 seconds**; the server answers with
the literal text frame `pong`.

* Client side: `PING_INTERVAL = TimeUtil.TimeInMillis.SECOND * 20`
  (`wire-webapp/libraries/api-client/src/tcp/reconnectingWebsocket.ts:188`), sent by `sendPing`
  (`:398-424`). If a previous ping has not been answered when the next tick fires
  (`hasUnansweredPing`), the client stops pinging and calls `socket.reconnect()` (`:411-417`).
  Incoming `pong` frames are consumed in `internalOnMessage` and never reach the app
  (`:287-296`).
* Server side (`wire-server/services/cannon/src/Cannon/App.hs:100-109`):

  ```haskell
  isAppLevelPing = \case
        (Text "ping" _) -> True
        (Binary "ping") -> True
        _ -> False
  sendAppLevelPong = sendMsgIO @ByteString "pong" ws
  ```

  with the comment that browsers may silently lose a socket, so *"wire clients are allowed send
  'DataMessage' pings as well, and we respond with a 'DataMessage' pong to allow them to reliably
  decide whether the connection is still alive."*
* The server *additionally* runs protocol-level ping/pong via
  `withPingPong defaultPingPongOptions` (`Cannon/App.hs:47`).
* **The server closes any `/await` socket after 3 days** regardless of health:
  `maxLifetime = 3 * 24 * 3600` seconds (`Cannon/App.hs:37-39`, enforced at `:56`).

### 2.4 Health probe (independent of the ping loop)

`ReconnectingWebsocket.checkHealth(timeoutMs = 10_000)`
(`reconnectingWebsocket.ts:569-637`):

* not OPEN → `false` (CONNECTING/CLOSING → `true`, treat as "not yet broken");
* a message received within the last **5 s** → `true` without probing;
* otherwise send `ping` and resolve `true` on the next `pong`, `false` on timeout.

The webapp drives this from a **30 s heartbeat** (`HEARTBEAT_INTERVAL = 30 s`,
`wire-webapp/apps/webapp/src/script/repositories/event/EventRepository.ts:84`, interval at
`:408-410`), plus `window.focus` on Electron / `visibilitychange` in the browser, plus
`online`/`offline` (`EventRepository.ts:284-404`). An unhealthy probe triggers a full reconnect.

### 2.5 Reconnect strategy

The socket wrapper is `partysocket`'s `ReconnectingWebSocket` with
(`reconnectingWebsocket.ts:176-182`):

| Option | Value |
| --- | --- |
| `connectionTimeout` | 4 s |
| `minReconnectionDelay` | 4 s |
| `maxReconnectionDelay` | 10 s |
| `reconnectionDelayGrowFactor` | 1.3 |
| `maxRetries` | `Infinity` |

The URL is recomputed **for every attempt** through the `onReconnect` callback
(`webSocketClient.ts:156-161`), which does, in order:

1. `waitForValidAccessTokenBeforeReconnect` — if `hasValidAccessToken()` is false, refresh in a loop
   with backoff `1 s × 2^(n-1)`, capped at `10 s`; abort permanently on
   `InvalidTokenError` / `MissingCookieError` / `MissingCookieAndTokenError`
   (`webSocketClient.ts:219-278`, delays at `:57-59`, `:312-318`).
2. `verifyAuthenticatedSessionBeforeReconnect` — a preflight `GET /cookies`; a failure aborts the
   attempt (`webSocketClient.ts:280-302`).
3. `buildWebSocketUrl(reconnectContext)` — fresh `access_token` (and a fresh `sync_marker`, §3.5).

The client also detects **wake-from-sleep** and reconnects then (`onBackFromSleep`,
`reconnectingWebsocket.ts:29`, started in the constructor at `:222`), because `navigator.onLine`
does not fire an `offline` event when a laptop lid closes.

### 2.6 Locking: the reason `/await` needs a buffer

`WebSocketClient` has an explicit lock (`webSocketClient.ts:359-386`):

```ts
/** Locks the websocket so messages are buffered instead of being emitted.
 *  Once the websocket gets unlocked buffered messages get emitted.
 *  This behaviour is needed in order to not miss any messages
 *  during fetching notifications from the notification stream. */
public readonly lock = () => { this.isSocketLocked = true; };
```

While locked, `onMessage` pushes the raw string into `bufferedMessages`; `unlock()` replays them in
order (`:127-141`, `:364-371`). `onClose` clears the buffer (`:167-171`). This is the whole
websocket/stream merge strategy for the legacy path — see §7.

---

## 3. The consumable ("async") `/events` WebSocket

### 3.1 URL

```
wss://<backendWSURL>/v<apiVersion>/events?access_token=<token>&sync_marker=<uuid4>&client=<clientId>
```

(`webSocketClient.ts:400-420`.) Unlike `/await`, this path **is** version-prefixed. Query params:

| Param | Required | Meaning |
| --- | --- | --- |
| `access_token` | yes | same query-string auth as `/await` |
| `client` | optional | device ID. **Omitting it changes the semantics** (§3.6) |
| `sync_marker` | optional, **v9+** | client-generated UUID echoed back once the backlog is drained |

Route: `wire-server/libs/wire-api/src/Wire/API/Routes/Public/Cannon.hs:64-105`. `consume-events@v8`
is `From 'V8 :> Until 'V9` and takes no `sync_marker`; `consume-events` is `From 'V9` and takes it.

### 3.2 Server → client frames (binary, JSON payload)

Tagged union `MessageServerToClient`
(`wire-server/libs/wire-api/src/Wire/API/Event/WebSocketProtocol.hs:80-134`), tag field `type`:

| `type` | Shape |
| --- | --- |
| `"event"` | `{"type":"event","data":{"event":{"id":"<uuid>","payload":[…]},"delivery_tag":<uint64>}}` |
| `"notifications_missed"` | `{"type":"notifications_missed"}` — no `data` |
| `"synchronization"` | `{"type":"synchronization","data":{"marker_id":"<uuid>","delivery_tag":<uint64>}}` |

Field names come from the `ToSchema` instances at `WebSocketProtocol.hs:43-78`:
`delivery_tag`, `multiple`, `event`, `marker_id`.

Note the nesting difference from `/await`: here `data.event` is a **`QueuedNotification`**
(`{id, payload}` only — see §4.1), *not* the internal `Notification`, so **there is no `transient`
field on this socket** (`services/gundeck/src/Gundeck/Push.hs:317-330` builds the message body with
`queuedNotification notif.ntfId notif.ntfPayload`).

Frames are sent with `WS.sendBinaryData` (`services/cannon/src/Cannon/RabbitMqConsumerApp.hs:238`,
`:318`). A client must accept **binary** frames and JSON-decode the bytes.

The TS mirror of these types is
`wire-webapp/libraries/api-client/src/notification/consumableNotification.ts:28-133`, including a
zod discriminated union `ConsumableNotificationSchema` that the client uses to *validate* every
frame (`webSocketClient.ts:136-138`) — malformed frames throw rather than being processed.

### 3.3 Client → server frames (JSON)

`MessageClientToServer` (`WebSocketProtocol.hs:89-95`, `:140-166`):

| `type` | Shape | When |
| --- | --- | --- |
| `"ack"` | `{"type":"ack","data":{"delivery_tag":<uint64>,"multiple":<bool>}}` | after an `event` or `synchronization` frame has been fully processed |
| `"ack_full_sync"` | `{"type":"ack_full_sync"}` — no `data` | exactly once, in reply to `notifications_missed` |

`multiple: true` acknowledges every `delivery_tag <= delivery_tag` (RabbitMQ multi-ack semantics,
documented in the Haskell comment at `WebSocketProtocol.hs:34-37`). The official web client always
sends `multiple: false` (`webSocketClient.ts:445-480`) and notes batch processing as a future use.

**Critical:** on this socket every client frame is parsed as `MessageClientToServer`. Sending the
legacy text `ping` produces `FailedToParseClientMessage` and the server closes the connection with
code **1003 `failed-to-parse`** (`RabbitMqConsumerApp.hs:339-344`, `:172-185`). The official client
therefore explicitly disables app-level pinging when switching:

```ts
public useAsyncNotificationsSocket() {
  this.useLegacySocket = false;
  // we shouldn't send ping to the new async notifications sockets otherwise the backend will close the connection
  this.socket.disablePinging();
}
```
(`webSocketClient.ts:439-443`.)

### 3.4 Keepalive on `/events`: WebSocket control frames

The server drives it (`RabbitMqConsumerApp.hs:83-92`):

```haskell
let monitor = do
      timeout wsConn.activityTimeout (takeMVar wsConn.activity) >>= \case
        Just _  -> monitor
        Nothing -> do
          WS.sendPing wsConn.inner ("ping" :: Text)
          timeout wsConn.pongTimeout (takeMVar wsConn.inner.connectionHeartbeat) >>= \case
            Just _  -> monitor
            Nothing -> cancelWith main InactivityTimeout
```

* `activityTimeout` and `pongTimeout` default to **20 000 000 µs = 20 s** each
  (`wire-server/services/cannon/src/Cannon/Options.hs:83-92`). *(The prose docs at
  `wire-server/docs/src/developer/reference/config-options.md:1339` say "both options default to 30
  seconds" — the code says 20 s. Treat the code as authoritative and assume ≥ 20 s of silence is
  fatal.)*
* "Activity" is reset by an incoming **control Ping** from the client
  (`RabbitMqConsumerApp.hs:361-364`), and the server replies with a control Pong. A client-sent
  control Pong satisfies the server's own ping (`:358-360`).
* On timeout the server closes with **1002 `inactivity`** (`:165-170`).

So a from-scratch client on `/events` should send a **WebSocket protocol-level Ping** (not a data
frame) every ~10 s, or simply answer the server's Pings — most WS libraries auto-reply to Ping with
Pong, which alone is enough to keep the connection open.

### 3.5 The `sync_marker` handshake (API v9+) — "when am I live?"

On the legacy path, "caught up" means "the `/notifications` pages are exhausted". On `/events`
there is no separate stream, so the client injects a **marker message into its own queue** and waits
for it to come back:

1. Before connecting, the client generates a fresh UUIDv4 and stores it as `markerToken`
   (`wire-webapp/libraries/api-client/src/auth/accessTokenStore.ts:80-85`), passing it as
   `sync_marker`.
2. cannon publishes a `synchronization`-typed AMQP message onto the client's queue *after* whatever
   backlog is already there
   (`RabbitMqConsumerApp.hs:80`: `traverse_ (Q.publishMsg chan.inner "" queueInfo.queueName . mkSynchronizationMessage e.notificationTTL) (mcid *> mSyncMarkerId)`
   — note `mcid *> mSyncMarkerId`: **the marker is only published when a `client` was supplied**).
   The marker message is built at `:221-228` with `msgType = Just "synchronization"` and body = the
   marker text.
3. When the consumer reaches it, cannon emits
   `{"type":"synchronization","data":{"marker_id":"<uuid>","delivery_tag":N}}` (`:109-119`).
4. The client acks it, and **only if `marker_id` equals its current `markerToken`** flips its state
   to LIVE (resume sending, resume MLS proposal processing, …)
   (`wire-webapp/libraries/core/src/account.ts:1053-1094`). Stale markers from earlier connection
   attempts are acked and ignored — the log line is `async-sync-marker-ignored`.

Everything received *before* the matching marker is backlog; everything after is live.

### 3.6 Queue topology and the "no `client` param" mode

`createQueue` (`RabbitMqConsumerApp.hs:206-219`):

* **With `client`**: a durable quorum queue named `user-notifications.<userId>.<clientId>`
  (`wire-server/libs/wire-api/src/Wire/API/Notification.hs:229-231`), dead-lettered to
  `dead-user-notifications` (`queueOpts`, `Notification.hs:242-257`). Messages survive
  disconnection; unacked messages are **redelivered** on the next connect.
* **Without `client`**: an *exclusive, auto-delete* queue bound to routing keys `<userId>` and
  `<userId>.temporary` on exchange `user-notifications` (`:207-216`). Nothing is retained; this is
  the mode used by a client that has not registered a device yet (e.g. during login).

Gundeck publishes to exchange `user-notifications` with routing key `<userId>` (all devices) or
`<userId>.<clientId>` (`services/gundeck/src/Gundeck/Push.hs:317-330`,
`Notification.hs:218-240`). Non-transient messages are `Persistent` with TTL = `notificationTTL`;
transient messages are `NonPersistent` with `msgExpiration = "0"`, i.e. *delivered only if a
consumer is attached right now* (`Push.hs:355-373`).

### 3.7 `notifications_missed` and the full-sync handshake

When a queue dead-letters (queue TTL expiry / overflow), the background worker records the pair in
Cassandra:

```sql
INSERT INTO missed_notifications (user_id, client_id) VALUES (?, ?)
```
(`wire-server/services/background-worker/src/Wire/DeadUserNotificationWatcher.hs:99-109`; transient
dead letters are ignored, `:65-69`).

On the **next** `/events` connect with a `client`, before anything else, cannon checks that table
and, if a row exists, sends `EventFullSync` and **blocks until the client answers**
(`RabbitMqConsumerApp.hs:79`, `:291-330`):

```haskell
sendFullSyncMessage uid cid wsConn env = do
  let event = encode EventFullSync
  WS.sendBinaryData wsConn.inner event
  getClientMessage wsConn >>= \case
    AckMessage _ -> throwIO UnexpectedAck
    AckFullSync  -> C.runClient env.cassandra do
        retry x1 $ write delete (params LocalQuorum (uid, cid))
```

Answering with an ordinary `ack` here is a protocol violation → close **1003 `unexpected-ack`**
(`:181-185`). **No further notifications are delivered until `ack_full_sync` arrives.**

What the client must *do* about it: re-fetch full state (conversations, connections, users, team,
self), because an unknown number of events were dropped. The official web client cannot resync
in place, so it sets a `has_missing_notification` localStorage flag and reloads the app; on the next
run it sees the flag, sends `ack_full_sync` and clears it
(`wire-webapp/libraries/core/src/account.ts:1294-1331`). A native client should instead: do the full
state refetch, *then* send `ack_full_sync`.

### 3.8 Close codes to expect on `/events`

| Code | Reason string | Cause |
| --- | --- | --- |
| 1001 | `""` | RabbitMQ channel closed server-side (`RabbitMqConsumerApp.hs:187-190`) |
| 1002 | `inactivity` | no pong within `pongTimeout` (`:165-170`) |
| 1003 | `failed-to-parse` | a client frame was not valid `MessageClientToServer` JSON (`:172-180`) |
| 1003 | `unexpected-ack` | `ack` sent where `ack_full_sync` was required, or vice versa (`:181-185`, `:246`) |
| 1003 | `websocket-failure` | unexpected `ConnectionException` (`:158-163`) |
| 1003 | `internal-error` | any other server exception (`:192-195`) |
| HTTP 503 | `Service Unavailable` (handshake rejected) | `TooManyChannels` on this cannon instance (`:197-204`) |

### 3.9 Delivery semantics

At-least-once. An event that is *not* acked is redelivered on the next connection — the integration
test `testConsumeEventsAcks` asserts exactly that: *"without ack, we receive the same event again"*
(`wire-server/integration/test/Test/Events.hs:337-357`). The client must therefore ack **after**
persisting/decrypting, and must be idempotent on replay. The official client flushes its
in-flight processing queue on socket close precisely so undecrypted notifications get redelivered
rather than double-decrypted (`wire-webapp/libraries/core/src/account.ts:1225-1235`).

The web client also notes a server-side in-flight window: *"currently total size of notifications
coming from web socket is limited to 500 so we need to acknowledge the notifications to let the
backend know we are ready for the next batch"* (`account.ts:829-835`). **UNVERIFIED** — the
concrete RabbitMQ prefetch value was not located in `wire-server`.

---

## 4. The notification stream (REST)

Service: **gundeck**. Routes:
`wire-server/libs/wire-api/src/Wire/API/Routes/Public/Gundeck.hs:67-132`.

### 4.1 `GET /notifications`

```
GET /notifications?since=<uuid-v1>&client=<clientId>&size=<n>
```

| Param | Type | Notes |
| --- | --- | --- |
| `since` | UUID **v1** | exclusive lower bound; the `id` of the last notification you handled |
| `client` | ClientId | only notifications targeted at this device |
| `size` | `Range 100 10000 Int32` | server default **1000** (`services/gundeck/src/Gundeck/API/Public.hs:96`, `:122`); the web client sends **10000** (`NOTIFICATION_SIZE_MAXIMUM`, `wire-webapp/libraries/api-client/src/notification/notificationApi/notificationApi.ts:25`) |

**200** body (`QueuedNotificationList`,
`wire-server/libs/wire-api/src/Wire/API/Notification.hs:149-176`):

```json
{
  "notifications": [ {"id": "...", "payload": [ … ]} ],
  "has_more": false,
  "time": "2026-08-20T09:41:12.000Z"
}
```

* `notifications` — array of `QueuedNotification`, each **only** `{id, payload}`
  (`Notification.hs:124-146`). No `transient` here.
* `has_more` — optional in the schema, defaults `false` (`:167-168`).
* `time` — optional ISO-8601 server time (`:169-170`); gundeck always fills it
  (`services/gundeck/src/Gundeck/Notification.hs:56-64`). Use it for clock-drift correction; the
  webapp does exactly that, issuing a `size=100` call purely to read `time`
  (`wire-webapp/apps/webapp/src/script/repositories/event/NotificationService.ts:60-65` and
  `EventRepository.ts:456-467`).

**Pagination**: loop while `has_more`, using the *last* returned notification's `id` as the next
`since` (`notificationApi.ts:149-160`).

**400** `{"code":400,"label":"bad-request","message":"Invalid Notification ID"}` when `since` is not
a v1 UUID (`Gundeck/Notification.hs:66-69`; version check in
`Wire/API/Notification.hs:115-119`).

### 4.2 The 404 "notifications lost" case

`since` is a **UUIDv1**, so it carries a timestamp. If the referenced notification no longer exists
(older than the TTL — `notificationTTL: 2419200` seconds = **28 days**,
`wire-server/charts/wire-server/values.yaml:562,798`), gundeck can still return everything *after*
that timestamp, but signals the gap with a 404. The behaviour **differs by API version**
(`services/gundeck/src/Gundeck/API/Public.hs:57-124`):

* **API ≤ v2** (`get-notifications@v2`): status **404** with a **full `QueuedNotificationList`
  body** — the partial list *is* returned:

  ```json
  {"notifications":[ … ],"has_more":false,"time":"…"}
  ```

  (`Gundeck.hs:107-113`, union `GetNotificationsResponse` at `Notification.hs:187-196`.)
  Same 404 is produced when `since` fails to parse at all (`Public.hs:104`).
* **API ≥ v3** (`get-notifications`): status **404** with the *error* body and **no notifications**:

  ```json
  {"code":404,"label":"not-found","message":"Some notifications not found"}
  ```

  (`Gundeck.hs:125-131`; `paginate` returns `Nothing` on a gap, `Public.hs:115-124`; label at
  `libs/wire-api/src/Wire/API/Error/Gundeck.hs:50`.)

**What the client must do**: treat it as *"you have lost history"*, then fetch full state. The
official client's algorithm (`notificationApi.ts:108-147`):

```ts
const isErrorWithNotifications =            // v2 and earlier: body carried a partial list
  isAxiosError && Array.isArray(error.response?.data?.notifications) && …length > 0;
const isBadRequestError = isAxiosError && error.response?.status === StatusCode.BAD_REQUEST;
const isNotFoundError   = error instanceof BackendError && error.label === BackendErrorLabel.NOT_FOUND;

if (isBadRequestError || isNotFoundError) {
  // we need to load all the notifications from the beginning (without 'since' param)
  const payload = await getNotificationChunks(notificationList, currentClientId);
  return {...payload, missedNotification: currentNotificationId};
}
if (isErrorWithNotifications) { hasMissedNotifications = true; payload = {…, ...error.response?.data}; }
```

i.e. **404 (v3+) or 400 → restart the whole pagination with no `since` at all**, and report the old
`since` as `missedNotification`. The consumer then (a) shows a "you may have missed messages"
system message in every conversation, persisting the missed ID so it is shown only once
(`EventRepository.ts:487-494`), and (b) for MLS, queues an epoch-mismatch rejoin of all
conversations (`wire-webapp/libraries/core/src/account.ts:1145-1157`).

Because the client also re-reads conversations/users/connections at startup, "fetch full state" in
practice means: `GET /conversations/list-ids` + `/conversations/list`, `/list-connections`,
`/self`, team members/features — and only then resume the stream.

### 4.3 `transient` is not in the stream at all

Transient notifications are never written to Cassandra
(`services/gundeck/src/Gundeck/Push.hs:275-281`: `unless (ntfTransient ctNotification) $ … mpaStreamAdd …`)
and never trigger a native push (`:304-306`). So:

* `/await` frames: `transient` present (`true` for typing indicators & co).
* `/events` frames: no `transient` field; transient events simply expire immediately if no consumer
  is attached.
* `GET /notifications` responses: transient notifications are absent by construction.

`transient = True` is set by the backend for: typing indicators
(`libs/wire-subsystems/src/Wire/ConversationSubsystem/Action.hs:1710-1721`), several team events
(`services/galley/src/Galley/API/Teams.hs:322,633,844,867,1097`) and user-group events
(`libs/wire-subsystems/src/Wire/UserGroupSubsystem/Interpreter.hs:197`).

### 4.4 `GET /notifications/last`

```
GET /notifications/last?client=<clientId>
```

**200** → a single `QueuedNotification` `{id, payload}`; **404** `not-found` if the user has none
yet (`Gundeck.hs:83-97`).

Used **only** to initialise a brand-new device: set `last_event_date` to the epoch and
`last_notification_id` to this ID so the client does *not* replay the account's entire history:

```ts
public async legacyInitializeNotificationStream(clientId: string): Promise<string> {
  await this.setLastEventDate(new Date(0));
  const latestNotification = await this.backend.getLastNotification(clientId);
  return this.setLastNotificationId(latestNotification);
}
```
(`wire-webapp/libraries/core/src/notification/notificationService.ts:92-102`.)

### 4.5 Other endpoints

| Method + path | Purpose |
| --- | --- |
| `GET /notifications/{id}?client=` | fetch one notification by ID; 404 `not-found` (`Gundeck.hs:67-82`, client `notificationApi.ts:171-186`) |
| `GET /time` | server time `{"time":"…"}`, **from API v9** (`Gundeck.hs:134-143`) |

### 4.6 Interaction with the consumable capability

Once a device declares `consumable-notifications`, gundeck routes its notifications to RabbitMQ
**instead of** Cassandra: `splitPushes` partitions recipients by
`supportsConsumableNotifications` (`services/gundeck/src/Gundeck/Push.hs:200-221`, `:243-258`), and
only the legacy half is written to the stream (`:275-281`). The integration test asserts the
consequence: after events were delivered over `/events`, *"No new notifications should be stored in
Cassandra as the user doesn't have any legacy clients"* and `GET /notifications?since=…` is empty
(`wire-server/integration/test/Test/Events.hs:90-94`).

**This is why the migration order matters** (§5.3): the two queues are disjoint.

---

## 5. Choosing a channel: capability + feature flag

### 5.1 Client capability

`PUT /clients/{clientId}` with body `{"capabilities": ["legalhold-implicit-consent",
"consumable-notifications"]}`
(`wire-webapp/libraries/api-client/src/client/clientApi.ts:78-96`,
`.../client/clientCapabilityData.ts:22-24`, enum at `.../client/clientCapability.ts:20-23`).

Server enum (`wire-server/libs/wire-api/src/Wire/API/User/Client.hs:147-160`):

```haskell
data ClientCapability = ClientSupportsLegalholdImplicitConsent | ClientSupportsConsumableNotifications
…
      element "legalhold-implicit-consent" ClientSupportsLegalholdImplicitConsent
        <> element "consumable-notifications" ClientSupportsConsumableNotifications
```

Capabilities can also be supplied at registration time (`POST /clients`,
`wire-webapp/libraries/core/src/client/clientService.ts:172-186`). **Capabilities cannot be
removed** — attempting it yields the backend error label `client-capability-removed`
(handled at `clientApi.ts:92-96`).

### 5.2 Feature detection

The switch is the **team feature `consumableNotifications`**:

```ts
const useAsyncNotificationStream =
  teamFeatures[FEATURE_KEY.CONSUMABLE_NOTIFICATIONS]?.status === FEATURE_STATUS.ENABLED;
const useLegacyNotificationStream = !useAsyncNotificationStream;
```
(`wire-webapp/apps/webapp/src/script/main/app.ts:643-646`; same check pre-login at
`.../auth/module/action/clientAction.ts:70-75`.)

* Key string: `consumableNotifications` (`FEATURE_KEY.CONSUMABLE_NOTIFICATIONS`,
  `wire-webapp/libraries/api-client/src/team/feature/featureList.types.ts:70`);
  status values `enabled` / `disabled` (`:101-104`).
* Read from `GET /feature-configs` (all features for the caller, works for personal users too —
  `wire-webapp/libraries/api-client/src/team/feature/featureApi.ts:75-79`, cached by
  `TeamService.getCommonFeatureConfig`, `libraries/core/src/team/teamService.ts:74-86`).
  Per-team variant: `GET /teams/{teamId}/features/consumableNotifications` (`featureApi.ts:389-397`).
* Server-side there is additionally a deployment flag `consumableNotifications` rendered into brig
  and gundeck configs; when false the RabbitMQ path is inert regardless of capabilities
  (`wire-server/docs/src/developer/reference/config-options.md:2289-2304`,
  `services/brig/src/Brig/Options.hs:552-553`, `services/gundeck/src/Gundeck/Push.hs:246-252`).

**Which one do current servers use?** Both. `/await` is universally available. `/events` requires
API ≥ v8 *and* the deployment flag *and* the team feature *and* the client capability. A new client
should therefore implement `/await` first and treat `/events` as an opt-in upgrade.

### 5.3 The one-time migration handshake

Because the two queues are disjoint (§4.6), a client switching from legacy to consumable must drain
the legacy stream **once more, after declaring the capability but before opening any socket**
(`wire-webapp/libraries/core/src/account.ts:772-806`):

```ts
const isClientCapableOfConsumableNotifications =
  this.getClientCapabilities().includes(ClientCapability.CONSUMABLE_NOTIFICATIONS);
const capabilities = [ClientCapability.LEGAL_HOLD_IMPLICIT_CONSENT];
if (!useLegacy) {
  capabilities.push(ClientCapability.CONSUMABLE_NOTIFICATIONS);
  this.apiClient.transport.ws.useAsyncNotificationsSocket();
}
await this.service?.client.putClientCapabilities(this.currentClient.id, {capabilities});
…
if (!isClientCapableOfConsumableNotifications && !useLegacy) {
  await legacyProcessNotificationStream();   // no websocket yet
}
```

with the explanatory comment: *"the backend maintains a separate queue for new async notifications
(/events websocket endpoint), which only starts populating after the client declares support …
after declaring support, it's necessary to perform one final fetch from the legacy system to ensure
no notifications are missed."*

---

## 6. The envelope, and a full example

### 6.1 Shape

A **notification** is `{id, payload}` (+ `transient` on the legacy socket only). `id` is a
**UUID version 1** — the version bits are checked by the server
(`wire-server/libs/wire-api/src/Wire/API/Notification.hs:115-119`) and it is generated with
`Data.UUID.V1.nextUUID` (`:83-90`). Because v1 UUIDs embed a timestamp, they are the stream cursor
(`since`).

`payload` is a **non-empty array of events**. Each event is a free-form JSON object whose only
guaranteed field is `type: string` (`Notification.hs:92-113`: *"This definition is very opaque, but
we know some of the structure already"*). Multiple events per notification are normal — a single
backend action can fan out several.

### 6.2 Real example — legacy `/await` frame / stream entry

```json
{
  "id": "f3c8bd90-9d5e-11f0-8000-22000a0d0e11",
  "payload": [
    {
      "type": "conversation.otr-message-add",
      "conversation": "8b3d3f6c-6f8f-4a3b-8f2f-2c9f4a5d1e77",
      "qualified_conversation": {
        "id": "8b3d3f6c-6f8f-4a3b-8f2f-2c9f4a5d1e77",
        "domain": "wire.com"
      },
      "from": "2c1e6a1e-8ab5-4b2e-9c65-1c6e6a2d5f01",
      "qualified_from": {
        "id": "2c1e6a1e-8ab5-4b2e-9c65-1c6e6a2d5f01",
        "domain": "wire.com"
      },
      "via": "user",
      "time": "2026-08-20T09:41:12.317Z",
      "data": {
        "sender": "6f3a1b7c9d2e4f01",
        "recipient": "a1b2c3d4e5f60718",
        "text": "owABAaEAWCA0d1p2…base64 Proteus ciphertext…",
        "data": "3q2+7wAAAAA…base64 external data…"
      }
    }
  ]
}
```

Every field name above is from `eventObjectSchema`
(`wire-server/libs/wire-api/src/Wire/API/Event/Conversation.hs:671-684`) and
`otrMessageObjectSchema` (`:481-502`). The `id`/`payload` wrapper is
`Wire/API/Notification.hs:135-146`.

### 6.3 The same event delivered over `/events`

```json
{
  "type": "event",
  "data": {
    "delivery_tag": 1487,
    "event": {
      "id": "f3c8bd90-9d5e-11f0-8000-22000a0d0e11",
      "payload": [ { "type": "conversation.otr-message-add", "…": "…" } ]
    }
  }
}
```

Reply:

```json
{"type":"ack","data":{"delivery_tag":1487,"multiple":false}}
```

### 6.4 Common conversation-event envelope

Produced by `eventObjectSchema` (`Event/Conversation.hs:671-684`) for **all** `conversation.*`
events except the `conversation.system.*` family:

| Field | Type | Notes |
| --- | --- | --- |
| `type` | string | see §7 |
| `conversation` | UUID | **deprecated/unqualified** duplicate of `qualified_conversation.id`; written via `optional (field "conversation" …)` |
| `qualified_conversation` | `{id, domain}` | authoritative conversation ID |
| `subconv` | string, optional | MLS subconversation ID, e.g. `"conference"` — only on MLS events |
| `from` | UUID | unqualified duplicate of `qualified_from.id` |
| `qualified_from` | `{id, domain}` | actor |
| `via` | `"user"` \| `"scim"` | how the action was triggered (`EventVia`, `Event/Conversation.hs:129-139`) |
| `time` | ISO-8601, **millisecond** precision | `toUTCTimeMillis` (`:681`) |
| `team` | UUID, optional | present when the conversation belongs to a team |
| `data` | object \| string \| `null` | per-type, see the table |

The `conversation.system.*` variants use `systemEventObjectSchema`
(`Event/Conversation.hs:607-618`): **no `from`/`qualified_from`**, and `via` is the constant
`"system"`.

`user.*` events have **no common envelope at all** — the payload fields sit at the top level next to
`type` (`wire-webapp/libraries/api-client/src/event/userEvent.ts:79-129`: every `UserXEvent extends
BaseUserEvent, UserXData`). `team.*` events use `{type, team, time, data}`
(`wire-server/libs/wire-api/src/Wire/API/Event/Team.hs:88-95`).

---

## 7. Complete event type table

Every `type` string a client can see, with its payload shape. Sources:
`wire-server/libs/wire-api/src/Wire/API/Event/*.hs` + `Wire/API/UserEvent.hs` (authoritative JSON),
mirrored in `wire-webapp/libraries/api-client/src/event/*.ts`.

### 7.1 `conversation.*` (galley → gundeck)

Enum: `Event/Conversation.hs:214-241` (+ system types at `:560-567`); TS mirror
`wire-webapp/libraries/api-client/src/event/conversationEvent.ts:43-69`. `data` dispatch table:
`Event/Conversation.hs:626-661`.

| `type` | `data` | Fields |
| --- | --- | --- |
| `conversation.otr-message-add` | object | `sender`, `recipient`, `text`, `data?` — §8 |
| `conversation.mls-message-add` | **string** | base64 MLSMessage; plus top-level `subconv?` — §9 |
| `conversation.mls-welcome` | **string** | base64 MLS Welcome — §10 |
| `conversation.mls-reset` | object | `group_id`, `new_group_id?` (`Event/Conversation.hs:504-517`) |
| `conversation.create` | object | full `Conversation` in **v2 shape** (`:646`) — see §7.1.1 |
| `conversation.create-meeting` | object | same shape, meeting conversations (`:647`) |
| `conversation.delete` | `null` | `:655` |
| `conversation.delete-meeting` | `null` | `:656` |
| `conversation.system.delete` | `null` | system variant, no `from`, `via:"system"` (`:564`, `:591`) |
| `conversation.rename` | object | `{name: string}` (`ConversationRename`) |
| `conversation.member-join` | object | `users: SimpleMember[]`, `user_ids: string[]` *(deprecated)*, `add_type` (`:356-378`) |
| `conversation.member-leave` | object | `reason`, `qualified_user_ids: QualifiedId[]`, `user_ids: string[]` (`:663-666`) |
| `conversation.member-update` | object | `qualified_target`, `target`, `otr_muted_status?`, `otr_muted_ref?`, `otr_archived?`, `otr_archived_ref?`, `hidden?`, `hidden_ref?`, `conversation_role?` (`:448-459`) |
| `conversation.system.member-update` | object | same `data`, no `from`, `via:"system"` (`:565`, `:592`) |
| `conversation.access-update` | object | `access: string[]`, `access_role: string\|null` *(legacy)*, `access_role_v2: string[]\|null` (`:640-643` → `conversationAccessDataSchema (Just V2)`) |
| `conversation.receipt-mode-update` | object | `{receipt_mode: 0|1}` |
| `conversation.message-timer-update` | object | `{message_timer: number|null}` — milliseconds |
| `conversation.code-update` | object | `code`, `key`, `uri`, `has_password` (`Conversation/Code.hs:110-127`) |
| `conversation.code-delete` | `null` | `:654` |
| `conversation.typing` | object | `{status:"started"|"stopped"}` — §12 |
| `conversation.protocol-update` | object | `{protocol:"mixed"|"mls"}` (`:658`) |
| `conversation.connect-request` | object | `qualified_recipient`, `recipient`, `message?`, `name?`, `email?` (`:416-423`) |
| `conversation.add-permission-update` | object | `{add_permission:"everyone"|"admins"}` |
| `conversation.history-update` | `null` \| object | `null` = private; otherwise `{depth: "infinite"|"<seconds>"}` (`History.hs:105-118`). Not implemented in the web client. |
| `conversation.adminless-reminder` | object | `{deletion_scheduled_for: ISO-8601}` (`:519-530`) |
| `conversation.system.adminless-reminder` | object | same `data`, no `from` (`:566`, `:593`) |

Enum values:

* `add_type` (`JoinType`): `"external_add"` \| `"internal_add"` (default `internal_add`) —
  `wire-server/libs/wire-api/src/Wire/API/Conversation.hs:1230-1244`.
* `reason` (`EdMemberLeftReason`): `"left"` \| `"user-deleted"` \| `"removed"` —
  `Event/LeaveReason.hs:29-46`. *(The web client's `MemberLeaveReason` also lists
  `"legalhold-policy-conflict"`, `wire-webapp/.../conversationMemberLeaveData.ts:22-25`; that value
  does not appear anywhere in current `wire-server` — treat it as legacy.)*
* `SimpleMember` (`member-join` `data.users[]`): `{qualified_id:{id,domain}, id, conversation_role}`,
  role defaulting to `wire_admin` when absent (`Event/Conversation.hs:380-398`). The web client
  types it as the richer `OtherMember` (`+ service?`, `status: 0`).
* `conversation_role`: `"wire_admin"` \| `"wire_member"` \| custom (2–128 chars, `wire_` reserved)
  (`wire-webapp/libraries/api-client/src/conversation/conversationRole.ts:19-21`).
* `otr_muted_status` (`MutedStatus`): `0` all notifications, `1` only mentions, `3` none
  (`wire-webapp/libraries/api-client/src/conversation/mutedStatus.ts:19-23`).
* `receipt_mode`: `0` off, `1` on (`.../data/conversationReceiptModeUpdateData.ts:24-31`).
* `access`: `"code"` \| `"invite"` \| `"link"` \| `"private"`; `access_role_v2`:
  `"team_member"` \| `"service"` \| `"non_team_member"` \| `"guest"`; legacy `access_role`:
  `"activated"` \| `"non_activated"` \| `"private"` \| `"team"`
  (`.../conversation/conversation.ts:36-55`).
* `subconv`: `"conference"` is the only value the client knows
  (`.../conversation/subconversation.ts:22-24`).

#### 7.1.1 `conversation.create` `data`

The full conversation object as returned by `GET /conversations`, serialized with the **V2** schema
(`Event/Conversation.hs:646`): `qualified_id`, `id`, `type` (0 regular / 1 self / 2 one-to-one /
3 connect / 4 global-team), `creator`, `access`, `access_role` + `access_role_v2`, `name`, `team`,
`message_timer`, `receipt_mode`, `group_conv_type`, `add_permission`, `cells_state`, `parent`,
`history`, `members`, `protocol` (+ `group_id`/`epoch`/`cipher_suite` for MLS), and two frozen
legacy fields `last_event: "0.0"` and `last_event_time: "1970-01-01T00:00:00.000Z"`
(`wire-server/libs/wire-api/src/Wire/API/Conversation.hs:227-245`, `:300-331`; TS shape
`wire-webapp/libraries/api-client/src/conversation/conversation.ts:78-121` and
`.../data/conversationCreateData.ts:22-27`).

### 7.2 `user.*` (brig → gundeck)

Enum and payload dispatch: `wire-server/libs/wire-api/src/Wire/API/UserEvent.hs:117-141`,
`:266-430`. TS mirror `wire-webapp/libraries/api-client/src/event/userEvent.ts:35-129` +
`.../user/data/*.ts`. **All fields are top-level, not under `data`.**

| `type` | Top-level fields |
| --- | --- |
| `user.new` | `user`: full `User` (identity stripped) — `UserEvent.hs:272-273` |
| `user.activate` | `user`: full `User` — `:274-275` |
| `user.update` | `user`: `{id, name?, text_status?, picture?` *(deprecated)*`, accent_id?, assets?, handle?, locale?, managed_by?, sso_id?, sso_id_deleted, supported_protocols?, team?}` — `:276-300`. Also carries the identity variant `user: {id, email?, phone?}` — `:301-312` |
| `user.identity-remove` | `user`: `{id, email?, phone?}` — `:314-329` |
| `user.suspend` | `id` — `:330` |
| `user.resume` | `id` — `:331` |
| `user.delete` | `qualified_id: {id,domain}`, `id` — `:332-340` |
| `user.legalhold-enable` | `id` (the user under legal hold) — `:341-344` |
| `user.legalhold-disable` | `id` — `:345-348` |
| `user.legalhold-request` | `id` (target user), `last_prekey: {id, key}`, `client: {id}` — `:349-359` |
| `user.session-refresh-suggested` | *(no data)* — `:360-363` |
| `user.properties-set` | `key`, `value` (arbitrary JSON) — `:364-373`. Web clients use `key: "webapp"` with the settings blob (`wire-webapp/.../user/data/userPropertiesSetData.ts:33-69`) |
| `user.properties-delete` | `key` — `:374-380` |
| `user.properties-clear` | *(no data)* — `:381-387` |
| `user.client-add` | `client`: full `Client` (v6 shape: `id`, `type`, `time`, `class`, `label`, `model`, `capabilities`, `mls_public_keys`, …) — `:388-394` |
| `user.client-remove` | `client: {id}` — `:395-401` |
| `user.connection` | `connection: {conversation, qualified_conversation?, from, to, qualified_to?, status, last_update, message?}`, `user?: {name}` — `:402-408`; TS `wire-webapp/.../connection/connection.ts:23-32` |
| `user.push-remove` | `token: {transport, app, token, client}` — `wire-server/libs/wire-api/src/Wire/API/Event/Gundeck.hs:26-41` |

`connection.status` values: `accepted`, `blocked`, `cancelled`, `ignored`,
`missing-legalhold-consent`, `pending`, `sent` (+ client-side `unknown`)
(`wire-webapp/libraries/api-client/src/connection/connectionStatus.ts:20-29`).

`user.push-remove` is emitted by gundeck (not brig) and is the only `user.*` event with a
hand-written encoder:

```haskell
instance ToJSONObject PushRemove where
  toJSONObject (PushRemove t) = KeyMap.fromList
      [ "type" .= ("user.push-remove" :: Text), "token" .= t ]
```

### 7.3 `user-group.*`

`wire-server/libs/wire-api/src/Wire/API/UserEvent.hs:138-140`, `:409-429`;
TS `wire-webapp/libraries/api-client/src/event/userGroupEvent.ts:20-47`.

| `type` | Fields |
| --- | --- |
| `user-group.created` | `user_group: {id}` |
| `user-group.updated` | `user_group: {id}` |
| `user-group.deleted` | `user_group: {id}` |

These are pushed `transient = True`
(`wire-server/libs/wire-subsystems/src/Wire/UserGroupSubsystem/Interpreter.hs:197`).

### 7.4 `team.*` (galley)

Envelope `{type, team, time, data}` (`Event/Team.hs:88-95` — that is `toJSONObject`, which is what
gundeck pushes; the Servant `ToSchema` at `:65-74` additionally mentions a `version` field, which is
**not** in the pushed JSON). `data` per type (`:174-199`):

| `type` | `data` |
| --- | --- |
| `team.create` | the full `Team` object |
| `team.delete` | `null` |
| `team.update` | `{name?, icon?, icon_key?}` (`TeamUpdateData`) |
| `team.member-join` | `{user: <uuid>}` |
| `team.member-leave` | `{user: <uuid>}` |
| `team.member-update` | `{user: <uuid>, permissions?: {self, copy}}` |
| `team.conversation-create` | `{conv: <uuid>}` |
| `team.conversation-delete` | `{conv: <uuid>}` |
| `team.collaborator-add` | `{user: <uuid>, permissions: [...]}` |
| `team.collaborator-update` | `{user: <uuid>, permissions: [...]}` |
| `team.collaborator-remove` | `{user: <uuid>}` |

The web client only models the first eight (`wire-webapp/libraries/api-client/src/event/teamEvent.ts:31-41`);
`team.collaborator-*` are newer and unmodelled there.

### 7.5 `feature-config.update`

Despite the name it is grouped with team events client-side
(`wire-webapp/libraries/api-client/src/event/teamEvent.ts:40`,
`TEAM_EVENT.FEATURE_CONFIG_UPDATE = 'feature-config.update'`). Wire shape
(`wire-server/libs/wire-api/src/Wire/API/Event/FeatureConfig.hs:84-100`):

```json
{
  "type": "feature-config.update",
  "name": "consumableNotifications",
  "data": {"status": "enabled", "lockStatus": "unlocked", "ttl": "unlimited", "config": { … }},
  "team": "0f4e…"
}
```

* `name` is the camelCase feature key (§5.2).
* `data` is the same `LockableFeature` object the `/feature-configs` endpoint returns
  (`mkUpdateEvent`, `:105-112`).
* **No `time` field** on this event.

The client is expected to patch its cached feature list and react — e.g. flipping
`consumableNotifications` while running.

### 7.6 `federation.*`

`wire-server/libs/wire-api/src/Wire/API/Event/Federation.hs:34-63`:

| `type` | Fields |
| --- | --- |
| `federation.delete` | `domain: string` |

The client additionally models `federation.connectionRemoved` with `domains: string[]`
(`wire-webapp/libraries/api-client/src/event/federationEvent.ts:22-40`). That second type is **not**
in the current `wire-server` `Event/Federation.hs` — **UNVERIFIED** whether it is still emitted.

### 7.7 `meeting.*`

`wire-server/libs/wire-api/src/Wire/API/Event/Meeting.hs:45-58`, `:88-105`. Flat envelope, **no
`data` wrapper**:

```json
{
  "type": "meeting.create",
  "qualified_id": {"id":"…","domain":"wire.com"},
  "conversation": "…",
  "qualified_conversation": {"id":"…","domain":"wire.com"},
  "from": "…",
  "qualified_from": {"id":"…","domain":"wire.com"},
  "via": "user",
  "time": "2026-08-20T09:41:12.317Z",
  "team": "…"
}
```

Types: `meeting.create`, `meeting.update`, `meeting.delete`, `meeting.member-add`.

### 7.8 Types that are NOT wire events

`wire-webapp/apps/webapp/src/script/repositories/event/Client.ts:26-71` defines a large set of
`conversation.*` and `call.*` strings — `conversation.message-add`, `conversation.asset-add`,
`conversation.knock`, `conversation.reaction`, `conversation.confirmation`,
`conversation.message-delete`, `conversation.unable-to-decrypt`, `call.e-call`, … — that a new
client will see in the official code but **never on the wire**. They are synthesized locally by
`CryptographyMapper.mapGenericMessage()` from a *decrypted* `GenericMessage` protobuf
(`wire-webapp/apps/webapp/src/script/repositories/cryptography/CryptographyMapper.ts`), invoked from
`EventRepository.mapEncryptedEvent` (`EventRepository.ts:647-682`). Do not implement them as
backend event types; derive them from the protobuf instead.

---

## 8. `conversation.otr-message-add` in detail

`data` schema (`wire-server/libs/wire-api/src/Wire/API/Event/Conversation.hs:465-502`):

```haskell
data OtrMessage = OtrMessage
  { otrSender :: ClientId, otrRecipient :: ClientId, otrCiphertext :: Text, otrData :: Maybe Text }
…
    <$> otrSender    .= field "sender" schema
    <*> otrRecipient .= field "recipient" schema
    <*> otrCiphertext .= fieldWithDocModifier "text" (description ?~ textDesc) schema
    <*> otrData      .= maybe_ (optFieldWithDocModifier "data" (description ?~ dataDesc) schema)
  where
    textDesc = "The ciphertext for the recipient (Base64 in JSON)"
    dataDesc = "Extra (symmetric) data (i.e. ciphertext, Base64 in JSON) \
               \that is common with all other recipients."
```

| Field | Type | Meaning |
| --- | --- | --- |
| `sender` | ClientId (16 lowercase hex chars, no leading zeros) | the **sender's device** — the Proteus session peer |
| `recipient` | ClientId | **your** device — always equals your own client ID; useful only as a sanity check |
| `text` | base64 | the Proteus ciphertext (a CBOR-encoded Proteus `Message`), decrypt with the session `(qualified_from, sender)` |
| `data` | base64, optional | the *external* payload: AES-GCM ciphertext shared by all recipients, keyed by the `External` field inside the decrypted `GenericMessage`. Used for messages too large to encrypt per-device. |

Producer: `wire-server/libs/wire-subsystems/src/Wire/ConversationSubsystem/Message.hs:739-747`
(`newMessageEvent`). Note `convId = fromMaybe (tUntagged (fmap selfConv receiver)) mconvId` — a
message with **no conversation** is delivered in the recipient's **self-conversation**; that is how
own-device sync messages (e.g. `Availability`, `DataTransfer`, `LastRead`, `Cleared`) arrive.

There is **no `sender_client_id` field on this event.** `sender_client_id` exists only as a
core-crypto *MLS decryption output* (`core-crypto/crypto/src/mls/conversation/mutable/decrypt/mod.rs:42`)
and as a local backup/storage field in the web client
(`wire-webapp/apps/webapp/src/script/repositories/storage/record/eventRecord.ts:110`). For Proteus,
the sender device is `data.sender`.

Reference decryption path (`wire-webapp/libraries/core/src/messagingProtocols/proteus/eventHandler/events/otrMessageAdd/otrMessageAdd.ts:38-73`):

```ts
const {from, qualified_from, data: {sender: clientId, text: encodedCiphertext}} = event;
const userId = qualified_from ?? {id: from, domain: ''};
const messageBytes = Decoder.fromBase64(encodedCiphertext).asBytes;
const decryptedData = await proteusService.decrypt(messageBytes, userId, clientId);
const decodedData = GenericMessage.decode(decryptedData);
```

Two decryption error codes are **silently swallowed** (they are benign duplicates/reorders):
`208` outdated message and `209` duplicate message
(`wire-webapp/apps/webapp/src/script/repositories/event/EventRepository.ts:661-668`). Every other
failure is turned into a locally injected `conversation.unable-to-decrypt` message (`:674`).

A `ClientAction.RESET_SESSION` inside the decrypted `GenericMessage` means the peer built a new
session from one of your prekeys — consume a prekey locally (`otrMessageAdd.ts:56-60`).

---

## 9. `conversation.mls-message-add` in detail

```json
{
  "type": "conversation.mls-message-add",
  "qualified_conversation": {"id":"…","domain":"wire.com"},
  "conversation": "…",
  "subconv": "conference",
  "qualified_from": {"id":"…","domain":"wire.com"},
  "from": "…",
  "via": "user",
  "time": "2026-08-20T09:41:12.317Z",
  "data": "AAEAAR2s…base64 MLSMessage…"
}
```

* **`data` is a bare base64 string**, not an object: `MLSMessageAdd -> tag _EdMLSMessage base64Schema`
  (`Event/Conversation.hs:651`); TS `export type ConversationMLSMessageAddData = string`
  (`wire-webapp/libraries/api-client/src/conversation/data/conversationMlsMessageAddData.ts:21`).
  The bytes are a complete TLS-serialized MLS `MLSMessage` (application message, commit, proposal,
  or external message).
* **`subconv`** is a **top-level** field (not inside `data`), optional:
  `evtSubConv .= maybe_ (optField "subconv" schema)` (`Event/Conversation.hs:677`). It is present
  when the message belongs to an MLS *sub*conversation — in practice the calling subconversation,
  `"conference"` (`wire-webapp/libraries/api-client/src/conversation/subconversation.ts:22-24`).
  Route the message to the subconversation's MLS group, not the parent's.
  Producer: `wire-server/libs/wire-subsystems/src/Wire/ConversationSubsystem/MLS/Propagate.hs:77-94`.
* `qualified_from` is the sending **user**; the sending **device** is not on the wire — it comes out
  of MLS decryption. The web client writes it back onto the event object as a non-wire field
  `senderClientId` after decryption
  (`wire-webapp/libraries/core/src/messagingProtocols/mls/eventHandler/events/messageAdd/messageAdd.ts:75-81`;
  the field is declared on the TS interface at
  `wire-webapp/libraries/api-client/src/event/conversationEvent.ts:209-215`). **It never arrives
  from the backend.**
* Decryption may return no application message (commit/proposal only) — then there is nothing to
  surface. If `commitDelay` is returned, schedule a pending-proposal commit after that delay
  (`messageAdd.ts:83-96`).
* The conversation's `group_id` (base64) must be looked up locally to address the MLS group.

Related: **`conversation.mls-reset`** carries `data: {group_id, new_group_id?}`
(`Event/Conversation.hs:504-517`) and means the group was reset — rejoin under `new_group_id`.

---

## 10. `conversation.mls-welcome` in detail

```json
{
  "type": "conversation.mls-welcome",
  "qualified_conversation": {"id":"…","domain":"wire.com"},
  "conversation": "…",
  "qualified_from": {"id":"…","domain":"wire.com"},
  "from": "…",
  "via": "user",
  "time": "2026-08-20T09:41:12.317Z",
  "data": "AAEAA0…base64 MLS Welcome message…"
}
```

* `data` is again a **bare base64 string**: `MLSWelcome -> tag _EdMLSWelcome base64Schema`
  (`Event/Conversation.hs:652`), TS `export type ConversationMLSWelcomeData = string`
  (`.../data/conversationMlsWelcomeData.ts:21`). The bytes are a TLS-serialized MLS `Welcome`.
* `qualified_conversation` is the **MLS group's conversation**, `qualified_from` is the committer
  who added you (`wire-server/libs/wire-subsystems/src/Wire/ConversationSubsystem/MLS/Welcome.hs:93-104`).
  The event is addressed to specific devices (`RecipientClientsSome`), one notification per user.
* Processing (`wire-webapp/libraries/core/src/messagingProtocols/mls/eventHandler/events/welcomeMessage/welcomeMessage.ts:31-53`):
  decode base64 → `processWelcomeMessage` → this yields the **`groupId`**; persist the
  conversation↔groupId mapping, schedule periodic key-material renewal, read the new epoch, and
  emit a "new epoch" signal. The web client replaces `event.data` with the base64 `groupId` before
  forwarding the event upward — a local convention, not a wire shape.
* There is no `subconv` on welcomes in practice (the schema allows it, but
  `Welcome.hs:102` passes `Nothing`).

---

## 11. Ordering, de-duplication and cursors

### 11.1 Two persisted cursors

| Key | Value | Purpose |
| --- | --- | --- |
| `z.storage.StorageKey.NOTIFICATION.LAST_ID` | notification `id` (UUIDv1) | the `since` cursor for `GET /notifications` |
| `z.storage.StorageKey.EVENT.LAST_DATE` | ISO-8601 timestamp | the "newest event I have applied" watermark, used for de-duplication |

Both live in an `amplify` key-value store (`wire-webapp/libraries/core/src/notification/notificationDatabaseRepository.ts:30-79`).
A third, `z.storage.StorageKey.NOTIFICATION.MISSED`, records the last `since` that 404'd, so the
"you missed messages" banner is shown once (`wire-webapp/apps/webapp/src/script/repositories/event/NotificationService.ts:36-38`, `:94-99`).

`last_notification_id` is written **after** a notification's whole payload has been handled, and
**only for non-transient notifications**
(`wire-webapp/libraries/core/src/notification/notificationService.ts:235-238`):

```ts
if (notification.transient !== true) {
  // keep track of the last handled notification for next time we fetch the notification stream
  await this.setLastNotificationId(notification);
}
```

`last_event_date` advances monotonically and only for non-injected events
(`wire-webapp/apps/webapp/src/script/repositories/event/EventRepository.ts:502-508`, `:714-728`);
the client-injected `conversation.voice-channel-deactivate` is explicitly excluded because injected
events must never move the stream watermark.

### 11.2 Merging the websocket with the stream — legacy path

The rule: **buffer websocket frames while catching up**.

1. `ws.lock()` *before* the socket is even opened, so nothing can slip past
   (`account.ts:808-815`, and again on every disconnect at `:1280-1286`).
2. Open the socket. Incoming frames go into `bufferedMessages` (`webSocketClient.ts:127-141`).
3. In the socket's `onOpen` callback, run the whole `GET /notifications` pagination from the stored
   `since` and process every notification (`account.ts:816-861` →
   `legacyProcessNotificationStream`, `account.ts:1170-1223`).
4. When the last stream notification has been *processed* (it is queued behind the same sequential
   queue), flip to LIVE and call `ws.unlock()`, which replays the buffered frames in arrival order
   (`account.ts:1203-1221`, `webSocketClient.ts:364-371`).

An `AbortController` tied to the socket aborts the catch-up if the socket dies mid-way; processing
simply restarts from the (unchanged) cursor on the next connect
(`notificationService.ts:166-173`).

### 11.3 Merging — consumable path

No merge is required: there is exactly one ordered queue. The client:

* pauses message sending / MLS proposal processing on connect (`account.ts:822-836`),
* processes and acks each `event` frame strictly in order via a sequential queue
  (`account.ts:993-1003`, `:1096-1126`),
* flips to LIVE when the `synchronization` frame whose `marker_id` matches the current marker
  arrives (`account.ts:1053-1094`).

### 11.4 De-duplication rule

Events can legitimately arrive twice: once as the HTTP response to your own action (e.g. `POST
/conversations` returns the `conversation.create` event) or via a guest-link join, and again on the
stream. The de-dup rule is **timestamp-based and restricted to a fixed set of types**
(`wire-webapp/libraries/core/src/notification/outdatedNotificationStreamEventTypes.ts:20-61`):

```ts
export const NOTIFICATION_STREAM_DUPLICATE_RISK_EVENT_TYPES: ReadonlySet<string> = new Set([
  CONVERSATION_EVENT.MEMBER_JOIN, CONVERSATION_EVENT.MEMBER_LEAVE, CONVERSATION_EVENT.CREATE,
  CONVERSATION_EVENT.RENAME, CONVERSATION_EVENT.PROTOCOL_UPDATE,
  CONVERSATION_EVENT.MESSAGE_TIMER_UPDATE, CONVERSATION_EVENT.RECEIPT_MODE_UPDATE,
  CONVERSATION_EVENT.ADD_PERMISSION_UPDATE,
]);

export function isOutdatedNotificationStreamEvent(event, notificationSource, lastEventDate): boolean {
  if (notificationSource !== NotificationSource.NOTIFICATION_STREAM) return false;
  if (!isNonEmptyString(event.time) || isNullOrUndefined(lastEventDate)) return false;
  if (!NOTIFICATION_STREAM_DUPLICATE_RISK_EVENT_TYPES.has(event.type)) return false;
  return lastEventDate.getTime() >= new Date(event.time).getTime();
}
```

i.e. **drop a stream event of one of those types whose `time` is not newer than
`last_event_date`.** Note it deliberately does *not* apply to websocket events and does *not* apply
to messages — message de-dup is done downstream by message ID, and Proteus itself rejects duplicate
ciphertexts with error 209.

Sources of an event, as the client tracks them
(`wire-webapp/libraries/core/src/notification/notificationSource.types.ts:20-24` +
`wire-webapp/apps/webapp/src/script/repositories/event/EventSource.ts:20-27`):
`NOTIFICATION_STREAM`, `WEBSOCKET`, `LOCAL`, plus client-only `backend_response` and `injected`.

### 11.5 Transient rules, summarized

1. A transient notification's `id` **must not** be stored as `last_notification_id` — it is not in
   the stream, so using it as `since` would 404 or skip data (`notificationService.ts:235-238`).
2. Transient notifications never appear in `GET /notifications`, so a client that was offline
   simply never learns about them. That is intentional: typing indicators are worthless late.
3. On `/events` there is no `transient` flag; transient messages either arrive live or are dropped
   by RabbitMQ (`msgExpiration = "0"`, `Gundeck/Push.hs:355-373`). A client can still recognise them
   by `type` (`conversation.typing`, `user-group.*`, some `team.*`).
4. Transient notifications never trigger a native push (`Gundeck/Push.hs:304-306`).

### 11.6 Ordering guarantees

* Within one notification, `payload` is ordered; process it front to back.
* Across notifications on one channel, order is preserved (Cassandra by UUIDv1 / RabbitMQ FIFO).
* **Across channels there is no guarantee** — hence the lock/buffer in §11.2.
* Process notifications **sequentially**, not concurrently: both the core and the webapp funnel
  everything through single-concurrency queues (`account.ts:836`, `EventRepository.ts:79`,
  `handleIncomingEvent` at `:180-193`). MLS in particular requires strict ordering, since every
  commit advances the epoch.
* `time` is server-assigned with millisecond precision, but do **not** sort by it — use arrival
  order.

---

## 12. Typing indicators and read receipts at the event level

### 12.1 Typing

Wire's typing indicator is a **first-class backend event**, not a message.

* Send: `POST /conversations/{domain}/{id}/typing` with body `{"status":"started"}` or
  `{"status":"stopped"}` (`wire-webapp/libraries/api-client/src/conversation/conversationApi/conversationApi.ts:753-769`,
  path segment constant `TYPING: 'typing'` at `:119`; for API < 3 the unqualified path is used).
* Receive: `conversation.typing` with `data: {status: "started"|"stopped"}`
  (`wire-webapp/libraries/api-client/src/conversation/data/conversationTypingData.ts:20-27`), the
  actor in `qualified_from`.
* It is pushed **transient**, `RouteDirect` (no native push)
  (`wire-server/libs/wire-subsystems/src/Wire/ConversationSubsystem/Action.hs:1710-1721`):

  ```haskell
  let e = Event qcnv Nothing (EventFromUser qusr) tEvent Nothing (EdTyping ts)
  pushNotifications [ def { origin = …, json = toJSONObject e, recipients = map userRecipient users
                          , conn = mcon, route = PushV2.RouteDirect, transient = True } ]
  ```
* Client handling (`wire-webapp/apps/webapp/src/script/repositories/conversation/ConversationRepository.ts:4789-4823`):
  on `started`, add the user to the conversation's typing set and arm a **60 s** expiry
  (`TYPING_TIMEOUT * 6`, i.e. 10 s × 6); on `stopped`, remove immediately. Re-arm on every repeat.
  Typing events are excluded from event logging (`:3571-3573`) and are **not** in the `STORE` list
  (`.../event/EventTypeHandling.ts`), so they are never persisted.

### 12.2 Read receipts

There is **no** read-receipt backend event. Two distinct things exist:

1. **The conversation-level setting** — `conversation.receipt-mode-update` with
   `data: {receipt_mode: 0|1}` (`RECEIPT_MODE.OFF = 0`, `ON = 1`;
   `wire-webapp/libraries/api-client/src/conversation/data/conversationReceiptModeUpdateData.ts:24-31`).
   The current value also ships as `receipt_mode` inside the conversation object
   (`conversation.create` data, `GET /conversations`).
2. **The actual receipt** — an ordinary encrypted message. The sender marks a message with
   `expects_read_confirmation` inside its `GenericMessage`; the reader replies with a
   `GenericMessage` whose `confirmation` field is set, `type` ∈ `{DELIVERED, READ}`, referencing
   `firstMessageId` / `moreMessageIds`. It therefore arrives as a normal
   `conversation.otr-message-add` (or `conversation.mls-message-add`) and is only visible after
   decryption; the web client maps it to the local event type `conversation.confirmation`
   (`wire-webapp/apps/webapp/src/script/repositories/cryptography/CryptographyMapper.ts:486-503`,
   `Confirmation.Type.DELIVERED` / `.READ` at `:493-495`).

So at the *event* level a client must handle `conversation.receipt-mode-update`; receipts themselves
belong to the protobuf/message-content layer.

---

## 13. Push token registration (`/push/tokens`)

Service: gundeck. Routes `wire-server/libs/wire-api/src/Wire/API/Routes/Public/Gundeck.hs:36-65`.

| Method + path | Body / result |
| --- | --- |
| `POST /push/tokens` | body `PushToken`; **201** with the stored `PushToken` and a `Location` header carrying the token |
| `GET /push/tokens` | `{"tokens":[PushToken, …]}` |
| `DELETE /push/tokens/{pid}` | `pid` = the token string; **204**, or 404 `not-found` |

`PushToken` body (`wire-server/libs/wire-api/src/Wire/API/Push/V2/Token.hs:79-109`):

```json
{
  "transport": "APNS",
  "app": "com.wire.ent",
  "token": "<hex device token or FCM registration id>",
  "client": "<your clientId>"
}
```

`transport` enum (`Token.hs:114-120`): `"GCM"`, `"APNS"`, `"APNS_SANDBOX"`, `"APNS_VOIP"`,
`"APNS_VOIP_SANDBOX"`. Mirrored client-side as `UserPushTokenProvider`
(`wire-webapp/libraries/api-client/src/user/data/userPushTokenProvider.ts:21-27`).

Error labels on `POST` (`Token.hs:173-199`): `sns-thread-budget-reached` (413),
plus not-found / invalid / too-long / metadata-too-long / apns-voip-not-supported.

**What a desktop client needs:** essentially nothing. Registration exists so gundeck can hand a
notification to APNs/FCM when no websocket is attached; a desktop client keeps a websocket open and
renders OS notifications itself. `ClientType.DESKTOP`/`PERMANENT` devices are not push targets. The
one thing a desktop client **must** handle is the inbound event
**`user.push-remove`** (§7.2) — the backend telling you a token of yours was invalidated — and it
can safely be a no-op if you never registered one. Transient notifications never generate a native
push at all (`Gundeck/Push.hs:304-306`).

The official web client does not call `/push/tokens` anywhere
(no match under `wire-webapp/libraries/api-client/src`).

---

## 14. Implementation checklist

1. Negotiate the API version (`GET /api-version`, take the highest supported ≥ your minimum) and
   store the `/vN` prefix; `/events` needs it, `/await` does not use it.
2. Read `GET /feature-configs`; `consumableNotifications.status === "enabled"` decides the channel.
3. If using `/events`: `PUT /clients/{id}` adding `consumable-notifications`, then — if this is the
   first time — drain `GET /notifications` once with no socket open, then connect.
4. If using `/await`: lock the socket, connect, drain `GET /notifications?since=…` inside the
   `onOpen` handler, then unlock and replay the buffer.
5. Brand-new device: `GET /notifications/last?client=` and store its `id` as the cursor, with
   `last_event_date = epoch`. Never replay the account's whole history.
6. Persist `last_notification_id` after each **non-transient** notification is fully handled;
   persist `last_event_date` as a monotonic max of applied event `time`s.
7. Handle 404 on `GET /notifications` (v3+: error body, no data) by refetching without `since`,
   refetching full state, and surfacing "you may have missed messages" once.
8. On `/events`, ack every `event` and `synchronization` frame *after* processing; answer
   `notifications_missed` with `ack_full_sync` only after a full state refetch.
9. Keepalive: text `ping`/`pong` every 20 s on `/await`; **never** send a text `ping` on `/events` —
   use protocol Ping/Pong there and expect a close after ~20 s of silence.
10. Reconnect with a fresh access token on every attempt; backoff 4 s → 10 s, growth 1.3, unlimited
    retries; also reconnect on `online`, window focus/visibility, wake-from-sleep, and a failed
    health probe.
11. Process notifications strictly sequentially; within a notification, iterate `payload` in order.
12. Drop stream events of the eight duplicate-risk types whose `time` ≤ `last_event_date`.
