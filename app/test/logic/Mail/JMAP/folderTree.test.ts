import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import type { TJMAPMethodResponse, TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import type { Folder } from "../../../../logic/Mail/Folder";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => null } as any;

function stalwartMailbox(id: string, name: string, parentId: string | null, role: string | null) {
  return {
    id, name, parentId, role, sortOrder: 0, isSubscribed: true,
    totalEmails: 0, unreadEmails: 0, totalThreads: 0, unreadThreads: 0,
    myRights: {
      mayReadItems: true, mayAddItems: true, mayRemoveItems: true, maySetSeen: true, maySetKeywords: true,
      mayCreateChild: true, mayRename: true, maySubmit: true, mayDelete: true, mayShare: true,
    },
  };
}

/** In the order in which Stalwart returned them once: "Sub" before its parent "Projects".
 * The order varies between calls. */
const kMailboxes = [
  stalwartMailbox("d", "Drafts", null, "drafts"),
  stalwartMailbox("i", "Sub", "h", null),
  stalwartMailbox("b", "Deleted Items", null, "trash"),
  stalwartMailbox("e", "Sent Items", null, "sent"),
  stalwartMailbox("h", "Projects", null, null),
  stalwartMailbox("c", "Junk Mail", null, "junk"),
  stalwartMailbox("a", "Inbox", null, "inbox"),
];

function newAccount(mailboxes: any[]) {
  let account = new JMAPAccount();
  account.accountID = "e";
  account.session = { capabilities: {}, accounts: {}, primaryAccounts: {} } as any as TJMAPSession;
  account.storage = new DummyMailStorage();
  account.makeCalls = async () => [
    ["Mailbox/get", { accountId: "e", state: "sni", list: mailboxes, notFound: [] }, "c1"],
  ] as TJMAPMethodResponse[];
  return account;
}

function names(folders: Iterable<Folder>): Set<string> {
  return new Set([...folders].map(folder => folder.name));
}

function folderNamed(account: JMAPAccount, name: string): Folder {
  return account.getAllFolders().find(folder => folder.name == name);
}

test("A subfolder that the server lists before its parent is put under its parent right away", async () => {
  let account = newAccount(kMailboxes);

  await account.listFolders();

  expect(names(account.rootFolders)).toEqual(new Set(["Drafts", "Deleted Items", "Sent Items", "Projects", "Junk Mail", "Inbox"]));
  expect(names(folderNamed(account, "Projects").subFolders)).toEqual(new Set(["Sub"]));
  expect(folderNamed(account, "Sub").parent.name).toBe("Projects");
});

test("A folder that was moved on the server is moved here, too", async () => {
  let account = newAccount(kMailboxes);
  await account.listFolders();
  let moved = kMailboxes.map(mailbox => mailbox.id == "i" ? { ...mailbox, parentId: null } : mailbox);
  account.makeCalls = newAccount(moved).makeCalls;

  await account.listFolders();

  expect(names(account.rootFolders)).toEqual(new Set(["Drafts", "Deleted Items", "Sent Items", "Projects", "Junk Mail", "Inbox", "Sub"]));
  expect(folderNamed(account, "Projects").subFolders.isEmpty).toBe(true);
  expect(folderNamed(account, "Sub").parent).toBeNull();
});
