import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { expect, test, vi } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => null } as any;

/** The listener waits between reconnects, so the tests that let it reconnect take a while */
const kTimeoutSec = 60;

function newAccount(): JMAPAccount {
  let account = new JMAPAccount();
  account.accountID = "u1";
  account.session = {
    capabilities: {},
    accounts: { u1: { accountCapabilities: {} } },
    eventSourceUrl: "https://example.com/jmap/eventsource/?types={types}&closeafter={closeafter}&ping={ping}",
  } as any as TJMAPSession;
  return account;
}

/** A connection that the server accepts and then closes, which ends one round of the loop */
function closedConnection(): any {
  return {
    ok: true,
    body: new ReadableStream({ start: controller => controller.close() }),
  };
}

/** A connection that sends one ping and then nothing anymore, like a connection that died
 * without the TCP connection being closed. It ends only when the client aborts it. */
function silentConnection(pingIntervalSec: number): (signal: AbortSignal) => any {
  return (signal: AbortSignal) => ({
    ok: true,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`event: ping\ndata: {"interval":${pingIntervalSec}}\n\n`));
        signal.addEventListener("abort", () => controller.error(signal.reason));
      },
    }),
  });
}

/** A connection that the network accepts, but nothing ever answers, e.g. a VPN tunnel
 * that isn't up yet. Ends only when the client aborts it. */
function unansweredConnection(): (signal: AbortSignal) => Promise<any> {
  return (signal: AbortSignal) => new Promise((resolve, reject) =>
    signal.addEventListener("abort", () => reject(signal.reason)));
}

function rejectedConnection(status: number, statusText: string, retryAfterSec?: number): any {
  return {
    ok: false,
    status: status,
    statusText: statusText,
    headers: new Headers(retryAfterSec ? { "Retry-After": String(retryAfterSec) } : {}),
  };
}

/** Answers the event source connections with `responses`, in order, then logs the account out */
function serve(account: JMAPAccount, responses: any[]): () => number {
  let attempts = 0;
  globalThis.fetch = (async (url: string, options: RequestInit) => {
    let response = responses[attempts++];
    if (attempts >= responses.length) {
      account.session = null; // `isLoggedIn` false, so the loop ends after this connection
    }
    return typeof response == "function" ? response(options.signal) : response;
  }) as any;
  return () => attempts;
}

test("After a reconnect, what changed in the meantime is fetched", { timeout: kTimeoutSec * 1000 }, async () => {
  let account = newAccount();
  account.syncState.set("Email", "e1");
  account.syncState.set("Identity", "i1");
  let synced: string[] = [];
  account.sync = async (type: string) => { synced.push(type) };
  let attempts = serve(account, [closedConnection(), closedConnection(), closedConnection()]);

  await account.startPushListener();

  expect(attempts()).toBe(3);
  expect(new Set(synced)).toEqual(new Set(["Email", "Identity"])); // After the second connection. The third logged out.
});

test("disconnect() during the catch-up ends it", { timeout: kTimeoutSec * 1000 }, async () => {
  let account = newAccount();
  account.syncState.set("Email", "e1");
  account.syncState.set("Identity", "i1");
  let synced: string[] = [];
  account.sync = async (type: string) => {
    synced.push(type);
    await account.disconnect(); // e.g. the user removed the account
  };
  let attempts = 0;
  globalThis.fetch = (async (url: string, options: any) => {
    if (++attempts == 1) {
      return closedConnection();
    }
    return { // stays open until it's aborted
      ok: true,
      body: new ReadableStream({
        start: controller => options.signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError"))),
      }),
    };
  }) as any;

  await account.startPushListener();

  expect(attempts).toBe(2);
  expect(synced.length).toBe(1); // Nothing after the disconnect, which would log in again
});

test("A rate-limited push connection is opened again", { timeout: kTimeoutSec * 1000 }, async () => {
  let account = newAccount();
  let attempts = serve(account, [rejectedConnection(429, "Too Many Requests", 1), closedConnection()]);

  await account.startPushListener();

  expect(attempts()).toBe(2);
});

test("A push connection that the server refuses outright is reported", async () => {
  let account = newAccount();
  let attempts = serve(account, [rejectedConnection(403, "Forbidden"), closedConnection()]);

  await expect(account.startPushListener()).rejects.toThrow("403");

  expect(attempts()).toBe(1);
});

test("A push connection that stopped sending pings is opened again", { timeout: kTimeoutSec * 1000 }, async () => {
  let account = newAccount();
  let attempts = serve(account, [silentConnection(1), closedConnection()]);

  await account.startPushListener();

  expect(attempts()).toBe(2);
});

test("A connection that is never answered is opened again", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    let account = newAccount();
    let attempts = serve(account, [unansweredConnection(), closedConnection()]);

    let listening = account.startPushListener();
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
    await listening;

    expect(attempts()).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

test("Starting push again ends the listener that is still waiting on a dead connection", async () => {
  let account = newAccount();
  let attempts = serve(account, [silentConnection(60), closedConnection()]);

  let oldListener = account.startPushListener();
  while (attempts() < 1) {
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  let newListener = account.startPushListener(); // e.g. `loginAndStartup()` after the OAuth2 token expired during sleep
  await oldListener;
  await newListener;

  expect(attempts()).toBe(2);
});
