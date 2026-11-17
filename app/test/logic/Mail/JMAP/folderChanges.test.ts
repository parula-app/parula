import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import type { TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => { throw new Error("The test should not talk to a real server") } } as any;

function stalwartMailbox(id: string, name: string, role: string | null, totalEmails: number, unreadEmails: number) {
  return {
    id, name, parentId: null, role, sortOrder: 0, isSubscribed: true,
    totalEmails, unreadEmails, totalThreads: totalEmails, unreadThreads: unreadEmails,
    myRights: { mayReadItems: true, mayAddItems: true, mayRemoveItems: true, maySetSeen: true, maySetKeywords: true, mayCreateChild: true, mayRename: true, maySubmit: true, mayDelete: true, mayShare: true },
  };
}

/** Answers like Stalwart, which also gave us the `Mailbox/changes` responses below */
class FakeServer {
  mailboxes = [stalwartMailbox("a", "Inbox", "inbox", 30, 28), stalwartMailbox("d", "Drafts", "drafts", 2, 0)];
  /** The `Mailbox/changes` response, or a function of the `sinceState` that returns it */
  changes: Record<string, any> | ((sinceState: string) => Record<string, any>) | null = null;
  methodsCalled: string[] = [];

  answer(request: { methodCalls: [string, Record<string, any>, string][] }) {
    let results: Record<string, any> = {};
    let methodResponses = [];
    for (let [method, args, callID] of request.methodCalls) {
      this.methodsCalled.push(method);
      if (method == "Mailbox/changes") {
        if (!this.changes) {
          methodResponses.push(["error", { type: "cannotCalculateChanges", description: "The server cannot calculate the changes between the old and new states." }, callID]);
          continue;
        }
        results[callID] = { accountId: "e", oldState: args.sinceState, ...(typeof this.changes == "function" ? this.changes(args.sinceState) : this.changes) };
        methodResponses.push([method, results[callID], callID]);
        continue;
      }
      let changes = args["#ids"] && results[args["#ids"].resultOf];
      if (args["#ids"] && !changes) {
        methodResponses.push(["error", { type: "invalidResultReference" }, callID]);
        continue;
      }
      let ids = changes ? changes.updated : args.ids;
      let properties = args.properties;
      let list = this.mailboxes
        .filter(mailbox => !ids || ids.includes(mailbox.id))
        .map(mailbox => properties
          ? Object.fromEntries(Object.entries(mailbox).filter(([key]) => key == "id" || properties.includes(key)))
          : mailbox);
      methodResponses.push([method, { accountId: "e", state: "s7maq", list, notFound: [] }, callID]);
    }
    return { methodResponses, sessionState: "s1" };
  }
}

async function setup() {
  let server = new FakeServer();
  let account = new JMAPAccount();
  account.accountID = "e";
  account.session = { apiUrl: "http://jmap.example.com/jmap/", capabilities: {}, accounts: {}, primaryAccounts: {} } as any as TJMAPSession;
  account.storage = new DummyMailStorage();
  account.save = async () => {};
  account.httpPost = async (url: string, request: any) => server.answer(request);
  await account.listFolders();
  server.methodsCalled = [];
  return { server, account };
}

test("The folder listing stores the Mailbox state", async () => {
  let { account } = await setup();
  expect(account.syncState.get("Mailbox")).toBe("s7maq");
});

test("When only the counts changed, only the counts are fetched", async () => {
  let { server, account } = await setup();
  server.mailboxes[0].unreadEmails = 27;
  server.changes = { newState: "s7naq", hasMoreChanges: false, created: [], updated: ["a"], destroyed: [], updatedProperties: ["totalEmails", "unreadEmails", "totalThreads", "unreadThreads"] };

  await account.sync("Mailbox", "s7naq");

  expect(account.inbox.countUnread).toBe(27);
  expect(server.methodsCalled).toEqual(["Mailbox/changes", "Mailbox/get"]);
  expect(account.syncState.get("Mailbox")).toBe("s7naq");
});

