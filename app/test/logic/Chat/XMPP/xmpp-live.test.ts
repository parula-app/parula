/**
 * Tests against a real XMPP server. Skipped unless env vars are set:
 *
 * Connection + auth flow only (no account needed):
 *   XMPP_TEST_SERVER=jabber.hot-chilli.net yarn test xmpp-live
 *
 * Full login, roster and message history (your real account):
 *   XMPP_TEST_JID=you@xabber.de XMPP_TEST_PASSWORD=... yarn test xmpp-live
 *
 * If endpoint discovery (.well-known/host-meta.json) doesn't work on your
 * network, set the websocket URL directly:
 *   XMPP_TEST_URL=wss://jabber.hot-chilli.net:443/xmpp-websocket
 *
 * Runs without the local DB (in-memory only), if the in-process SQLite
 * does not load under your system Node, see setup.ts.
 */
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { setupChatTestEnv, newChatStorage } from "./setup";
import { XMPPAccount } from "../../../../logic/Chat/XMPP/XMPPAccount";
import { LoginError } from "../../../../logic/Abstract/Account";
import { beforeAll, expect, test } from "vitest";

const kServer = process.env.XMPP_TEST_SERVER;
const kJID = process.env.XMPP_TEST_JID;
const kPassword = process.env.XMPP_TEST_PASSWORD;
const kURL = process.env.XMPP_TEST_URL;

beforeAll(async () => {
  if (!kServer && !(kJID && kPassword)) {
    return;
  }
  await setupChatTestEnv();
});

test.skipIf(!kServer)("Real server: connection works, wrong password fails cleanly", { timeout: 30000 }, async () => {
  let account = new XMPPAccount();
  account.storage = newChatStorage();
  account.name = account.username = `nonexistent-user-test@${kServer}`;
  account.password = "wrong-password-123";
  appGlobal.chatAccounts.add(account);
  // LoginError means: endpoint discovery, connection and SASL all worked,
  // and the server rejected the credentials
  await expect(account.login(true)).rejects.toThrow(LoginError);
  expect(account.isLoggedIn).toBe(false);
  appGlobal.chatAccounts.remove(account);
});

test.skipIf(!kJID || !kPassword)("Real server: login, roster and message history", { timeout: 120000 }, async () => {
  let account = new XMPPAccount();
  account.storage = newChatStorage();
  account.name = account.username = kJID!;
  account.password = kPassword!;
  account.url = kURL!;
  appGlobal.chatAccounts.add(account);
  await account.loginAndStartup(true);
  expect(account.isLoggedIn).toBe(true);
  console.log(`Roster of ${kJID}: ${account.roster.length} contacts`);
  for (let person of account.roster) {
    console.log(` - ${person.chatID}: ${person.name}`);
  }
  for (let chatRoom of account.rooms.contents) {
    await chatRoom.listMessages();
    console.log(`Chat with ${chatRoom.name}: ${chatRoom.messages.length} messages, last: ${chatRoom.lastMessage?.text?.slice(0, 60) ?? "-"}`);
  }
  await account.logout();
  expect(account.isLoggedIn).toBe(false);
});
