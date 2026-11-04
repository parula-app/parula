import { RecentFolders, type RecentFolderRef } from "../../Mail/RecentFolders";
import { expect, test } from "vitest";

// Minimal stand-ins for `MailAccount` and `Folder`
function makeAccount(id: string, folderIDs: string[]): any {
  let account: any = { id };
  account.folders = folderIDs.map(folderID => ({ id: folderID, account }));
  account.findFolder = (filter: (folder: any) => boolean) => account.folders.find(filter) ?? null;
  return account;
}

function folderOf(account: any, id: string): any {
  return account.folders.find((folder: any) => folder.id == id);
}

test("Newest first, no duplicates", () => {
  let setting = { value: [] as RecentFolderRef[] };
  let recent = new RecentFolders(setting);
  let account = makeAccount("a1", ["inbox", "work", "family"]);
  recent.add(folderOf(account, "work"));
  recent.add(folderOf(account, "family"));
  recent.add(folderOf(account, "work"));
  expect(recent.folders([account]).map(folder => folder.id)).toEqual(["work", "family"]);
  expect(setting.value).toEqual([
    { accountID: "a1", folderID: "work" },
    { accountID: "a1", folderID: "family" },
  ]);
});

test("Same folder ID in two accounts are different folders", () => {
  let recent = new RecentFolders({ value: [] });
  let account1 = makeAccount("a1", ["inbox"]);
  let account2 = makeAccount("a2", ["inbox"]);
  recent.add(folderOf(account1, "inbox"));
  recent.add(folderOf(account2, "inbox"));
  let folders = recent.folders([account1, account2]);
  expect(folders.map(folder => folder.account.id)).toEqual(["a2", "a1"]);
});

test("At most 10 folders", () => {
  let ids = Array.from({ length: 12 }, (_, i) => "f" + i);
  let account = makeAccount("a1", ids);
  let recent = new RecentFolders({ value: [] });
  for (let id of ids) {
    recent.add(folderOf(account, id));
  }
  let folders = recent.folders([account]);
  expect(folders.length).toBe(10);
  expect(folders[0].id).toBe("f11");
  expect(folders[9].id).toBe("f2");
});

test("Deleted folders and removed accounts are skipped", () => {
  let setting = { value: [
    { accountID: "a1", folderID: "gone" },
    { accountID: "a1", folderID: "work" },
    { accountID: "removed", folderID: "inbox" },
  ] };
  let recent = new RecentFolders(setting);
  let account = makeAccount("a1", ["work"]);
  expect(recent.folders([account]).map(folder => folder.id)).toEqual(["work"]);
});

test("Folders without ID or account are not remembered", () => {
  let setting = { value: [] as RecentFolderRef[] };
  let recent = new RecentFolders(setting);
  recent.add({ id: null, account: { id: "a1" } } as any);
  recent.add({ id: "x", account: null } as any);
  expect(setting.value).toEqual([]);
});
