// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { MailAccount } from "../../../logic/Mail/MailAccount";
import { SpecialFolder, type Folder } from "../../../logic/Mail/Folder";
import type { EMail } from "../../../logic/Mail/EMail";
import { SearchEMail } from "../../../logic/Mail/Store/SearchEMail";
import { CombinedSearchEMail } from "../../../logic/Mail/Store/CombinedSearchEMail";
import { QuickSearchEMail } from "../../../logic/Mail/Store/QuickSearchEMail";
import { IMAPSearchEMail } from "../../../logic/Mail/IMAP/IMAPSearchEMail";
import { JMAPSearchEMail } from "../../../logic/Mail/JMAP/JMAPSearchEMail";
import { ExchangeSearchEMail } from "../../../logic/Mail/EWS/ExchangeSearchEMail";
import { GraphSearchEMail } from "../../../logic/Mail/Graph/GraphSearchEMail";
import { EWSAccount } from "../../../logic/Mail/EWS/EWSAccount";
import { SQLEMail } from "../../../logic/Mail/SQL/SQLEMail";
import { getDatabase } from "../../../logic/Mail/SQL/SQLDatabase";
import { DummyMailStorage } from "../../../logic/Mail/Store/DummyMailStorage";
import { Person, ContactEntry } from "../../../logic/Abstract/Person";
import { getTagByName } from "../../../logic/Abstract/Tag";
import { findOrCreatePersonUID } from "../../../logic/Abstract/PersonUID";
import { Workspace } from "../../../logic/Abstract/Workspace";
import { errorsForServer } from "../../../logic/util/error";
import { notifications } from "../../../logic/util/Notification";
import { InProcessSQLiteDatabase } from "../util/inProcessSQLite";
import { ArrayColl } from "svelte-collections";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sql from "../../../../lib/rs-sqlite";
import { beforeEach, expect, test } from "vitest";

/** Stands in for e.g. `IMAPSearchEMail`, and returns what the server "found" */
class TestServerSearch extends SearchEMail {
  declare account: TestMailAccount;

  async startSearch(limit?: number): Promise<ArrayColl<EMail>> {
    if (this.account.serverError) {
      throw this.account.serverError;
    }
    return this.account.serverResults;
  }
}

class TestMailAccount extends MailAccount {
  readonly serverResults = new ArrayColl<EMail>();
  serverError: Error | null = null;

  newSearch(): TestServerSearch {
    return new TestServerSearch();
  }
}

test("The combined search merges the local database and the server results", async () => {
  let account = await setupAccount();
  let inbox = account.inbox;
  await SQLEMail.save(newTestEMail(inbox, "old", "Budget report", "2026-01-01"));
  await SQLEMail.save(newTestEMail(inbox, "both", "Budget meeting", "2026-02-01"));
  // The server finds the same email again, plus one that we never downloaded
  account.serverResults.add(newTestEMail(inbox, "both", "Budget meeting", "2026-02-01"));
  account.serverResults.add(newTestEMail(inbox, "new", "Budget draft", "2026-03-01"));

  let search = new CombinedSearchEMail();
  search.bodyText = "budget";
  let results = await search.startSearch();
  await search.finished;

  expect(results.contents.map(email => email.subject)).toEqual([
    "Budget draft", "Budget meeting", "Budget report"]);
});

test("The server results are filtered again, because the server ignores what it cannot express", async () => {
  let account = await setupAccount();
  let inbox = account.inbox;
  await SQLEMail.save(newTestEMail(inbox, "old", "Budget report", "2026-01-01"));
  account.serverResults.add(newTestEMail(inbox, "new", "Budget draft", "2026-03-01"));
  let alreadyRead = newTestEMail(inbox, "read", "Budget meeting", "2026-04-01");
  alreadyRead.isRead = true;
  account.serverResults.add(alreadyRead);

  let search = new CombinedSearchEMail();
  search.bodyText = "budget";
  search.isRead = false;
  let results = await search.startSearch();
  await search.finished;

  expect(results.contents.map(email => email.subject)).toEqual([
    "Budget draft", "Budget report"]);
});

test("A server result matches, even if we do not have the body that the server searched", async () => {
  let account = await setupAccount();
  // The subject does not contain the search term
  account.serverResults.add(newTestEMail(account.inbox, "new", "Lunch", "2026-03-01"));

  let search = new CombinedSearchEMail();
  search.bodyText = "budget";
  let results = await search.startSearch();
  await search.finished;

  expect(results.contents.map(email => email.subject)).toEqual(["Lunch"]);
});

