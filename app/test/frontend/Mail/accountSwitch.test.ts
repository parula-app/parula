// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { MailAccount } from "../../../logic/Mail/MailAccount";
import { Folder, SpecialFolder } from "../../../logic/Mail/Folder";
import { DummyMailStorage } from "../../../logic/Mail/Store/DummyMailStorage";
import { selectedAccount, selectedFolder } from "../../../frontend/Mail/Selected";
import MailApp from "../../../frontend/Mail/MailApp.svelte";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeAll, expect, test } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let mailApp: Record<string, any> | null = null;

afterEach(() => {
  mailApp && unmount(mailApp);
  mailApp = null;
});

function newTestAccount(name: string, folderNames: string[]): MailAccount {
  appGlobal.remoteApp = {} as any;
  let account = new MailAccount();
  account.name = name;
  account.emailAddress = `${name}@example.com`;
  account.storage = new DummyMailStorage();
  for (let folderName of folderNames) {
    let folder = new Folder(account);
    folder.name = folderName;
    folder.id = `${name}-${folderName}`;
    if (folderName == "Inbox") {
      folder.specialFolder = SpecialFolder.Inbox;
    } else if (folderName == "Sent") {
      folder.specialFolder = SpecialFolder.Sent;
    }
    account.rootFolders.add(folder);
  }
  return account;
}

function newSubFolder(parent: Folder, name: string): Folder {
  let folder = new Folder(parent.account);
  folder.name = name;
  folder.id = parent.id + "-" + name;
  folder.parent = parent;
  parent.subFolders.add(folder);
  return folder;
}

function shownFolderNames(target: HTMLElement): string[] {
  return [...target.querySelectorAll(".folder-list .row")].map(rowE => rowE.textContent.trim());
}

test("Switching the account lists and selects the folders of the new account", () => {
  let accountA = newTestAccount("A", ["Inbox", "Sent", "Parent"]);
  let subFolder = newSubFolder(accountA.rootFolders.find(folder => folder.name == "Parent"), "Subfolder");
  // More folders than account A, so that the old list position picks the wrong one
  let accountB = newTestAccount("B", ["Inbox", "Sent", "Archive", "Drafts", "Spam"]);
  appGlobal.emailAccounts.addAll([accountA, accountB]);

  selectedAccount.set(accountA);
  selectedFolder.set(subFolder);
  let target = document.createElement("div");
  document.body.append(target);
  mailApp = mount(MailApp, { target });
  flushSync();
  expect(shownFolderNames(target)[0]).toEqual("Inbox");
  expect(get(selectedFolder)).toBe(subFolder);

  selectedAccount.set(accountB);
  flushSync();
  // The subfolder of account A was listed above the inbox of account B, and stayed selected
  expect(shownFolderNames(target)).not.toContain("Subfolder");
  expect(shownFolderNames(target)[0]).toEqual("Inbox");
  expect(get(selectedFolder)).toBe(accountB.inbox);
});

test("Adding a top-level folder keeps the selected subfolder selected", () => {
  let account = newTestAccount("C", ["Inbox", "Sent", "Parent", "Archive"]);
  let subFolder = newSubFolder(account.rootFolders.find(folder => folder.name == "Parent"), "Subfolder");
  appGlobal.emailAccounts.add(account);

  selectedAccount.set(account);
  selectedFolder.set(subFolder);
  let target = document.createElement("div");
  document.body.append(target);
  mailApp = mount(MailApp, { target });
  flushSync();
  expect(get(selectedFolder)).toBe(subFolder);

  let newFolder = new Folder(account);
  newFolder.name = "New";
  newFolder.id = "C-New";
  account.rootFolders.add(newFolder);
  flushSync();
  // The tree showed only the top-level folders again, without the selected subfolder
  expect(get(selectedFolder)).toBe(subFolder);
});
