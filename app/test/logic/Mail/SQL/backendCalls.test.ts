import { setupTestFolder, newTestEMail } from "./setup";
import type { Folder } from "../../../../logic/Mail/Folder";
import { SQLEMail } from "../../../../logic/Mail/SQL/SQLEMail";
import { SQLSearchEMail } from "../../../../logic/Mail/SQL/SQLSearchEMail";
import { ContactEntry, Person } from "../../../../logic/Abstract/Person";
import { getDatabase } from "../../../../logic/Mail/SQL/SQLDatabase";
import { findOrCreatePersonUID } from "../../../../logic/Abstract/PersonUID";
import { beforeAll, expect, test } from "vitest";

/** Each database call goes from the window to the backend process.
 * With one call per SQL statement, listing 30,000 emails took more than a minute. */
let folder: Folder;
let calls = 0;

beforeAll(async () => {
  ({ folder } = await setupTestFolder());
  let db = await getDatabase() as any;
  for (let method of ["run", "runMultiple", "get", "all", "execute"]) {
    let original = db[method].bind(db);
    db[method] = (...args: any[]) => {
      calls++;
      return original(...args);
    };
  }
});

function newEMails(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => {
    let email = newTestEMail(folder, `${prefix}${i}@example.com`);
    email.cc.add(findOrCreatePersonUID(`cc${i}@example.com`, `CC ${i}`));
    return email;
  });
}

test("Saving a page of the email list makes about one call to the backend per email", async () => {
  let emails = newEMails("page", 100);
  calls = 0;

  await SQLEMail.saveMultiple(emails);

  expect(calls).toBeLessThan(2 * emails.length);
});

test("Saving one email makes a few calls to the backend, not one per recipient", async () => {
  let [email] = newEMails("single", 1);
  for (let i = 0; i < 20; i++) {
    email.to.add(findOrCreatePersonUID(`to${i}@example.com`, `To ${i}`));
  }
  calls = 0;

  await SQLEMail.save(email);

  expect(calls).toBeLessThan(5);
});

test("Searching emails makes a few calls to the backend, not some per email found", async () => {
  let emails = newEMails("search", 50);
  for (let email of emails) {
    email.from = findOrCreatePersonUID("fred@example.com", "Fred");
  }
  await SQLEMail.saveMultiple(emails);
  let fred = new Person();
  fred.emailAddresses.add(new ContactEntry("fred@example.com", "work"));
  let search = new SQLSearchEMail(); // as the contact history does
  search.folder = folder;
  search.includesPerson = fred;
  calls = 0;

  let found = await search.startSearch();

  expect(found.length).toBe(emails.length);
  expect(calls).toBeLessThan(10);
});
