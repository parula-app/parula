// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { GraphAccount } from "../../../logic/Mail/Graph/GraphAccount";
import { JMAPAccount } from "../../../logic/Mail/JMAP/JMAPAccount";
import type { TGraphFolder } from "../../../logic/Mail/Graph/TGraphMail";
import type { TJMAPFolder } from "../../../logic/Mail/JMAP/TJMAPMail";
import type { MailAccount } from "../../../logic/Mail/MailAccount";
import { SQLMailStorage } from "../../../logic/Mail/SQL/SQLMailStorage";
import { SQLEMail } from "../../../logic/Mail/SQL/SQLEMail";
import { getDatabase } from "../../../logic/Mail/SQL/SQLDatabase";
import { newTestEMail } from "./SQL/setup";
import { InProcessSQLiteDatabase } from "../util/inProcessSQLite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sql from "../../../../lib/rs-sqlite";
import { expect, test } from "vitest";

/** The folder list that the server sends us. */
class TestGraphAccount extends GraphAccount {
  serverFolders: Partial<TGraphFolder>[] = [];
  async graphGetAll<T>(urlPath: string): Promise<T[]> {
    return (urlPath == "mailFolders" ? this.serverFolders : []) as T[];
  }
}

class TestJMAPAccount extends JMAPAccount {
  serverFolders: Partial<TJMAPFolder>[] = [];
  async makeSingleCall(method: string): Promise<Record<string, any>> {
    return { list: this.serverFolders };
  }
}

test("Graph: Listing the folders keeps the folders that we already stored", async () => {
  let account = await setupAccount(() => new TestGraphAccount());
  account.serverFolders = [
    { id: "inbox-1", displayName: "Inbox", wellKnownName: "inbox", totalItemCount: 1, unreadItemCount: 0 },
    { id: "sent-1", displayName: "Sent Items", wellKnownName: "sentitems", totalItemCount: 0, unreadItemCount: 0 },
  ];

  await account.listFolders();
  await expectFolderSyncIsStable(account);
});

test("JMAP: Listing the folders keeps the folders that we already stored", async () => {
  let account = await setupAccount(() => new TestJMAPAccount());
  account.serverFolders = [
    // A subfolder before its parent, which the server is allowed to do
    { id: "sub-1", name: "Old mail", parentId: "inbox-1", sortOrder: 1, totalEmails: 0, unreadEmails: 0 },
    { id: "inbox-1", name: "Inbox", role: "inbox", sortOrder: 0, totalEmails: 1, unreadEmails: 0 },
  ];

  await account.listFolders();
  await expectFolderSyncIsStable(account);
});

test("Deleting a folder also deletes its subfolders", async () => {
  let account = await setupAccount(() => new TestJMAPAccount());
  account.serverFolders = [
    { id: "inbox-1", name: "Inbox", role: "inbox", sortOrder: 0, totalEmails: 0, unreadEmails: 0 },
    { id: "sub-1", name: "Old mail", parentId: "inbox-1", sortOrder: 1, totalEmails: 0, unreadEmails: 0 },
  ];
  await account.listFolders();
  let inbox = account.findFolder(folder => folder.id == "inbox-1");
  let subFolder = account.findFolder(folder => folder.id == "sub-1");
  expect(subFolder.parent).toBe(inbox);
  await SQLEMail.save(newTestEMail(subFolder));
  let subFolderID = subFolder.dbID;

  await inbox.deleteItLocally();

  expect(account.getAllFolders().length).toBe(0);
  expect(subFolder.dbID).toBeNull();
  expect(await folderPaths(account)).toEqual([]);
  let db = await getDatabase();
  let mailRows = await db.all(sql`SELECT id FROM email WHERE folderID = ${subFolderID}`) as any[];
  expect(mailRows.length).toBe(0);
});

test("A folder that the server no longer lists is deleted locally", async () => {
  let account = await setupAccount(() => new TestJMAPAccount());
  account.serverFolders = [
    { id: "inbox-1", name: "Inbox", role: "inbox", sortOrder: 0, totalEmails: 0, unreadEmails: 0 },
    { id: "sent-1", name: "Sent", role: "sent", sortOrder: 1, totalEmails: 0, unreadEmails: 0 },
  ];
  await account.listFolders();
  await SQLEMail.save(newTestEMail(account.findFolder(folder => folder.id == "sent-1")));
  account.serverFolders.pop(); // The user deleted the folder in another mail app

  await account.listFolders();

  expect(account.getAllFolders().contents.map(folder => folder.id)).toEqual(["inbox-1"]);
  expect(await folderPaths(account)).toEqual(["inbox-1"]);
});

async function folderPaths(account: MailAccount): Promise<string[]> {
  let rows = await (await getDatabase()).all(sql`
    SELECT path FROM folder WHERE accountID = ${account.dbID}`) as any[];
  return rows.map(row => row.path).sort();
}

/** Saves a message, then lists the folders a second time, like we do on every
 * login. The folders, their DB IDs and the saved messages must survive that.
 * Otherwise, saving a message fails with "FOREIGN KEY constraint failed",
 * because the folder DB row that the message points to is gone. */
async function expectFolderSyncIsStable(account: MailAccount) {
  let folders = account.getAllFolders();
  expect(folders.length).toBe(2);
  let folder = folders.find(folder => folder.name == "Inbox");
  expect(folder.dbID).toBeTruthy();
  let dbIDs = folders.contents.map(folder => folder.dbID);
  await SQLEMail.save(newTestEMail(folder));

  await account.listFolders();

  let foldersAfter = account.getAllFolders();
  let replaced = foldersAfter.contents.filter(folder => !folders.contents.includes(folder));
  expect(replaced.map(folder => folder.name)).toEqual([]);
  expect(foldersAfter.length).toBe(folders.length);
  expect(folders.contents.map(folder => folder.dbID)).toEqual(dbIDs);
  let db = await getDatabase();
  let folderRows = await db.all(sql`SELECT id FROM folder WHERE accountID = ${account.dbID}`) as any[];
  expect(folderRows.map(row => row.id).sort()).toEqual(dbIDs.slice().sort());
  let mailRows = await db.all(sql`SELECT id FROM email WHERE folderID = ${folder.dbID}`) as any[];
  expect(mailRows.length).toBe(1);
}

async function setupAccount<T extends MailAccount>(newAccount: () => T): Promise<T> {
  let tempDir = mkdtempSync(path.join(tmpdir(), "folder-sync-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
    kyCreate: () => null,
  };
  let account = newAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.storage = new SQLMailStorage();
  let db = await getDatabase();
  let accountRow = await db.run(sql`
    INSERT INTO emailAccount (idStr, protocol) VALUES (${account.id}, ${account.protocol})`);
  account.dbID = accountRow.lastInsertRowid;
  return account;
}
