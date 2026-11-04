// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { OWAOffice365Notifications } from "../../../../logic/Mail/OWA/Notification/OWAOffice365Notifications";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

/** Ends each SignalR message */
const kRecordSeparator = "\x1e";

class TestOWAAccount extends OWAAccount {
  server: TestServer;
  readonly notifications: any[] = [];

  async callOWA(request: any): Promise<any> {
    if (request.action == "SubscribeToNotification") {
      this.server.subscribe();
      return {};
    }
    throw new Error("Unexpected OWA call " + request.action);
  }

  async onNotificationMessages(messages: any[][]) {
    this.notifications.push(...messages.flat());
  }
}

/** One SignalR connection, from `negotiate` until the client or the server ends it */
class TestConnection {
  readonly connectionToken: string;
  /** The messages that the client sent, and when */
  readonly received: { time: number, message: any }[] = [];
  /** When the event stream was opened and closed */
  opened: number | null = null;
  closed: number | null = null;
  /** We told the client `ChannelReady` */
  ready = false;
  /** The client subscribed after we were ready, so we send it notifications */
  subscribed = false;
  protected controller: ReadableStreamDefaultController;
  protected pingTimer: ReturnType<typeof setInterval>;
  protected clientTimeout: ReturnType<typeof setTimeout>;

  constructor(connectionToken: string) {
    this.connectionToken = connectionToken;
  }

  openStream(signal: AbortSignal): ReadableStream {
    this.opened = Date.now();
    signal?.addEventListener("abort", () => {
      if (this.closed == null) {
        this.onClosed();
        this.controller.error(new DOMException("Aborted", "AbortError"));
      }
    });
    return new ReadableStream({
      start: controller => {
        this.controller = controller;
        controller.enqueue(new TextEncoder().encode(":\r\n"));
      },
      cancel: () => this.onClosed(),
    });
  }

  /** The server sends messages to the client, as one server-sent event */
  send(...messages: any[]) {
    if (this.closed != null) {
      return;
    }
    let data = messages.map(message => JSON.stringify(message) + kRecordSeparator).join("");
    this.controller.enqueue(new TextEncoder().encode("data: " + data + "\r\n\r\n"));
  }

  /** The server sends notifications to the client, the way Office 365 does */
  sendNotifications(...notifications: any[]) {
    this.send({ type: 1, target: "syncMessage", arguments: [notifications] });
  }

  /** The server ends the event stream */
  end() {
    if (this.closed != null) {
      return;
    }
    this.onClosed();
    this.controller.close();
  }

  onReceived(message: any) {
    this.received.push({ time: Date.now(), message });
    // Office 365 closes a connection when the client sent nothing for 5 minutes
    clearTimeout(this.clientTimeout);
    this.clientTimeout = setTimeout(() => {
      this.send({ type: 7, error: "Client hasn't sent a message/ping within the configured ClientTimeoutInterval.", allowReconnect: true });
      this.end();
    }, 5 * 60 * 1000);
    if (this.received.length == 1 && message.protocol == "json") {
      this.send({}); // handshake response
      // as Office 365 sends them
      this.send(
        { type: 1, target: "syncMessage", arguments: [[{ id: "pg", mark: 0, data: "alive1", EventType: "0" }]] },
        { type: 1, target: "syncMessage", arguments: [[{ id: "pg", subscriptionIds: [], data: "validateSubscriptions", EventType: "0" }]] },
        { type: 1, target: "syncMessage", arguments: [[{ id: "ChannelReady", EventType: "0" }]] },
      );
      this.ready = true;
      this.pingTimer = setInterval(() => this.send({ type: 6 }), 20 * 1000);
    }
  }

  protected onClosed() {
    this.closed ??= Date.now();
    clearInterval(this.pingTimer);
    clearTimeout(this.clientTimeout);
  }
}

/** Answers the requests of the notification channel like Office 365 with SignalR v2,
 * see <https://github.com/dotnet/aspnetcore/tree/main/src/SignalR/docs/specs>,
 * plus what we saw in a trace of Outlook on the web */
class TestServer {
  readonly account: TestOWAAccount;
  readonly connections: TestConnection[] = [];
  /** Requests without the account's current access token */
  readonly rejectedRequests: string[] = [];
  /** The most event streams that were open at the same time */
  maxOpenStreams = 0;
  /** Called when the handshake of a connection is done */
  onHandshake = (_connection: TestConnection) => {};

  constructor(account: TestOWAAccount) {
    this.account = account;
    account.server = this;
    globalThis.fetch = this.fetch.bind(this) as any;
  }

  get openConnections(): TestConnection[] {
    return this.connections.filter(connection => connection.opened != null && connection.closed == null);
  }

  /** `SubscribeToNotification` doesn't say for which connection.
   * Our guess: It's for the connections that are ready at that time. */
  subscribe() {
    for (let connection of this.openConnections.filter(connection => connection.ready)) {
      connection.subscribed = true;
    }
  }

  /** Sends a new mail notification to all connections that subscribed */
  newMail(itemID: string) {
    for (let connection of this.openConnections.filter(connection => connection.subscribed)) {
      connection.sendNotifications({ id: "NewMailNotification", Subject: "Test", ItemId: itemID, EventType: "0" });
      connection.sendNotifications({ id: "pg", mark: 1, data: "update", EventType: "0" });
    }
  }

