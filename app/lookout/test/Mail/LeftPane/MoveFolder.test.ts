// @vitest-environment happy-dom
import { RulesTestAccount } from "../Rules/RulesTestAccount";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { FolderTreeActions } from "../../../Mail/LeftPane/FolderTreeActions";
import { expect, test } from "vitest";

test("A folder moves into another folder of the same account", async () => {
  let account = RulesTestAccount.create("move", ["Inbox", "Projects", "Archive"]);
  let projects = RulesTestAccount.folder(account, "Projects");
  let archive = RulesTestAccount.folder(account, "Archive");
  expect(FolderTreeActions.canMoveFolderInto(projects, archive)).toBe(true);

  await FolderTreeActions.moveFolder(projects, archive);
  expect(projects.parent).toBe(archive);
  expect(archive.subFolders.contains(projects)).toBe(true);
  expect(account.rootFolders.contains(projects)).toBe(false);
  expect(FolderTreeActions.canMoveFolderInto(projects, archive)).toBe(false);
});

test("A folder cannot move into itself, its subfolders or another account", async () => {
  let account = RulesTestAccount.create("tree", ["Inbox", "Projects", "Archive"]);
  let projects = RulesTestAccount.folder(account, "Projects");
  let archive = RulesTestAccount.folder(account, "Archive");
  await FolderTreeActions.moveFolder(archive, projects);
  expect(FolderTreeActions.canMoveFolderInto(projects, projects)).toBe(false);
  expect(FolderTreeActions.canMoveFolderInto(projects, archive)).toBe(false);

  let otherAccount = RulesTestAccount.create("second", ["Inbox", "Projects"]);
  expect(FolderTreeActions.canMoveFolderInto(projects, RulesTestAccount.folder(otherAccount, "Projects"))).toBe(false);
  await expect(FolderTreeActions.moveFolder(projects, archive)).rejects.toThrow();
});

test("Folders with a special use cannot move", () => {
  let account = RulesTestAccount.create("special", ["Inbox", "Sent", "Archive"]);
  let sent = RulesTestAccount.folder(account, "Sent");
  sent.specialFolder = SpecialFolder.Sent;
  expect(FolderTreeActions.disableMove(account.inbox)).toBeTruthy();
  expect(FolderTreeActions.disableMove(sent)).toBeTruthy();
  expect(FolderTreeActions.disableMove(RulesTestAccount.folder(account, "Archive"))).toBe(false);
  expect(FolderTreeActions.canMoveFolderInto(sent, RulesTestAccount.folder(account, "Archive"))).toBe(false);
});
