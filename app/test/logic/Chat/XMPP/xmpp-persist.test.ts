/**
 * Messages and contacts must survive an app restart.
 * Uses the real SQL storage chain for both chat.db and contacts.db,
 * unlike xmpp.test.ts, which stubs out the contacts.
 */
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Database } from "./setup";
import { XMPPAccount } from "../../../../logic/Chat/XMPP/XMPPAccount";
import { XMPP1to1Chat } from "../../../../logic/Chat/XMPP/XMPP1to1Chat";
import { XMPPRoomEvent } from "../../../../logic/Chat/XMPP/XMPPRoomEvent";
import { ChatMessage } from "../../../../logic/Chat/ChatMessage";
import { JoinLeave, RoomEventKind } from "../../../../logic/Chat/RoomEvent";
import { SQLChatStorage } from "../../../../logic/Chat/SQL/SQLChatStorage";
import { makeTestDatabase as makeChatTestDatabase, getDatabase as getChatDatabase } from "../../../../logic/Chat/SQL/SQLDatabase";
import { makeTestDatabase as makeContactsTestDatabase } from "../../../../logic/Contacts/SQL/SQLDatabase";
import { SQLAddressbook } from "../../../../logic/Contacts/SQL/SQLAddressbook";
import { SQLAddressbookStorage } from "../../../../logic/Contacts/SQL/SQLAddressbookStorage";
import { SQLAccount } from "../../../../logic/Mail/SQL/Account/SQLAccount";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { MockXMPPServer } from "./MockXMPPServer";
import sql from "../../../../../lib/rs-sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";

const kMe = "testuser@localhost";
const kPassword = "test-password-123";
const kAlice = "alice@localhost";
const kBob = "bob@localhost";

let server: MockXMPPServer;

beforeAll(async () => {
  if (!Database) {
    return;
  }
  let tempDir = mkdtempSync(path.join(tmpdir(), "xmpp-persist-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase(filename: string, options?: any, buffer?: Uint8Array) {
      if (buffer) {
        return new Database(Buffer.from(buffer), options);
      }
      return new Database(path.join(tempDir, filename), options);
    },
  };
  await makeChatTestDatabase();
  await makeContactsTestDatabase();
  SQLAccount.save = async () => {}; // the accounts DB is not part of this test

  let addressbook = new Addressbook();
  addressbook.name = "Test addressbook";
  addressbook.storage = new SQLAddressbookStorage();
  await SQLAddressbook.save(addressbook);
  appGlobal.addressbooks.add(addressbook);
  appGlobal.personalAddressbook = addressbook;

  server = new MockXMPPServer();
  server.users.set("testuser", kPassword);
  server.roster = [
    { jid: kAlice, name: "Alice Test" },
    { jid: kBob, name: "Bob Test" },
  ];
  server.addToArchive(kAlice, { archiveID: "a1", from: kAlice, to: kMe, body: "Hi, this is Alice", time: "2026-06-01T10:00:00Z" });
  server.addToArchive(kAlice, { archiveID: "a2", from: kMe, to: kAlice, body: "Hi Alice!", time: "2026-06-01T10:01:00Z" });
  server.addToArchive(kAlice, { archiveID: "a3", from: kAlice, to: kMe, body: "How are you?", time: "2026-06-02T08:30:00Z" });
  server.addToArchive(kBob, { archiveID: "b1", from: kBob, to: kMe, body: "Lunch today?", time: "2026-06-03T11:00:00Z" });
  server.addToArchive(kBob, { archiveID: "b2", from: kMe, to: kBob, body: "Sure, 12:30", time: "2026-06-03T11:05:00Z" });
  await server.start();
});

afterAll(async () => {
  await server?.stop();
});

function newAccount(): XMPPAccount {
  let account = new XMPPAccount();
  account.storage = new SQLChatStorage();
  account.name = kMe;
  account.username = kMe;
  account.password = kPassword;
  account.url = server.url;
  return account;
}

async function countMessages(): Promise<number> {
  let row = await (await getChatDatabase()).get(sql`SELECT COUNT(*) AS count FROM message`) as any;
  return row.count;
}
async function countChats(): Promise<number> {
  let row = await (await getChatDatabase()).get(sql`SELECT COUNT(*) AS count FROM chatRoom`) as any;
  return row.count;
}
/** Chat contacts are kept in the chat DB, not in the address book */
async function countContacts(): Promise<number> {
  let row = await (await getChatDatabase()).get(sql`SELECT COUNT(*) AS count FROM chatContact`) as any;
  return row.count;
}

