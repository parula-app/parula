// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import type { EWSFolder } from "../../../../logic/Mail/EWS/EWSFolder";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { SQLMailStorage } from "../../../../logic/Mail/SQL/SQLMailStorage";
import { SQLSourceEMail } from "../../../../logic/Mail/SQL/Source/SQLSourceEMail";
import { getDatabase } from "../../../../logic/Mail/SQL/SQLDatabase";
import { FilterRuleAction } from "../../../../logic/Mail/FilterRules/FilterRuleAction";
import { Person } from "../../../../logic/Abstract/Person";
import { getTagByName } from "../../../../logic/Abstract/Tag";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { ensureArray } from "../../../../logic/util/util";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sql from "../../../../../lib/rs-sqlite";
import { expect, test } from "vitest";

appGlobal.me = new Person(); // as `startup.ts` does

const kSubject = "Invoice from ACME Newsletter";

/** An Exchange server with one new mail in the inbox.
 * Like Office365, it refuses to un-junk a mail that is not in the Junk folder. */
class TestEWSAccount extends EWSAccount {
  /** The EWS operations that the filter rules caused */
  readonly serverCalls: string[] = [];
  protected listedTheNewMail = false;

  async callEWS(request: any): Promise<any> {
    if (request.m$SyncFolderItems) {
      let created = this.listedTheNewMail ? [] : [{ Message: { ItemId: { Id: kItemID } } }];
      this.listedTheNewMail = true;
      return { SyncState: "sync-2", IncludesLastItemInRange: "true", Changes: { Create: created } };
    }
    if (request.m$GetItem) {
      let ids = ensureArray(request.m$GetItem.m$ItemIds.t$ItemId).map((item: any) => item.Id);
      if (!request.m$GetItem.m$ItemShape.t$IncludeMimeContent) {
        return { Items: { Message: headersOfMessage(ids[0]) } };
      }
      return { Items: { Message: { ItemId: { Id: ids[0] }, MimeContent: { Value: btoa(mimeOfMessage(ids[0])) } } } };
    }
    if (request.m$MarkAsJunk) {
      this.serverCalls.push("MarkAsJunk " + request.m$MarkAsJunk.IsJunk);
      throw new Error("This was deleted on the server");
    }
    if (request.m$UpdateItem) {
      this.serverCalls.push("UpdateItem");
      return { Items: { Message: { ItemId: { Id: kItemID } } } };
    }
    if (request.m$MoveItem) {
      this.serverCalls.push("MoveItem to " + request.m$MoveItem.m$ToFolderId.t$FolderId.Id);
      return { Items: { Message: { ItemId: { Id: kItemID } } } };
    }
    throw new Error("Unexpected EWS call " + JSON.stringify(request));
  }
}

const kItemID = "item-1";

function headersOfMessage(id: string) {
  return {
    ItemId: { Id: id },
    InternetMessageId: `<${id}@example.com>`,
    IsRead: "false",
    IsDraft: "false",
    Subject: kSubject,
    Size: "20000",
    DateTimeSent: new Date().toISOString(),
    DateTimeReceived: new Date().toISOString(),
    From: { Mailbox: { EmailAddress: "alice@example.com", Name: "Alice" } },
    ToRecipients: { Mailbox: { EmailAddress: "user@example.com", Name: "User" } },
  };
}

function mimeOfMessage(id: string): string {
  return [
    `Message-ID: <${id}@example.com>`,
    "From: Alice <alice@example.com>",
    "To: User <user@example.com>",
    `Subject: ${kSubject}`,
    "Date: Tue, 1 Sep 2026 10:00:00 +0000",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "The criterion appears only in the subject.",
  ].join("\r\n");
}

async function setupAccountWithNewMail(): Promise<TestEWSAccount> {
  let tempDir = mkdtempSync(path.join(tmpdir(), "ews-filter-rule-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
    getConfigDir: async () => tempDir,
    getFilesDir: async () => tempDir,
    path: { join: async (...parts: string[]) => path.join(...parts) },
    fs: { mkdir: async (dir: string) => mkdirSync(dir, { recursive: true }) },
  };
  let account = new TestEWSAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.storage = new SQLMailStorage();
  account.contentStorage.add(new SQLSourceEMail());
  let db = await getDatabase();
  let accountRow = await db.run(sql`
    INSERT INTO emailAccount (idStr, protocol) VALUES (${account.id}, ${account.protocol})`);
  account.dbID = accountRow.lastInsertRowid;
  let inbox = account.newFolder();
  inbox.name = "Inbox";
  inbox.id = "inbox-1";
  inbox.specialFolder = SpecialFolder.Inbox;
  inbox.syncState = "sync-1"; // we synced this folder before
  account.rootFolders.add(inbox);
  await inbox.save();
  let target = account.newFolder();
  target.name = "Newsletters";
  target.id = "newsletters-1";
  target.parent = inbox;
  inbox.subFolders.add(target);
  await target.save();
  return account;
}

/** The rules that the settings UI creates: picking an action also says
 * "this mail is not spam" @see `RuleActions.removeDelete()` */
function addRule(account: TestEWSAccount, configure: (rule: FilterRuleAction) => void) {
  let rule = new FilterRuleAction(account);
  rule.name = "Newsletters";
  rule.criteria.bodyText = "acme newsletter"; // the search field stores it lowercase
  rule.markAsSpam = false;
  configure(rule);
  account.filterRuleActions.add(rule);
}

test("A rule moves the new mail, although Exchange refuses to un-junk it", async () => {
  let account = await setupAccountWithNewMail();
  let inbox = account.inbox as EWSFolder;
  addRule(account, rule => rule.toFolder = account.findFolder(folder => folder.name == "Newsletters"));

  await inbox.getNewMessages();

  expect(account.serverCalls).toEqual(["MoveItem to newsletters-1"]);
  expect(inbox.messages.contents).toEqual([]);
});

test("A rule tags the new mail, although Exchange refuses to un-junk it", async () => {
  let account = await setupAccountWithNewMail();
  let inbox = account.inbox as EWSFolder;
  addRule(account, rule => rule.addTags.add(getTagByName("Newsletter")));

  await inbox.getNewMessages();

  expect(account.serverCalls).toEqual(["UpdateItem"]); // the categories, and no `MarkAsJunk`
  expect(inbox.messages.first.tags.contents.map(tag => tag.name)).toEqual(["Newsletter"]);
});
