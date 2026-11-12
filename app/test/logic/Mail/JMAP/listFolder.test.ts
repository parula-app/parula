import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { JMAPFolder } from "../../../../logic/Mail/JMAP/JMAPFolder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import type { TJMAPMethodResponse, TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => null } as any;

/** An email as Stalwart returns it from `Email/get` without `properties` */
function stalwartEMail(n: number) {
  return {
    id: "e" + n, blobId: "catyxccs031m7s9mogshetv11im3aa3zmdcvfchfzlxhwik7en0w2byaai" + n, threadId: "t" + n,
    mailboxIds: { a: true }, keywords: {}, size: 260,
    receivedAt: new Date(Date.UTC(2026, 9, 17, 15, 52, 44) - n * 60000).toISOString().replace(".000Z", "Z"),
    messageId: [`m-${n}@example.org`], inReplyTo: null, references: null, sender: null,
    from: [{ name: "Outside", email: "outside@example.org" }],
    to: [{ name: null, email: "mail-carol@example.com" }],
    cc: null, bcc: null, replyTo: null, subject: "Email " + n,
    sentAt: "2026-10-17T15:52:44Z", hasAttachment: false, preview: `Hello ${n}\n`,
    bodyValues: {}, textBody: [], htmlBody: [], attachments: [],
  };
}

/** Serves `Email/query` + `Email/get` like Stalwart, for `serverCount` emails in the Inbox
 * @param serverLimit The server returns at most this many per page, and says so in `limit` */
function newAccount(serverCount: number, serverLimit?: number) {
  let account = new JMAPAccount();
  account.accountID = "h";
  account.session = { capabilities: {}, accounts: {}, primaryAccounts: {} } as any as TJMAPSession;
  account.storage = new DummyMailStorage();
  let errors: Error[] = [];
  account.errorCallback = ex => errors.push(ex);
  let queries: Record<string, any>[] = [];
  account.makeCalls = async (requests: [string, Record<string, any>, string?][]) => {
    let query = requests[0][1];
    queries.push(query);
    let limit = Math.min(query.limit, serverLimit ?? query.limit);
    let all = Array.from({ length: serverCount }, (_, i) => stalwartEMail(i));
    let page = all.slice(query.position, query.position + limit);
    return [
      ["Email/query", {
        accountId: "h", queryState: "saq", canCalculateChanges: true, position: query.position,
        ids: page.map(email => email.id), ...(serverLimit ? { limit } : {}),
      }, "list"],
      ["Email/get", { accountId: "h", state: "saq", list: page, notFound: [] }, "emails"],
    ] as TJMAPMethodResponse[];
  };
  let inbox = account.newFolder();
  inbox.id = "a";
  inbox.specialFolder = SpecialFolder.Inbox;
  account.rootFolders.add(inbox);
  return { account, inbox: inbox as JMAPFolder, queries, errors };
}

test("A folder that was empty at the folder listing shows the emails that arrived since", async () => {
  let { account, inbox } = newAccount(2);
  inbox.countTotal = 0; // `totalEmails` from `Mailbox/get` at startup

  await inbox.listMessages();

  expect(inbox.messages.contents.map(email => email.subject)).toEqual(["Email 0", "Email 1"]);
  expect(account.syncState.get("Email")).toBe("saq");
});

test("An empty folder stores the sync state, so that changes can be fetched later", async () => {
  let { account, inbox } = newAccount(0);

  await inbox.listMessages();

  expect(inbox.messages.isEmpty).toBe(true);
  expect(account.syncState.get("Email")).toBe("saq");
});

test("Listing pages until a short page, not by the outdated folder count", async () => {
  let { inbox, queries } = newAccount(1100);
  inbox.countTotal = 300;

  await inbox.listMessages();

  expect(queries.map(query => query.position)).toEqual([0, 500, 1000]);
  expect(queries.some(query => query.calculateTotal)).toBe(false); // expensive for the server
  expect(inbox.messages.length).toBe(1100);
  expect(inbox.countTotal).toBe(300); // Listing doesn't change it: `countTotal` comes from `Mailbox/get`
});

test("The next page is fetched while the last page is still being saved", async () => {
  let { inbox, queries } = newAccount(1100);
  let queriesDuringSave: number[] = [];
  let saveNewMsgs = (inbox as any).saveNewMsgs.bind(inbox);
  (inbox as any).saveNewMsgs = async (emails: any) => {
    let queriesBefore = queries.length;
    await new Promise(resolve => setTimeout(resolve, 10));
    await saveNewMsgs(emails);
    queriesDuringSave.push(queries.length - queriesBefore);
  };

  await inbox.listMessages();

  expect(queriesDuringSave).toEqual([1, 1, 0]); // nothing after the last page
  expect(inbox.messages.length).toBe(1100);
});

test("An error while saving a page is reported, and the listing goes on", async () => {
  let { account, inbox, errors } = newAccount(1100);
  let saves = 0;
  account.storage.saveMessages = async () => {
    if (++saves == 1) {
      throw new Error("Disk full");
    }
  };

  await inbox.listMessages();

  expect(errors.map(ex => ex.message)).toEqual(["Disk full"]);
  expect(saves).toBe(3);
  expect(inbox.messages.length).toBe(1100);
});

test("A server that allows fewer emails per request gets smaller pages", async () => {
  let { account, inbox, queries } = newAccount(250);
  account.session.capabilities["urn:ietf:params:jmap:core"] = { maxObjectsInGet: 100 } as any;

  await inbox.listMessages();

  expect(queries.every(query => query.limit <= 100)).toBe(true);
  expect(inbox.messages.length).toBe(250);
});

test("A server with a lower limit than we asked for still gets all emails listed", async () => {
  let { inbox, queries } = newAccount(250, 100);

  await inbox.listMessages();

  expect(queries.map(query => query.position)).toEqual([0, 100, 200]);
  expect(inbox.messages.length).toBe(250);
});

/** A buggy or hostile server, which never ends the list */
function newEndlessAccount(samePage: boolean) {
  let { account, inbox, errors } = newAccount(0);
  let queries = 0;
  account.makeCalls = async (requests: [string, Record<string, any>, string?][]) => {
    queries++;
    let email = stalwartEMail(samePage ? 1 : queries);
    return [
      ["Email/query", { accountId: "h", queryState: "saq", canCalculateChanges: true, position: 0, ids: [email.id], limit: 1 }, "list"],
      ["Email/get", { accountId: "h", state: "saq", list: [email], notFound: [] }, "emails"],
    ] as TJMAPMethodResponse[];
  };
  return { inbox, errors, queries: () => queries };
}

test("Listing stops when the server returns the same page again", async () => {
  let { inbox, errors, queries } = newEndlessAccount(true);

  await inbox.listMessages();

  expect(queries()).toBe(2);
  expect(errors.length).toBe(1);
  expect(inbox.messages.length).toBe(1);
});

test("Listing stops after a maximum number of rounds, when the server always returns more", async () => {
  let { inbox, errors, queries } = newEndlessAccount(false);

  await inbox.listMessages();

  expect(queries()).toBe(1000000 / 500); // 1,000,000 emails in pages of 500
  expect(errors.length).toBe(1);
});

test("The listed emails are saved a page at a time, not one by one", async () => {
  let { account, inbox } = newAccount(450);
  let saves: number[] = [];
  account.storage.saveMessage = async () => { saves.push(1) };
  account.storage.saveMessages = async emails => { saves.push(emails.length) };

  await inbox.listMessages();

  expect(saves.reduce((sum, count) => sum + count)).toBe(450);
  expect(saves.length).toBeLessThanOrEqual(3); // one per page
});