test("A folder created on another device appears", async () => {
  let { server, account } = await setup();
  server.mailboxes.push(stalwartMailbox("k", "Projects", null, 0, 0));
  server.changes = { newState: "s7naq", hasMoreChanges: false, created: ["k"], updated: [], destroyed: [], updatedProperties: null };

  await account.sync("Mailbox", "s7naq");

  expect(account.getAllFolders().contents.map(folder => folder.name)).toContain("Projects");
});

test("When the server can't tell the changes, all folders are listed again", async () => {
  let { server, account } = await setup();
  server.mailboxes = server.mailboxes.filter(mailbox => mailbox.id != "d");
  server.changes = null;

  await account.sync("Mailbox", "s7naq");

  expect(account.getAllFolders().contents.map(folder => folder.name)).toEqual(["Inbox"]);
});

test("A changed folder that we don't know lists all folders again", async () => {
  let { server, account } = await setup();
  server.mailboxes.push(stalwartMailbox("k", "Projects", null, 1, 1));
  server.changes = { newState: "s7naq", hasMoreChanges: false, created: [], updated: ["k"], destroyed: [], updatedProperties: ["totalEmails", "unreadEmails", "totalThreads", "unreadThreads"] };

  await account.sync("Mailbox", "s7naq");

  expect(server.methodsCalled).toEqual(["Mailbox/changes", "Mailbox/get", "Mailbox/get"]);
  expect(account.getAllFolders().contents.map(folder => folder.name)).toContain("Projects");
});

/** A buggy or hostile server, which always has more changes */
async function setupEndless(sameState: boolean) {
  let { server, account } = await setup();
  let errors: Error[] = [];
  account.errorCallback = ex => errors.push(ex);
  let round = 0;
  server.changes = (sinceState: string) => ({
    newState: sameState ? sinceState : "s" + (++round), hasMoreChanges: true,
    created: [], updated: ["a"], destroyed: [], updatedProperties: ["totalEmails", "unreadEmails"],
  });
  return { server, account, errors };
}

test("Folder changes stop when the server reports more changes, but no new state", async () => {
  let { server, account, errors } = await setupEndless(true);

  await account.sync("Mailbox", "s7naq");

  expect(server.methodsCalled.filter(method => method == "Mailbox/changes").length).toBe(1);
  expect(errors.length).toBe(1);
});

test("Folder changes stop after a maximum number of rounds, when the server always has more", async () => {
  let { server, account, errors } = await setupEndless(false);

  await account.sync("Mailbox", "s7naq");

  expect(server.methodsCalled.filter(method => method == "Mailbox/changes").length).toBe(1000);
  expect(errors.length).toBe(1);
});

test("Changes in several batches: an interrupted sync continues after the last batch that was applied", async () => {
  let { server, account } = await setup();
  // Inbox unread: 28 at s7maq. The server sends the changes in 3 batches, and the connection breaks at the 2nd.
  let batches: Record<string, { newState: string, unread: number, hasMoreChanges: boolean }> = {
    s7maq: { newState: "b1", unread: 27, hasMoreChanges: true },
    b1: { newState: "b2", unread: 26, hasMoreChanges: true },
    b2: { newState: "b3", unread: 25, hasMoreChanges: false },
  };
  let breakAt = "b1";
  let answer = server.answer.bind(server);
  server.answer = (request: any) => {
    let sinceState = request.methodCalls[0][1].sinceState;
    if (sinceState == breakAt) {
      breakAt = null;
      throw new TypeError("fetch failed");
    }
    let batch = batches[sinceState];
    server.mailboxes[0].unreadEmails = batch.unread;
    server.changes = { newState: batch.newState, hasMoreChanges: batch.hasMoreChanges, created: [], updated: ["a"], destroyed: [], updatedProperties: ["totalEmails", "unreadEmails", "totalThreads", "unreadThreads"] };
    return answer(request);
  };

  await expect(account.sync("Mailbox", "b3")).rejects.toThrow("fetch failed");

  expect(account.syncState.get("Mailbox")).toBe("b1"); // not b2: that batch wasn't applied
  expect(account.inbox.countUnread).toBe(27);

  await account.sync("Mailbox", "b3");

  expect(account.syncState.get("Mailbox")).toBe("b3");
  expect(account.inbox.countUnread).toBe(25);
});
