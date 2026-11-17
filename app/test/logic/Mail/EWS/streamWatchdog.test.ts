// @vitest-environment happy-dom
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { AuthMethod } from "../../../../logic/Abstract/Account";
import { waitTime } from "../../../../logic/util/util";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

/** Exchange sends a heartbeat every 45 s */
const kHeartbeatMS = 45 * 1000;

class TestEWSAccount extends EWSAccount {
  /** What the server answers to our subscription requests, in order. An `Error` fails the request. */
  subscriptions: (string | Error)[] = ["subscription-1"];

  async callEWS(request: any): Promise<any> {
    if (request.m$Subscribe) {
      let subscription = this.subscriptions.shift();
      if (subscription instanceof Error) {
        throw subscription;
      }
      return { SubscriptionId: subscription };
    }
    if (request.m$Unsubscribe) {
      return {};
    }
    throw new Error("Unexpected EWS call " + JSON.stringify(request));
  }
}

/** What `GetStreamingEvents` sends when the connection opens, and then every 45 s */
const kHeartbeat = `<?xml version="1.0" encoding="utf-8"?>
  <Envelope xmlns="http://schemas.xmlsoap.org/soap/envelope/">
    <Body>
      <GetStreamingEventsResponse xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
        <ResponseMessages>
          <GetStreamingEventsResponseMessage ResponseClass="Success">
            <ResponseCode>NoError</ResponseCode>
            <ConnectionStatus>OK</ConnectionStatus>
          </GetStreamingEventsResponseMessage>
        </ResponseMessages>
      </GetStreamingEventsResponse>
    </Body>
  </Envelope>`;

/** A stream that sends heartbeats `count` times, and then nothing anymore,
 * like a connection that died without the TCP connection being closed,
 * e.g. after a VPN drop. It ends only when the client aborts it. */
function heartbeatStream(count = Infinity): (signal: AbortSignal) => any {
  return (signal: AbortSignal) => ({
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        let sent = 0;
        function send() {
          if (sent++ < count && !signal.aborted) {
            controller.enqueue(new TextEncoder().encode(kHeartbeat));
            setTimeout(send, kHeartbeatMS);
          }
        }
        send();
        signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")));
      },
    }),
  });
}

/** The server lost our subscription, e.g. while the computer slept */
function subscriptionLost(): any {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`<?xml version="1.0" encoding="utf-8"?>
          <Envelope xmlns="http://schemas.xmlsoap.org/soap/envelope/">
            <Body>
              <GetStreamingEventsResponse xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
                <ResponseMessages>
                  <GetStreamingEventsResponseMessage ResponseClass="Error">
                    <MessageText>The specified subscription was not found.</MessageText>
                    <ResponseCode>ErrorSubscriptionNotFound</ResponseCode>
                    <ConnectionStatus>Closed</ConnectionStatus>
                  </GetStreamingEventsResponseMessage>
                </ResponseMessages>
              </GetStreamingEventsResponse>
            </Body>
          </Envelope>`));
        controller.close();
      },
    }),
  };
}

/** The server refuses the stream, e.g. because we have no rights, and would do so again */
function refused(): any {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`<?xml version="1.0" encoding="utf-8"?>
          <Envelope xmlns="http://schemas.xmlsoap.org/soap/envelope/">
            <Body>
              <GetStreamingEventsResponse xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
                <ResponseMessages>
                  <GetStreamingEventsResponseMessage ResponseClass="Error">
                    <MessageText>The subscription is invalid.</MessageText>
                    <ResponseCode>ErrorInvalidSubscription</ResponseCode>
                    <ConnectionStatus>Closed</ConnectionStatus>
                  </GetStreamingEventsResponseMessage>
                </ResponseMessages>
              </GetStreamingEventsResponse>
            </Body>
          </Envelope>`));
        controller.close();
      },
    }),
  };
}

/** The server name doesn't resolve, e.g. while the VPN tunnel isn't up yet */
function unreachable(): any {
  throw new TypeError("Failed to fetch");
}

function httpError(status: number, statusText: string): any {
  return { ok: false, status, statusText };
}

interface StreamRequest {
  subscriptionID: string;
  signal: AbortSignal;
  authorization?: string;
}

/** Answers the stream requests with `responses`, in order.
 * @returns the requests that came in */
function serve(responses: ((signal: AbortSignal) => any)[]): StreamRequest[] {
  let requests: StreamRequest[] = [];
  globalThis.fetch = (async (_url: string, options: RequestInit) => {
    requests.push({
      subscriptionID: /<t:SubscriptionId>([^<]*)</.exec(options.body as string)[1],
      signal: options.signal,
      authorization: (options.headers as Record<string, string>).Authorization,
    });
    let response = responses[requests.length - 1];
    if (!response) {
      throw new Error("Unexpected stream request");
    }
    return response(options.signal);
  }) as any;
  return requests;
}

function newTestAccount(): TestEWSAccount {
  let account = new TestEWSAccount();
  account.name = "Test";
  account.username = "user@example.com";
  account.emailAddress = account.username;
  account.url = "https://exchange.example.com/EWS/Exchange.asmx";
  account.authMethod = AuthMethod.Unknown; // no credentials needed for the stream request
  account.errorCallback = () => undefined;
  return account;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  waitTime.factor = 1; // fake timers don't wait anyway, and the tests check the real intervals
});

afterEach(() => {
  vi.useRealTimers();
});

test("A stream that keeps sending heartbeats stays open", async () => {
  let account = newTestAccount();
  let requests = serve([heartbeatStream()]);

  await account.subscribeToNotifications();
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

  expect(requests.length).toBe(1);
  expect(requests[0].signal.aborted).toBe(false);
  await account.unsubscribeAllSubscriptions();
});

