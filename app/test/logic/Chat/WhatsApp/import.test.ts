// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { WhatsAppAccount } from "../../../../logic/Chat/WhatsApp/WhatsAppAccount";
import { WhatsAppBackupImport, normalizePhoneNumber, phoneNumbersMatch } from "../../../../logic/Chat/WhatsApp/Import/ImportBackup";
import { JID } from "../../../../logic/Chat/WhatsApp/Binary/JID";
import { SQLChatStorage } from "../../../../logic/Chat/SQL/SQLChatStorage";
import { makeTestDatabase, getDatabase } from "../../../../logic/Chat/SQL/SQLDatabase";
import { SQLPerson } from "../../../../logic/Contacts/SQL/SQLPerson";
import { SQLGroup } from "../../../../logic/Contacts/SQL/SQLGroup";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { DummyAddressbookStorage } from "../../../../logic/Contacts/SQL/DummyAddressbookStorage";
import { ContactEntry, Person } from "../../../../logic/Abstract/Person";
import { ChatPersonUID } from "../../../../logic/Chat/ChatPersonUID";
import { Group } from "../../../../logic/Abstract/Group";
import sql from "../../../../../lib/rs-sqlite";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, expect, test } from "vitest";

const kAliceJID = "491761111111@s.whatsapp.net";
const kBobJID = "491762222222@s.whatsapp.net";
const kGroupJID = "12345-67890@g.us";

let addressbook: Addressbook;

beforeAll(async () => {
  // Run the backend's SQLite factory in-process, instead of via JPC
  let tempDir = mkdtempSync(path.join(tmpdir(), "whatsapp-import-test-"));
  let backupCount = 0;
  appGlobal.remoteApp = {
    getSQLiteDatabase(filename: string, options?: any, buffer?: Uint8Array) {
      if (buffer) {
        // node:sqlite opens only files, so write the backup image to disk first
        filename = `backup-${++backupCount}.db`;
        writeFileSync(path.join(tempDir, filename), buffer);
      }
      return new InProcessSQLiteDatabase(path.join(tempDir, filename));
    },
  };
  await makeTestDatabase();

  // Contacts are not part of this test, so don't save them to contacts.db
  let personDbID = 0;
  let groupDbID = 0;
  SQLPerson.save = async (person: Person) => { person.dbID ??= ++personDbID; };
  SQLGroup.save = async (group: Group) => { group.dbID ??= ++groupDbID; };

  addressbook = new Addressbook();
  addressbook.name = "Test addressbook";
  addressbook.storage = new DummyAddressbookStorage();
  addressbook.dbID = 1;
  appGlobal.addressbooks.add(addressbook);
  appGlobal.personalAddressbook = addressbook;
});

