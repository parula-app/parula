// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { setupChatTestEnv, newChatStorage } from "./setup";
import { XMPPAccount } from "../../../../logic/Chat/XMPP/XMPPAccount";
import { XMPP1to1Chat } from "../../../../logic/Chat/XMPP/XMPP1to1Chat";
import { getDatabase } from "../../../../logic/Chat/SQL/SQLDatabase";
import { SQLChatRoom } from "../../../../logic/Chat/SQL/SQLChatRoom";
import { DummyChatStorage } from "../../../../logic/Chat/SQL/DummyChatStorage";
import { LoginError } from "../../../../logic/Abstract/Account";
import { MockXMPPServer } from "./MockXMPPServer";
import { waitFor } from "../../util/waitFor";
import sql from "../../../../../lib/rs-sqlite";
import { afterAll, beforeAll, expect, test } from "vitest";

const kMe = "testuser@localhost";
const kPassword = "test-password-123";
const kAlice = "alice@localhost";
const kBob = "bob@localhost";

let server: MockXMPPServer;

beforeAll(async () => {
  await setupChatTestEnv();

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
  await server.stop();
});

function newAccount(): XMPPAccount {
  let account = new XMPPAccount();
  account.storage = newChatStorage();
  account.name = kMe;
  account.username = kMe;
  account.password = kPassword;
  account.url = server.url;
  return account;
}

async function countMessagesInDB(): Promise<number> {
  let row = await (await getDatabase()).get(sql`SELECT COUNT(*) AS count FROM message`) as any;
  return row.count;
}

test("Login with wrong password fails cleanly", { timeout: 10000 }, async () => {
  let account = newAccount();
  account.password = "wrong-password";
  await expect(account.login(true)).rejects.toThrow(LoginError);
  expect(account.isLoggedIn).toBe(false);
});

test("Login, roster, message history, send, live message, then sync again without duplicates", { timeout: 30000 }, async () => {
  let account = newAccount();
  appGlobal.chatAccounts.add(account);
  await account.loginAndStartup(true);
  expect(account.isLoggedIn).toBe(true);
  expect(account.dbID).toBeTruthy();

  // Roster
  expect(account.roster.length).toBe(2);
  let alicePerson = account.getExistingPerson(kAlice);
  expect(alicePerson?.name).toBe("Alice Test");
  // Roster contacts stay `ChatPersonUID`s. Linking them to a `Person` is up to
  // the UI, so the chat must not add them to the address book by itself.
  expect(alicePerson.findPerson()).toBeUndefined();
  expect(appGlobal.personalAddressbook.persons.isEmpty).toBe(true);
  let aliceChat = account.getExistingChat(kAlice) as XMPP1to1Chat;
  let bobChat = account.getExistingChat(kBob) as XMPP1to1Chat;
  expect(aliceChat).toBeTruthy();
  expect(bobChat).toBeTruthy();

  // History from the server archive (the startup also syncs in the background;
  // the lock makes this call wait for it, and dedup prevents doubles)
  await aliceChat.listMessages();
  await bobChat.listMessages();
  expect(aliceChat.messages.length).toBe(3);
  expect(bobChat.messages.length).toBe(2);
  expect(aliceChat.syncState).toBe("a3");
  expect(bobChat.syncState).toBe("b2");
  let hi = aliceChat.messages.find(msg => msg.id == "msg-a1");
  expect(hi.text).toBe("Hi, this is Alice");
  expect(hi.outgoing).toBe(false);
  expect(hi.sent.toISOString()).toBe("2026-06-01T10:00:00.000Z");
  let reply = aliceChat.messages.find(msg => msg.id == "msg-a2");
  expect(reply.outgoing).toBe(true);
  expect(aliceChat.lastMessage?.id).toBe("msg-a3");
  expect(await countMessagesInDB()).toBe(5);

  // Send a message
  let sendMsg = aliceChat.newMessage();
  sendMsg.text = "Sent from the test";
  await aliceChat.sendMessage(sendMsg);
  await waitFor(() => server.received.some(msg => msg.to == kAlice && msg.body == "Sent from the test"));
  expect(aliceChat.messages.length).toBe(4);
  expect(await countMessagesInDB()).toBe(6);

  // Live incoming message
  server.pushMessage(kAlice, kMe, "Live message");
  await waitFor(async () => await countMessagesInDB() == 7); // stored, which comes last
  let live = aliceChat.messages.find(msg => msg.text == "Live message");
  expect(live).toBeTruthy();
  expect(live.outgoing).toBe(false);
  expect(aliceChat.lastMessage?.text).toBe("Live message");

  await account.logout();
  expect(account.isLoggedIn).toBe(false);

  // "Restart the app": new account object, same DB.
  // One new message arrived on the server while we were offline.
  // (dated after the live message above, which used the current time)
  server.addToArchive(kAlice, { archiveID: "a4", from: kAlice, to: kMe, body: "Are you still there?", time: new Date(Date.now() + 60000).toISOString() });
  let dbMessageCount = await countMessagesInDB();
  let account2 = newAccount();
  account2.id = account.id; // same config as before
  account2.dbID = account.dbID;
  appGlobal.chatAccounts.remove(account);
  appGlobal.chatAccounts.add(account2);
  server.countQueriesAfter = 0;
  await account2.loginAndStartup(false);

  let aliceChat2 = account2.getExistingChat(kAlice) as XMPP1to1Chat;
  expect(aliceChat2.dbID).toBe(aliceChat.dbID); // from DB, not re-created
  await aliceChat2.listMessages();
  let bobChat2 = account2.getExistingChat(kBob) as XMPP1to1Chat;
  await bobChat2.listMessages();

  // Cached messages came from our DB, only the new one from the server
  expect(server.countQueriesAfter).toBeGreaterThan(0); // used incremental sync
  expect(aliceChat2.messages.length).toBe(6); // 5 cached + 1 new
  expect(aliceChat2.messages.filter(msg => msg.id == "msg-a1").length).toBe(1); // no duplicates
  expect(aliceChat2.syncState).toBe("a4");
  expect(bobChat2.messages.length).toBe(2);
  expect(await countMessagesInDB()).toBe(dbMessageCount + 1);
  expect(aliceChat2.lastMessage?.text).toBe("Are you still there?");

  await account2.logout();
});

