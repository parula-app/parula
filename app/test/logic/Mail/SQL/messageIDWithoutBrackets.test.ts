// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { setupTestFolder } from "./setup";
import { getDatabase } from "../../../../logic/Mail/SQL/SQLDatabase";
import { removeMessageIDBrackets } from "../../../../logic/Mail/SQL/SQLEMailMigrate";
import type { Folder } from "../../../../logic/Mail/Folder";
import sql from "../../../../../lib/rs-sqlite";
import { beforeAll, expect, test } from "vitest";

let folder: Folder;

beforeAll(async () => {
  ({ folder } = await setupTestFolder());
});

async function insertEMail(messageID: string, parentMsgID: string | null, threadID: string | null): Promise<number> {
  let insert = await (await getDatabase()).run(sql`
    INSERT INTO email (folderID, pID, messageID, parentMsgID, threadID, dateSent, dateReceived, subject)
    VALUES (${folder.dbID}, ${messageID}, ${messageID}, ${parentMsgID}, ${threadID}, 1, 1, ${"Test"})`);
  return insert.lastInsertRowid;
}

async function readIDs(dbID: number): Promise<any> {
  return await (await getDatabase()).get(sql`
    SELECT messageID, parentMsgID, threadID FROM email WHERE id = ${dbID}`);
}

test("The Message-IDs that IMAP, EWS etc. saved with <> are without them after the migration", async () => {
  let reply = await insertEMail("<reply@example.com>", "<original@example.com>", "<start@example.com>");
  let jmap = await insertEMail("jmap@example.com", "original@example.com", "T12345"); // JMAP: no <> and the server's thread ID
  let composed = await insertEMail("composed@example.com", "<original@example.com>", null); // a reply that we wrote to an IMAP mail

  await (await getDatabase()).execute(removeMessageIDBrackets);

  expect(await readIDs(reply)).toEqual({ messageID: "reply@example.com", parentMsgID: "original@example.com", threadID: "start@example.com" });
  expect(await readIDs(jmap)).toEqual({ messageID: "jmap@example.com", parentMsgID: "original@example.com", threadID: "T12345" });
  expect(await readIDs(composed)).toEqual({ messageID: "composed@example.com", parentMsgID: "original@example.com", threadID: null });
});
