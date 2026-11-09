import { appGlobal } from "../../../../logic/app";
import { IMAPAccount } from "../../../../logic/Mail/IMAP/IMAPAccount";
import type { IMAPFolder } from "../../../../logic/Mail/IMAP/IMAPFolder";
import type { IMAPEMail } from "../../../../logic/Mail/IMAP/IMAPEMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { SQLEMail } from "../../../../logic/Mail/SQL/SQLEMail";
import { getDatabase } from "../../../../logic/Mail/SQL/SQLDatabase";
import { findOrCreatePersonUID } from "../../../../logic/Abstract/PersonUID";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import sql from "../../../../../lib/rs-sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

const tempDir = mkdtempSync(path.join(tmpdir(), "imap-notjunk-test-"));

/**
 * A fake IMAP server that keeps the keywords of one email
 * @param keywords on the server
 */
function setUpEMail(keywords: string[]) {
  let onServer = new Set(keywords);
  /** All keywords that the app asked the server to remove */
  let removed = new Set<string>();
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
    getFilesDir: async () => tempDir,
    createIMAPFlowConnection: () => ({
      id: "test",
      on: () => undefined,
      connect: async () => undefined,
      getMailboxLock: async () => ({ release: () => undefined }),
      messageFlagsAdd: async (uid: number, flags: string[]) => {
        flags.forEach(flag => onServer.add(flag));
        return true;
      },
      messageFlagsRemove: async (uid: number, flags: string[]) => {
        for (let flag of flags) {
          removed.add(flag);
          for (let kept of onServer) {
            if (kept.toLowerCase() == flag.toLowerCase()) {
              onServer.delete(kept);
            }
          }
        }
        return true;
      },
    }),
  } as any;
  let account = new IMAPAccount();
  account.id = crypto.randomUUID(); // unique in the database of this test file
  account.hostname = "imap.example.com";
  account.username = "me@example.com";
  account.password = "secret";
  account.storage = new DummyMailStorage();
  let folder = account.newFolder() as IMAPFolder;
  folder.path = "Junk";
  account.rootFolders.add(folder);
  let email = folder.newEMail() as IMAPEMail;
  email.uid = 42;
  email.id = "notjunk@example.com";
  email.subject = "Test";
  email.sent = new Date("2026-11-04T10:00:00Z");
  email.received = new Date("2026-11-04T10:00:01Z");
  email.from = findOrCreatePersonUID("alice@example.com", "Alice");
  email.contact = email.from;
  folder.messages.add(email);
  email.setFlagsLocal(new Set(keywords));
  return { email, onServer, removed };
}

/**
 * Saves the email in the local database, as the app does after it fetched the email from the server.
 * Then reads it back from the database into a new folder object, as the app does after a restart,
 * without fetching the flags from the server again.
 */
async function restartApp(email: IMAPEMail): Promise<IMAPEMail> {
  let db = await getDatabase();
  let folder = email.folder;
  let accountRow = await db.run(sql`
    INSERT INTO emailAccount (idStr, protocol) VALUES (${folder.account.id}, ${"imap"})`);
  let folderRow = await db.run(sql`
    INSERT INTO folder (accountID, name, path) VALUES (${accountRow.lastInsertRowid}, ${"Junk"}, ${"Junk"})`);
  folder.dbID = folderRow.lastInsertRowid;
  await SQLEMail.save(email);

  let restartedFolder = folder.account.newFolder() as IMAPFolder;
  restartedFolder.path = folder.path;
  restartedFolder.dbID = folder.dbID;
  folder.account.rootFolders.add(restartedFolder);
  await SQLEMail.readAllMainProperties(restartedFolder);
  expect(restartedFolder.messages.length).toBe(1);
  return restartedFolder.messages.first as IMAPEMail;
}

// IANA "IMAP and JMAP Keywords" registry (RFC 5788): `$Junk` and `$NotJunk` are mutually exclusive.
// Keywords are case-insensitive.
function has(onServer: Set<string>, keyword: string): boolean {
  return [...onServer].some(flag => flag.toLowerCase() == keyword.toLowerCase());
}

