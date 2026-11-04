import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { Folder } from "../../../../logic/Mail/Folder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import type { TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => { throw new Error("The test should not talk to a real server") } } as any;

/** A folder as Stalwart returns it from `Mailbox/get` */
function stalwartMailbox(id: string, name: string, parentId: string | null, role: string | null = null) {
  return {
    id, name, parentId, role, sortOrder: 0, isSubscribed: true,
    totalEmails: 0, unreadEmails: 0, totalThreads: 0, unreadThreads: 0,
    myRights: { mayReadItems: true, mayAddItems: true, mayRemoveItems: true, maySetSeen: true, maySetKeywords: true, mayCreateChild: true, mayRename: true, maySubmit: true, mayDelete: true, mayShare: true },
  };
}

function setup(mailboxes: ReturnType<typeof stalwartMailbox>[]) {
  let account = new JMAPAccount();
  account.accountID = "e";
  account.session = { apiUrl: "http://jmap.example.com/jmap/", capabilities: {}, accounts: {}, primaryAccounts: {}, state: "s1" } as any as TJMAPSession;
  account.storage = new DummyMailStorage();
  account.save = async () => {};
  let errors: Error[] = [];
  account.errorCallback = ex => errors.push(ex);
  let server = { mailboxes };
  account.httpPost = async (url: string, request: any) => ({
    methodResponses: request.methodCalls.map(([method, args, callID]) =>
      [method, { accountId: "e", state: "s1", list: server.mailboxes, notFound: [] }, callID]),
    sessionState: "s1",
  });
  return { account, server, errors: () => [...errors, ...account.dataErrors.contents] };
}

/** Whether `folder` has itself as ancestor. Walks at most `max` steps, so that it ends even then. */
function isOwnAncestor(folder: Folder, max = 100): boolean {
  let current = folder.parent;
  for (let i = 0; current && i < max; i++) {
    if (current == folder) {
      return true;
    }
    current = current.parent;
  }
  return !!current;
}

/** The folder tree as `id: parent id` of the folders that the account shows */
function tree(account: JMAPAccount): Record<string, string | null> {
  let all = account.getAllFolders().contents;
  return Object.fromEntries(all.map(folder => [folder.id, folder.parent?.id ?? null]));
}

function expectSaneTree(account: JMAPAccount, ids: string[]) {
  let all = account.getAllFolders().contents;
  expect(all.map(folder => folder.id).sort()).toEqual([...ids].sort()); // each folder shown exactly once
  for (let folder of all) {
    expect(isOwnAncestor(folder), folder.name).toBe(false);
    expect(folder.parent ? folder.parent.subFolders.contains(folder) : account.rootFolders.contains(folder), folder.name).toBe(true);
  }
}

test.each([
  ["its own parent", { k: "k" }],
  ["the parent of its parent", { k: "p", p: "k" }],
  ["a subfolder of its subfolder's subfolder", { k: "q", p: "k", q: "p" }],
])("A folder that the server made %s stays in the folder list", async (_, parents: Record<string, string>) => {
  let mailboxes = [stalwartMailbox("a", "Inbox", null, "inbox"),
    ...Object.entries(parents).map(([id, parentId]) => stalwartMailbox(id, "Folder " + id, parentId))];
  let { account, errors } = setup(mailboxes);

  await account.listFolders();
  expectSaneTree(account, mailboxes.map(mailbox => mailbox.id));
  await account.listFolders(); // e.g. after a folder changed

  expectSaneTree(account, mailboxes.map(mailbox => mailbox.id));
  expect(errors().length).toBeGreaterThan(0);
});

test("A folder moved into its former subfolder on another device is moved here, too", async () => {
  // p was a subfolder of k. Then p was moved to the top, and k into p.
  let { account, server, errors } = setup([stalwartMailbox("a", "Inbox", null, "inbox"), stalwartMailbox("k", "Projects", null), stalwartMailbox("p", "Mustang", "k")]);
  await account.listFolders();
  expect(tree(account)).toEqual({ a: null, k: null, p: "k" });
  server.mailboxes = [stalwartMailbox("a", "Inbox", null, "inbox"), stalwartMailbox("k", "Projects", "p"), stalwartMailbox("p", "Mustang", null)];

  await account.listFolders();

  expectSaneTree(account, ["a", "k", "p"]);
  expect(account.getAllFolders().find(folder => folder.id == "k").parent?.id).toBe("p");
  expect(errors()).toEqual([]);
});

test("Normal folder trees and moves still work", async () => {
  let { account, server, errors } = setup([stalwartMailbox("a", "Inbox", null, "inbox"), stalwartMailbox("k", "Projects", null), stalwartMailbox("p", "Mustang", "k"), stalwartMailbox("q", "Release", "p")]);
  await account.listFolders();
  expect(tree(account)).toEqual({ a: null, k: null, p: "k", q: "p" });
  server.mailboxes = [stalwartMailbox("a", "Inbox", null, "inbox"), stalwartMailbox("k", "Projects", null), stalwartMailbox("p", "Mustang", "a"), stalwartMailbox("q", "Release", "k")];

  await account.listFolders();

  expect(tree(account)).toEqual({ a: null, k: null, p: "a", q: "k" });
  expectSaneTree(account, ["a", "k", "p", "q"]);
  expect(account.getAllFolders().find(folder => folder.id == "q").fullPath).toBe("Projects/Release");
  expect(errors()).toEqual([]);
});
