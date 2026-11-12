// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { GraphAccount } from "../../../../logic/Mail/Graph/GraphAccount";
import { waitTime } from "../../../../logic/util/util";
import { expect, test, vi } from "vitest";

/** Microsoft Graph, Outlook service limits: "Four concurrent requests" per app and mailbox
 * <https://learn.microsoft.com/en-us/graph/throttling-limits#outlook-service-limits> */
const kServerMaxConcurrent = 4;

/** A Graph server that answers each request after a while, and counts how many run at the same time */
class FakeGraphServer {
  running = 0;
  maxRunning = 0;
  answered = 0;
  rejected = 0;
  /** When each request arrived, like `Date.now()` */
  arrivals: number[] = [];

  async answer(): Promise<any> {
    this.arrivals.push(Date.now());
    this.running++;
    this.maxRunning = Math.max(this.maxRunning, this.running);
    try {
      if (this.running > kServerMaxConcurrent) {
        this.rejected++;
        let ex = new Error("HTTP GET failed with 429 Too Many Requests") as any;
        ex.name = "HTTPError";
        ex.httpCode = 429;
        throw ex;
      }
      await new Promise(resolve => setTimeout(resolve, 20));
      this.answered++;
      return { value: [] };
    } finally {
      this.running--;
    }
  }
}

function setupAccount(server: FakeGraphServer): GraphAccount {
  let ky = {};
  for (let method of ["get", "post", "patch", "delete"]) {
    ky[method] = () => server.answer();
  }
  appGlobal.remoteApp = { kyCreate: () => ky } as any;
  let account = new GraphAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.url = "https://graph.microsoft.com";
  account.oAuth2 = {
    isLoggedIn: true,
    authorizationHeader: "Bearer TEST",
  } as any;
  return account;
}

test("Many requests at once, e.g. downloads of two folders, stay within the server's limit and all succeed", async () => {
  let server = new FakeGraphServer();
  let account = setupAccount(server);

  let requests = [];
  for (let i = 0; i < 12; i++) {
    requests.push(account.graphCall("messages/msg-" + i + "/$value"));
  }
  let results = await Promise.allSettled(requests);

  expect(results.filter(result => result.status == "rejected")).toEqual([]);
  expect(server.answered).toBe(12);
  expect(server.rejected).toBe(0);
  expect(server.maxRunning).toBeLessThanOrEqual(kServerMaxConcurrent);
});

test("More than 1000 requests in a minute, e.g. a big folder, wait for the next minute and all succeed", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  let oldWaitFactor = waitTime.factor;
  waitTime.factor = 1; // fake timers don't wait anyway, and the test checks the real interval
  try {
    let server = new FakeGraphServer();
    let account = setupAccount(server);
    const kRequests = 1200;

    let requests = [];
    for (let i = 0; i < kRequests; i++) {
      requests.push(account.graphCall("messages/msg-" + i + "/$value"));
    }
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000);

    expect(server.answered).toBe(kRequests);
    let results = await Promise.allSettled(requests);
    expect(results.filter(result => result.status == "rejected")).toEqual([]);
    expect(server.rejected).toBe(0);
    // Microsoft Graph, Outlook service limits: "10,000 API requests in a 10-minute period".
    // We send at most 1000 per minute, so any 1001 requests span at least a minute.
    let arrivals = server.arrivals;
    for (let i = 0; i + 1000 < arrivals.length; i++) {
      expect(arrivals[i + 1000] - arrivals[i]).toBeGreaterThanOrEqual(60 * 1000);
    }
  } finally {
    waitTime.factor = oldWaitFactor;
    vi.useRealTimers();
  }
});
