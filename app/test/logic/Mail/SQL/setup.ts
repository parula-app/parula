// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { Folder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { getDatabase } from "../../../../logic/Mail/SQL/SQLDatabase";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { encryptionProcessorsHookup } from "../../../../logic/Mail/Encryption/Processors";
import { findOrCreatePersonUID } from "../../../../logic/Abstract/PersonUID";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sql from "../../../../../lib/rs-sqlite";

/** Sets up an in-process test mail database in a temp dir,
 * with one mail account and one folder saved in it. */
export async function setupTestFolder(extraRemoteApp: any = {}): Promise<{ folder: Folder, tempDir: string }> {
  let tempDir = mkdtempSync(path.join(tmpdir(), "mail-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
    ...extraRemoteApp,
  };

  encryptionProcessorsHookup(); // as the app does on startup

  let account = new MailAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.storage = new DummyMailStorage();
  let folder = new Folder(account);
  folder.name = "INBOX";
  folder.id = "INBOX";
  let db = await getDatabase();
  let accountRow = await db.run(sql`
    INSERT INTO emailAccount (idStr, protocol) VALUES (${account.id}, ${"imap"})`);
  let folderRow = await db.run(sql`
    INSERT INTO folder (accountID, name, path) VALUES (${accountRow.lastInsertRowid}, ${"INBOX"}, ${"INBOX"})`);
  folder.dbID = folderRow.lastInsertRowid;
  return { folder, tempDir };
}

export function newTestEMail(folder: Folder, msgID = "msg1@example.com"): EMail {
  let email = folder.newEMail();
  email.id = msgID;
  email.pID = msgID;
  email.subject = "Test";
  email.sent = new Date("2026-07-14T10:00:00Z");
  email.received = new Date("2026-07-14T10:00:01Z");
  email.from = findOrCreatePersonUID("alice@example.com", "Alice");
  email.to.add(findOrCreatePersonUID("user@example.com", "User"));
  email.contact = email.from;
  return email;
}

export function addTestAttachment(email: EMail, filename: string, contentID: string, content?: Uint8Array) {
  let a = email.newAttachment();
  a.filename = filename;
  a.contentID = contentID;
  a.mimeType = "application/octet-stream";
  if (content) {
    a.content = new File([content as BlobPart], filename, { type: a.mimeType });
  }
  a.size = content ? content.length : 3;
  email.attachments.add(a);
  return a;
}
