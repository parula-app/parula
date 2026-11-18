/** The Wire event stream: the WebSocket plus the `GET /notifications` catch-up.
 * See `Protocol/06-Events-and-Notifications.md`.
 *
 * Wire has 2 generations of live delivery, and both are alive on current servers.
 * The team feature `consumableNotifications` and our client's capabilities say
 * which one we get:
 * - `/await`: a text socket that only pushes. What we missed while we were away
 *   comes from `GET /notifications`, so the socket is locked while we page
 *   through that stream, and the frames that arrive meanwhile are replayed after.
 * - `/vN/events`: one RabbitMQ queue per device, which replays the backlog by
 *   itself. Every frame is acknowledged, and an unacknowledged event is
 *   redelivered on the next connection.
 *
 * Auth is the `access_token` query parameter, not a header (browsers cannot set
 * headers on a WebSocket handshake), so the platform WebSocket suffices, unlike
 * for Signal. The token expires long before the socket does, so every connection
 * attempt builds the URL anew. */
import { appGlobal } from "../../app";
import type { WireAPI } from "./WireAPI";
import type { WireSession } from "./WireSession";
import type { TWireEvent, TWireNotification } from "./TWire";
import { getComputerOn } from "../../util/backend-wrapper";
import { Lock } from "../../util/flow/Lock";
import { waitUntilOnline } from "../../util/netUtil";
import { assert } from "../../util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

export class WireEventStream {
  /** Called for every event, in order, one at a time. Never runs twice in
   * parallel: MLS epochs only advance correctly in sequence. */
  onEvent: (event: TWireEvent) => Promise<void> = async () => undefined;
  /** We lost history and could not catch up: the caller must refetch
   * conversations, users and connections from scratch. */
  onDesynchronized: (() => Promise<void>) | null = null;
  /** Everything that went wrong in the background: a failed event, a broken
   * socket, a failed catch-up, or a login that we cannot refresh any more.
   * A failed event is neither acked nor moves the cursor, so the backend sends
   * it to us again. `WireAccount` shows these to the user. */
  onError: ((ex: Error) => void) | null = null;
  /** Our cursor into the notification stream. The account persists it, so that
   * the next start resumes where we stopped. */
  lastNotificationID: string | null = null;
  /** We are past the backlog and see live events */
  isLive = false;
  /** e.g. `wss://prod-nginz-ssl.wire.com`. The authoritative value is
   * `endpoints.backendWSURL` of the backend config, i.e. the deeplink or
   * `/config.json`, normalized to `wss:`. `WireAccount` must set it from there:
   * it is a different host than the REST API, and only the config knows it.
   * Where it is unset, we fall back to the `nginz-https` / `nginz-ssl` naming
   * convention of the REST URL, which holds for Wire's own backends. */
  websocketBaseURL: string | null = null;
  /** Our client declared the `consumable-notifications` capability, which
   * `WireSession` decides when it registers the client. Without it, the backend
   * keeps writing our notifications to the legacy stream, and our queue - and
   * with it the `/events` socket - would stay empty. */
  haveConsumableCapability = false;

  protected socket: WebSocketLike | null = null;
  protected isRunning = false;
  /** `/vN/events` instead of `/await` */
  protected isAsync = false;
  /** While we page through the notification stream, live frames are buffered */
  protected isSocketLocked = false;
  protected bufferedFrames: string[] = [];
  /** `/events`: the UUID we passed as `sync_marker`. The server sends it back
   * once our queue backlog is drained. */
  protected syncMarker: string | null = null;
  /** Serializes `onEvent()` */
  protected readonly processLock = new Lock();
  /** Aborts the catch-up when the socket dies while it runs */
  protected catchUpAbort: AbortController | null = null;
  protected keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  protected reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  protected reconnectDelaySeconds = kMinReconnectDelaySeconds;
  /** `/await`: we sent a `ping` and have no `pong` for it yet */
  protected isPingUnanswered = false;
  protected lastFrameTime = 0;
  protected removeWakeUpListeners: (() => void) | null = null;

  constructor(protected session: WireSession, protected api: WireAPI) {
  }

