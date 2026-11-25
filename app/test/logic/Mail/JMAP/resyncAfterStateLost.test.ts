import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { JMAPFolder } from "../../../../logic/Mail/JMAP/JMAPFolder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import type { TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => { throw new Error("The test should not talk to a real server") } } as any;

const kOldState = "sje";
const kNewState = "slm";

/** Answers like Stalwart. Our state is unknown to it, so `Email/changes` fails. */
class FakeServer {
  mailboxes = [
    { id: "a", name: "Inbox", role: "inbox", parentId: null, totalEmails: 0, unreadEmails: 0, sortOrder: 0, isSubscribed: true, myRights: { mayDelete: true } },
    { id: "b", name: "Deleted Items", role: "trash", parentId: null, totalEmails: 0, unreadEmails: 0, sortOrder: 0, isSubscribed: true, myRights: { mayDelete: true } },
    { id: "k", name: "Projects", role: null, parentId: null, totalEmails: 0, unreadEmails: 0, sortOrder: 0, isSubscribed: true, myRights: { mayDelete: true } },
  ];
  emails: Record<string, any>[] = [];
  /** Emails per `Email/query` page */
  limit: number | null = null;
  /** The listing breaks off at this position */
  failAtPosition: number | null = null;
  /** Answers every `Email/query` with the first page, like a buggy server */
  repeatFirstPage = false;

  email(id: string, mailboxID: string, keywords: Record<string, boolean> = {}) {
    return {
      id, blobId: "blob" + id, threadId: "t" + id, mailboxIds: { [mailboxID]: true }, keywords, size: 260,
      receivedAt: "2026-10-17T15:52:44Z", messageId: [id + "@example.org"], subject: "Email " + id,
      from: [{ name: "Outside", email: "outside@example.org" }], to: [{ name: null, email: "mail-alice@example.com" }],
    };
  }

  answer(request: { methodCalls: [string, Record<string, any>, string][] }) {
    let results: Record<string, any> = {};
    let methodResponses = [];
    for (let [method, args, callID] of request.methodCalls) {
      let reference = args["#ids"] && results[args["#ids"].resultOf];
      if (args["#ids"] && !reference) {
        methodResponses.push(["error", { type: "invalidResultReference" }, callID]);
        continue;
      }
      let ids = reference ? reference.ids : args.ids;
      let result: Record<string, any>;
      if (method == "Email/changes") {
        methodResponses.push(["error", { type: "cannotCalculateChanges", description: "The server cannot calculate the changes between the old and new states." }, callID]);
        continue;
      } else if (method == "Mailbox/get") {
        for (let mailbox of this.mailboxes) {
          mailbox.totalEmails = this.emails.filter(email => email.mailboxIds[mailbox.id]).length;
        }
        result = { accountId: "e", state: "sni", list: this.mailboxes, notFound: [] };
      } else if (method == "Email/query") {
        let matching = this.emails.filter(email => email.mailboxIds[args.filter.inMailbox]);
        let position = this.repeatFirstPage ? 0 : args.position ?? 0;
        if (this.failAtPosition != null && position >= this.failAtPosition) {
          methodResponses.push(["error", { type: "serverFail", description: "Something went wrong" }, callID]);
          continue;
        }
        let limit = this.limit ?? args.limit ?? 1000;
        let page = matching.slice(position, position + limit);
        result = { accountId: "e", queryState: kNewState, canCalculateChanges: true, position, ids: page.map(email => email.id), ...(this.limit ? { limit } : {}) };
      } else if (method == "Email/get") {
        result = { accountId: "e", state: kNewState, list: this.emails.filter(email => ids.includes(email.id)), notFound: [] };
      } else {
        throw new Error("Unexpected " + method);
      }
      results[callID] = result;
      methodResponses.push([method, result, callID]);
    }
    return { methodResponses, sessionState: "s1" };
  }
}

/** Alice had her Inbox and Trash synced, then her state got too old. Meanwhile, on another device:
 * e1 was moved from Inbox to Trash, e2 was deleted, e3 arrived, e4 was flagged. */
async function setup() {
  let server = new FakeServer();
  let account = new JMAPAccount();
  account.accountID = "e";
  account.session = { apiUrl: "http://jmap.example.com/jmap/", capabilities: {}, accounts: {}, primaryAccounts: {}, state: "s1" } as any as TJMAPSession;
  account.storage = new DummyMailStorage();
  account.save = async () => {};
  account.errorCallback = ex => { throw ex };
  account.httpPost = async (url: string, request: any) => server.answer(request);
  await account.listFolders();
  let inbox = account.inbox as JMAPFolder;
  let trash = account.getAllFolders().find(folder => folder.id == "b") as JMAPFolder;
  let projects = account.getAllFolders().find(folder => folder.id == "k") as JMAPFolder;
  server.emails = [server.email("e1", "a"), server.email("e2", "a"), server.email("e4", "k"), server.email("e5", "b")];
  await account.listFolders();
  for (let folder of [inbox, trash, projects]) {
    let { newMessages } = folder.parseMessageList(server.emails.filter(email => email.mailboxIds[folder.id]) as any);
    folder.messages.addAll(newMessages);
  }
  account.syncState.set("Email", kOldState);

  server.emails = [
    server.email("e1", "b"),
    server.email("e3", "a"),
    server.email("e4", "k", { "$flagged": true }),
    server.email("e5", "b"),
  ];
  return { server, account, inbox, trash, projects };
}

function ids(folder: JMAPFolder): string[] {
  return folder.messages.contents.map(email => email.jmapID).sort();
}

test("When the server can't tell the changes, all folders are compared with the server", async () => {
  let { account, inbox, trash, projects } = await setup();

  let newInInbox = await inbox.listMessages();

  expect(ids(inbox)).toEqual(["e3"]);
  expect(ids(trash)).toEqual(["e1", "e5"]);
  expect(ids(projects)).toEqual(["e4"]);
  expect(projects.messages.first.isStarred).toBe(true);
  expect(newInInbox.contents.map(email => email.jmapID)).toEqual(["e3"]);
  expect(account.syncState.get("Email")).toBe(kNewState);
});

test("A push that finds the state unusable also compares all folders", async () => {
  let { account, inbox, trash } = await setup();

  await account.sync("Email", kNewState);

  expect(ids(inbox)).toEqual(["e3"]);
  expect(ids(trash)).toEqual(["e1", "e5"]);
  expect(account.syncState.get("Email")).toBe(kNewState);
});

test("A listing that breaks off doesn't remove local emails", async () => {
  let { server, inbox } = await setup();
  server.emails.push(server.email("e6", "a"));
  server.limit = 1;
  server.failAtPosition = 1;

  await expect(inbox.listMessages()).rejects.toThrow("Something went wrong");

  // e1 and e2 are gone on the server, but an incomplete listing doesn't prove that
  expect(ids(inbox)).toEqual(expect.arrayContaining(["e1", "e2"]));
});

test("A listing that the loop guard stops doesn't remove local emails", async () => {
  let { server, account, inbox } = await setup();
  let errors: Error[] = [];
  account.errorCallback = ex => errors.push(ex);
  server.limit = 1;
  server.repeatFirstPage = true;

  await inbox.listMessages();

  expect(errors.map(ex => ex.message).join("\n")).toMatch(/keeps returning more emails/);
  // e1 and e2 are gone on the server, but a stopped listing doesn't prove that
  expect(ids(inbox)).toEqual(expect.arrayContaining(["e1", "e2"]));
});
