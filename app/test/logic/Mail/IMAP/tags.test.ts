// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { IMAPAccount, ConnectionPurpose } from "../../../../logic/Mail/IMAP/IMAPAccount";
import type { IMAPFolder } from "../../../../logic/Mail/IMAP/IMAPFolder";
import type { IMAPEMail } from "../../../../logic/Mail/IMAP/IMAPEMail";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { getTagByName } from "../../../../logic/Abstract/Tag";
import { Person } from "../../../../logic/Abstract/Person";
import { expect, test } from "vitest";

appGlobal.me = new Person(); // as `startup.ts` does

/** What the server answers to `SELECT INBOX`, as ImapFlow's `mailboxOpen()` returns it */
let inboxInfo: any;

function newAccount(): IMAPAccount {
  appGlobal.remoteApp = {
    createIMAPFlowConnection: () => ({
      id: "test",
      on: () => undefined,
      connect: async () => undefined,
      mailboxOpen: async (path: string) => ({ path, ...inboxInfo }),
    }),
  } as any;
  let account = new IMAPAccount();
  account.hostname = "imap.example.com";
  account.username = "me@example.com";
  account.emailAddress = "me@example.com";
  account.password = "secret";
  account.storage = new DummyMailStorage();
  let inbox = account.newFolder() as IMAPFolder;
  inbox.path = "INBOX";
  inbox.specialFolder = SpecialFolder.Inbox;
  account.rootFolders.add(inbox);
  return account;
}

function newEMail(account: IMAPAccount): IMAPEMail {
  return account.inbox.newEMail() as IMAPEMail;
}

function tagNames(email: IMAPEMail): string[] {
  return email.tags.contents.map(tag => tag.name).sort();
}

/** Like ImapFlow opens the Inbox for IDLE, after the login and after each reconnect */
async function openInbox(account: IMAPAccount) {
  await account.startIDLE(await account.connection(false, ConnectionPurpose.Main));
}

test("A keyword that was removed on another device is removed here", () => {
  let account = newAccount();
  account.canStoreKeywords = true;
  let email = newEMail(account);
  email.setFlagsLocal(new Set(["\\Seen", "Work", "Private"]));

  email.setFlagsLocal(new Set(["\\Seen", "Private"]));

  expect(tagNames(email)).toEqual(["Private"]);
});

test("On a server that can't store keywords, a tag that the user set here stays", () => {
  let account = newAccount();
  account.canStoreKeywords = false;
  let email = newEMail(account);
  email.tags.add(getTagByName("Work")); // The server ignored it, so only we have it

  email.setFlagsLocal(new Set(["\\Seen", "Later"]));

  expect(tagNames(email)).toEqual(["Later", "Work"]);
});

test("The Inbox tells whether the server can store keywords", async () => {
  inboxInfo = { permanentFlags: new Set(["\\Seen", "\\Flagged", "\\*"]) };
  let account = newAccount();
  await openInbox(account);
  expect(account.canStoreKeywords).toBe(true);

  // RFC 9051 section 7.1: Without `\*`, a new keyword can't be stored
  inboxInfo = { permanentFlags: new Set(["\\Seen", "\\Flagged", "\\Deleted"]) };
  account = newAccount();
  await openInbox(account);
  expect(account.canStoreKeywords).toBe(false);

  // RFC 9051 section 6.3.2: Without PERMANENTFLAGS, all flags are permanent
  inboxInfo = {};
  account = newAccount();
  await openInbox(account);
  expect(account.canStoreKeywords).toBe(true);
});

test("After a restart, the first sync knows whether the server can store keywords", async () => {
  inboxInfo = { permanentFlags: new Set(["\\Seen", "\\*"]) };
  let account = newAccount();
  await openInbox(account);

  // The app starts again: The first sync of the Inbox runs before it is opened for IDLE
  let restarted = newAccount();
  restarted.fromConfigJSON(JSON.parse(JSON.stringify(account.toConfigJSON())));
  let email = newEMail(restarted);
  email.setFlagsLocal(new Set(["Work"]));
  email.setFlagsLocal(new Set([]));

  expect(tagNames(email)).toEqual([]);
});
