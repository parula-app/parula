// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { waitTime } from "../../../../logic/util/util";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

class TestOWAAccount extends OWAAccount {
  readonly errors: Error[] = [];
  /** How many notification messages arrived */
  messages = 0;

  async callOWA(request: any): Promise<any> {
    if (request.action == "GetAccessTokenforResource") {
      return { AccessToken: "notification-token" };
    }
    throw new Error("Unexpected OWA call " + request.action);
  }

  async onNotificationMessages(messages: any[][]) {
    this.messages += messages.length;
  }
}

function newTestAccount(): TestOWAAccount {
  appGlobal.remoteApp ??= { OWA: {} } as any; // `OWAAccount` needs the backend
  let account = new TestOWAAccount();
  account.name = "Test";
  account.username = "alice@example.com";
  account.emailAddress = account.username;
  account.url = "https://exchange.example.com/owa/";
  account.errorCallback = ex => account.errors.push(ex);
  return account;
}

function waitForever(): Promise<void> {
  return new Promise(() => undefined);
}

/** An on-prem notification stream that sends a notification every 40 s, `count` times,
 * and then nothing anymore, like a connection that died without the TCP connection
 * being closed, e.g. after a VPN drop */
async function* exchangeStream(count = Infinity): AsyncIterable<string> {
  for (let i = 0; i < count; i++) {
    yield `<script>[{"id":"Test"}]</script>`;
    await new Promise(resolve => setTimeout(resolve, 40 * 1000));
  }
  await waitForever();
}

/** Answers the requests of each new on-prem listener with the next of `servers`.
 * An `Error` fails its first request, e.g. while the VPN tunnel isn't up yet.
 * @returns how many listeners started */
function serveExchange(servers: ((() => AsyncIterable<string>) | Error)[]): () => number {
  let listeners = 0;
  appGlobal.remoteApp = {
    OWA: {
      fetchJSON: async (_partition: string, url: string) => {
        if (url.includes("ev=FinishNotificationRequest")) {
          let server = servers[listeners++];
          if (server instanceof Error) {
            throw server;
          }
          return { ok: true, status: 200, json: { cid: "cid-" + listeners } };
        }
        let server = servers[listeners - 1] as () => AsyncIterable<string>;
        return { ok: true, status: 200, body: server() };
      },
    },
  } as any;
  return () => listeners;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  waitTime.factor = 1; // fake timers don't wait anyway, and the tests check the real intervals
});

afterEach(() => {
  vi.useRealTimers();
});

test("OWA: A notification stream that keeps sending stays open", async () => {
  let account = newTestAccount();
  let listeners = serveExchange([exchangeStream]);

  account.listenForNotifications();
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

  expect(listeners()).toBe(1);
  expect(account.messages).toBeGreaterThan(10);
  await account.disconnect();
});

test("OWA: A notification stream that stopped sending is opened again", async () => {
  let account = newTestAccount();
  let listeners = serveExchange([() => exchangeStream(2), exchangeStream]);

  account.listenForNotifications();
  await vi.advanceTimersByTimeAsync(3 * 60 * 1000);

  expect(listeners()).toBe(2);
  expect(account.errors).toEqual([]);
  await account.disconnect();
});

test("OWA: When the server isn't reachable yet, e.g. a late VPN, the notifications are opened again later", async () => {
  let account = newTestAccount();
  let unreachable = new Error("net::ERR_NAME_NOT_RESOLVED");
  let listeners = serveExchange([unreachable, unreachable, exchangeStream]);

  account.listenForNotifications();
  await vi.advanceTimersByTimeAsync(4 * 60 * 1000);

  expect(listeners()).toBe(3);
  expect(account.errors).toEqual([]);
  let messages = account.messages;
  await vi.advanceTimersByTimeAsync(60 * 1000);
  expect(account.messages).toBeGreaterThan(messages);
  await account.disconnect();
});

test("OWA: After an error that won't go away by itself, the notifications are not opened again", async () => {
  let account = newTestAccount();
  let listeners = serveExchange([new Error("Something unexpected")]);

  account.listenForNotifications();
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

  expect(listeners()).toBe(1);
  expect(account.errors.map(ex => ex.message)).toEqual(["Something unexpected"]);
});

test("OWA: After logout, the notifications are not opened again", async () => {
  let account = newTestAccount();
  let listeners = serveExchange([() => exchangeStream(1)]);

  account.listenForNotifications();
  await vi.advanceTimersByTimeAsync(1000);
  await account.disconnect();
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

  expect(listeners()).toBe(1);
});

/** An Office 365 server-sent event stream that sends a keep-alive every 10 s, `count` times,
 * and then nothing anymore. It ends only when the client aborts it. */
function office365Stream(count: number, signal: AbortSignal): ReadableStream {
  return new ReadableStream({
    start(controller) {
      let sent = 0;
      function send() {
        if (sent++ < count && !signal.aborted) {
          controller.enqueue(new TextEncoder().encode(sent == 1 ? "data: initialized\n\n" : "data: {}\n\n"));
          setTimeout(send, 10 * 1000);
        }
      }
      send();
      signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")));
    },
  });
}

/** Answers the Office 365 notification channel requests.
 * The stream of each listener sends `keepAlives[n]` keep-alives, and then nothing anymore.
 * @returns the streams that were opened */
function serveOffice365(keepAlives: number[]): AbortSignal[] {
  let streams: AbortSignal[] = [];
  globalThis.fetch = (async (url: string, options: any) => {
    if (url.includes("notificationchannel/negotiate")) {
      return { ok: true, status: 200, json: async () => ({ ConnectionToken: "token", KeepAliveTimeout: 20, TransportConnectTimeout: 5 }) };
    }
    if (url.includes("notificationchannel/connect")) {
      streams.push(options.signal);
      return { ok: true, status: 200, body: office365Stream(keepAlives[streams.length - 1], options.signal) };
    }
    return { ok: true, status: 200 }; // start, ping, abort
  }) as any;
  return streams;
}

test("OWA: Office 365: A notification stream that stopped sending keep-alives is opened again", async () => {
  let account = newTestAccount();
  account.authorizationHeader = "Bearer main-token";
  let streams = serveOffice365([3, Infinity]);

  account.listenForNotifications();
  await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

  expect(streams.length).toBe(2);
  expect(streams[0].aborted).toBe(true);
  expect(streams[1].aborted).toBe(false);
  expect(account.errors).toEqual([]);
  await account.disconnect();
});
