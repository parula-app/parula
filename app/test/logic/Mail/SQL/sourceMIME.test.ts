// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { setupTestFolder, newTestEMail } from "./setup";
import type { Folder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { SQLEMail } from "../../../../logic/Mail/SQL/SQLEMail";
import { SQLMailStorage } from "../../../../logic/Mail/SQL/SQLMailStorage";
import { SQLSourceEMail } from "../../../../logic/Mail/SQL/Source/SQLSourceEMail";
import { getDatabase } from "../../../../logic/Mail/SQL/SQLDatabase";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { beforeAll, expect, test } from "vitest";
import sql from "../../../../../lib/rs-sqlite";

let folder: Folder;

function testMIME(msgID: string): Uint8Array {
  return new TextEncoder().encode(`Message-ID: <${msgID}>\r\nSubject: Test\r\n\r\nHello`);
}

beforeAll(async () => {
  let tempDir: string;
  ({ folder, tempDir } = await setupTestFolder({
    getConfigDir: () => tempDir,
    path: path,
    fs: fsPromises,
  }));
  folder.account.storage = new SQLMailStorage();
});

async function newSavedEMail(msgID: string): Promise<EMail> {
  let email = newTestEMail(folder, msgID);
  email.text = "Hello";
  email.mime = testMIME(msgID);
  await SQLEMail.save(email);
  return email;
}

/** No FOREIGN KEY reaches into the backup database, so a deleted mail leaves
 * its MIME behind, for whoever gets its row ID next. */
test("A mail does not get the MIME of a deleted mail that had its row ID", async () => {
  let storage = new SQLSourceEMail();
  let gone = await newSavedEMail("gone@example.com");
  await storage.save(gone);
  let recycledID = gone.dbID;

  // As a folder delete cascades, without telling the backup DB
  let db = await getDatabase();
  await db.run(sql`DELETE FROM email WHERE id = ${recycledID}`);
  // Reuses row IDs, like a DB from before `AUTOINCREMENT`
  await db.run(sql`DELETE FROM sqlite_sequence WHERE name = 'email'`);

  let fresh = await newSavedEMail("fresh@example.com");
  expect(fresh.dbID).toBe(recycledID); // SQLite reuses the freed row ID
  fresh.mime = null;
  await storage.read(fresh);
  expect(fresh.mime).toBeFalsy();
});

test("A mail gets its own MIME back", async () => {
  let storage = new SQLSourceEMail();
  let email = await newSavedEMail("own@example.com");
  await storage.save(email);

  let reread = newTestEMail(folder, "own@example.com");
  reread.dbID = email.dbID;
  await storage.read(reread);
  expect(new TextDecoder().decode(reread.mime)).toBe(
    new TextDecoder().decode(testMIME("own@example.com")));
});
