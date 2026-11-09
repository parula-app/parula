// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { OWAFolder } from "../../../../logic/Mail/OWA/OWAFolder";
import type { OWAEMail } from "../../../../logic/Mail/OWA/OWAEMail";
import { OWACalendar } from "../../../../logic/Calendar/OWA/OWACalendar";
import { OWAAddressbook } from "../../../../logic/Contacts/OWA/OWAAddressbook";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { waitTime } from "../../../../logic/util/util";
import { ArrayColl } from "svelte-collections";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

class TestOWAAccount extends OWAAccount {
  readonly errors: Error[] = [];
  /** How many notification messages arrived */
  messages = 0;
  /** How often we checked the inbox for new mail */
  inboxChecks = 0;
  /** All requests that we sent to the server */
  readonly requests: any[] = [];
  /** The number of mails in each mail folder on the server, by folder ID */
  readonly serverCounts = new Map<string, number>();
  /** The next folder listings fail with these errors, one each */
  readonly folderListingErrors: Error[] = [];

  async callOWA(request: any): Promise<any> {
    this.requests.push(request);
    if (request.action == "GetAccessTokenforResource") {
      return { AccessToken: "notification-token" };
    }
    if (request.action == "FindFolder") {
      let error = this.folderListingErrors.shift();
      if (error) {
        throw error;
      }
      let folders = [...this.serverCounts.keys()].map(folderID => this.serverFolderJSON(folderID));
      return { RootFolder: { ParentFolder: { FolderId: { Id: "msgfolderroot-id" } }, Folders: folders } };
    }
    if (request.action == "GetFolder") {
      // Like `callOWAShared()`, which unpacks a response with only one folder
      let responses = request.Body.FolderIds.map(folder => ({ ResponseClass: "Success", Folders: [this.serverFolderJSON(folder.Id)] }));
      return responses.length == 1 ? responses[0] : { ResponseMessages: { Items: responses } };
    }
    if (request.action == "FindItem") {
      // Which mails arrived is not part of these tests
      return { RootFolder: { Items: [], IncludesLastItemInRange: true } };
    }
    throw new Error("Unexpected OWA call " + request.action);
  }

  serverFolderJSON(folderID: string): any {
    let count = this.serverCounts.get(folderID);
    return {
      FolderId: { Id: folderID },
      ParentFolderId: { Id: "msgfolderroot-id" },
      DisplayName: folderID,
      FolderClass: "IPF.Note",
      DistinguishedFolderId: folderID == "inbox-folder" ? "inbox" : null,
      TotalCount: count,
      UnreadCount: count,
    };
  }

  async onNotificationMessages(messages: any[][]) {
    this.messages += messages.length;
  }
}

/** False while the last listener couldn't reach the server, e.g. while the VPN is down */
let serverReachable = true;

function newTestAccount(): TestOWAAccount {
  appGlobal.remoteApp ??= { OWA: {} } as any; // `OWAAccount` needs the backend
  let account = new TestOWAAccount();
  account.name = "Test";
  account.username = "alice@example.com";
  account.emailAddress = account.username;
  account.url = "https://exchange.example.com/owa/";
  account.errorCallback = ex => account.errors.push(ex);
  account.storage = new DummyMailStorage();
  newMailFolder(account, "inbox-folder", true, () => account.inboxChecks++);
  return account;
}

/** A mail folder, empty here and on the server.
 * `OWAFolder.listMessages()` subscribed it to row notifications, if `listening`.
 * @param onFetch Called when we fetch its new mail. Without it, the real `getNewMessages()` runs. */
function newMailFolder(account: TestOWAAccount, folderID: string, listening: boolean, onFetch?: () => void): OWAFolder {
  let folder = new OWAFolder(account);
  folder.id = folderID;
  folder.listening = listening;
  if (onFetch) {
    folder.getNewMessages = async () => {
      if (!serverReachable) {
        throw new Error("net::ERR_NAME_NOT_RESOLVED");
      }
      onFetch();
      return new ArrayColl<OWAEMail>();
    };
  }
  account.rootFolders.add(folder);
  account.folderMap.set(folderID, folder);
  account.serverCounts.set(folderID, 0);
  return folder;
}