test("A stream that stopped sending heartbeats is opened again", async () => {
  let account = newTestAccount();
  let requests = serve([heartbeatStream(2), heartbeatStream()]);

  await account.subscribeToNotifications();
  await vi.advanceTimersByTimeAsync(3 * kHeartbeatMS + 1000);

  expect(requests.length).toBe(2);
  expect(requests[0].signal.aborted).toBe(true);
  expect(requests[1].signal.aborted).toBe(false);
  await account.unsubscribeAllSubscriptions();
});

test("When the server isn't reachable yet, e.g. a late VPN, we try again, at most every 10 s, until it is", async () => {
  let account = newTestAccount();
  let requests = serve([unreachable, unreachable, unreachable, heartbeatStream()]);

  await account.subscribeToNotifications();
  await vi.advanceTimersByTimeAsync(5 * 1000);
  expect(requests.length).toBeLessThanOrEqual(2); // not hammering the server
  await vi.advanceTimersByTimeAsync(30 * 1000);

  expect(requests.length).toBe(4);
  expect(requests[3].signal.aborted).toBe(false);
  await account.unsubscribeAllSubscriptions();
});

test("When the server answered with an HTTP error, the stream is opened again later", async () => {
  let account = newTestAccount();
  let requests = serve([() => httpError(503, "Service Unavailable"), heartbeatStream()]);

  await account.subscribeToNotifications();
  await vi.advanceTimersByTimeAsync(3 * kHeartbeatMS + 1000);

  expect(requests.length).toBe(2);
  await account.unsubscribeAllSubscriptions();
});

test("After unsubscribing, the stream is not opened again", async () => {
  let account = newTestAccount();
  let requests = serve([heartbeatStream(1)]);

  await account.subscribeToNotifications();
  await vi.advanceTimersByTimeAsync(1000);
  await account.unsubscribeAllSubscriptions();
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

  expect(requests.length).toBe(1);
});

test("After an error that won't go away by itself, the stream is not opened again", async () => {
  let account = newTestAccount();
  let errors: Error[] = [];
  account.errorCallback = ex => errors.push(ex);
  let requests = serve([() => { throw new Error("Login failed"); }]);

  await account.subscribeToNotifications();
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

  expect(requests.length).toBe(1);
  expect(errors.map(ex => ex.message)).toEqual(["Login failed"]);
});

test("When getting a new subscription failed, e.g. because the VPN dropped again, we try again later", async () => {
  let account = newTestAccount();
  account.subscriptions = ["subscription-1", new TypeError("Failed to fetch"), "subscription-2"];
  let requests = serve([subscriptionLost, subscriptionLost, heartbeatStream()]);

  await account.subscribeToNotifications();
  await vi.advanceTimersByTimeAsync(3 * kHeartbeatMS);

  expect(requests.map(request => request.subscriptionID)).toEqual(["subscription-1", "subscription-1", "subscription-2"]);
  expect(requests[2].signal.aborted).toBe(false);
  await account.unsubscribeAllSubscriptions();
});

test("When the server refuses the stream, we report that once, and don't ask again", async () => {
  let account = newTestAccount();
  let errors: any[] = [];
  account.errorCallback = ex => errors.push(ex);
  let requests = serve([refused, refused, heartbeatStream()]);

  await account.subscribeToNotifications();
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

  expect(requests.length).toBe(1);
  expect(errors.map(ex => ex.type)).toEqual(["ErrorInvalidSubscription"]);
});

test("When the access token expired while the computer slept, we get a new one before we reconnect", async () => {
  let account = newTestAccount();
  account.authMethod = AuthMethod.OAuth2;
  account.oAuth2 = {
    isLoggedIn: false,
    authorizationHeader: "Bearer expired",
    async login(interactive: boolean) {
      expect(interactive).toBe(false);
      this.isLoggedIn = true;
      this.authorizationHeader = "Bearer fresh";
    },
  } as any;
  let requests = serve([heartbeatStream()]);

  await account.subscribeToNotifications();
  await vi.advanceTimersByTimeAsync(1000);

  expect(requests.map(request => request.authorization)).toEqual(["Bearer fresh"]);
  await account.unsubscribeAllSubscriptions();
});

test("When getting a new access token fails, e.g. while the network is down, we try again at most every 10 s", async () => {
  let account = newTestAccount();
  account.authMethod = AuthMethod.OAuth2;
  let tokenRequests = 0;
  let oAuth2 = {
    isLoggedIn: true,
    authorizationHeader: "Bearer valid",
    async login() {
      tokenRequests++;
      if (tokenRequests > 100) { // so that a busy loop fails the test, instead of hanging it
        this.isLoggedIn = true;
        return;
      }
      throw new TypeError("Failed to fetch");
    },
  };
  account.oAuth2 = oAuth2 as any;
  /** The server ends the stream normally after a minute, and meanwhile the access token expired */
  function endsAfterAMinute() {
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(kHeartbeat));
          setTimeout(() => {
            oAuth2.isLoggedIn = false;
            controller.close();
          }, 60 * 1000);
        },
      }),
    };
  }
  serve([endsAfterAMinute]);

  await account.subscribeToNotifications();
  await vi.advanceTimersByTimeAsync(60 * 1000 + 30 * 1000);

  expect(tokenRequests).toBeGreaterThanOrEqual(2); // keeps trying
  expect(tokenRequests).toBeLessThanOrEqual(5); // not hammering the token server
  oAuth2.isLoggedIn = true;
  await account.unsubscribeAllSubscriptions();
});
