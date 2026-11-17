/**
 * Group chats (XEP-0045 MUC): Bookmarks, joining, members,
 * message history, sending with reflection, live messages,
 * and that everything survives a restart.
 */
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Database } from "./setup";
import { XMPPAccount } from "../../../../logic/Chat/XMPP/XMPPAccount";
import { XMPPGroupChat } from "../../../../logic/Chat/XMPP/XMPPGroupChat";
import { ChatMessage } from "../../../../logic/Chat/ChatMessage";
import { SQLChatStorage } from "../../../../logic/Chat/SQL/SQLChatStorage";
import { makeTestDatabase as makeChatTestDatabase, getDatabase as getChatDatabase } from "../../../../logic/Chat/SQL/SQLDatabase";
import { makeTestDatabase as makeContactsTestDatabase, getDatabase as getContactsDatabase } from "../../../../logic/Contacts/SQL/SQLDatabase";
import { SQLAddressbookStorage } from "../../../../logic/Contacts/SQL/SQLAddressbookStorage";
import { SQLAddressbook } from "../../../../logic/Contacts/SQL/SQLAddressbook";
import { SQLAccount } from "../../../../logic/Mail/SQL/Account/SQLAccount";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { Group } from "../../../../logic/Abstract/Group";
import { MockXMPPServer } from "./MockXMPPServer";
import sql from "../../../../../lib/rs-sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";

const kMe = "testuser@localhost";
const kPassword = "test-password-123";
const kRoom = "fans@conference.localhost";
const kAlice = "alice@localhost";

let server: MockXMPPServer;