test("The quick search ignores the case of the search term", async () => {
  let account = await setupAccount();
  account.inbox.messages.add(newTestEMail(account.inbox, "one", "Budget report", "2026-01-01"));
  account.inbox.messages.add(newTestEMail(account.inbox, "two", "Lunch", "2026-02-01"));

  let search = new QuickSearchEMail();
  search.folder = account.inbox;
  search.bodyText = "Budget";

  let results = await search.startSearch();

  expect(results.contents.map(email => email.subject)).toEqual(["Budget report"]);
});

test("The limit applies to the combined results", async () => {
  let account = await setupAccount();
  let inbox = account.inbox;
  await SQLEMail.save(newTestEMail(inbox, "old", "Budget report", "2026-01-01"));
  account.serverResults.add(newTestEMail(inbox, "new", "Budget draft", "2026-03-01"));

  let search = new CombinedSearchEMail();
  search.bodyText = "budget";
  let results = await search.startSearch(1);
  await search.finished;

  expect(results.contents.map(email => email.subject)).toEqual(["Budget draft"]);
});

test("A server search that fails still returns the database results", async () => {
  let account = await setupAccount();
  await SQLEMail.save(newTestEMail(account.inbox, "old", "Budget report", "2026-01-01"));
  account.serverError = new Error("Server is down");

  let search = new CombinedSearchEMail();
  search.bodyText = "budget";
  let results = await search.startSearch();
  await search.finished;

  expect(results.contents.map(email => email.subject)).toEqual(["Budget report"]);
  // A minor error: Development builds show it as warning, but it's not logged to the server
  expect(notifications.contents.map(notification => notification.ex)).toContain(account.serverError);
  expect(errorsForServer.contents).not.toContain(account.serverError);
});

test("A search leaves its own criteria alone", async () => {
  // Otherwise the search pane sees a change, searches again, and never stops
  let account = await setupAccount();
  await SQLEMail.save(newTestEMail(account.inbox, "old", "Budget report", "2026-01-01"));
  let search = new CombinedSearchEMail();
  search.bodyText = "budget";
  search.hasAttachmentMIMETypes.add("application/pdf"); // implies `hasAttachment`
  let criteria = JSON.stringify(search.toJSON());

  await search.startSearch();
  await search.finished;

  expect(JSON.stringify(search.toJSON())).toBe(criteria);
});

test("A workspace also restricts the local database search", async () => {
  let work = await setupAccount("Work");
  let home = await setupAccount("Home");
  appGlobal.emailAccounts.replaceAll([work, home]);
  work.workspace = new Workspace("Work", null, null);
  home.workspace = new Workspace("Home", null, null);
  await SQLEMail.save(newTestEMail(work.inbox, "w1", "Budget at work", "2026-01-01"));
  await SQLEMail.save(newTestEMail(home.inbox, "h1", "Budget at home", "2026-02-01"));

  let search = new CombinedSearchEMail();
  search.workspace = work.workspace;
  search.bodyText = "budget";
  let results = await search.startSearch();
  await search.finished;

  expect(results.contents.map(email => email.subject)).toEqual(["Budget at work"]);
});

test("EWS: A tag matches the whole category, not a part of it", async () => {
  let account = newTestEWSAccount();
  let search = account.newSearch();
  search.account = account;
  search.tags.add(getTagByName("Work"));

  await search.startSearch(10);

  expect(account.requests[0].m$FindItem.m$Restriction).toEqual({
    t$Contains: {
      ContainmentMode: "FullString", // "Work" must not find "Workshop"
      ContainmentComparison: "IgnoreCase",
      t$FieldURI: { FieldURI: "item:Categories" },
      t$Constant: { Value: "Work" },
    },
  });
});

test("EWS: Only the newest emails of all folders together are loaded", async () => {
  let account = newTestEWSAccount();
  // The server applies the limit to each folder separately, so each of them
  // returns its own newest emails, and most of them are not ours
  account.foundItems = [
    testEWSItem("inbox-new", "Inbox", "2026-04-01"),
    testEWSItem("inbox-mid", "Inbox", "2026-03-01"),
    testEWSItem("sent-old", "Sent", "2026-02-01"),
    testEWSItem("sent-older", "Sent", "2026-01-01"),
  ];

  await startEWSSearch(account, 2);

  expect(loadedItemIDs(account)).toEqual(["inbox-new", "inbox-mid"]);
});

