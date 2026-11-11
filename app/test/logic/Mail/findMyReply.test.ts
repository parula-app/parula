// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { MailAccount } from "../../../logic/Mail/MailAccount";
import { SpecialFolder, type Folder } from "../../../logic/Mail/Folder";
import type { EMail } from "../../../logic/Mail/EMail";
import { SearchEMail } from "../../../logic/Mail/Store/SearchEMail";
import { SQLEMail } from "../../../logic/Mail/SQL/SQLEMail";
import { SQLSearchEMail } from "../../../logic/Mail/SQL/SQLSearchEMail";
import { getDatabase } from "../../../logic/Mail/SQL/SQLDatabase";
import { DummyMailStorage } from "../../../logic/Mail/Store/DummyMailStorage";
import { findOrCreatePersonUID } from "../../../logic/Abstract/PersonUID";
import { InProcessSQLiteDatabase } from "../util/inProcessSQLite";
import { ArrayColl } from "svelte-collections";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sql from "../../../../lib/rs-sqlite";
import { beforeEach, expect, test } from "vitest";

test("The reply in the Sent folder is found", async () => {
  let account = await setupAccount();
  let original = newIncomingEMail(account.inbox);
  let reply = newReply(original, sentFolder(account), "2026-03-02");
  sentFolder(account).messages.add(reply);

  expect(await original.findMyReply()).toBe(reply);
});

test("A reply that is only in the database is found, without loading the Sent folder", async () => {
  let account = await setupAccount();
  let original = newIncomingEMail(account.inbox);
  await SQLEMail.save(newReply(original, sentFolder(account), "2026-03-02", "reply1"));
  expect(sentFolder(account).messages.isEmpty).toBe(true);

  let found = await original.findMyReply();

  expect(found?.messageID).toBe("reply1@example.com");
  expect(found?.folder).toBe(sentFolder(account));
});

test("A reply that was filed in another folder is found", async () => {
  // Replies to emails in normal folders are saved in that folder, not in Sent
  let account = await setupAccount();
  let projects = folderNamed(account, "Projects");
  let original = newIncomingEMail(projects);
  await SQLEMail.save(newReply(original, projects, "2026-03-02", "reply1"));

  let found = await original.findMyReply();

  expect(found?.messageID).toBe("reply1@example.com");
  expect(found?.folder).toBe(projects);
});

test("Of several replies, the latest one is found", async () => {
  let account = await setupAccount();
  let original = newIncomingEMail(account.inbox);
  await SQLEMail.save(newReply(original, sentFolder(account), "2026-03-02", "first"));
  await SQLEMail.save(newReply(original, sentFolder(account), "2026-03-05", "latest"));
  await SQLEMail.save(newReply(original, sentFolder(account), "2026-03-03", "second"));

  let found = await original.findMyReply();

  expect(found?.messageID).toBe("latest@example.com");
});

test("The reply in the Sent folder wins over a copy in another folder", async () => {
  let account = await setupAccount();
  let original = newIncomingEMail(account.inbox);
  let copy = newReply(original, folderNamed(account, "Projects"), "2026-03-02", "reply1");
  folderNamed(account, "Projects").messages.add(copy);
  await SQLEMail.save(newReply(original, sentFolder(account), "2026-03-02", "reply1"));

  let found = await original.findMyReply();

  expect(found?.folder).toBe(sentFolder(account));
});

test("A reply that was just sent, and is only on the server, is found in the Sent folder", async () => {
  let account = await setupAccount();
  let original = newIncomingEMail(account.inbox);
  let reply = newReply(original, sentFolder(account), "2026-03-02");
  account.serverResults.add(reply);

  expect(await original.findMyReply()).toBe(reply);
  expect(account.searches.length).toBe(1);
  expect(account.searches[0].folder).toBe(sentFolder(account));
  expect(account.searches[0].inReplyTo).toBe(original.messageID);
});

test("The server is not asked when this computer has the reply", async () => {
  let account = await setupAccount();
  let original = newIncomingEMail(account.inbox);
  await SQLEMail.save(newReply(original, sentFolder(account), "2026-03-02"));

  await original.findMyReply();

  expect(account.searches.length).toBe(0);
});

test("A reply that somebody else wrote is not the user's reply", async () => {
  let account = await setupAccount();
  let original = newIncomingEMail(account.inbox);
  let theirReply = newIncomingEMail(account.inbox, "theirs");
  theirReply.inReplyTo = original.messageID;
  account.inbox.messages.add(theirReply);
  await SQLEMail.save(theirReply);

  expect(await original.findMyReply()).toBeNull();
});

test("A reply to another email is not found", async () => {
  let account = await setupAccount();
  let original = newIncomingEMail(account.inbox);
  let otherOriginal = newIncomingEMail(account.inbox, "unrelated");
  await SQLEMail.save(newReply(otherOriginal, sentFolder(account), "2026-03-02"));

  expect(await original.findMyReply()).toBeNull();
});

