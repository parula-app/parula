import { setupTestFolder, newTestEMail } from "./setup";
import { SQLEMail } from "../../../../logic/Mail/SQL/SQLEMail";
import { getDatabase } from "../../../../logic/Mail/SQL/SQLDatabase";
import { expect, test } from "vitest";
import sql from "../../../../../lib/rs-sqlite";

/** Listing a folder looks up every new email this way. Reading the whole
 * folder each time made the listing of 30,000 emails take minutes. */
test("Finding an email by its server ID does not read the whole folder", async () => {
  let { folder } = await setupTestFolder();
  let db = await getDatabase();
  // The lookup in `SQLEMail.saveMainProps()`
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

test("An email that is already saved, e.g. by another listing, is updated, not added again", async () => {
  let { folder } = await setupTestFolder();
  let first = newTestEMail(folder, "twice@example.com");
  await SQLEMail.save(first);
  let second = newTestEMail(folder, "twice@example.com");
  second.subject = "Changed";

  await SQLEMail.save(second);

  expect(second.dbID).toBe(first.dbID);
  let rows = await (await getDatabase()).all(sql`
    SELECT
      subject
    FROM email
    WHERE folderID = ${folder.dbID}
    `) as any[];
  expect(rows.map(row => row.subject)).toEqual(["Changed"]);
});
