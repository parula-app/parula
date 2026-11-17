// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Person } from "../../../../logic/Abstract/Person";
import { DeleteStrategy, MailAccount } from "../../../../logic/Mail/MailAccount";
import { Folder, SpecialFolder } from "../../../../logic/Mail/Folder";
import { EMail } from "../../../../logic/Mail/EMail";
import { FilterRuleAction } from "../../../../logic/Mail/FilterRules/FilterRuleAction";
import { FilterMoment } from "../../../../logic/Mail/FilterRules/FilterMoments";
import { SQLMailStorage } from "../../../../logic/Mail/SQL/SQLMailStorage";
import { getDatabase } from "../../../../logic/Mail/SQL/SQLDatabase";
import { getTagByName, type Tag } from "../../../../logic/Abstract/Tag";
import { findOrCreatePersonUID } from "../../../../logic/Abstract/PersonUID";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { ArrayColl, type Collection } from "svelte-collections";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sql from "../../../../../lib/rs-sqlite";
import { expect, test } from "vitest";

appGlobal.me = new Person(); // as `startup.ts` does

test("The tags of a rule survive saving and reading the config", async () => {
  let account = await setupAccount();
  let rule = new FilterRuleAction(account);
  rule.name = "Newsletters";
  rule.addTags.add(getTagByName("Newsletter"));
  account.filterRuleActions.add(rule);

  let readAccount = await setupAccount();
  readAccount.fromConfigJSON(JSON.parse(JSON.stringify(account.toConfigJSON())));

  let readRule = readAccount.filterRuleActions.first;
  expect(readRule.name).toBe("Newsletters");
  expect(readRule.addTags.contents.map(tag => tag.name)).toEqual(["Newsletter"]);
});

test("The target folder of a rule survives saving and reading the config", async () => {
  let account = await setupAccount();
  let rule = new FilterRuleAction(account);
  rule.name = "Newsletters";
  rule.toFolder = account.findFolder(folder => folder.name == "Newsletters");
  account.filterRuleActions.add(rule);

  let readAccount = await setupAccount();
  readAccount.fromConfigJSON(JSON.parse(JSON.stringify(account.toConfigJSON())));

  let readRule = readAccount.filterRuleActions.first;
  expect(readRule.toFolder?.name).toBe("Newsletters");
});

test("A rule marks the mail as read and tags it, in the database", async () => {
  let account = await setupAccount();
  let rule = new FilterRuleAction(account);
  rule.markAsRead = true;
  rule.addTags.add(getTagByName("Newsletter"));
  account.filterRuleActions.add(rule);

  let email = newTestMail(account.inbox);
  await email.saveCompleteMessage();

  expect(account.serverActions.contents).toEqual(["read true", "tag Newsletter"]);
  expect((await storedMails(account)).map(row => row.isRead)).toEqual([1]);
  expect(await storedTags(account)).toEqual(["Newsletter"]);
});

test("A rule moves the mail out of the inbox, and it does not come back", async () => {
  let account = await setupAccount();
  let rule = new FilterRuleAction(account);
  rule.toFolder = account.findFolder(folder => folder.name == "Newsletters");
  account.filterRuleActions.add(rule);

  let email = newTestMail(account.inbox);
  await email.saveCompleteMessage();

  expect(account.serverActions.contents).toEqual(["move 1 mails to Newsletters"]);
  expect(account.inbox.messages.contents).toEqual([]);
  expect(await storedMails(account)).toEqual([]);
});

test("A rule copies the mail, and the original stays in the inbox", async () => {
  let account = await setupAccount();
  let rule = new FilterRuleAction(account);
  rule.toFolder = account.findFolder(folder => folder.name == "Newsletters");
  rule.copy = true;
  account.filterRuleActions.add(rule);

  let email = newTestMail(account.inbox);
  await email.saveCompleteMessage();

  expect(account.serverActions.contents).toEqual(["copy 1 mails to Newsletters"]);
  expect(account.inbox.messages.contents).toEqual([email]);
  expect((await storedMails(account)).map(row => row.downloadComplete)).toEqual([1]);
});

test("A delete rule deletes with the strategy that the rule asks for", async () => {
  let account = await setupAccount();
  let rule = new FilterRuleAction(account);
  rule.deleteImmediately = true;
  account.filterRuleActions.add(rule);

  await newTestMail(account.inbox).saveCompleteMessage();

  expect(account.serverActions.contents).toEqual(["delete DeleteImmediately"]);
});

test("Rules do not run on the mail in other folders", async () => {
  let account = await setupAccount();
  let rule = new FilterRuleAction(account);
  rule.markAsRead = true;
  account.filterRuleActions.add(rule);

  let email = newTestMail(account.findFolder(folder => folder.name == "Newsletters"));
  await email.saveCompleteMessage();

  expect(account.serverActions.contents).toEqual([]);
  expect((await storedMails(account)).map(row => row.isRead)).toEqual([0]);
});

test("A rule for mails that I send does not run on incoming mail", async () => {
  let account = await setupAccount();
  let rule = new FilterRuleAction(account);
  rule.when = FilterMoment.Outgoing;
  rule.markAsRead = true;
  account.filterRuleActions.add(rule);

  let email = newTestMail(account.inbox);
  await email.saveCompleteMessage();

  expect(account.serverActions.contents).toEqual([]);
  expect(email.isRead).toBe(false);
});

test("A rule for mails that I send runs on the mails in the Sent folder", async () => {
  let account = await setupAccount();
  let rule = new FilterRuleAction(account);
  rule.when = FilterMoment.Outgoing;
  rule.addTags.add(getTagByName("Sent by me"));
  account.filterRuleActions.add(rule);

  let email = newTestMail(account.findFolder(folder => folder.specialFolder == SpecialFolder.Sent));
  email.outgoing = true;
  await email.saveCompleteMessage();

  expect(account.serverActions.contents).toEqual(["tag Sent by me"]);
  expect(await storedTags(account)).toEqual(["Sent by me"]);
});

