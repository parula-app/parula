// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { getDatabase } from "../../../../logic/Contacts/SQL/SQLDatabase";
import { SQLGroup } from "../../../../logic/Contacts/SQL/SQLGroup";
import { SQLPerson } from "../../../../logic/Contacts/SQL/SQLPerson";
import { DummyAddressbookStorage } from "../../../../logic/Contacts/SQL/DummyAddressbookStorage";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, expect, test } from "vitest";
import sql from "../../../../../lib/rs-sqlite";

/** The addressbook that owns the group, e.g. an Exchange addressbook */
let serverAddressbookID: number;
/** The addressbook that owns the group member, e.g. the collected addressbook */
let collectedAddressbookID: number;
let personDBID: number;

beforeAll(async () => {
  let tempDir = mkdtempSync(path.join(tmpdir(), "group-members-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
  };

  let serverAddressbook = await createAddressbook("Server addressbook");
  let collectedAddressbook = await createAddressbook("Collected addressbook");
  serverAddressbookID = serverAddressbook.dbID;
  collectedAddressbookID = collectedAddressbook.dbID;

  // A distribution list on the server, with a member who is not a contact there
  let member = collectedAddressbook.newPerson();
  member.name = "Alice Example";
  await SQLPerson.save(member);
  personDBID = member.dbID;

  let group = serverAddressbook.newGroup();
  group.name = "Team";
  group.participants.add(member);
  await SQLGroup.save(group);
});

test("a group member from another addressbook is read into that addressbook", async () => {
  // Restart: the addressbooks are known, but nothing has been read from the DB yet
  let serverAddressbook = restoreAddressbook(serverAddressbookID);
  let collectedAddressbook = restoreAddressbook(collectedAddressbookID);
  appGlobal.addressbooks.replaceAll([serverAddressbook, collectedAddressbook]);

  await serverAddressbook.readContactsFromDB();

  let group = serverAddressbook.groups.first;
  expect(group?.name).toEqual("Team");
  expect(group.participants.length).toEqual(1);

  let member = group.participants.first;
  expect(member.dbID).toEqual(personDBID);
  expect(member.name).toEqual("Alice Example");
  expect(member.addressbook).toBe(collectedAddressbook);
  // The member must be the person of that addressbook, not a second copy of it
  expect(collectedAddressbook.persons.contents).toEqual([member]);
});

test("reading the other addressbook afterwards does not duplicate the member", async () => {
  let collectedAddressbook = appGlobal.addressbooks.find(ab => ab.dbID == collectedAddressbookID);

  await collectedAddressbook.readContactsFromDB();

  expect(collectedAddressbook.persons.length).toEqual(1);
  expect(collectedAddressbook.persons.first.dbID).toEqual(personDBID);
});

async function createAddressbook(name: string): Promise<Addressbook> {
  let addressbook = new Addressbook();
  addressbook.name = name;
  addressbook.storage = new DummyAddressbookStorage();
  let row = await (await getDatabase()).run(sql`
    INSERT INTO addressbook (idStr, protocol) VALUES (${addressbook.id}, ${"test"})`);
  addressbook.dbID = row.lastInsertRowid;
  return addressbook;
}

/** A fresh object for an addressbook that is already in the DB, as after an app restart */
function restoreAddressbook(dbID: number): Addressbook {
  let addressbook = new Addressbook();
  addressbook.storage = new DummyAddressbookStorage();
  addressbook.dbID = dbID;
  return addressbook;
}
