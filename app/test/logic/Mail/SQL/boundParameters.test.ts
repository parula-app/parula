import { setupTestFolder, newTestEMail } from "./setup";
import { SQLEMail } from "../../../../logic/Mail/SQL/SQLEMail";
import { getDatabase } from "../../../../logic/Mail/SQL/SQLDatabase";
import { getTagByName } from "../../../../logic/Abstract/Tag";
import { expect, test } from "vitest";

/** `execute()` can't bind parameters, so it quotes the values into the SQL text.
 * With bound parameters, a value can never run as SQL. */
test("Saving emails gives all values to SQLite as bound parameters", async () => {
  let { folder } = await setupTestFolder();
  let db = await getDatabase() as any;
  let quotedValues = 0;
  let execute = db.execute.bind(db);
  db.execute = (query: any) => {
    quotedValues += query.parameters.length;
    return execute(query);
  };
  let emails = [1, 2, 3].map(i => newTestEMail(folder, `bound${i}@example.com`));
  emails[0].tags.add(getTagByName("Work"));

  await SQLEMail.saveMultiple(emails);
  await SQLEMail.save(emails[1]);
  await SQLEMail.saveWritableProps(emails[0]);
  await SQLEMail.saveTags(emails[0]);

  expect(quotedValues).toBe(0);
});