  /** Connects, catches up on the notifications that we missed, then goes live.
   * Reconnects by itself until `stop()`. */
  async start(lastNotificationID: string | null): Promise<void> {
    this.lastNotificationID = lastNotificationID;
    this.isRunning = true;
    this.isAsync = await this.useAsyncSocket();
    this.listenForWakeUp();
    await this.connect();
  }

  /** Ends everything: socket, timers, listeners, catch-up, and the event that
   * is currently being processed. Nothing of ours runs after this. */
  async stop(): Promise<void> {
    this.isRunning = false;
    this.removeWakeUpListeners?.();
    this.removeWakeUpListeners = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closeSocket();
    let lock = await this.processLock.lock(); // wait for the event in flight
    lock.release();
  }

  get isConnected(): boolean {
    return !!this.socket;
  }

  /** The team feature `consumableNotifications` moves us to the queue socket.
   * Without a `client`, that queue would be neither durable nor synchronized. */
  protected async useAsyncSocket(): Promise<boolean> {
    if (this.session.transport.version < kConsumableAPIVersion ||
      !this.haveConsumableCapability || !this.session.clientID) {
      return false;
    }
    let features = await this.api.getFeatureConfigs();
    return features.consumableNotifications?.status == "enabled";
  }

  protected async connect(isReconnect = false): Promise<void> {
    if (isReconnect || !this.session.transport.accessToken) {
      await this.session.refreshToken(); // ours expired while we were gone
    }
    if (this.isAsync) {
      await this.connectAsync();
    } else {
      await this.connectLegacy();
    }
    this.startKeepAlive();
    this.reconnectDelaySeconds = kMinReconnectDelaySeconds;
  }

  /** Locks the socket before it is even open, so that the events arriving while
   * we page through the notification stream are buffered, and replays them once
   * we are through. Across the 2 channels there is no ordering guarantee, so
   * this buffer is the whole merge strategy. */
  protected async connectLegacy(): Promise<void> {
    this.isSocketLocked = true;
    this.bufferedFrames = [];
    await this.openSocket();
    try {
      await this.catchUp();
    } catch (ex) {
      this.closeSocket();
      throw ex;
    }
    this.replayBufferedFrames();
    this.isLive = true;
  }

  /** The queue replays our backlog itself, so there is nothing to merge. Only
   * when we come from the legacy stream do we drain that one a last time: the
   * 2 queues are disjoint, and ours started filling only when our client
   * declared the capability. */
  protected async connectAsync(): Promise<void> {
    if (this.lastNotificationID) {
      await this.catchUp();
      this.lastNotificationID = null; // a stream cursor means nothing on the queue
    }
    this.syncMarker = this.session.transport.version >= kSyncMarkerAPIVersion
      ? crypto.randomUUID() : null;
    this.isLive = !this.syncMarker;
    await this.openSocket();
  }

