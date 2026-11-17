import { appGlobal } from "../../../../logic/app";
import { FakePOP3Server, type FakeMail } from "./FakePOP3Server";
import { POP3Account } from "../../../../logic/Mail/POP3/POP3Account";
import type { POP3Folder } from "../../../../logic/Mail/POP3/POP3Folder";
import { newAccountForProtocol } from "../../../../logic/Mail/AccountsList/MailAccounts";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { isCertError } from "../../../../logic/Mail/AutoConfig/checkConfig";
import { AuthMethod } from "../../../../logic/Abstract/Account";
import { TLSSocketType } from "../../../../logic/Abstract/TCPAccount";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import net from "node:net";
import tls from "node:tls";
import { afterEach, beforeEach, expect, test } from "vitest";

/** Like the backends, but in-process. Objects cross JPC as JSON, so the options do too. */
appGlobal.remoteApp = {
  newTCPSocket: () => new net.Socket(),
  startTLS: (socket: net.Socket, hostname: string, tlsOptions: any) => new Promise((resolve, reject) => {
    let tlsSocket = tls.connect({ socket, servername: hostname, ...JSON.parse(JSON.stringify(tlsOptions)) }, () => resolve(tlsSocket));
    tlsSocket.on("error", reject);
  }),
};

let server: FakePOP3Server;

beforeEach(async () => {
  server = new FakePOP3Server();
  server.mails = [mail("a1", "First"), mail("b2", "Second"), mail("c3", "Third")];
});
afterEach(async () => {
  await server.stop();
});

function mail(uidl: string, subject: string, body = "Hello"): FakeMail {
  return { uidl, mime: `From: Alice <alice@example.com>\r\nTo: user@example.com\r\nSubject: ${subject}\r\nDate: Tue, 1 Sep 2026 10:00:00 +0000\r\nMessage-ID: <${uidl}@example.com>\r\n\r\n${body}\r\n` };
}

function newAccount(tlsMode: TLSSocketType = TLSSocketType.Plain): POP3Account {
  let acc = newAccountForProtocol("pop3") as POP3Account;
  acc.hostname = "127.0.0.1";
  acc.port = server.port;
  acc.tls = tlsMode;
  acc.username = server.username;
  acc.password = server.password;
  acc.emailAddress = "user@example.com";
  acc.name = acc.emailAddress;
  acc.authMethod = AuthMethod.Password;
  acc.pollIntervalMinutes = 0;
  acc.storage = new DummyMailStorage();
  acc.contentStorage.clear();
  return acc;
}

function inboxOf(acc: POP3Account): POP3Folder {
  return acc.inbox as POP3Folder;
}

test("Downloads the mails once, and new ones later", async () => {
  await server.start();
  let acc = newAccount();
  await acc.loginAndStartup(false);
  expect(acc.isLoggedIn).toBe(true);
  let inbox = inboxOf(acc);
  expect(inbox.messages.contents.map(msg => msg.subject).sort()).toEqual(["First", "Second", "Third"]);
  expect(inbox.messages.first.from.emailAddress).toBe("alice@example.com");
  expect(inbox.messages.first.downloadComplete).toBe(true);
  expect(inbox.messages.first.isNewArrived).toBe(false); // existing mailbox
  expect(inbox.countTotal).toBe(3);
  expect(inbox.countUnread).toBe(3);
  expect(inbox.downloaded.contentKeys().sort()).toEqual(["a1", "b2", "c3"]);
  expect(server.commands).toContain("QUIT");
  expect(server.commands.filter(c => c.startsWith("DELE"))).toEqual([]); // leave on server, by default
  expect(server.mails.length).toBe(3);

  // Second check: Nothing new
  server.commands = [];
  let newMsgs = await inbox.getNewMessages();
  expect(newMsgs.length).toBe(0);
  expect(server.commands.filter(c => c.startsWith("RETR"))).toEqual([]);

  // Third check: A new mail
  server.mails.push(mail("d4", "Fourth"));
  server.commands = [];
  newMsgs = await inbox.getNewMessages();
  expect(newMsgs.contents.map(msg => msg.subject)).toEqual(["Fourth"]);
  expect(newMsgs.first.isNewArrived).toBe(true);
  expect(server.commands.filter(c => c.startsWith("RETR"))).toEqual(["RETR 4"]);
  expect(inbox.messages.length).toBe(4);

  // The record survives a restart
  let json = JSON.parse(JSON.stringify(inbox.toExtraJSON()));
  let restored = acc.newFolder();
  restored.specialFolder = SpecialFolder.Inbox;
  restored.fromExtraJSON(json);
  expect(restored.downloaded.contentKeys().sort()).toEqual(["a1", "b2", "c3", "d4"]);
  expect(restored.toExtraJSON()).toEqual(json);
});

