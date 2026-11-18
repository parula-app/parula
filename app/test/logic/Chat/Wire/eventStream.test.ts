// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { WireEventStream, type WebSocketLike } from "../../../../logic/Chat/Wire/WireEventStream";
import type { TWireEvent, TWireNotification, TWireNotifications } from "../../../../logic/Chat/Wire/TWire";
import { ComputerOn } from "../../../../logic/util/backend-wrapper";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let stream: TestEventStream;
let session: any;
let api: any;
/** Everything that happened, in order, to check ordering across the parts */
let log: string[];

beforeAll(() => {
  setupBrowserGlobals();
});

beforeEach(() => {
  log = [];
  session = {
    clientID: "abcd1234abcd1234",
    transport: {
      baseURL: "https://prod-nginz-https.wire.com",
      version: 9,
      accessToken: "token1",
    },
    refreshCount: 0,
    async refreshToken() {
      session.transport.accessToken = "token" + (++session.refreshCount + 1);
    },
  };
  api = {
    features: {},
    /** The `since` of each `getNotifications()` call */
    calls: [] as (string | null)[],
    respond: async (since: string | null): Promise<TWireNotifications> => page([]),
    async getFeatureConfigs() {
      return api.features;
    },
    async getNotifications(since: string | null, clientID: string, size: number) {
      expect(clientID).toBe(session.clientID);
      api.calls.push(since);
      return await api.respond(since);
    },
  };
  stream = new TestEventStream(session, api);
  stream.onEvent = async (event: TWireEvent) => {
    log.push(event.type);
  };
});

afterEach(async () => {
  await stream.stop();
  vi.useRealTimers();
});

describe("Wire event stream, legacy /await socket", () => {
  test("pages through the notification stream, then goes live", async () => {
    api.respond = async (since: string | null) => since
      ? page([notification("n3", "third")])
      : page([notification("n1", "first"), notification("n2", "second")], true);

    await startStream();

    expect(api.calls).toEqual([null, "n2"]);
    expect(log).toEqual(["first", "second", "third"]);
    expect(stream.lastNotificationID).toBe("n3");
    expect(stream.isLive).toBe(true);
    let url = new URL(stream.urls[0]);
    expect(url.protocol).toBe("wss:");
    expect(url.host).toBe("prod-nginz-ssl.wire.com"); // not the REST host
    expect(url.pathname).toBe("/await"); // no version prefix on the legacy socket
    expect(url.searchParams.get("access_token")).toBe("token1");
    expect(url.searchParams.get("client")).toBe(session.clientID);
  });

  test("buffers the frames that arrive during the catch-up, and replays them in order", async () => {
    let firstPage = deferred<TWireNotifications>();
    api.respond = () => firstPage.promise;

    let started = stream.start(null);
    await flush();
    stream.lastSocket.open();
    await flush();

    // The socket is live while we are still paging through the stream
    stream.lastSocket.receiveText(notification("n9", "live-1"));
    stream.lastSocket.receiveText(notification("n10", "live-2"));
    await flush();
    expect(log).toEqual([]); // buffered, not processed

    firstPage.resolve(page([notification("n1", "stream-1"), notification("n2", "stream-2")]));
    await started;
    await flush();

    expect(log).toEqual(["stream-1", "stream-2", "live-1", "live-2"]);
    expect(stream.lastNotificationID).toBe("n10");
  });

  test("a lost notification stream refetches everything and reports the gap", async () => {
    api.respond = async (since: string | null) => since
      ? page([], false, true) // 404: our cursor is gone
      : page([notification("n1", "from-scratch")]);
    stream.onDesynchronized = async () => {
      log.push("desynchronized");
    };

    await startStream("old-cursor");

    expect(api.calls).toEqual(["old-cursor", null]);
    expect(log).toEqual(["from-scratch", "desynchronized"]);
    expect(stream.lastNotificationID).toBe("n1");
  });

  test("processes events one at a time, in order, even with a slow handler", async () => {
    let isProcessing = false;
    stream.onEvent = async (event: TWireEvent) => {
      expect(isProcessing).toBe(false); // never 2 at the same time
      isProcessing = true;
      await new Promise(resolve => setTimeout(resolve, 1));
      log.push(event.type);
      isProcessing = false;
    };
    let firstPage = deferred<TWireNotifications>();
    api.respond = () => firstPage.promise;

    let started = stream.start(null);
    await flush();
    stream.lastSocket.open();
    await flush();
    stream.lastSocket.receiveText(notification("n9", "live-1", "live-2"));
    firstPage.resolve(page([notification("n1", "stream-1", "stream-2")]));
    await started;
    await flush();
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(log).toEqual(["stream-1", "stream-2", "live-1", "live-2"]);
  });

  test("a transient notification is no cursor", async () => {
    await startStream();
    stream.lastSocket.receiveText(notification("n1", "conversation.otr-message-add"));
    await flush();
    stream.lastSocket.receiveText(notification("n2", "conversation.typing"), true);
    await flush();

    expect(log).toEqual(["conversation.otr-message-add", "conversation.typing"]);
    expect(stream.lastNotificationID).toBe("n1");
  });

  test("keeps the socket alive with a text ping, and reconnects when it stays unanswered", async () => {
    vi.useFakeTimers();
    await startStream();

    await vi.advanceTimersByTimeAsync(20_000);
    expect(stream.lastSocket.sent).toEqual(["ping"]);
    stream.lastSocket.receiveText("pong");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(stream.lastSocket.sent).toEqual(["ping", "ping"]);

    // No `pong` this time: the socket is dead, and we reconnect
    let dead = stream.lastSocket;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(dead.isClosed).toBe(true);
    await reconnected();
    expect(stream.sockets.length).toBe(2);
  });

  test("stop() leaves no timer and no listener behind", async () => {
    vi.useFakeTimers();
    await startStream();
    expect(windowEvents.count).toBeGreaterThan(0);
    expect(documentEvents.count).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0); // the keepalive

    await stream.stop();

    expect(windowEvents.count).toBe(0);
    expect(documentEvents.count).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(stream.lastSocket.isClosed).toBe(true);
    expect(stream.isConnected).toBe(false);
  });

  test("reconnects with a fresh access token after the socket dropped", async () => {
    vi.useFakeTimers();
    await startStream();
    api.calls = [];
    stream.lastNotificationID = "n5";

    stream.lastSocket.closeFromServer(1006);
    expect(stream.isConnected).toBe(false);
    await reconnected();

    expect(session.refreshCount).toBe(1);
    expect(stream.sockets.length).toBe(2);
    expect(new URL(stream.urls[1]).searchParams.get("access_token")).toBe("token2");
    expect(api.calls).toEqual(["n5"]); // resumed at our cursor
  });

  test("the network coming back reconnects the socket", async () => {
    vi.useFakeTimers();
    await startStream();
    let old = stream.lastSocket;

    windowEvents.fire("online");
    expect(old.isClosed).toBe(true);
    await reconnected();

    expect(stream.sockets.length).toBe(2);
  });
});