test("A reply in another account is not found", async () => {
  let account = await setupAccount("Work");
  let personal = await setupAccount("Personal", false);
  let original = newIncomingEMail(account.inbox);
  await SQLEMail.save(newReply(original, sentFolder(personal), "2026-03-02"));

  expect(await original.findMyReply()).toBeNull();
});

test("An email without a Message-ID has no reply", async () => {
  let account = await setupAccount();
  let original = newIncomingEMail(account.inbox);
  original.messageID = "";
  await SQLEMail.save(newReply(original, sentFolder(account), "2026-03-02"));

  expect(await original.findMyReply()).toBeNull();
});

test("The database search for replies reads only the replies", async () => {
  let account = await setupAccount();
  let original = newIncomingEMail(account.inbox);
  await SQLEMail.save(newReply(original, sentFolder(account), "2026-03-02", "reply1"));
  await SQLEMail.save(newReply(newIncomingEMail(account.inbox, "unrelated"), sentFolder(account), "2026-03-03", "reply2"));
  await SQLEMail.save(newIncomingEMail(account.inbox, "another"));

  let search = new SQLSearchEMail();
  search.account = account;
  search.inReplyTo = original.messageID;
  let found = await search.startSearch();

  expect(found.contents.map(email => email.messageID)).toEqual(["reply1@example.com"]);
});

/** Stands in for e.g. `IMAPSearchEMail`, and returns what the server "found" */
class TestServerSearch extends SearchEMail {
  declare account: TestMailAccount;

  async startSearch(limit?: number): Promise<ArrayColl<EMail>> {
    this.account.searches.push(this);
    return new ArrayColl(this.account.serverResults.contents);
  }
}

class TestMailAccount extends MailAccount {
  readonly serverResults = new ArrayColl<EMail>();
  readonly searches: SearchEMail[] = [];

  newSearch(): TestServerSearch {
    return new TestServerSearch();
  }
}

let databaseDir: string;

beforeEach(async () => {
  // `getDatabase()` keeps the first database, so clean it instead
  if (databaseDir) {
    await (await getDatabase()).run(sql`DELETE FROM email`);
  }
});

async function setupAccount(name = "Test", isOnlyAccount = true): Promise<TestMailAccount> {
  if (!databaseDir) {
    databaseDir = mkdtempSync(path.join(tmpdir(), "my-reply-test-"));
    appGlobal.remoteApp = {
      getSQLiteDatabase: (filename: string) =>
        new InProcessSQLiteDatabase(path.join(databaseDir, filename)),
    };
  }
  let account = new TestMailAccount();
  account.name = name;
  account.emailAddress = `${name.toLowerCase()}@example.com`;
  account.storage = new DummyMailStorage();
  let db = await getDatabase();
  let accountRow = await db.run(sql`
    INSERT INTO emailAccount (idStr, protocol) VALUES (${account.id}, ${"imap"})`);
  account.dbID = accountRow.lastInsertRowid;
  for (let [folderName, specialFolder] of [
    ["Inbox", SpecialFolder.Inbox],
    ["Sent", SpecialFolder.Sent],
    ["Projects", SpecialFolder.Normal],
  ]) {
    let folderRow = await db.run(sql`
      INSERT INTO folder (accountID, name, path)
      VALUES (${account.dbID}, ${folderName}, ${folderName})`);
    let folder = account.newFolder();
    folder.name = folder.id = folderName;
    folder.specialFolder = specialFolder as SpecialFolder;
    folder.dbID = folderRow.lastInsertRowid;
    account.rootFolders.add(folder);
  }
  if (isOnlyAccount) {
    appGlobal.emailAccounts.replaceAll([account]);
  } else {
    appGlobal.emailAccounts.add(account);
  }
  return account;
}

function folderNamed(account: MailAccount, name: string): Folder {
  return account.findFolder(folder => folder.name == name);
}

function sentFolder(account: MailAccount): Folder {
  return account.getSpecialFolder(SpecialFolder.Sent);
}

/** A mail from somebody else */
function newIncomingEMail(folder: Folder, id = "original"): EMail {
  let email = folder.newEMail();
  email.messageID = id + "@example.com";
  email.pID = id;
  email.subject = "Budget";
  email.sent = email.received = new Date("2026-03-01T10:00:00Z");
  email.from = findOrCreatePersonUID("alice@example.com", "Alice");
  email.contact = email.from;
  return email;
}

function newReply(original: EMail, folder: Folder, sentDate: string, id = "reply"): EMail {
  let reply = folder.newEMail();
  reply.messageID = id + "@example.com";
  reply.pID = id + "-" + folder.name;
  reply.inReplyTo = original.messageID;
  reply.subject = "Re: " + original.subject;
  reply.sent = reply.received = new Date(sentDate + "T10:00:00Z");
  reply.from = findOrCreatePersonUID(folder.account.emailAddress, "Me");
  reply.to.add(original.from);
  reply.outgoing = true;
  reply.contact = original.from;
  return reply;
}