// 450 messages = 3 batches of 200 (kBatchSize in XMPP1to1Chat)
test("First sync gets the whole archive, in batches", { timeout: 30000 }, async () => {
  const kCharlie = "charlie@localhost";
  const kTotal = 450;
  for (let i = 1; i <= kTotal; i++) {
    server.addToArchive(kCharlie, {
      archiveID: `c${i}`,
      from: i % 3 ? kCharlie : kMe,
      to: i % 3 ? kMe : kCharlie,
      body: `Message ${i}`,
      time: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    });
  }
  let account = newAccount();
  appGlobal.chatAccounts.add(account);
  await account.loginAndStartup(false);
  // Charlie is not in the roster, so only we sync this chat, not the startup
  let chat = await account.getNewChat(kCharlie) as XMPP1to1Chat;
  await chat.listMessages();

  expect(chat.messages.length).toBe(kTotal);
  expect(chat.messages.first.text).toBe("Message 1"); // oldest first
  expect(chat.lastMessage?.text).toBe(`Message ${kTotal}`);
  expect(chat.syncState).toBe(`c${kTotal}`);
  let charlieQueries = server.queries.filter(q => q.withJID == kCharlie);
  expect(charlieQueries.length).toBe(3); // 200 + 200 + 50
  expect(charlieQueries.filter(q => !q.after).length).toBe(1); // fetched the archive only once
  let row = await (await getDatabase()).get(sql`SELECT COUNT(*) AS count FROM message WHERE chatID = ${chat.dbID}`) as any;
  expect(row.count).toBe(kTotal);

  await account.logout();
  appGlobal.chatAccounts.remove(account);
});

// The same flow without the local DB, as in the webmail build: chats and
// messages stay in memory.
// Keep this test last: it stubs out reading rooms from the DB.
test("Login and sync without local DB", { timeout: 30000 }, async () => {
  SQLChatRoom.readAll = async () => {}; // there are no saved rooms to read
  let account = newAccount();
  account.storage = new DummyChatStorage();
  appGlobal.chatAccounts.add(account);
  await account.loginAndStartup(true);
  expect(account.isLoggedIn).toBe(true);
  expect(account.roster.length).toBe(2);
  let aliceChat = account.getExistingChat(kAlice) as XMPP1to1Chat;
  await aliceChat.listMessages();
  expect(aliceChat.messages.length).toBe(server.archives.get(kAlice)!.length);
  expect(aliceChat.syncState).toBeTruthy();
  expect(aliceChat.lastMessage).toBeTruthy();
  await account.logout();
  appGlobal.chatAccounts.remove(account);
});