test.skipIf(!Database)("Messages and contacts survive a restart", { timeout: 60000 }, async () => {
  // Session 1: First login, like after account setup
  let account1 = newAccount();
  appGlobal.chatAccounts.add(account1);
  await account1.loginAndStartup(true);
  let alice1 = account1.getExistingChat(kAlice) as XMPP1to1Chat;
  let bob1 = account1.getExistingChat(kBob) as XMPP1to1Chat;
  await alice1.listMessages();
  await bob1.listMessages();
  expect(alice1.messages.length).toBe(3);

  // Room events: a specific kind, and a generic protocol event
  let join = alice1.newRoomEvent(RoomEventKind.JoinLeave) as JoinLeave;
  join.id = "evt-1";
  join.join = true;
  join.text = "Alice joined";
  join.sent = new Date("2026-06-02T09:00:00Z"); // after the newest human message
  join.received = new Date(join.sent);
  alice1.messages.add(join);
  let raw = alice1.newRoomEvent();
  raw.id = "evt-2";
  raw.text = "Server maintenance notice";
  raw.sent = raw.received = new Date("2026-06-02T09:01:00Z");
  alice1.messages.add(raw);
  await alice1.saveNewMessages([join, raw]);
  await account1.logout();

  // Everything was saved
  expect(await countMessages()).toBe(7); // 5 messages + 2 events
  expect(await countChats()).toBe(2);
  expect(await countContacts()).toBe(2);

  // Session 2: Restart the app, like getStartObjects():
  // Fresh objects, and the address book is loaded,
  // but its contacts are not loaded yet.
  let addressbook1 = appGlobal.personalAddressbook;
  appGlobal.chatAccounts.clear();
  appGlobal.addressbooks.clear();
  let addressbook2 = new Addressbook();
  addressbook2.id = addressbook1.id;
  addressbook2.dbID = addressbook1.dbID;
  addressbook2.name = addressbook1.name;
  addressbook2.storage = new SQLAddressbookStorage();
  appGlobal.addressbooks.add(addressbook2);
  appGlobal.personalAddressbook = addressbook2;
  expect(appGlobal.persons.length).toBe(0); // not loaded yet, like at app start

  let account2 = newAccount();
  account2.id = account1.id;
  account2.dbID = account1.dbID;
  appGlobal.chatAccounts.add(account2);
  server.queries.length = 0;
  await account2.loginAndStartup(false);

  // The chats were loaded from our DB, not re-created
  let alice2 = account2.getExistingChat(kAlice) as XMPP1to1Chat;
  let bob2 = account2.getExistingChat(kBob) as XMPP1to1Chat;
  expect(alice2.dbID).toBe(alice1.dbID);
  expect(alice2.syncState).toBe("a3");
  await alice2.listMessages();
  await bob2.listMessages();

  // The messages come from our DB, and the server is asked only for newer ones
  expect(alice2.messages.length).toBe(5); // 3 messages + 2 events
  expect(bob2.messages.length).toBe(2);
  expect(alice2.messages.contents.filter(msg => msg instanceof ChatMessage).length).toBe(3);
  // `lastMessage` is the newest *human* message, not the newer events
  expect(alice2.lastMessage?.text).toBe("How are you?");

  // The room events were restored with their kind and protocol class
  let join2 = alice2.messages.find(msg => msg.id == "evt-1");
  expect(join2 instanceof JoinLeave).toBe(true);
  expect((join2 as JoinLeave).join).toBe(true);
  expect(join2.text).toBe("Alice joined");
  let raw2 = alice2.messages.find(msg => msg.id == "evt-2");
  expect(raw2 instanceof XMPPRoomEvent).toBe(true);
  expect((raw2 as XMPPRoomEvent).kind).toBe(RoomEventKind.Generic);

  expect(server.queries.filter(q => q.withJID == kAlice && !q.after).length).toBe(0); // no full re-fetch
  expect(await countMessages()).toBe(7); // no duplicates
  expect(await countContacts()).toBe(2); // no duplicate contacts

  await account2.logout();
});