test("Import WhatsApp backup, then import again without duplicates", { timeout: 30000 }, async () => {
  // An existing contact with Bob's phone number in national format.
  // The import should not create a duplicate for him.
  let bob = addressbook.newPerson();
  bob.name = "Bob Existing";
  bob.phoneNumbers.add(new ContactEntry("0176 2222222", "mobile", "tel"));
  addressbook.persons.add(bob);

  let account = new WhatsAppAccount();
  account.name = "WhatsApp";
  account.storage = new SQLChatStorage();
  account.deviceJID = JID.parse("412300000000:1@s.whatsapp.net");
  appGlobal.chatAccounts.add(account);

  let msgstore = makeMsgstore();
  let waDB = makeWADB();

  // First import
  let result = await new WhatsAppBackupImport(account).importBackup(msgstore, waDB);
  expect(result.newMessages).toBe(8);
  expect(result.knownMessages).toBe(0);
  expect(result.messagesTotal).toBe(8);
  expect(result.messagesDone).toBe(8);
  expect(account.rooms.length).toBe(2); // status@broadcast and empty chat skipped

  // 1:1 chat
  let aliceRoom = account.rooms.contents.find(r => r.id == kAliceJID)!;
  expect(aliceRoom).toBeDefined();
  let aliceContact = aliceRoom.contact as ChatPersonUID;
  expect(aliceContact).toBeInstanceOf(ChatPersonUID);
  let alice = aliceContact.person!; // the import links the chat contact to an address book Person
  expect(alice.name).toBe("Alice Test"); // from wa.db
  expect(alice.chatAccounts.some(e => e.protocol == "whatsapp" && e.value == kAliceJID)).toBe(true);
  expect(alice.phoneNumbers.some(e => e.value == "+491761111111")).toBe(true);
  expect(aliceRoom.messages.length).toBe(6);
  let hello = aliceRoom.messages.contents.find(m => m.text == "Hello")!;
  expect(hello).toBeDefined();
  expect(hello.outgoing).toBe(false);
  expect(aliceRoom.messages.contents.find(m => m.text == "Hi back")!.outgoing).toBe(true);
  // Media message: caption + attachment metadata
  let media = aliceRoom.messages.contents.find(m => m.text == "Look at this")!;
  expect(media.attachments.first.filename).toBe("IMG-1.jpg");
  expect(media.attachments.first.mimeType).toBe("image/jpeg");
  expect(media.attachments.first.size).toBe(12345);
  // Revoked message becomes a placeholder
  expect(aliceRoom.messages.contents.some(m => m.text == "This message was deleted")).toBe(true);
  // Reply
  let reply = aliceRoom.messages.contents.find(m => m.text == "Reply to hello")!;
  expect(reply.inReplyTo).toBe(hello.id);
  // Location
  expect(aliceRoom.messages.contents.some(m => m.text.includes("openstreetmap.org"))).toBe(true);
  // Reaction in a 1:1 chat comes from the chat partner
  expect(hello.reactions.get(aliceContact as any)).toBe("❤️");

  // Group chat
  let groupRoom = account.rooms.contents.find(r => r.id == kGroupJID)!;
  expect(groupRoom.name).toBe("Test Group");
  expect(groupRoom.contact).toBeInstanceOf(Group);
  let group = groupRoom.contact as Group;
  expect(group.participants.length).toBe(2);
  expect(group.participants.contents).toContain(bob); // matched by phone number
  expect(bob.chatAccounts.some(e => e.protocol == "whatsapp" && e.value == kBobJID)).toBe(true);
  // Sender was a @lid alias JID, resolved to Bob's phone number JID
  let groupMsg = groupRoom.messages.contents.find(m => m.text == "Group hello")!;
  expect((groupMsg.contact as ChatPersonUID).person).toBe(bob);
  expect(groupMsg.reactions.get(aliceContact as any)).toBe("👍");

  // No duplicate persons created, and no contact for the empty chat
  expect(addressbook.persons.contents.filter(p => p.name == "Bob Existing").length).toBe(1);
  expect(addressbook.persons.length).toBe(2); // Alice + Bob

  // Second import of the same backup: empty run
  let result2 = await new WhatsAppBackupImport(account).importBackup(msgstore, waDB);
  expect(result2.newMessages).toBe(0);
  expect(result2.knownMessages).toBe(8);
  expect(result2.messagesDone).toBe(8);
  expect(account.rooms.length).toBe(2);
  expect(addressbook.persons.length).toBe(2);
  let messageCount = await (await getDatabase()).get(sql`SELECT COUNT(*) AS count FROM message`) as any;
  expect(messageCount.count).toBe(8);

  // Import a newer backup with one additional message
  let newerMsgstore = makeMsgstore(true);
  let result3 = await new WhatsAppBackupImport(account).importBackup(newerMsgstore, waDB);
  expect(result3.newMessages).toBe(1);
  expect(result3.knownMessages).toBe(8);
  expect(aliceRoom.messages.contents.some(m => m.text == "Newer backup message")).toBe(true);

  // Reload everything from the local database, like after a restart
  account.rooms.clear();
  await account.readFromDB();
  expect(account.rooms.length).toBe(2);
  let aliceRoom2 = account.rooms.contents.find(r => r.id == kAliceJID)!;
  expect((aliceRoom2.contact as ChatPersonUID).person).toBe(alice);
  await aliceRoom2.listMessages();
  expect(aliceRoom2.messages.length).toBe(7);
  let media2 = aliceRoom2.messages.contents.find(m => m.text == "Look at this")!;
  expect(media2.attachments.first?.filename).toBe("IMG-1.jpg");
  let groupRoom2 = account.rooms.contents.find(r => r.id == kGroupJID)!;
  expect(groupRoom2.contact).toBe(group);
  await groupRoom2.listMessages();
  let groupMsg2 = groupRoom2.messages.contents.find(m => m.text == "Group hello")!;
  expect((groupMsg2.contact as ChatPersonUID).person).toBe(bob);
});

test("Phone number matching", () => {
  expect(normalizePhoneNumber("+49 176 333-4444")).toBe("491763334444");
  expect(normalizePhoneNumber("0049 176 3334444")).toBe("491763334444");
  expect(phoneNumbersMatch("+491763334444", "+49 176 3334444")).toBe(true);
  expect(phoneNumbersMatch("0176 3334444", "+491763334444")).toBe(true);
  expect(phoneNumbersMatch("0176 3334444", "+441763334444")).toBe(true); // country unknown
  expect(phoneNumbersMatch("+491763334444", "+491763334445")).toBe(false);
  expect(phoneNumbersMatch("", "+491763334444")).toBe(false);
});