  async fetch(url: string, options: any): Promise<any> {
    if (options?.headers?.Authorization != this.account.authorizationHeader) {
      this.rejectedRequests.push(url);
      return { ok: false, status: 401, statusText: "Unauthorized" };
    }
    let hubURL = this.account.url + "notificationchannel";
    let { pathname, searchParams } = new URL(url);
    if (options.method == "POST" && pathname == new URL(hubURL).pathname + "/negotiate") {
      expect(searchParams.get("negotiateVersion")).toBe("1");
      let connection = new TestConnection("connection-token-" + this.connections.length);
      this.connections.push(connection);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          negotiateVersion: 1,
          connectionId: "connection-id-" + this.connections.length,
          connectionToken: connection.connectionToken,
          availableTransports: [
            { transport: "WebSockets", transferFormats: ["Text", "Binary"] },
            { transport: "ServerSentEvents", transferFormats: ["Text"] },
            { transport: "LongPolling", transferFormats: ["Text", "Binary"] },
          ],
        }),
      };
    }
    expect(pathname).toBe(new URL(hubURL).pathname);
    let connection = this.connections.find(connection => connection.connectionToken == searchParams.get("id"));
    if (!connection || connection.closed) {
      return { ok: false, status: 404, statusText: "Not Found" };
    }
    if (options.method == "POST") {
      for (let record of options.body.split(kRecordSeparator).filter(Boolean)) {
        connection.onReceived(JSON.parse(record));
      }
      if (connection.received.length == 1) {
        this.onHandshake(connection);
      }
      return { ok: true, status: 200 };
    }
    expect(options.headers.Accept).toBe("text/event-stream");
    let body = connection.openStream(options.signal);
    this.maxOpenStreams = Math.max(this.maxOpenStreams, this.openConnections.length);
    return { ok: true, status: 200, body };
  }
}

function newTestAccount(): TestOWAAccount {
  appGlobal.remoteApp ??= { OWA: {} } as any; // `OWAAccount` needs the backend
  let account = new TestOWAAccount();
  account.url = "https://outlook.office.com/owa/";
  account.authorizationHeader = "Bearer access-token-1";
  return account;
}

/** Starts the notifications, and catches the error that ends them */
function startNotifications(account: TestOWAAccount): { error: Error | null } {
  let result = { error: null };
  new OWAOffice365Notifications(account).start()
    .catch(ex => result.error = ex);
  return result;
}

function newMailNotifications(account: TestOWAAccount): any[] {
  return account.notifications.filter(notification => notification.id == "NewMailNotification");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

test("OWA: Office 365: New mail arrives over SignalR v2", async () => {
  let account = newTestAccount();
  let server = new TestServer(account);

  let result = startNotifications(account);
  await vi.advanceTimersByTimeAsync(60 * 1000);
  server.newMail("item-1");
  await vi.advanceTimersByTimeAsync(1000);

  expect(result.error).toBeNull();
  expect(server.connections.length).toBe(1);
  // The handshake must be the first message
  expect(server.connections[0].received[0].message).toEqual({ protocol: "json", version: 1 });
  expect(newMailNotifications(account).map(notification => notification.ItemId)).toEqual(["item-1"]);
});

test("OWA: Office 365: The notification channel stays open for hours, also when the access token of the account changes", async () => {
  let account = newTestAccount();
  let server = new TestServer(account);

  let result = startNotifications(account);
  await vi.advanceTimersByTimeAsync(90 * 60 * 1000);
  // e.g. after a new login. The server takes only the new token from now on.
  account.authorizationHeader = "Bearer access-token-2";
  await vi.advanceTimersByTimeAsync(90 * 60 * 1000);
  server.newMail("item-1");
  await vi.advanceTimersByTimeAsync(1000);

  expect(result.error).toBeNull();
  expect(server.rejectedRequests).toEqual([]);
  expect(server.connections.length).toBe(1);
  expect(server.connections[0].closed).toBeNull();
  expect(newMailNotifications(account).length).toBe(1);
});

test("OWA: Office 365: After the server closed the notification channel, we open it again, and subscribe again", async () => {
  let account = newTestAccount();
  let server = new TestServer(account);
  server.onHandshake = connection => {
    if (server.connections.length == 1) {
      setTimeout(() => {
        connection.send({ type: 7, error: "Server restarts", allowReconnect: true });
        connection.end();
      }, 10 * 60 * 1000);
    }
  };

  let result = startNotifications(account);
  await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
  server.newMail("item-1");
  await vi.advanceTimersByTimeAsync(1000);

  expect(result.error).toBeNull();
  expect(server.connections.length).toBe(2);
  expect(server.maxOpenStreams).toBe(1);
  expect(newMailNotifications(account).map(notification => notification.ItemId)).toEqual(["item-1"]);
});

test("OWA: Office 365: The server closes the notification channel with an error", async () => {
  let account = newTestAccount();
  let server = new TestServer(account);
  server.onHandshake = connection => connection.send({ type: 7, error: "Server is shutting down" });

  let result = startNotifications(account);
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

  expect(result.error?.message).toContain("Server is shutting down");
  expect(server.connections.length).toBe(1);
});

test("OWA: Office 365: A server that ends the notification channel right away doesn't keep us busy", async () => {
  let account = newTestAccount();
  let server = new TestServer(account);
  // After a second, so that a reconnect loop shows as many connections, and doesn't hang the test
  server.onHandshake = connection => setTimeout(() => connection.end(), 1000);

  startNotifications(account);
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

  // At most one connection per minute
  expect(server.connections.length).toBeLessThanOrEqual(10);
});
