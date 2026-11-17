import { setupTestFolder, newTestEMail } from "./setup";
import type { Folder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { SQLEMail } from "../../../../logic/Mail/SQL/SQLEMail";
import { getDatabase } from "../../../../logic/Mail/SQL/SQLDatabase";
import { findOrCreatePersonUID, PersonUID } from "../../../../logic/Abstract/PersonUID";
import { beforeAll, expect, test } from "vitest";
import sql from "../../../../../lib/rs-sqlite";

let folder: Folder;

beforeAll(async () => {
  ({ folder } = await setupTestFolder());
});

function newEMailCCedTo(msgID: string, ccNumber: number): EMail {
  let email = newTestEMail(folder, msgID);
  email.cc.add(findOrCreatePersonUID(`cc${ccNumber}@example.com`, `CC ${ccNumber}`));
  return email;
}

test("Emails saved in parallel get their own recipients", async () => {
  // IMAP saves the list as a batch, the others save each downloaded msg
  let batch = [1, 2, 3, 4, 5].map(i => newEMailCCedTo(`batch${i}@example.com`, i));
  let single = [6, 7, 8].map(i => newEMailCCedTo(`single${i}@example.com`, i - 5));
  await Promise.all([
    SQLEMail.saveMultiple(batch),
    ...single.map(email => SQLEMail.save(email)),
  ]);

  let db = await getDatabase();
  for (let email of batch.concat(single)) {
    let rows = await db.all(sql`
      SELECT
        emailPerson.emailAddress as emailAddress
      FROM emailPersonRel
      LEFT JOIN emailPerson ON (emailPersonRel.emailPersonID = emailPerson.id)
      WHERE emailID = ${email.dbID}
      ORDER BY recipientType
      `) as any[];
    expect(rows.map(row => row.emailAddress)).toEqual(
      [email.from, ...email.to, ...email.cc].map(puid => puid.emailAddress));
  }
});

test("A sender without name is saved only once, not again for each email", async () => {
  // E.g. an email without `From:` header keeps the default `from`
  let first = newTestEMail(folder, "nameless1@example.com");
  first.from = new PersonUID("nameless@example.com");
  let second = newTestEMail(folder, "nameless2@example.com");
  second.from = new PersonUID("nameless@example.com");
  await SQLEMail.save(first);
  await SQLEMail.save(second);

  let rows = await (await getDatabase()).all(sql`
    SELECT
      id
    FROM emailPerson
    WHERE emailAddress = ${"nameless@example.com"}
    `) as any[];
  expect(rows.length).toBe(1);
});