test("A rule that marks as not spam leaves the mail in the inbox, also without a spam folder", async () => {
  let account = await setupAccount();
  let rule = new FilterRuleAction(account);
  rule.markAsSpam = false;
  rule.markAsRead = true;
  account.filterRuleActions.add(rule);

  let email = newTestMail(account.inbox);
  await email.saveCompleteMessage();

  expect(account.serverActions.contents).toEqual(["read true"]);
  expect(account.inbox.messages.contents).toEqual([email]);
  expect((await storedMails(account)).map(row => row.downloadComplete)).toEqual([1]);
});

test("A rule whose criteria do not match leaves the mail alone", async () => {
  let account = await setupAccount();
  let rule = new FilterRuleAction(account);
  rule.criteria.bodyText = "invoice";
  rule.markAsRead = true;
  account.filterRuleActions.add(rule);

  let email = newTestMail(account.inbox);
  await email.saveCompleteMessage();

  expect(account.serverActions.contents).toEqual([]);
  expect((await storedMails(account)).map(row => row.isRead)).toEqual([0]);
});

test("A rule whose action fails does not stop the other rules", async () => {
  let account = await setupAccount();
  let errors = new ArrayColl<Error>();
  account.errorCallback = ex => errors.add(ex);
  let broken = new FilterRuleAction(account);
  broken.toFolderID = "folder that the user deleted on the server";
  account.filterRuleActions.add(broken);
  let rule = new FilterRuleAction(account);
  rule.addTags.add(getTagByName("Newsletter"));
  account.filterRuleActions.add(rule);

  let email = newTestMail(account.inbox);
  await email.saveCompleteMessage();

  expect(errors.length).toBe(1);
  expect(account.serverActions.contents).toEqual(["tag Newsletter"]);
  expect(await storedTags(account)).toEqual(["Newsletter"]);
  expect((await storedMails(account)).map(row => row.downloadComplete)).toEqual([1]);
});

/** Records what the filter actions did on the server,
 * because no real protocol is available in the test. */
class TestAccount extends MailAccount {
  readonly serverActions = new ArrayColl<string>();
  deleteStrategy: DeleteStrategy = DeleteStrategy.MoveToTrash;
  newFolder(): Folder {
    return new TestFolder(this);
  }
}

class TestFolder extends Folder {
  newEMail(): EMail {
    return new TestEMail(this);
  }
  protected async moveOrCopyMessagesOnServer(action: "move" | "copy", messages: Collection<EMail>) {
    (this.account as TestAccount).serverActions.add(`${action} ${messages.length} mails to ${this.name}`);
  }
}

class TestEMail extends EMail {
  protected get serverActions(): ArrayColl<string> {
    return (this.folder.account as TestAccount).serverActions;
  }
  async markRead(read = true) {
    await super.markRead(read);
    this.serverActions.add(`read ${read}`);
  }
  async addTagOnServer(tag: Tag) {
    this.serverActions.add(`tag ${tag.name}`);
  }
  async deleteMessageOnServer(strategy = (this.folder.account as TestAccount).deleteStrategy) {
    this.serverActions.add(`delete ${DeleteStrategy[strategy]}`);
  }
}

async function setupAccount(): Promise<TestAccount> {
  let tempDir = mkdtempSync(path.join(tmpdir(), "filter-rule-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
  };
  let account = new TestAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.storage = new SQLMailStorage();
  account.contentStorage.clear();
  let accountRow = await (await getDatabase()).run(sql`
    INSERT INTO emailAccount (idStr, protocol) VALUES (${account.id}, ${"imap"})`);
  account.dbID = accountRow.lastInsertRowid;
  await addFolder(account, "INBOX", SpecialFolder.Inbox);
  await addFolder(account, "Sent", SpecialFolder.Sent);
  await addFolder(account, "Newsletters");
  return account;
}

async function addFolder(account: TestAccount, name: string, specialFolder = SpecialFolder.Normal) {
  let folder = account.newFolder();
  folder.name = name;
  folder.id = name;
  folder.specialFolder = specialFolder;
  account.rootFolders.add(folder);
  await folder.save();
}

function newTestMail(folder: Folder): EMail {
  let email = folder.newEMail();
  email.id = "msg1@example.com";
  email.pID = "msg1@example.com";
  email.subject = "Test";
  email.sent = new Date("2026-07-14T10:00:00Z");
  email.received = new Date("2026-07-14T10:00:01Z");
  email.from = findOrCreatePersonUID("alice@example.com", "Alice");
  email.to.add(findOrCreatePersonUID("user@example.com", "User"));
  email.contact = email.from;
  email.text = "Hello";
  email.mime = new Uint8Array([1, 2, 3]);
  folder.messages.add(email);
  return email;
}

/** All tests share one database, so scope the reads to the account of the test. */
async function storedMails(account: TestAccount): Promise<any[]> {
  return await (await getDatabase()).all(sql`
    SELECT email.isRead, email.downloadComplete
    FROM email JOIN folder ON (folder.id = email.folderID)
    WHERE folder.accountID = ${account.dbID}`) as any[];
}

async function storedTags(account: TestAccount): Promise<string[]> {
  let rows = await (await getDatabase()).all(sql`
    SELECT emailTag.tagName
    FROM emailTag
      JOIN email ON (email.id = emailTag.emailID)
      JOIN folder ON (folder.id = email.folderID)
    WHERE folder.accountID = ${account.dbID}`) as any[];
  return rows.map(row => row.tagName);
}