/** A mail arrived in each of these folders on the server */
function newMailOnServer(account: TestOWAAccount, ...folderIDs: string[]) {
  for (let folderID of folderIDs) {
    account.serverCounts.set(folderID, account.serverCounts.get(folderID) + 1);
  }
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
          serverReachable = !(server instanceof Error);
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
  appGlobal.calendars.clear();
  appGlobal.addressbooks.clear();
  serverReachable = true;
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

/** The mail folders, calendars and address books that were synced, by folder ID */
let synced: string[] = [];

function newCalendar(account: OWAAccount, folderID: string): OWACalendar {
  let calendar = new OWACalendar();
  calendar.initFromMainAccount(account);
  calendar.folderID = folderID;
  calendar.listEvents = async () => {
    synced.push(folderID);
  };
  appGlobal.calendars.add(calendar);
  return calendar;
}

function newAddressbook(account: OWAAccount, folderID: string): OWAAddressbook {
  let addressbook = new OWAAddressbook();
  addressbook.initFromMainAccount(account);
  addressbook.folderID = folderID;
  addressbook.listContacts = async () => {
    synced.push(folderID);
  };
  appGlobal.addressbooks.add(addressbook);
  return addressbook;
}

test("OWA: After the notifications were opened again, we fetch what changed meanwhile in the inbox, the listed mail folders, calendars and address books", async () => {
  synced = [];
  let account = newTestAccount();
  newMailFolder(account, "listed-folder", true, () => synced.push("listed-folder"));
  newMailFolder(account, "unlisted-folder", false, () => synced.push("unlisted-folder"));
  newCalendar(account, "calendar-folder");
  newAddressbook(account, "contacts-folder");
  let listeners = serveExchange([() => exchangeStream(2), exchangeStream]);

  account.listenForNotifications();
  await vi.advanceTimersByTimeAsync(30 * 1000);
  // The first listener follows the startup sync, which already fetched everything
  expect(account.inboxChecks).toBe(0);
  expect(synced).toEqual([]);

  newMailOnServer(account, "inbox-folder", "listed-folder", "unlisted-folder");
  await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
  expect(listeners()).toBe(2);
  expect(account.inboxChecks).toBeGreaterThan(0);
  expect(synced).toContain("listed-folder");
  // Gets no row notifications, and is checked when it's opened
  expect(synced).not.toContain("unlisted-folder");
  expect(synced).toContain("calendar-folder");
  expect(synced).toContain("contacts-folder");
  expect(account.errors).toEqual([]);
  await account.disconnect();
});

test("OWA: When the server was reachable again only later, e.g. a late VPN, we fetch what changed meanwhile once it is", async () => {
  let account = newTestAccount();
  let unreachable = new Error("net::ERR_NAME_NOT_RESOLVED");
  let listeners = serveExchange([() => exchangeStream(1), unreachable, exchangeStream]);
  newMailOnServer(account, "inbox-folder");

  account.listenForNotifications();
  await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

  expect(listeners()).toBe(3);
  expect(account.inboxChecks).toBeGreaterThan(0);
  expect(account.errors).toEqual([]);
  await account.disconnect();
});

test("OWA: After the notifications were opened again, one request gets the counts of all listed mail folders, and only the folder with new mail is fetched", async () => {
  let account = newTestAccount();
  for (let i = 1; i <= 5; i++) {
    newMailFolder(account, "listed-folder-" + i, true);
  }
  let listeners = serveExchange([() => exchangeStream(2), exchangeStream]);

  account.listenForNotifications();
  await vi.advanceTimersByTimeAsync(30 * 1000);
  newMailOnServer(account, "listed-folder-3");
  await vi.advanceTimersByTimeAsync(3 * 60 * 1000);

  expect(listeners()).toBe(2);
  let countRequests = account.requests.filter(request => request.action == "GetFolder" || request.action == "FindFolder");
  expect(countRequests.length).toBe(1);
  let fetchedFolderIDs = account.requests
    .filter(request => request.action == "FindItem")
    .map(request => request.Body.ParentFolderIds[0].Id);
  expect(fetchedFolderIDs.length).toBeGreaterThan(0);
  expect(new Set(fetchedFolderIDs)).toEqual(new Set(["listed-folder-3"]));
  expect(account.inboxChecks).toBe(0);
  expect(account.errors).toEqual([]);
  await account.disconnect();
});

test("OWA: When the folder listing after the notifications were opened again fails, the error is reported once, and no mail folder is fetched", async () => {
  let account = newTestAccount();
  newMailFolder(account, "listed-folder", true);
  let listeners = serveExchange([() => exchangeStream(2), exchangeStream, exchangeStream]);

  account.listenForNotifications();
  await vi.advanceTimersByTimeAsync(30 * 1000);
  newMailOnServer(account, "inbox-folder", "listed-folder");
  account.folderListingErrors.push(new Error("Folder listing failed"));
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

  expect(account.errors.length).toBe(1);
  expect(account.errors[0].message).toContain("Folder listing failed");
  // An error that won't go away by itself is not tried again
  expect(listeners()).toBe(2);
  expect(account.inboxChecks).toBe(0);
  expect(account.requests.filter(request => request.action == "FindItem")).toEqual([]);
  await account.disconnect();
});

test("OWA: When the folder listing after the notifications were opened again fails only for a while, e.g. the network changed, we fetch what changed meanwhile later", async () => {
  let account = newTestAccount();
  let listeners = serveExchange([() => exchangeStream(2), exchangeStream, exchangeStream]);

  account.listenForNotifications();
  await vi.advanceTimersByTimeAsync(30 * 1000);
  newMailOnServer(account, "inbox-folder");
  account.folderListingErrors.push(new Error("net::ERR_NETWORK_CHANGED"));
  await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

  expect(account.inboxChecks).toBeGreaterThan(0);
  expect(account.errors).toEqual([]);
  // Tried again after a while, not right away
  expect(listeners()).toBeLessThanOrEqual(3);
  await account.disconnect();
});

test("OWA: When fetching one mail folder fails after the notifications were opened again, the other folders are still fetched", async () => {
  synced = [];
  let account = newTestAccount();
  newMailFolder(account, "listed-folder-1", true, () => synced.push("listed-folder-1"));
  newMailFolder(account, "broken-folder", true, () => {
    throw new Error("Folder fetch failed");
  });
  newMailFolder(account, "listed-folder-2", true, () => synced.push("listed-folder-2"));
  let listeners = serveExchange([() => exchangeStream(2), exchangeStream]);

  account.listenForNotifications();
  await vi.advanceTimersByTimeAsync(30 * 1000);
  newMailOnServer(account, "inbox-folder", "listed-folder-1", "broken-folder", "listed-folder-2");
  await vi.advanceTimersByTimeAsync(3 * 60 * 1000);

  expect(listeners()).toBe(2);
  expect(account.inboxChecks).toBeGreaterThan(0);
  expect(synced).toContain("listed-folder-1");
  expect(synced).toContain("listed-folder-2");
  expect(account.errors.length).toBe(1);
  expect(account.errors[0].message).toContain("Folder fetch failed");
  // The notifications stay open
  let messages = account.messages;
  await vi.advanceTimersByTimeAsync(60 * 1000);
  expect(account.messages).toBeGreaterThan(messages);
  await account.disconnect();
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

test("OWA: Office 365: After the notifications were opened again, we fetch what changed meanwhile in the inbox", async () => {
  let account = newTestAccount();
  account.authorizationHeader = "Bearer main-token";
  let streams = serveOffice365([3, Infinity]);
  newMailOnServer(account, "inbox-folder");

  account.listenForNotifications();
  await vi.advanceTimersByTimeAsync(20 * 1000);
  expect(account.inboxChecks).toBe(0);

  await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
  expect(streams.length).toBe(2);
  expect(account.inboxChecks).toBeGreaterThan(0);
  expect(account.errors).toEqual([]);
  await account.disconnect();
});
