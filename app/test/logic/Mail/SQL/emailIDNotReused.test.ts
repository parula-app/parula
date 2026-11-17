// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { setupTestFolder, newTestEMail } from "./setup";
import type { Folder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { SQLEMail } from "../../../../logic/Mail/SQL/SQLEMail";
import { SQLMailStorage } from "../../../../logic/Mail/SQL/SQLMailStorage";
import { beforeAll, expect, test } from "vitest";

let folder: Folder;

beforeAll(async () => {
  ({ folder } = await setupTestFolder());
  folder.account.storage = new SQLMailStorage();
});

async function newSavedEMail(msgID: string): Promise<EMail> {
  let email = newTestEMail(folder, msgID);
  email.text = "Hello";
  await SQLEMail.save(email);
  return email;
}

/** The MIME source in the backup DB, the maildir files and the attachment files
 * are keyed by this ID, and no FOREIGN KEY reaches any of them. */
test("The row ID of a deleted mail is not given to the next mail", async () => {
  let first = await newSavedEMail("first@example.com");
  let firstID = first.dbID;
  await SQLEMail.deleteIt(first);

  let second = await newSavedEMail("second@example.com");
  expect(second.dbID).not.toBe(firstID);
});
