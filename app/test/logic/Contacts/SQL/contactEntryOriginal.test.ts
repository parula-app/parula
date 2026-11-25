// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { ContactEntry } from "../../../../logic/Abstract/Person";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { getDatabase } from "../../../../logic/Contacts/SQL/SQLDatabase";
import { SQLPerson } from "../../../../logic/Contacts/SQL/SQLPerson";
import { DummyAddressbookStorage } from "../../../../logic/Contacts/SQL/DummyAddressbookStorage";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, expect, test } from "vitest";
import sql from "../../../../../lib/rs-sqlite";

let addressbook: Addressbook;

beforeAll(async () => {
  let tempDir = mkdtempSync(path.join(tmpdir(), "contact-entry-original-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
  };

  addressbook = new Addressbook();
  addressbook.name = "Test addressbook";
  addressbook.storage = new DummyAddressbookStorage();
  let abRow = await (await getDatabase()).run(sql`
    INSERT INTO addressbook (idStr, protocol) VALUES (${addressbook.id}, ${"test"})`);
  addressbook.dbID = abRow.lastInsertRowid;
});

test("The server's version of an entry survives the DB round-trip, next to the protocol data", async () => {
  let person = addressbook.newPerson();
  person.name = "Erika Mustermann";
  // Read from the server, then changed by the user
  let phone = new ContactEntry("+49 30 1234567", "work", "tel", 1);
  phone.json = { jmapID: "p1" };
  phone.original = phone.clone();
  phone.value = "+49 30 7654321";
  person.phoneNumbers.add(phone);
  // Read from the server, not changed
  let email = new ContactEntry("erika@example.com", "home", "mailto", 100);
  email.json = { jmapID: "e1" };
  email.original = email.clone();
  person.emailAddresses.add(email);
  await SQLPerson.save(person);

  let readPerson = await SQLPerson.read(person.dbID, addressbook.newPerson());
  let readPhone = readPerson.phoneNumbers.first;
  expect(readPhone.value).toEqual("+49 30 7654321");
  expect(readPhone.json).toEqual({ jmapID: "p1" });
  expect(readPhone.original.compare(phone.original)).toBe(true);
  expect(readPhone.compare(readPhone.original)).toBe(false);
  let readEmail = readPerson.emailAddresses.first;
  expect(readEmail.json).toEqual({ jmapID: "e1" });
  expect(readEmail.compare(readEmail.original)).toBe(true);
});

test("An entry that the user added has no server version after the DB round-trip", async () => {
  let person = addressbook.newPerson();
  person.name = "Max Mustermann";
  person.urls.add(new ContactEntry("https://example.com/max", "work"));
  await SQLPerson.save(person);

  let readPerson = await SQLPerson.read(person.dbID, addressbook.newPerson());
  let readURL = readPerson.urls.first;
  expect(readURL.value).toEqual("https://example.com/max");
  expect(readURL.original).toBeNull();
  expect(readURL.json ?? null).toBeNull();
});
