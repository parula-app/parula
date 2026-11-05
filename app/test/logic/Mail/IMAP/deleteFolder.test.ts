import { appGlobal } from "../../../../logic/app";
import { IMAPAccount } from "../../../../logic/Mail/IMAP/IMAPAccount";
import type { IMAPFolder } from "../../../../logic/Mail/IMAP/IMAPFolder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { expect, test } from "vitest";

/** "Projects" has the subfolder "Projects/2025", which has "Projects/2025/Q1".
 * "Projects/2025/Q1" was created on another device, so we don't know it here.
 * "Projects old" only starts with the same name. */
const kServerFolders = ["INBOX", "Projects old", "Projects/2025/Q1", "Projects", "Projects/2025"];

test("Deleting a folder deletes its subfolders on the server, also those we don't know", async () => {
  let { account, deleted } = setUpAccount();
  let projects = newFolder(account, "Projects", null);
  newFolder(account, "Projects/2025", projects);

  await projects.deleteIt();

  expect(new Set(deleted)).toEqual(new Set(["Projects", "Projects/2025", "Projects/2025/Q1"]));
  // RFC 3501 section 6.3.4: The server keeps the subfolders, or refuses to delete their parent
  expect(deleted.indexOf("Projects/2025/Q1")).toBeLessThan(deleted.indexOf("Projects/2025"));
  expect(deleted.indexOf("Projects/2025")).toBeLessThan(deleted.indexOf("Projects"));
  expect(account.rootFolders.contents.map(folder => folder.path)).toEqual(["INBOX"]);
});

test("Deleting a folder without subfolders deletes only that folder", async () => {
  let { account, deleted } = setUpAccount();
  let inbox = account.rootFolders.first as IMAPFolder;
  let projectsOld = newFolder(account, "Projects old", null);

  await projectsOld.deleteIt();

  expect(deleted).toEqual(["Projects old"]);
  expect(account.rootFolders.contents).toEqual([inbox]);
});

function setUpAccount() {
  let deleted: string[] = [];
  appGlobal.remoteApp = {
    createIMAPFlowConnection: () => ({
      id: "test",
      on: () => undefined,
      connect: async () => undefined,
      getMailboxLock: async () => ({ release: () => undefined }),
      list: async () => kServerFolders
        .filter(path => !deleted.includes(path))
        .map(path => ({ path, delimiter: "/" })),
      mailboxDelete: async (path: string) => {
        // Like Stalwart: `NO [HASCHILDREN] Mailbox has children`
        let hasChildren = kServerFolders.some(other => other.startsWith(path + "/") && !deleted.includes(other));
        if (hasChildren) {
          throw new Error("Mailbox has children");
        }
        deleted.push(path);
        return { path };
      },
    }),
  } as any;
  let account = new IMAPAccount();
  account.hostname = "imap.example.com";
  account.username = "me@example.com";
  account.password = "secret";
  account.pathDelimiter = "/";
  account.storage = new DummyMailStorage();
  newFolder(account, "INBOX", null);
  return { account, deleted };
}

function newFolder(account: IMAPAccount, path: string, parent: IMAPFolder | null): IMAPFolder {
  let folder = account.newFolder() as IMAPFolder;
  folder.path = path;
  folder.name = path.split("/").pop();
  folder.parent = parent;
  (parent ? parent.subFolders : account.rootFolders).add(folder);
  return folder;
}
