// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { setupTestFolder, newTestEMail, addTestAttachment } from "./setup";
import type { Folder } from "../../../../logic/Mail/Folder";
import { SQLEMail } from "../../../../logic/Mail/SQL/SQLEMail";
import { ContactEntry, Person } from "../../../../logic/Abstract/Person";
import { findOrCreatePersonUID } from "../../../../logic/Abstract/PersonUID";
import { SQLSearchEMail } from "../../../../logic/Mail/SQL/SQLSearchEMail";
import { beforeAll, expect, test } from "vitest";

let folder: Folder;

beforeAll(async () => {
  ({ folder } = await setupTestFolder());
});

test("Searching before the user set up a mail account finds nothing", async () => {
  expect(appGlobal.emailAccounts.isEmpty).toBe(true);
  let search = new SQLSearchEMail(); // as the Files pane does, to list the persons who sent us files
  search.hasAttachment = true;

  let emails = await search.startSearch();

  expect(emails.isEmpty).toBe(true);
});

test("Finds the emails of a person, ignoring case, with their recipients, attachments and text", async () => {
  let fromFred = newTestEMail(folder, "from-fred@example.com");
  fromFred.from = findOrCreatePersonUID("Fred@Example.com", "Fred");
  fromFred.text = "Hello from Fred";
  addTestAttachment(fromFred, "fred.pdf", "fred1");
  let toFred = newTestEMail(folder, "to-fred@example.com");
  toFred.to.add(findOrCreatePersonUID("fred@example.com", "Fred"));
  let other = newTestEMail(folder, "other@example.com");
  await SQLEMail.saveMultiple([fromFred, toFred, other]);
  let fred = new Person();
  fred.emailAddresses.add(new ContactEntry("fred@example.com", "work"));
  let search = new SQLSearchEMail();
  search.folder = folder;
  search.includesPerson = fred;

  let found = await search.startSearch();

  expect(found.contents.map(email => email.id).sort()).toEqual(["from-fred@example.com", "to-fred@example.com"]);
  let readFromFred = found.find(email => email.id == "from-fred@example.com");
  expect(readFromFred.from.emailAddress.toLowerCase()).toBe("fred@example.com");
  expect(readFromFred.to.contents.map(person => person.emailAddress)).toContain("user@example.com");
  expect(readFromFred.attachments.contents.map(a => a.filename)).toContain("fred.pdf");
  expect(readFromFred.text).toContain("Hello from Fred");
  let readToFred = found.find(email => email.id == "to-fred@example.com");
  expect(readToFred.to.contents.map(person => person.emailAddress)).toContain("fred@example.com");
});