test("The login only connects, the startup downloads the mails", async () => {
  await server.start();
  let acc = newAccount();

  await acc.login(false);

  expect(server.commands).toContain("PASS secret");
  expect(server.commands.filter(c => c.startsWith("RETR"))).toEqual([]);

  await acc.syncOnStartup();

  expect(inboxOf(acc).messages.length).toBe(3);
  expect(acc.isLoggedIn).toBe(true);

  await acc.logout(); // the login left its connection open, for the first mail check
});

test("Two concurrent logins open one session", async () => {
  await server.start();
  let acc = newAccount();

  await Promise.all([acc.login(false), acc.login(false)]);

  // POP3 servers allow only one session per mailbox
  expect(server.commands.filter(c => c.startsWith("PASS"))).toEqual(["PASS secret"]);

  await acc.logout(); // the login left its connection open, for the first mail check
});

test("Deletes the mails from the server right after the download", async () => {
  await server.start();
  let acc = newAccount();
  acc.leaveOnServer = false;
  await acc.loginAndStartup(false);
  expect(inboxOf(acc).messages.length).toBe(3);
  expect(server.commands.filter(c => c.startsWith("DELE")).sort()).toEqual(["DELE 1", "DELE 2", "DELE 3"]);
  expect(server.mails).toEqual([]);
});

test("Deletes the mails from the server after some days", async () => {
  await server.start();
  let acc = newAccount();
  acc.deleteAfterDays = 7;
  await acc.loginAndStartup(false);
  let inbox = inboxOf(acc);
  expect(server.commands.filter(c => c.startsWith("DELE"))).toEqual([]);
  let eightDaysAgo = new Date();
  eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
  inbox.downloaded.set("b2", eightDaysAgo);
  server.commands = [];
  await inbox.getNewMessages();
  expect(server.commands.filter(c => c.startsWith("DELE"))).toEqual(["DELE 2"]);
  expect(server.mails.map(m => m.uidl)).toEqual(["a1", "c3"]);
  // Forgotten, now that the server does not have it anymore
  await inbox.getNewMessages();
  expect(inbox.downloaded.contentKeys().sort()).toEqual(["a1", "c3"]);
  expect(inbox.messages.length).toBe(3); // but still here locally
});

test("Wrong password", async () => {
  await server.start();
  let acc = newAccount();
  acc.password = "wrong";
  let ex = await acc.login(false).catch(ex => ex);
  expect(ex.authFail).toBe(true);
  expect(ex.message).toMatch(/Authentication failed/);
  expect(acc.fatalError).toBe(ex);
  expect(acc.isLoggedIn).toBe(false);
  await expect(acc.verifyLogin()).rejects.toThrow(/Authentication failed/);
});