  protected async openSocket(): Promise<void> {
    let socket = await this.createSocket(this.socketURL());
    this.socket = socket;
    // Attach before the socket is open: our backlog starts arriving at once
    socket.onmessage = ev => this.onFrame(ev.data);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = (ev: any) => reject(new Error(`Wire WebSocket connection failed: ${ev?.message ?? ev?.type ?? "error"}`));
        socket.onclose = (ev: any) => reject(new Error(`Wire WebSocket closed during connect, code ${ev?.code ?? "?"} ${ev?.reason ?? ""}`));
      });
    } catch (ex) {
      this.closeSocket();
      throw ex;
    }
    socket.onclose = () => this.socketClosed(socket);
    socket.onerror = (ev: any) => {
      this.reportError(new Error(`Wire WebSocket error: ${ev?.message ?? ev?.type ?? "error"}`));
      this.socketClosed(socket);
    };
  }

  /** Wire authenticates by query string, so the platform WebSocket does it, and
   * we need no request headers, unlike Signal. Only where there is none, e.g. in
   * a Node context, the backend opens it for us. */
  protected async createSocket(url: string): Promise<WebSocketLike> {
    let WS = (globalThis as any).WebSocket;
    if (WS) {
      let socket = new WS(url) as WebSocketLike;
      socket.binaryType = "arraybuffer";
      return socket;
    }
    return new RemoteWebSocket(await appGlobal.remoteApp.newWebSocket(url));
  }

  /** e.g. `wss://prod-nginz-ssl.wire.com/v9/events?access_token=…&client=…`.
   * `/events` is version-prefixed, the legacy `/await` is not. */
  protected socketURL(): string {
    let query = new URLSearchParams();
    query.set("access_token", this.session.transport.accessToken ?? "");
    if (this.session.clientID) { // without it, we would get all our devices' events
      query.set("client", this.session.clientID);
    }
    if (this.syncMarker) {
      query.set("sync_marker", this.syncMarker);
    }
    let path = this.isAsync ? `/v${this.session.transport.version}/events` : "/await";
    return `${this.websocketBase}${path}?${query}`;
  }

  protected get websocketBase(): string {
    let url = this.websocketBaseURL ??
      this.session.transport.baseURL.replace("nginz-https", "nginz-ssl");
    return url.replace(/^http/, "ws").replace(/\/$/, "");
  }

  ///////////////////////////////////////////////////////////
  // Notification stream

  /** Pages through `GET /notifications` from our cursor and processes
   * everything, until the stream is exhausted. */
  protected async catchUp(): Promise<void> {
    let abort = this.catchUpAbort = new AbortController();
    let since = this.lastNotificationID;
    let isLost = false;
    while (!abort.signal.aborted) {
      let page = await this.api.getNotifications(since, this.session.clientID, kNotificationPageSize);
      if (page.lost) {
        // Our cursor is older than the stream reaches back: fetch it all anew.
        assert(since, "Wire: Notifications lost, although we asked for the whole stream");
        isLost = true;
        since = null;
        continue;
      }
      for (let notification of page.notifications) {
        if (abort.signal.aborted) {
          return;
        }
        await this.processNotification(notification, false);
      }
      let lastID = page.notifications.at(-1)?.id;
      if (!page.has_more || !lastID) {
        break;
      }
      since = lastID;
    }
    if (isLost) {
      await this.onDesynchronized?.();
    }
  }

  /** The events of one notification, in order, and never 2 at the same time:
   * MLS epochs only advance correctly in sequence.
   * @param isTransient A transient notification, e.g. a typing indicator, is
   *   never in the notification stream, so it is no cursor. */
  protected async processNotification(notification: TWireNotification, isTransient: boolean): Promise<void> {
    let lock = await this.processLock.lock();
    try {
      for (let event of notification.payload) {
        await this.onEvent(event);
      }
      if (!isTransient) {
        this.lastNotificationID = notification.id;
      }
    } finally {
      lock.release();
    }
  }

  ///////////////////////////////////////////////////////////
  // Socket frames

  protected onFrame(data: any): void {
    this.lastFrameTime = Date.now();
    let text = frameText(data);
    if (text == kPong) { // the answer to our keepalive `ping`
      this.isPingUnanswered = false;
      return;
    }
    if (this.isSocketLocked) { // still catching up, `replayBufferedFrames()` gets to it
      this.bufferedFrames.push(text);
      return;
    }
    this.processFrame(text)
      .catch(ex => this.reportError(ex)); // the socket callback cannot wait for us
  }

  /** In arrival order. `processFrame()` queues each frame behind `processLock`
   * before its first `await`, so replaying them in a loop keeps that order. */
  protected replayBufferedFrames(): void {
    let frames = this.bufferedFrames;
    this.bufferedFrames = [];
    this.isSocketLocked = false;
    for (let text of frames) {
      this.processFrame(text)
        .catch(ex => this.reportError(ex));
    }
  }

  protected async processFrame(text: string): Promise<void> {
    let json = sanitize.json(text);
    if (this.isAsync) {
      await this.processAsyncFrame(json);
    } else {
      await this.processNotification(readNotification(json), sanitize.boolean(json.transient, false));
    }
  }

  /** `/events` tags every frame and wants each of them acknowledged. */
  protected async processAsyncFrame(json: any): Promise<void> {
    let type = sanitize.string(json.type, "");
    if (type == "event") {
      await this.processNotification(readNotification(json.data?.event), false);
      this.sendAck(json.data?.delivery_tag); // only now: an unacked event is redelivered
    } else if (type == "synchronization") {
      this.sendAck(json.data?.delivery_tag);
      if (sanitize.string(json.data?.marker_id, null) == this.syncMarker) {
        this.isLive = true; // everything before this was backlog
      } // a marker of an earlier connection attempt is acked and ignored
    } else if (type == "notifications_missed") {
      await this.desynchronized();
      this.send({ type: "ack_full_sync" }); // nothing else is delivered until we answer
    } else {
      console.log("Wire: Unknown WebSocket frame type", type);
    }
  }

  /** Our queue expired or overflowed, and an unknown number of events was
   * dropped, so the account must fetch its state anew. */
  protected async desynchronized(): Promise<void> {
    let lock = await this.processLock.lock();
    try {
      await this.onDesynchronized?.();
    } finally {
      lock.release();
    }
  }

  protected sendAck(deliveryTag: any): void {
    this.send({
      type: "ack",
      data: { delivery_tag: sanitize.integer(deliveryTag), multiple: false },
    });
  }

  protected send(json: any): void {
    this.socket?.send(JSON.stringify(json));
  }

  ///////////////////////////////////////////////////////////
  // Keepalive, reconnect

  protected startKeepAlive(): void {
    this.stopKeepAlive();
    this.isPingUnanswered = false;
    if (this.isAsync) {
      // `/events` reads every frame we send as JSON and closes the socket on a
      // text `ping`. The server pings us, and the WebSocket stack answers that.
      return;
    }
    this.keepAliveTimer = setInterval(() => this.sendPing(), kPingIntervalSeconds * 1000);
  }

  protected stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  /** The server answers the text frame `ping` with `pong`. If it did not answer
   * the last one, the socket is dead without having told us. */
  protected sendPing(): void {
    if (this.isPingUnanswered) {
      this.socket?.close();
      return;
    }
    this.isPingUnanswered = true;
    this.socket?.send(kPing);
  }

  /** A socket can die without a close event, e.g. when the lid closes, so check
   * on it whenever the computer or the network came back, or the user looks. */
  protected listenForWakeUp(): void {
    let networkBack = () => this.checkConnection(true);
    let focussed = () => this.checkConnection(false);
    let visibilityChanged = () => {
      if (!document.hidden) {
        this.checkConnection(false);
      }
    };
    let computerOn = getComputerOn();
    let wasSleeping = computerOn.isSleeping;
    let unsubscribe = computerOn.subscribe(() => {
      if (wasSleeping && !computerOn.isSleeping) {
        this.checkConnection(true);
      }
      wasSleeping = computerOn.isSleeping;
    });
    window.addEventListener("online", networkBack);
    window.addEventListener("focus", focussed);
    document.addEventListener("visibilitychange", visibilityChanged);
    this.removeWakeUpListeners = () => {
      window.removeEventListener("online", networkBack);
      window.removeEventListener("focus", focussed);
      document.removeEventListener("visibilitychange", visibilityChanged);
      unsubscribe();
    };
  }

  /** @param isDead Our socket is certainly gone, e.g. the network changed.
   *   Otherwise, only ask it whether it is still alive. */
  protected checkConnection(isDead: boolean): void {
    if (!this.isRunning || !this.socket) { // no socket = we are reconnecting already
      return;
    }
    if (isDead) {
      this.socket.close(); // `socketClosed()` reconnects
    } else if (!this.isAsync && Date.now() - this.lastFrameTime > kHealthyFrameAgeSeconds * 1000) {
      this.sendPing(); // no `pong` until the next tick means reconnect
    } // `/events` gives us no way to probe it
  }

  protected socketClosed(socket: WebSocketLike): void {
    if (this.socket != socket) { // one that we replaced already
      return;
    }
    this.closeSocket();
    if (this.isRunning) {
      this.scheduleReconnect();
    }
  }

  /** Drops the socket and everything that belongs to it, without reconnecting */
  protected closeSocket(): void {
    let socket = this.socket;
    this.socket = null;
    this.isLive = false;
    this.isSocketLocked = false;
    this.bufferedFrames = [];
    this.catchUpAbort?.abort();
    this.stopKeepAlive();
    socket?.close();
  }

  protected scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => this.reconnect().catch(ex => this.reportError(ex)),
      this.reconnectDelaySeconds * 1000);
    this.reconnectDelaySeconds = Math.min(
      this.reconnectDelaySeconds * kReconnectDelayFactor, kMaxReconnectDelaySeconds);
  }

  protected async reconnect(): Promise<void> {
    this.reconnectTimer = null;
    if (!this.isRunning) {
      return;
    }
    await waitUntilOnline();
    try {
      await this.connect(true);
    } catch (ex) {
      this.reportError(ex);
      if (kLoginHTTPCodes.includes(ex?.httpCode)) { // our login is gone: this will not fix itself
        return;
      }
      this.scheduleReconnect();
    }
  }

  protected reportError(ex: Error): void {
    if (this.onError) {
      this.onError(ex);
    } else {
      console.error(ex);
    }
  }
}