beforeAll(async () => {
  if (!Database) {
    return;
  }
  let tempDir = mkdtempSync(path.join(tmpdir(), "xmpp-group-test-"));
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
  appGlobal.collectedAddressbook = addressbook;

  server = new MockXMPPServer();
  server.users.set("testuser", kPassword);
  server.roster = [
    { jid: kAlice, name: "Alice Test" },
  ];
  server.groups = [{
    jid: kRoom,
    name: "Fan Club",
    nick: "testnick",
    occupants: [
      { nick: "alice", jid: kAlice }, // discloses her real address
      { nick: "anon" }, // anonymous
    ],
  }];
  // Room history: from a member with real JID, an anonymous one, and our user
  server.addToArchive(kRoom, { archiveID: "g1", from: `${kRoom}/alice`, to: kRoom, body: "Welcome to the club", time: "2026-06-01T10:00:00Z" });
  server.addToArchive(kRoom, { archiveID: "g2", from: `${kRoom}/anon`, to: kRoom, body: "Boo", time: "2026-06-01T10:01:00Z" });
  server.addToArchive(kRoom, { archiveID: "g3", from: `${kRoom}/testnick`, to: kRoom, body: "Hi all", time: "2026-06-01T10:02:00Z" });
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
async function countPersons(): Promise<number> {
  let row = await (await getContactsDatabase()).get(sql`SELECT COUNT(*) AS count FROM person`) as any;
  return row.count;
}
async function countGroups(): Promise<number> {
  let row = await (await getContactsDatabase()).get(sql`SELECT COUNT(*) AS count FROM "group"`) as any;
  return row.count;
}

test.skipIf(!Database)("Group chat: join, members, history, send, live, restart", { timeout: 60000 }, async () => {
  // Session 1: Bookmark found, room joined
  let account1 = newAccount();
  appGlobal.chatAccounts.add(account1);
  await account1.loginAndStartup(true);
  let room1 = account1.getExistingChat(kRoom) as XMPPGroupChat;
  expect(room1 instanceof XMPPGroupChat).toBe(true);
  expect(room1.contact instanceof Group).toBe(true);
  expect(room1.name).toBe("Fan Club");
  expect(room1.nick).toBe("testnick");

  // Members, from the room presences, tracked in the room
  expect(room1.memberByNick.size).toBe(2);
  let alice = room1.memberByNick.get("alice")!;
  expect(alice).toBe(account1.getExistingPerson(kAlice)); // real address disclosed: same contact as in the roster
  expect(alice).toBe(account1.getPersonUID(kAlice)); // reused across rooms
  let anon = room1.memberByNick.get("anon")!;
  expect(anon.name).toBe("anon");
  await room1.listMembers();
  expect(room1.members.length).toBe(2);
  expect(room1.members.contains(alice)).toBe(true);
  expect(room1.members.contains(anon)).toBe(true);
  // Unknown room members are chat-only contacts (ChatPersonUID), not linked to an
  // address-book Person, so they never appear in the user's address books.
  expect(anon.person).toBeUndefined();

  // History from the room archive
  await room1.listMessages();
  expect(room1.messages.length).toBe(3);
  let fromAlice = room1.messages.find(msg => msg.id == "msg-g1") as ChatMessage;
  expect(fromAlice.from).toBe(alice); // the sender; `contact` is the room's Group
  expect(fromAlice.contact).toBe(room1.contact);
  expect(fromAlice.outgoing).toBe(false);
  let fromMe = room1.messages.find(msg => msg.id == "msg-g3")!;
  expect(fromMe.outgoing).toBe(true);
  expect(room1.lastMessage?.text).toBe("Hi all");
  expect(room1.syncState).toBe("g3");

  // Send: the room reflects our message back, without duplicating it
  let sendMsg = room1.newMessage();
  sendMsg.text = "New message from the test";
  await room1.sendMessage(sendMsg);
  await new Promise(resolve => setTimeout(resolve, 500));
  expect(server.received.some(msg => msg.to == kRoom && msg.body == "New message from the test")).toBe(true);
  expect(room1.messages.length).toBe(4);
  expect(room1.messages.contents.filter(msg => msg.text == "New message from the test").length).toBe(1);

  // Live message from a member
  server.pushGroupMessage(kRoom, "anon", "Live boo");
  await new Promise(resolve => setTimeout(resolve, 500));
  let live = room1.messages.find(msg => msg.text == "Live boo") as ChatMessage;
  expect(live).toBeTruthy();
  expect(live.from).toBe(anon);
  expect(room1.lastMessage?.text).toBe("Live boo");

  await account1.logout();
  expect(await countMessages()).toBe(5);
  expect(await countGroups()).toBe(0); // the room's Group is not in the contacts DB
  expect(await countPersons()).toBe(0); // neither room members nor roster contacts

  // Session 2: Restart, like getStartObjects(): fresh objects,
  // address book without contacts loaded yet
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
  appGlobal.collectedAddressbook = addressbook2;

  let account2 = newAccount();
  account2.id = account1.id;
  account2.dbID = account1.dbID;
  appGlobal.chatAccounts.add(account2);
  server.queries.length = 0;
  await account2.loginAndStartup(false);

  // The room was loaded from our DB as a group chat, and re-joined
  let room2 = account2.getExistingChat(kRoom) as XMPPGroupChat;
  expect(room2 instanceof XMPPGroupChat).toBe(true);
  expect(room2.dbID).toBe(room1.dbID);
  expect(room2.contact instanceof Group).toBe(true);
  expect(room2.name).toBe("Fan Club");
  expect(room2.syncState).toBe(room1.syncState);
  // The members restored from the DB are merged with the room presences
  expect(room2.memberByNick.size).toBe(2);
  expect(room2.members.length).toBe(2);
  let alice2 = room2.members.find(m => m.chatID == kAlice)!;
  expect(alice2.name).toBe("Alice Test"); // the roster contact, restored from the contacts DB
  expect(room2.memberByNick.get("alice")).toBe(alice2); // no duplicate member
  expect(alice2).toBe(account2.getPersonUID(kAlice)); // reused across rooms
  expect(room2.memberByNick.get("anon")!.person).toBeUndefined();

  // Messages come from our DB, only newer ones from the room archive
  await room2.listMessages();
  expect(room2.messages.length).toBe(5);
  expect(server.queries.filter(q => q.withJID == kRoom && !q.after).length).toBe(0); // no full re-fetch
  expect(await countMessages()).toBe(5); // no duplicates
  expect(await countPersons()).toBe(0); // still no room members in the contacts
  expect(await countGroups()).toBe(0); // still no group in the contacts
  let fromAnon = room2.messages.find(msg => msg.id == "msg-g2") as ChatMessage;
  expect(fromAnon.from?.name).toBe("anon");
  expect(room2.messages.contents.filter(msg => msg instanceof ChatMessage).length).toBe(5);

  await account2.logout();
});