test("EWS: An unsent draft has no date, and counts as new", async () => {
  let account = newTestEWSAccount();
  let drafts = account.newFolder();
  drafts.name = drafts.id = "Drafts";
  account.rootFolders.add(drafts);
  account.foundItems = [
    testEWSItem("inbox-old", "Inbox", "2026-01-01"),
    testEWSItem("inbox-new", "Inbox", "2026-04-01"),
    { ItemId: { Id: "draft" }, ParentFolderId: { Id: "Drafts" } },
  ];

  await startEWSSearch(account, 2);

  expect(loadedItemIDs(account)).toEqual(["inbox-new", "draft"]);
});

test("IMAP: The `or` groups nest, because each search key is allowed only once", () => {
  let search = new IMAPSearchEMail();
  search.bodyText = "budget";
  search.isRead = false;
  search.includesPerson = testPerson("alice@example.com");

  expect((search as any).imapQuery()).toEqual({
    seen: false,
    or: [{ subject: "budget" }, { body: "budget" }],
    not: {
      not: {
        or: [
          { from: "alice@example.com" },
          { to: "alice@example.com" },
          { cc: "alice@example.com" },
          { bcc: "alice@example.com" },
        ],
      },
    },
  });
});

test("JMAP: The criteria become filter conditions", () => {
  let search = new JMAPSearchEMail();
  search.bodyText = "budget";
  search.isRead = false;
  search.hasAttachment = true;
  search.tags.add(getTagByName("Work"));

  expect((search as any).filterConditions()).toEqual([
    { operator: "OR", conditions: [{ subject: "budget" }, { body: "budget" }] },
    { notKeyword: "$seen" },
    { hasKeyword: "Work" },
    { hasAttachment: true },
  ]);
});

test("IMAP and JMAP: The replies to an email are found by their `In-Reply-To:` header", () => {
  let imap = new IMAPSearchEMail();
  imap.inReplyTo = "<original@example.com>";
  expect((imap as any).imapQuery()).toEqual({
    header: { "in-reply-to": "<original@example.com>" },
  });

  let jmap = new JMAPSearchEMail();
  jmap.inReplyTo = "original@example.com";
  expect((jmap as any).filterConditions()).toEqual([
    { header: ["In-Reply-To", "original@example.com"] },
  ]);
});

test("Graph: The whole query is quoted once, so the text must not quote again", () => {
  // `$search="(subject:"x" OR body:"x")"` ends after `(subject:` and is a 400
  let search = new GraphSearchEMail();
  search.bodyText = 'say "hello: world"';
  search.hasAttachment = true;

  expect((search as any).searchQuery()).toBe(
    "(subject:say hello world OR body:say hello world) AND hasattachment:true");
});

test("Graph: A search term of only syntax characters is not a search", () => {
  let search = new GraphSearchEMail();
  search.bodyText = "((";

  expect((search as any).searchQuery()).toBeNull();
});

test("EWS: All folders are searched in a single request", async () => {
  let account = newTestEWSAccount();

  await startEWSSearch(account);

  expect(account.requests.length).toBe(1);
  expect(searchedFolderIDs(account)).toEqual(["Inbox", "Sent"]);
});

test("A criterion that is `undefined` instead of `null` is still no criterion", async () => {
  let account = newTestEWSAccount();
  let search = account.newSearch();
  search.account = account;
  search.bodyText = "budget";
  // The UI may hand over `undefined` (#1424)
  search.isOutgoing = undefined;
  search.isStarred = undefined;
  search.hasAttachment = undefined;

  await search.startSearch(10);

  expect(Object.keys(account.requests[0].m$FindItem.m$Restriction)).toEqual(["t$Or"]);
  expect(search.unsupportedFilters).toBe(false);

  let jmap = new JMAPSearchEMail();
  jmap.isStarred = undefined;
  jmap.hasAttachment = undefined;
  expect((jmap as any).filterConditions()).toEqual([]);

  let graph = new GraphSearchEMail();
  graph.isStarred = undefined;
  graph.hasAttachment = undefined;
  expect((graph as any).searchQuery()).toBeNull();
});

test("EWS: The criteria become a restriction", async () => {
  let account = newTestEWSAccount();
  let search = account.newSearch();
  search.account = account;
  search.bodyText = "budget";
  search.isRead = false;

  await search.startSearch(10);

  expect(account.requests[0].m$FindItem.m$Restriction).toEqual({
    t$And: {
      t$Or: {
        t$Contains: [{
          ContainmentMode: "Substring",
          ContainmentComparison: "IgnoreCase",
          t$FieldURI: { FieldURI: "item:Subject" },
          t$Constant: { Value: "budget" },
        }, {
          ContainmentMode: "Substring",
          ContainmentComparison: "IgnoreCase",
          t$FieldURI: { FieldURI: "item:Body" },
          t$Constant: { Value: "budget" },
        }],
      },
      t$IsEqualTo: {
        t$FieldURI: { FieldURI: "message:IsRead" },
        t$FieldURIOrConstant: { t$Constant: { Value: false } },
      },
    },
  });
});

