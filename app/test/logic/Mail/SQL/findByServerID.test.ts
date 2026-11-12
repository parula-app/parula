import { setupTestFolder } from "./setup";
import { getDatabase } from "../../../../logic/Mail/SQL/SQLDatabase";
import { expect, test } from "vitest";
import sql from "../../../../../lib/rs-sqlite";

/** Listing a folder looks up every new email this way. Reading the whole
 * folder each time made the listing of 30,000 emails take minutes. */
test("Finding an email by its server ID does not read the whole folder", async () => {
  let { folder } = await setupTestFolder();
  let db = await getDatabase();
  // The lookup in `SQLEMail.save()`
  let plan = await db.all(sql`
    EXPLAIN QUERY PLAN
    SELECT
      id
    FROM email
    WHERE
      messageID = ${"msg1@example.com"} AND
      pID = ${123} AND
      folderID = ${folder.dbID}
    `) as any[];
  expect(plan.map(row => row.detail).join("\n")).toContain("pID=?");
});