/** The part of the WebSocket API that we use, so that we can also drive the
 * backend's `ws` socket and, in tests, a fake one. Wire sends us text frames on
 * `/await` and binary frames on `/events`, and we send text either way. */
export interface WebSocketLike {
  binaryType: string;
  send(data: string): void;
  close(): void;
  onopen: ((ev: any) => void) | null;
  onmessage: ((ev: { data: any }) => void) | null;
  onclose: ((ev: any) => void) | null;
  onerror: ((ev: any) => void) | null;
}

/** Adapts a backend `ws` WebSocket, reached over JPC, to `WebSocketLike`. Each
 * call crosses the JPC boundary. @see `SignalWebSocket` */
class RemoteWebSocket implements WebSocketLike {
  binaryType = "arraybuffer";
  onopen: ((ev: any) => void) | null = null;
  onmessage: ((ev: { data: any }) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;

  constructor(protected proxy: any) {
    proxy.on("open", () => this.onopen?.({ type: "open" }));
    proxy.on("message", (data: any) => this.onmessage?.({ data }));
    proxy.on("close", (code: number, reason: any) => this.onclose?.({ code, reason: String(reason ?? "") }));
    proxy.on("error", (ex: any) => this.onerror?.({ message: ex?.message ?? String(ex), type: "error" }));
  }

  send(data: string): void {
    this.proxy.send(data);
  }

  close(): void {
    this.proxy.close();
  }
}

/** The notification envelope of a socket frame. Unlike the notification stream,
 * this does not come through `WireAPI`, so it is sanitized here. */
function readNotification(json: any): TWireNotification {
  let payload = sanitize.array(json?.payload, null) as TWireEvent[];
  assert(payload?.length, "Wire: Notification without events");
  for (let event of payload) {
    // Only `type`: what else an event carries depends on it, so whoever reads
    // a field sanitizes that field.
    assert(sanitize.nonemptystring(event?.type, null), "Wire: Event without type");
  }
  return {
    id: sanitize.alphanumdash(json?.id),
    payload: payload,
  };
}

/** A frame is text on `/await` and binary on `/events`, and the platform gives
 * it to us as a string, an ArrayBuffer or a Buffer. */
function frameText(data: any): string {
  if (typeof (data) == "string") {
    return data;
  }
  return new TextDecoder().decode(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
}

/** The `consumableNotifications` feature needs API v8, `sync_marker` v9 */
const kConsumableAPIVersion = 8;
const kSyncMarkerAPIVersion = 9;
/** The server default. Its range is 100 to 10000. */
const kNotificationPageSize = 1000;
const kPing = "ping";
const kPong = "pong";
const kPingIntervalSeconds = 20;
/** A frame this recent means the socket is fine, so do not probe it */
const kHealthyFrameAgeSeconds = 5;
const kMinReconnectDelaySeconds = 4;
const kMaxReconnectDelaySeconds = 10;
const kReconnectDelayFactor = 1.3;
/** Our credentials are gone, and trying again will not bring them back */
const kLoginHTTPCodes = [401, 403];