test("Exchange: Criteria that a restriction cannot express are flagged", () => {
  let search = new ExchangeSearchEMail();
  search.bodyText = "budget";
  search.isReplied = true; // Exchange has no property for it

  let conditions = (search as any).conditions();

  expect(search.unsupportedFilters).toBe(true);
  expect(conditions.length).toBe(1);
});

let databaseDir: string;

beforeEach(async () => {
  // `getDatabase()` keeps the first database, so clean it instead
  if (databaseDir) {
    await (await getDatabase()).run(sql`DELETE FROM email`);
  }
});

async function setupAccount(name = "Test"): Promise<TestMailAccount> {
  if (!databaseDir) {
    databaseDir = mkdtempSync(path.join(tmpdir(), "server-search-test-"));
    appGlobal.remoteApp = {
      getSQLiteDatabase: (filename: string) =>
        new InProcessSQLiteDatabase(path.join(databaseDir, filename)),
    };
  }
  let account = new TestMailAccount();
  account.name = name;
  account.emailAddress = `${name}@example.com`;
  account.storage = new DummyMailStorage();
  let db = await getDatabase();
  let accountRow = await db.run(sql`
    INSERT INTO emailAccount (idStr, protocol) VALUES (${account.id}, ${"imap"})`);
  account.dbID = accountRow.lastInsertRowid;
  let folderRow = await db.run(sql`
    INSERT INTO folder (accountID, name, path)
    VALUES (${account.dbID}, ${"Inbox"}, ${"INBOX"})`);
  let inbox = account.newFolder();
  inbox.name = "Inbox";
  inbox.id = "INBOX";
  inbox.specialFolder = SpecialFolder.Inbox;
  inbox.dbID = folderRow.lastInsertRowid;
  account.rootFolders.add(inbox);
  appGlobal.emailAccounts.replaceAll([account]);
  return account;
}

function newTestEMail(folder: Folder, pID: string, subject: string, sentDate: string): EMail {
  let email = folder.newEMail();
  email.id = pID + "@example.com";
  email.pID = pID;
  email.subject = subject;
  email.sent = new Date(sentDate + "T10:00:00Z");
  email.received = email.sent;
  email.from = findOrCreatePersonUID("alice@example.com", "Alice");
  email.contact = email.from;
  return email;
}

/** Records the requests, and answers `FindItem` with `foundItems` */
class TestEWSAccount extends EWSAccount {
  readonly requests: any[] = [];
  foundItems: any[] = [];

  async callEWS(request: any): Promise<any> {
    this.requests.push(request);
    if (!request.m$FindItem) {
      return []; // `GetItem`: no headers
    }
    return this.getAllFolders().contents.map(folder => ({ // 1 response per folder
      RootFolder: {
        Items: {
          Message: this.foundItems.filter(item => item.ParentFolderId.Id == folder.id),
        },
      },
    }));
  }
}

function testEWSItem(itemID: string, folderID: string, sentDate: string) {
  return {
    ItemId: { Id: itemID },
    ParentFolderId: { Id: folderID },
    DateTimeSent: sentDate + "T10:00:00Z",
  };
}

function newTestEWSAccount(): TestEWSAccount {
  let account = new TestEWSAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.storage = new DummyMailStorage();
  for (let name of ["Inbox", "Sent"]) {
    let folder = account.newFolder();
    folder.name = folder.id = name;
    account.rootFolders.add(folder);
  }
  return account;
}

async function startEWSSearch(account: TestEWSAccount, limit = 10) {
  let search = account.newSearch();
  search.account = account;
  search.bodyText = "budget";
  await search.startSearch(limit);
}

function searchedFolderIDs(account: TestEWSAccount): string[] {
  return account.requests[0].m$FindItem.m$ParentFolderIds.t$FolderId
    .map(folder => folder.Id);
}

/** The IDs of the emails whose headers the search asked for, with `GetItem` */
function loadedItemIDs(account: TestEWSAccount): string[] {
  return account.requests
    .filter(request => request.m$GetItem)
    .flatMap(request => request.m$GetItem.m$ItemIds.t$ItemId.map(item => item.Id));
}

function testPerson(emailAddress: string): Person {
  let person = new Person();
  person.emailAddresses.add(new ContactEntry(emailAddress, "work"));
  return person;
}
