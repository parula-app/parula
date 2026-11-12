import { setupTestFolder, newTestEMail } from "./setup";
import { SQLEMail } from "../../../../logic/Mail/SQL/SQLEMail";
import { getDatabase } from "../../../../logic/Mail/SQL/SQLDatabase";
import { expect, test } from "vitest";
import sql from "../../../../../lib/rs-sqlite";

/** The save of the page would wait for the lock that it holds itself,
 * and all later saves would wait for it */
test("A page of the email list with the same email twice is saved", async () => {
  let { folder } = await setupTestFolder();
  let email = newTestEMail(folder);

  await SQLEMail.saveMultiple([email, email]);

  let rows = await (await getDatabase()).all(sql`
    SELECT
      id
    FROM email
    WHERE folderID = ${folder.dbID}
    `) as any[];
  expect(rows.length).toBe(1);
});