test("STARTTLS with a self-signed certificate", async () => {
  server.tlsMode = "starttls";
  await server.start();
  let acc = newAccount(TLSSocketType.STARTTLS);
  let ex = await acc.login(false).catch(ex => ex);
  expect(ex.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  expect(isCertError(ex)).toBe(true);

  acc.acceptBrokenTLSCerts = true;
  await acc.loginAndStartup(false);
  expect(inboxOf(acc).messages.length).toBe(3);
  // The login happened after STLS, with the capabilities re-read after STLS
  let commands = server.commands.slice(server.commands.lastIndexOf("STLS"));
  expect(commands.slice(0, 4)).toEqual(["STLS", "CAPA", "USER user", "PASS secret"]);
});

test("Implicit TLS, with AUTH PLAIN when the server offers no USER", async () => {
  server.tlsMode = "implicit";
  server.capabilities = ["UIDL", "SASL PLAIN XOAUTH2"];
  await server.start();
  let acc = newAccount(TLSSocketType.TLS);
  acc.acceptBrokenTLSCerts = true;
  await acc.loginAndStartup(false);
  expect(inboxOf(acc).messages.length).toBe(3);
  expect(server.commands).toContain("AUTH PLAIN");
  expect(server.commands).toContain("\0user\0secret");
  expect(server.commands.filter(c => c.startsWith("USER"))).toEqual([]);
});

test("OAuth2", async () => {
  await server.start();
  let acc = newAccount();
  acc.authMethod = AuthMethod.OAuth2;
  acc.oAuth2 = { isLoggedIn: true, accessToken: "valid-token", subscribe: () => () => {} } as any;
  await acc.loginAndStartup(false);
  expect(inboxOf(acc).messages.length).toBe(3);
  expect(server.commands).toContain("AUTH XOAUTH2");
  expect(server.commands).toContain("user=user\x01auth=Bearer valid-token\x01\x01");

  acc.oAuth2.accessToken = "expired";
  let ex = await inboxOf(acc).getNewMessages().catch(ex => ex);
  expect(ex.authFail).toBe(true);
  expect(ex.message).toMatch(/Invalid credentials/);
});

test("Reassembles responses that arrive in pieces, and unstuffs dots", async () => {
  server.chunkSize = 7;
  server.mails = [mail("x1", "Dots", "Line one\r\n.Line starting with a dot\r\n..Two dots\r\n+OK not a status line\r\n-ERR neither\r\n.\r\nlast")];
  await server.start();
  let acc = newAccount();
  await acc.loginAndStartup(false);
  let msg = inboxOf(acc).messages.first;
  expect(msg.subject).toBe("Dots");
  expect(new TextDecoder().decode(msg.mime)).toContain("Line one\r\n.Line starting with a dot\r\n..Two dots\r\n+OK not a status line\r\n-ERR neither\r\n.\r\nlast\r\n");
  expect(msg.text).toContain("+OK not a status line");
});

test("Big mailbox: Lists only the mails after the last known one", async () => {
  server.mails = [];
  for (let i = 1; i <= 1200; i++) {
    server.mails.push(mail("uidl" + i, "Mail " + i));
  }
  await server.start();
  let acc = newAccount();
  await acc.loginAndStartup(false);
  let inbox = inboxOf(acc);
  expect(inbox.messages.length).toBe(1200);
  expect(server.commands).toContain("UIDL"); // full listing, the first time

  // Only the new mail is listed
  server.mails.push(mail("uidl1201", "Mail 1201"));
  server.commands = [];
  let newMsgs = await inbox.getNewMessages();
  expect(newMsgs.contents.map(msg => msg.subject)).toEqual(["Mail 1201"]);
  expect(server.commands.filter(c => c.startsWith("UIDL"))).toEqual(["UIDL 1200", "UIDL 1201"]);
  expect(server.commands.filter(c => c.startsWith("RETR"))).toEqual(["RETR 1201"]);

  // Nothing new: 2 commands after login
  server.commands = [];
  await inbox.getNewMessages();
  expect(server.commands.slice(server.commands.indexOf("STAT"))).toEqual(["STAT", "UIDL 1201", "QUIT"]);

  // Another client deleted an old mail, so the numbers shifted: Full listing again
  server.mails.splice(499, 1);
  server.mails.push(mail("uidl1202", "Mail 1202"));
  server.commands = [];
  newMsgs = await inbox.getNewMessages();
  expect(newMsgs.contents.map(msg => msg.subject)).toEqual(["Mail 1202"]);
  expect(server.commands.filter(c => c.startsWith("UIDL"))).toEqual(["UIDL 1201", "UIDL"]);
  expect(inbox.downloaded.has("uidl500")).toBe(false);
  expect(inbox.downloaded.length).toBe(1201);
}, 60000);

test("Local folders: Sent, move to trash, delete", async () => {
  await server.start();
  let acc = newAccount();
  await acc.loginAndStartup(false);
  let inbox = inboxOf(acc);
  let sent = acc.getSpecialFolder(SpecialFolder.Sent) as POP3Folder;
  let trash = acc.getSpecialFolder(SpecialFolder.Trash) as POP3Folder;
  expect(sent).not.toBe(inbox);
  expect(trash).not.toBe(inbox);
  expect(sent.path).toBe("Sent");

  let composed = sent.newEMail();
  composed.mime = new TextEncoder().encode(mail("", "Reply").mime);
  composed.isRead = true;
  await sent.addMessage(composed);
  expect(sent.messages.length).toBe(1);
  expect(sent.messages.first).not.toBe(composed);
  expect(sent.messages.first.subject).toBe("Reply");
  expect(sent.messages.first.downloadComplete).toBe(true);
  expect(sent.countTotal).toBe(1);
  expect(sent.countUnread).toBe(0);

  let msg = inbox.messages.find(msg => msg.subject == "Second");
  await msg.markRead();
  expect(inbox.countUnread).toBe(2);
  await msg.deleteMessage();
  expect(inbox.messages.length).toBe(2);
  expect(inbox.countTotal).toBe(2);
  expect(trash.messages.contents.map(msg => msg.subject)).toEqual(["Second"]);
  expect(trash.messages.first.isRead).toBe(true);
  expect(trash.messages.first.uidl).toBe(null);
  await trash.messages.first.deleteMessage();
  expect(trash.messages.length).toBe(0);
  // Still on the server, and not downloaded again
  await inbox.getNewMessages();
  expect(inbox.messages.length).toBe(2);
  expect(server.mails.length).toBe(3);

  let sub = await inbox.createSubFolder("Work");
  expect(sub.path).toBe(inbox.path + "/Work");
  await sub.rename("Projects");
  expect(sub.path).toBe(inbox.path + "/Projects");
});

test("Local folders exist, even when the login failed", async () => {
  await server.start();
  let acc = newAccount();
  await acc.readFromDB(); // The app start does this, before the login
  expect(acc.getSpecialFolder(SpecialFolder.Sent).path).toBe("Sent");

  let mail = acc.newEMailFrom();
  expect(mail.folder.specialFolder).toBe(SpecialFolder.Sent);
});