describe("Wire event stream, consumable /events socket", () => {
  beforeEach(() => {
    api.features = { consumableNotifications: { status: "enabled" } };
    stream.haveConsumableCapability = true;
  });

  test("stays on the legacy socket while our client lacks the capability", async () => {
    stream.haveConsumableCapability = false;

    await startStream();

    expect(new URL(stream.urls[0]).pathname).toBe("/await");
  });

  test("connects to the versioned events socket, with a sync marker", async () => {
    await startStream();

    expect(api.calls).toEqual([]); // the queue replays the backlog itself
    let url = new URL(stream.urls[0]);
    expect(url.pathname).toBe("/v9/events");
    expect(url.searchParams.get("sync_marker")).toMatch(/^[0-9a-f-]{36}$/);
    expect(stream.isLive).toBe(false); // not before our marker comes back
  });

  test("drains the legacy stream once when switching over", async () => {
    api.respond = async () => page([notification("n1", "last-legacy-event")]);

    await startStream("old-cursor");

    expect(api.calls).toEqual(["old-cursor"]);
    expect(log).toEqual(["last-legacy-event"]);
    expect(stream.lastNotificationID).toBeNull(); // the queue has no stream cursor
    expect(new URL(stream.urls[0]).pathname).toBe("/v9/events");
  });

  test("acknowledges an event only after it was processed", async () => {
    await startStream();
    stream.onEvent = async (event: TWireEvent) => {
      await new Promise(resolve => setTimeout(resolve, 1));
      log.push(event.type);
    };

    stream.lastSocket.receiveBinary({
      type: "event",
      data: {
        delivery_tag: 1487,
        event: notification("n1", "conversation.mls-message-add"),
      },
    });
    await flush();
    expect(stream.lastSocket.sent).toEqual([]); // still processing

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(log).toEqual(["conversation.mls-message-add"]);
    expect(JSON.parse(stream.lastSocket.sent[0])).toEqual({
      type: "ack",
      data: { delivery_tag: 1487, multiple: false },
    });
    expect(stream.lastNotificationID).toBe("n1");
  });

  test("a failed event goes to onError, and is neither acked nor a cursor", async () => {
    await startStream();
    let errors: Error[] = [];
    stream.onError = ex => errors.push(ex);
    stream.onEvent = async () => {
      throw new Error("Cannot decrypt");
    };

    stream.lastSocket.receiveBinary({
      type: "event",
      data: { delivery_tag: 12, event: notification("n1", "conversation.mls-message-add") },
    });
    await flush();

    expect(errors.map(ex => ex.message)).toEqual(["Cannot decrypt"]);
    expect(stream.lastSocket.sent).toEqual([]); // unacked, so the backend sends it again
    expect(stream.lastNotificationID).toBeNull();
  });

  test("the sync marker coming back means we are live", async () => {
    await startStream();
    let marker = new URL(stream.urls[0]).searchParams.get("sync_marker");

    stream.lastSocket.receiveBinary({
      type: "synchronization",
      data: { marker_id: "11111111-2222-3333-4444-555555555555", delivery_tag: 5 },
    });
    await flush();
    expect(stream.isLive).toBe(false); // a marker of an earlier attempt
    expect(JSON.parse(stream.lastSocket.sent[0]).data.delivery_tag).toBe(5); // acked anyway

    stream.lastSocket.receiveBinary({
      type: "synchronization",
      data: { marker_id: marker, delivery_tag: 6 },
    });
    await flush();
    expect(stream.isLive).toBe(true);
  });

  test("notifications_missed refetches everything, and only then acknowledges", async () => {
    await startStream();
    stream.onDesynchronized = async () => {
      await new Promise(resolve => setTimeout(resolve, 1));
      log.push("refetched");
    };

    stream.lastSocket.receiveBinary({ type: "notifications_missed" });
    await flush();
    expect(stream.lastSocket.sent).toEqual([]);

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(log).toEqual(["refetched"]);
    expect(JSON.parse(stream.lastSocket.sent[0])).toEqual({ type: "ack_full_sync" });
  });

  test("never sends a text ping, which would close the socket", async () => {
    vi.useFakeTimers();
    await startStream();

    await vi.advanceTimersByTimeAsync(120_000);

    expect(stream.lastSocket.sent).toEqual([]);
    expect(vi.getTimerCount()).toBe(0); // no keepalive timer at all
  });
});

