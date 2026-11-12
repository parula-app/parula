import { setupTestFolder, newTestEMail } from "./setup";
import { SQLEMail } from "../../../../logic/Mail/SQL/SQLEMail";
import { getDatabase } from "../../../../logic/Mail/SQL/SQLDatabase";
import { expect, test } from "vitest";
import sql from "../../../../../lib/rs-sqlite";

/** IMAP and JMAP save each page of the email list this way */
test("An email that can't be saved doesn't stop the save of the other emails of the page", async () => {
  let { folder } = await setupTestFolder();
  let errors: Error[] = [];
  folder.account.errorCallback = ex => errors.push(ex);
  let emails = [1, 2, 3].map(i => newTestEMail(folder, `page${i}@example.com`));
  emails[1].downloadComplete = true; // without body, so `save()` throws

  await SQLEMail.saveMultiple(emails);

  expect(errors.length).toBe(1);
  let rows = await (await getDatabase()).all(sql`
    SELECT
      messageID
    FROM email
    WHERE folderID = ${folder.dbID}
    `) as any[];
  expect(rows.map(row => row.messageID).sort()).toEqual(["page1@example.com", "page3@example.com"]);
});
