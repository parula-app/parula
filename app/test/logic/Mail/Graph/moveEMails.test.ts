// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { GraphAccount } from "../../../../logic/Mail/Graph/GraphAccount";
import { GraphFolder } from "../../../../logic/Mail/Graph/GraphFolder";
import { GraphEMail } from "../../../../logic/Mail/Graph/GraphEMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { waitTime } from "../../../../logic/util/util";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

/** Microsoft Graph JSON batching: "JSON batch requests are currently limited to 20 individual requests."
 * <https://learn.microsoft.com/en-us/graph/json-batching#batch-size-limitations> */
const kServerMaxBatchSize = 20;

/**
 * A fake Graph server with a mailbox, which answers `POST /v1.0/$batch` like the docs describe:
 * <https://learn.microsoft.com/en-us/graph/json-batching>
 * - The batch itself answers 200, each request has its own `status`.
 * - Responses come in a different order than the requests, correlated by `id`.
 * - Requests with `dependsOn` run after the request they depend on.
 *   If that one failed, they fail with 424, and don't run.
 * - A throttled request gets 429 with a `Retry-After` header.
 *   <https://learn.microsoft.com/en-us/graph/throttling#throttling-and-batching>
 */
class FakeGraphServer {
  /** folder ID -> message IDs in that folder */
  folders = new Map<string, Set<string>>();
  batchCalls = 0;
  otherCalls = 0;
  /** message ID -> how many more times the server answers its move or copy with 429 */
  throttle = new Map<string, number>();
  retryAfter = "1";
  /** message ID -> time when it was throttled last, and when it was moved */
  throttledAt = new Map<string, number>();
  movedAt = new Map<string, number>();
  /** message ID -> how many times it was moved or copied */
  actions = new Map<string, number>();
  protected nextID = 1;

  ky() {
    return {
      get: async (url: string) => {
        this.otherCalls++;
        expect(url).toContain("/delta");
        return { value: [], "@odata.deltaLink": url };
      },
      post: async (url: string, options: any) => {
        if (url.endsWith("/v1.0/$batch")) {
          return this.batch(options.json);
        }
        this.otherCalls++;
        throw new Error("Unexpected call " + url);
      },
    };
  }

  batch(json: any) {
    this.batchCalls++;
    let requests = json.requests as any[];
    if (requests.length > kServerMaxBatchSize ||
        new Set(requests.map(request => request.id)).size != requests.length) {
      let ex = new Error("HTTP POST $batch failed with 400 Bad Request") as any;
      ex.name = "HTTPError";
      ex.httpCode = 400;
      throw ex;
    }
    let responses = new Map<string, any>();
    let remaining = [...requests];
    while (remaining.length) {
      let request = remaining.find(request => (request.dependsOn ?? []).every(id => responses.has(id)));
      expect(request, "dependsOn refers to a request in this batch").toBeDefined();
      remaining.splice(remaining.indexOf(request), 1);
      let failedDependency = (request.dependsOn ?? []).some(id => responses.get(id).status >= 400);
      responses.set(request.id, failedDependency
        ? { id: request.id, status: 424, body: { error: { code: "FailedDependency", message: "Failed dependency" } } }
        : { id: request.id, ...this.run(request) });
    }
    return { responses: [...responses.values()].reverse() };
  }

  run(request: any) {
    expect(request.method).toBe("POST");
    if (request.body) {
      expect(request.headers?.["Content-Type"]).toContain("application/json");
    }
    let [, messageID, action] = request.url.match(/^\/me\/messages\/([^/]+)\/(move|copy)$/);
    let throttle = this.throttle.get(messageID) ?? 0;
    if (throttle > 0) {
      this.throttle.set(messageID, throttle - 1);
      this.throttledAt.set(messageID, Date.now());
      return {
        status: 429,
        headers: { "Retry-After": this.retryAfter },
        body: { error: { code: "TooManyRequests", message: "Please retry again later." } },
      };
    }
    let source = [...this.folders.values()].find(ids => ids.has(messageID));
    let target = this.folders.get(request.body?.destinationId);
    if (!source || !target) {
      return {
        status: 404,
        body: { error: { code: "ErrorItemNotFound", message: "The specified object was not found in the store." } },
      };
    }
    this.actions.set(messageID, (this.actions.get(messageID) ?? 0) + 1);
    this.movedAt.set(messageID, Date.now());
    let newID = "new-" + this.nextID++;
    target.add(newID);
    if (action == "move") {
      source.delete(messageID);
    }
    return { status: 201, body: { id: newID, parentFolderId: request.body.destinationId } };
  }
}

