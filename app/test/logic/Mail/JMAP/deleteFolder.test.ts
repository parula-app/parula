import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { JMAPFolder } from "../../../../logic/Mail/JMAP/JMAPFolder";
import type { TJMAPMethodResponse, TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => null } as any;

/** "Projects" (w) has the subfolder "2025" (x). "Q1" (y) in "2025" was created on another device,
 * so we don't know it here. Recorded from Stalwart: It lists children before their parents. */
const kMailboxGetResponse = {
  accountId: "e", state: "sni",
  list: [
    { parentId: null, id: "a" }, { parentId: null, id: "c" }, { parentId: null, id: "m" },
    { parentId: null, id: "d" }, { parentId: null, id: "b" }, { parentId: null, id: "w" },
    { parentId: "k", id: "l" }, { parentId: "x", id: "y" }, { parentId: "w", id: "x" },
    { parentId: null, id: "h" }, { parentId: null, id: "e" }, { parentId: null, id: "p" },
    { parentId: null, id: "k" }, { parentId: null, id: "j" }, { parentId: "h", id: "i" },
  ],
  notFound: [],
};

function newAccount(serverResponses: (call: [string, Record<string, any>, string]) => Record<string, any>) {
  let account = new JMAPAccount();
  account.accountID = "e";
  account.session = { capabilities: {}, accounts: {}, primaryAccounts: {} } as any as TJMAPSession;
  let calls: [string, Record<string, any>, string][] = [];
  account.makeCalls = async (requests: [string, Record<string, any>, string?][]) => {
    return requests.map(call => {
      calls.push(call as [string, Record<string, any>, string]);
      return [call[0], serverResponses(call as [string, Record<string, any>, string]), call[2] ?? "c1"] as TJMAPMethodResponse;
    });
  };
  return { account, calls };
}

function newFolder(account: JMAPAccount, id: string, name: string, parent: JMAPFolder | null): JMAPFolder {
  let folder = account.newFolder();
  folder.id = id;
  folder.name = name;
  folder.myRights = { mayDelete: true } as any;
  folder.parent = parent;
  (parent ? parent.subFolders : account.rootFolders).add(folder);
  return folder;
}

test("Deleting a folder deletes its subfolders and emails on the server", async () => {
  let { account, calls } = newAccount(call => call[0] == "Mailbox/get"
    ? kMailboxGetResponse
    : { accountId: "e", oldState: "sni", newState: "snu", destroyed: ["y", "x", "w"] });
  newFolder(account, "a", "Inbox", null);
  let projects = newFolder(account, "w", "Projects", null);
  newFolder(account, "x", "2025", projects);

  await projects.deleteIt();

  let destroyCalls = calls.filter(call => call[0] == "Mailbox/set").map(call => call[1]);
  expect(destroyCalls.every(call => call.onDestroyRemoveEmails)).toBe(true);
  let destroyed: string[] = destroyCalls.flatMap(call => call.destroy ?? []);
  // Including "Q1", which we didn't know
  expect(new Set(destroyed)).toEqual(new Set(["y", "x", "w"]));
  // Children before their parent, because Stalwart destroys in this order
  expect(destroyed.indexOf("y")).toBeLessThan(destroyed.indexOf("x"));
  expect(destroyed.indexOf("x")).toBeLessThan(destroyed.indexOf("w"));
  expect(account.getAllFolders().contents.map(folder => folder.id)).toEqual(["a"]);
});

test("Deleting a folder that the server refuses to delete throws", async () => {
  let { account } = newAccount(call => call[0] == "Mailbox/get"
    ? kMailboxGetResponse
    : {
      accountId: "e", oldState: "sni", newState: "sni",
      notDestroyed: {
        w: { type: "mailboxHasChild", description: "Mailbox has at least one children." },
      },
    });
  let projects = newFolder(account, "w", "Projects", null);

  await expect(projects.deleteIt()).rejects.toThrow("Mailbox has at least one children");
});