/** Builds a minimal msgstore.db with the tables and columns that the import reads */
function makeMsgstore(withExtraMessage = false): Uint8Array {
  let db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE jid (_id INTEGER PRIMARY KEY, raw_string TEXT);
    CREATE TABLE jid_map (lid_row_id INTEGER, jid_row_id INTEGER);
    CREATE TABLE chat (_id INTEGER PRIMARY KEY, jid_row_id INTEGER, subject TEXT, created_timestamp INTEGER);
    CREATE TABLE message (_id INTEGER PRIMARY KEY, chat_row_id INTEGER, from_me INTEGER,
      key_id TEXT, sender_jid_row_id INTEGER, status INTEGER, timestamp INTEGER,
      received_timestamp INTEGER, message_type INTEGER, text_data TEXT, starred INTEGER);
    CREATE TABLE message_media (message_row_id INTEGER PRIMARY KEY, file_path TEXT,
      mime_type TEXT, file_length INTEGER, media_name TEXT, media_caption TEXT);
    CREATE TABLE message_quoted (message_row_id INTEGER PRIMARY KEY, key_id TEXT,
      from_me INTEGER, sender_jid_row_id INTEGER);
    CREATE TABLE message_location (message_row_id INTEGER PRIMARY KEY, latitude REAL, longitude REAL);
    CREATE TABLE group_participant_user (group_jid_row_id INTEGER, user_jid_row_id INTEGER);
    CREATE TABLE message_add_on (_id INTEGER PRIMARY KEY, parent_message_row_id INTEGER,
      from_me INTEGER, sender_jid_row_id INTEGER);
    CREATE TABLE message_add_on_reaction (message_add_on_row_id INTEGER, reaction TEXT);

    INSERT INTO jid VALUES
      (1, '${kAliceJID}'), (2, '${kBobJID}'), (3, '${kGroupJID}'),
      (4, 'status@broadcast'), (5, '998877665544@lid'),
      (6, '491763333333@s.whatsapp.net');
    INSERT INTO jid_map VALUES (5, 2); -- lid alias for Bob

    INSERT INTO chat VALUES
      (1, 1, NULL, 1700000000000),
      (2, 3, 'Test Group', 1700000000000),
      (3, 4, NULL, 1700000000000), -- status feed, must be skipped
      (4, 6, NULL, 1700000000000); -- chat without messages, must be skipped
    INSERT INTO group_participant_user VALUES (3, 1), (3, 5);

    INSERT INTO message
      (_id, chat_row_id, from_me, key_id, sender_jid_row_id, status, timestamp, received_timestamp, message_type, text_data, starred) VALUES
      (1, 1, 0, 'A1', 0, 0, 1700000001000, 1700000002000, 0, 'Hello', 0),
      (2, 1, 1, 'A2', 0, 4, 1700000003000, 1700000003000, 0, 'Hi back', 1),
      (3, 1, 0, 'A3', 0, 0, 1700000004000, 1700000004000, 1, 'Look at this', 0),
      (4, 1, 0, 'A4', 0, 0, 1700000005000, 1700000005000, 15, NULL, 0),
      (5, 1, 0, 'A5', 0, 6, 1700000006000, 1700000006000, 7, 'system message', 0),
      (6, 1, 0, 'A6', 0, 0, 1700000007000, 1700000007000, 0, 'Reply to hello', 0),
      (7, 1, 0, 'A7', 0, 0, 1700000008000, 1700000008000, 5, NULL, 0),
      (8, 2, 0, 'G1', 5, 0, 1700000009000, 1700000009000, 0, 'Group hello', 0),
      (9, 2, 1, 'G2', 0, 4, 1700000010000, 1700000010000, 0, 'Out to group', 0);
    INSERT INTO message_media VALUES (3, 'Media/WhatsApp Images/IMG-1.jpg', 'image/jpeg', 12345, NULL, NULL);
    INSERT INTO message_quoted VALUES (6, 'A1', 0, 0);
    INSERT INTO message_location VALUES (7, 48.137, 11.575);
    INSERT INTO message_add_on VALUES (1, 1, 0, 0), (2, 8, 0, 1);
    INSERT INTO message_add_on_reaction VALUES (1, '❤️'), (2, '👍');
  `);
  if (withExtraMessage) {
    db.exec(`
      INSERT INTO message
        (_id, chat_row_id, from_me, key_id, sender_jid_row_id, status, timestamp, received_timestamp, message_type, text_data, starred) VALUES
        (10, 1, 0, 'A8', 0, 0, 1700000011000, 1700000011000, 0, 'Newer backup message', 0);
    `);
  }
  return new Uint8Array(db.serialize());
}

/** Builds a minimal wa.db with the contact names */
function makeWADB(): Uint8Array {
  let db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE wa_contacts (jid TEXT, display_name TEXT, wa_name TEXT);
    INSERT INTO wa_contacts VALUES
      ('${kAliceJID}', 'Alice Test', 'alice'),
      ('${kBobJID}', NULL, 'Bobby');
  `);
  let file = new Uint8Array(db.serialize());
  // The real wa.db is in WAL mode, which the import must flip to journal mode
  file[18] = 2;
  file[19] = 2;
  return file;
}