function setUp(count: number) {
  let server = new FakeGraphServer();
  appGlobal.remoteApp = { kyCreate: () => server.ky() } as any;
  let account = new GraphAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.url = "https://graph.microsoft.com";
  account.userID = "me-1";
  account.oAuth2 = { isLoggedIn: true, authorizationHeader: "Bearer TEST" } as any;
  account.storage = new DummyMailStorage();
  let errors: Error[] = [];
  account.errorCallback = ex => errors.push(ex);

  function newFolder(id: string): GraphFolder {
    let folder = new GraphFolder(account);
    folder.id = id;
    folder.name = id;
    folder.deltaURL = `https://graph.microsoft.com/v1.0/me/mailFolders/${id}/messages/delta?$deltatoken=1`;
    account.rootFolders.add(folder);
    server.folders.set(id, new Set());
    return folder;
  }
  let inbox = newFolder("inbox");
  let archive = newFolder("archive");
  for (let i = 1; i <= count; i++) {
    let email = new GraphEMail(inbox);
    email.pID = "msg-" + i;
    email.subject = "Email " + i;
    inbox.messages.add(email);
    server.folders.get("inbox").add(email.pID);
  }
  inbox.countTotal = count;
  return { server, inbox, archive, errors };
}

test("Moving more emails than fit into one batch moves all of them, with fewer calls than emails", async () => {
  let { server, inbox, archive, errors } = setUp(45);
  let emails = inbox.messages.contents.slice();

  await archive.moveMessagesHere(new ArrayColl(inbox.messages.contents));

  expect(server.folders.get("inbox").size).toBe(0);
  expect(server.folders.get("archive").size).toBe(45);
  expect(emails.every(email => server.actions.get(email.pID) == 1)).toBe(true);
  expect(server.batchCalls).toBeLessThan(45);
  expect(inbox.messages.length).toBe(0);
  expect(inbox.countTotal).toBe(0);
  expect(archive.countTotal).toBe(45);
  expect(errors).toEqual([]);
});

test("Copying emails copies all of them, and keeps them in the source folder", async () => {
  let { server, inbox, archive, errors } = setUp(25);

  await archive.copyMessagesHere(new ArrayColl(inbox.messages.contents));

  expect(server.folders.get("inbox").size).toBe(25);
  expect(server.folders.get("archive").size).toBe(25);
  expect(inbox.messages.length).toBe(25);
  expect(errors).toEqual([]);
});

test("A move that the server refuses for one email gives that error, and no email is lost", async () => {
  let { server, inbox, archive } = setUp(30);
  server.folders.get("inbox").delete("msg-5"); // e.g. deleted on another device

  await expect(archive.moveMessagesHere(new ArrayColl(inbox.messages.contents)))
    .rejects.toThrow(/The specified object was not found in the store/);

  expect(server.folders.get("archive").size + server.folders.get("inbox").size).toBe(29);
});

test("A request that the server throttles within a batch is sent again after Retry-After, and runs once", async () => {
  let { server, inbox, archive, errors } = setUp(30);
  server.throttle.set("msg-3", 1);
  server.throttle.set("msg-25", 2);
  server.retryAfter = "2";

  await archive.moveMessagesHere(new ArrayColl(inbox.messages.contents));

  expect(server.folders.get("inbox").size).toBe(0);
  expect(server.folders.get("archive").size).toBe(30);
  expect([...server.actions.values()].every(count => count == 1)).toBe(true);
  for (let id of ["msg-3", "msg-25"]) {
    let waited = server.movedAt.get(id) - server.throttledAt.get(id);
    expect(waited).toBeGreaterThanOrEqual(2000 * waitTime.factor * 0.9);
  }
  expect(errors).toEqual([]);
});

test("A server that keeps throttling, with a huge Retry-After, ends with an error after a few retries", async () => {
  let { server, inbox, archive } = setUp(3);
  server.throttle.set("msg-2", Infinity);
  server.retryAfter = "100000"; // more than a day. Without an upper limit, this test times out.
  let factor = waitTime.factor;
  waitTime.factor = 0.001;
  try {
    await expect(archive.moveMessagesHere(new ArrayColl(inbox.messages.contents)))
      .rejects.toThrow(/Please retry again later/);
  } finally {
    waitTime.factor = factor;
  }

  expect(server.batchCalls).toBeLessThanOrEqual(10);
  expect(server.actions.has("msg-2")).toBe(false);
  expect(server.actions.has("msg-3")).toBe(false);
});