test("Marking an email as not spam tells the server's spam filter", async () => {
  let { email, onServer } = setUpEMail(["$Junk"]);

  await email.markSpam(false);

  expect(has(onServer, "$NotJunk")).toBe(true);
  expect(has(onServer, "$Junk")).toBe(false);
});

test("Marking an email as spam removes an earlier not spam", async () => {
  let { email, onServer } = setUpEMail(["$NotJunk"]);

  await email.markSpam(true);

  expect(has(onServer, "$Junk")).toBe(true);
  expect(has(onServer, "$NotJunk")).toBe(false);
});

test("Marking an email as not spam that has neither keyword only adds $NotJunk", async () => {
  let { email, onServer, removed } = setUpEMail([]);

  await email.markSpam(false);

  expect(has(onServer, "$NotJunk")).toBe(true);
  expect(has(onServer, "$Junk")).toBe(false);
  expect(removed.size).toBe(0);
});

test("Marking an email as spam that has neither keyword only adds $Junk", async () => {
  let { email, onServer, removed } = setUpEMail([]);

  await email.markSpam(true);

  expect(has(onServer, "$Junk")).toBe(true);
  expect(has(onServer, "$NotJunk")).toBe(false);
  expect(removed.size).toBe(0);
});

test("Marking an email as not spam removes $Junk, when the app knows the email only from its database", async () => {
  let { email, onServer } = setUpEMail(["$Junk"]);
  email = await restartApp(email);

  await email.markSpam(false);

  expect(has(onServer, "$NotJunk")).toBe(true);
  expect(has(onServer, "$Junk")).toBe(false);
});

test("Marking an email as spam removes $NotJunk, when the app knows the email only from its database", async () => {
  let { email, onServer } = setUpEMail(["$NotJunk"]);
  email = await restartApp(email);

  await email.markSpam(true);

  expect(has(onServer, "$Junk")).toBe(true);
  expect(has(onServer, "$NotJunk")).toBe(false);
});

test("Marking an email as spam that has neither keyword only adds $Junk, when the app knows the email only from its database", async () => {
  let { email, onServer, removed } = setUpEMail([]);
  email = await restartApp(email);

  await email.markSpam(true);

  expect(has(onServer, "$Junk")).toBe(true);
  expect(has(onServer, "$NotJunk")).toBe(false);
  expect(removed.size).toBe(0);
});

test("Marking an email as spam removes the $NotJunk that the user set before a restart", async () => {
  let { email, onServer } = setUpEMail(["$Junk"]);
  await email.markSpam(false);
  email = await restartApp(email);

  await email.markSpam(true);

  expect(has(onServer, "$Junk")).toBe(true);
  expect(has(onServer, "$NotJunk")).toBe(false);
});

test("Marking an email as not spam and then as spam again leaves only $Junk", async () => {
  let { email, onServer } = setUpEMail(["$Junk"]);

  await email.markSpam(false);
  await email.markSpam(true);

  expect(has(onServer, "$Junk")).toBe(true);
  expect(has(onServer, "$NotJunk")).toBe(false);
});

// RFC 9051 section 9: keywords are case-insensitive, and a server may report them in any case
test("Marking an email as not spam removes $Junk, when the server reports it in lowercase", async () => {
  let { email, onServer } = setUpEMail(["$junk"]);

  await email.markSpam(false);

  expect(has(onServer, "$NotJunk")).toBe(true);
  expect(has(onServer, "$Junk")).toBe(false);
});

test("Marking an email as spam removes $NotJunk, when the server reports it in lowercase", async () => {
  let { email, onServer } = setUpEMail(["$notjunk"]);

  await email.markSpam(true);

  expect(has(onServer, "$Junk")).toBe(true);
  expect(has(onServer, "$NotJunk")).toBe(false);
});
