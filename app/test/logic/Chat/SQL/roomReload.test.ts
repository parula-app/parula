// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { ChatAccount } from "../../../../logic/Chat/ChatAccount";
import { SQLChatRoom } from "../../../../logic/Chat/SQL/SQLChatRoom";
import { getDatabase as getChatDatabase } from "../../../../logic/Chat/SQL/SQLDatabase";
import { getDatabase as getContactsDatabase } from "../../../../logic/Contacts/SQL/SQLDatabase";
import { SQLPerson } from "../../../../logic/Contacts/SQL/SQLPerson";
import { SQLGroup } from "../../../../logic/Contacts/SQL/SQLGroup";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { DummyAddressbookStorage } from "../../../../logic/Contacts/SQL/DummyAddressbookStorage";
import { Person, ContactEntry } from "../../../../logic/Abstract/Person";
import { ChatPersonUID } from "../../../../logic/Chat/ChatPersonUID";
import { Group } from "../../../../logic/Abstract/Group";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, expect, test } from "vitest";
import sql from "../../../../../lib/rs-sqlite";

const kAliceJID = "491761111111@s.whatsapp.net";
const kGroupJID = "12345-67890@g.us";

beforeAll(async () => {
  let tempDir = mkdtempSync(path.join(tmpdir(), "room-reload-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
  };
  // The chat and contacts databases lazily create + migrate themselves in the
  // fresh temp dir on first use (getDatabase()).
});

/** Reproduces the startup load-order race: chat rooms are read from SQL before
 * the addressbooks' contacts are loaded into memory. The rooms must still load
 * (their contact fetched from the DB), not be silently dropped. */
test("rooms whose contacts aren't in memory yet are loaded from the DB, not dropped", async () => {
  let addressbook = new Addressbook();
  addressbook.name = "Test addressbook";
  addressbook.storage = new DummyAddressbookStorage();
  let abRow = await (await getContactsDatabase()).run(sql`
    INSERT INTO addressbook (idStr, protocol) VALUES (${addressbook.id}, ${"test"})`);
  addressbook.dbID = abRow.lastInsertRowid;
  appGlobal.addressbooks.add(addressbook);
  appGlobal.personalAddressbook = addressbook;

  let alice = addressbook.newPerson();
  alice.name = "Alice Example";
  alice.chatAccounts.add(new ContactEntry(kAliceJID, "WhatsApp", "whatsapp"));
  addressbook.persons.add(alice);
  await SQLPerson.save(alice);

  let bob = addressbook.newPerson();
  bob.name = "Bob Example";
  addressbook.persons.add(bob);
  await SQLPerson.save(bob);

  let group = addressbook.newGroup();
  group.name = "Project Group";
  group.participants.add(bob);
  addressbook.groups.add(group);
  await SQLGroup.save(group);

  let account = new ChatAccount();
  account.name = "Test chat";
  let accRow = await (await getChatDatabase()).run(sql`
    INSERT INTO chatAccount (idStr, protocol) VALUES (${account.id}, ${account.protocol})`);
  account.dbID = accRow.lastInsertRowid;
  appGlobal.chatAccounts.add(account);

  let aliceContact = account.getPersonUID(kAliceJID, alice.name);
  aliceContact.person = alice;
  let dm = account.newRoom();
  dm.id = kAliceJID;
  dm.contact = aliceContact;
  dm.members.add(aliceContact);
  await SQLChatRoom.save(dm);

  let groupRoom = account.newRoom();
  groupRoom.id = kGroupJID;
  groupRoom.contact = group;
  await SQLChatRoom.save(groupRoom);

  // Simulate the race: rooms read before the addressbook's contacts are loaded.
  account.rooms.clear();
  addressbook.persons.clear();
  addressbook.groups.clear();
  expect(appGlobal.persons.length).toBe(0);

  await SQLChatRoom.readAll(account);

  // Both rooms came back, with their contacts loaded from the DB.
  expect(account.rooms.length).toBe(2);
  let dmLoaded = account.rooms.contents.find(room => room.id == kAliceJID)!;
  expect(dmLoaded).toBeDefined();
  expect(dmLoaded.contact).toBeInstanceOf(ChatPersonUID); // a 1:1's contact is its member
  expect(dmLoaded.contact.name).toBe("Alice Example");
  let groupLoaded = account.rooms.contents.find(room => room.id == kGroupJID)!;
  expect(groupLoaded).toBeDefined();
  expect(groupLoaded.contact).toBeInstanceOf(Group);
  expect(groupLoaded.name).toBe("Project Group");

  // The loaded group was registered back into the addressbook (so a later bulk
  // load dedups against it). A 1:1 contact is a chat-only ChatPersonUID, not an
  // address-book Person, so it is not re-added there.
  expect(addressbook.groups.some(g => g.dbID == group.dbID)).toBe(true);
});