///////////////////////////////////////////////////////////
// Test doubles

/** Feeds the stream a socket that we drive by hand */
class TestEventStream extends WireEventStream {
  readonly sockets: FakeSocket[] = [];
  readonly urls: string[] = [];

  protected async createSocket(url: string): Promise<WebSocketLike> {
    this.urls.push(url);
    let socket = new FakeSocket();
    this.sockets.push(socket);
    return socket;
  }

  get lastSocket(): FakeSocket {
    return this.sockets.at(-1);
  }
}

class FakeSocket implements WebSocketLike {
  binaryType = "";
  /** What we sent to the server */
  readonly sent: string[] = [];
  isClosed = false;
  onopen: ((ev: any) => void) | null = null;
  onmessage: ((ev: { data: any }) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.isClosed = true;
    this.onclose?.({ code: 1000, reason: "" });
  }

  open(): void {
    this.onopen?.({ type: "open" });
  }

  /** A `/await` frame: text */
  receiveText(json: any, transient = false): void {
    let data = typeof (json) == "string" ? json : JSON.stringify({ ...json, transient: transient });
    this.onmessage?.({ data: data });
  }

  /** An `/events` frame: binary */
  receiveBinary(json: any): void {
    this.onmessage?.({ data: new TextEncoder().encode(JSON.stringify(json)).buffer });
  }

  closeFromServer(code: number): void {
    this.isClosed = true;
    this.onclose?.({ code: code, reason: "" });
  }
}

///////////////////////////////////////////////////////////
// Helpers

/** Starts the stream and opens its socket */
async function startStream(lastNotificationID: string | null = null): Promise<void> {
  let started = stream.start(lastNotificationID);
  await flush();
  stream.lastSocket.open();
  await started;
  await flush();
}

/** Waits out the reconnect backoff and opens the new socket */
async function reconnected(): Promise<void> {
  await vi.advanceTimersByTimeAsync(5000);
  stream.lastSocket.open();
  await vi.advanceTimersByTimeAsync(1);
}

/** Lets the pending promise chains run. There are no timers in between, so
 * turning the microtask queue a few times is enough. */
async function flush(turns = 50): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

function deferred<T>(): { promise: Promise<T>, resolve: (result: T) => void } {
  let resolve: (result: T) => void;
  let promise = new Promise<T>(res => resolve = res);
  return { promise: promise, resolve: resolve };
}

function notification(notificationID: string, ...eventTypes: string[]): TWireNotification {
  return {
    id: notificationID,
    payload: eventTypes.map(type => ({ type: type })),
  };
}

function page(notifications: TWireNotification[], hasMore = false, lost = false): TWireNotifications {
  return {
    notifications: notifications,
    has_more: hasMore,
    time: null,
    lost: lost,
  };
}

/** The event stream listens to the window, the document and the computer's
 * sleep state, none of which exist in a test. */
function setupBrowserGlobals(): void {
  appGlobal.remoteApp = { ...appGlobal.remoteApp, computerOn: new ComputerOn() };
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
  (globalThis as any).window = windowEvents;
  (globalThis as any).document = documentEvents;
}

/** Counts its listeners, so that we see the ones left behind */
class FakeEventTarget {
  protected readonly listeners = new Map<string, Function[]>();
  hidden = false;

  addEventListener(type: string, listener: Function): void {
    let forType = this.listeners.get(type) ?? [];
    forType.push(listener);
    this.listeners.set(type, forType);
  }

  removeEventListener(type: string, listener: Function): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(l => l != listener));
  }

  fire(type: string): void {
    for (let listener of [...this.listeners.get(type) ?? []]) {
      listener({ type: type });
    }
  }

  get count(): number {
    return [...this.listeners.values()].reduce((sum, forType) => sum + forType.length, 0);
  }
}

let windowEvents = new FakeEventTarget();
let documentEvents = new FakeEventTarget();
