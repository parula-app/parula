// @vitest-environment happy-dom
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { selectedFolder } from "../../../../frontend/Mail/Selected";
import FolderListHarness from "./FolderListHarness.svelte";
import { flushSync, mount } from "svelte";
import { get } from "svelte/store";
import { beforeAll, expect, test } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // happy-dom has no layout, and a list of height 0 shows no rows
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    get() { return this.classList.contains("fast-list") ? 500 : 20; },
  });
});

function newAccount(): MailAccount {
  let account = new MailAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.storage = new DummyMailStorage();
  for (let [name, specialFolder] of [["Inbox", SpecialFolder.Inbox], ["Sent", SpecialFolder.Sent]]) {
    let folder = account.newFolder();
    folder.name = folder.id = name;
    folder.specialFolder = specialFolder as SpecialFolder;
    account.rootFolders.add(folder);
  }
  return account;
}

test("A folder that was selected from elsewhere is highlighted", () => {
  let account = newAccount();
  selectedFolder.set(account.inbox);
  let target = document.createElement("div");
  document.body.append(target);
  mount(FolderListHarness, { target, props: { folders: account.rootFolders } });
  flushSync();
  expect(highlightedRows(target)).toEqual(["Inbox"]);

  // e.g. the user opens their reply, which is in the Sent folder
  selectedFolder.set(account.getSpecialFolder(SpecialFolder.Sent));
  flushSync();

  expect(highlightedRows(target)).toEqual(["Sent"]);
  target.remove();
});

test("The list's own selection changes are not taken as a selection from elsewhere", () => {
  let account = newAccount();
  selectedFolder.set(account.inbox);
  let target = document.createElement("div");
  document.body.append(target);
  mount(FolderListHarness, { target, props: { folders: account.rootFolders } });
  flushSync();

  // Ctrl+click adds Sent to the selection
  ctrlClick(target, "Sent");
  expect(highlightedRows(target)).toEqual(["Inbox", "Sent"]);
  expect(get(selectedFolder)).toBe(account.inbox);

  // Selecting a folder that is already selected keeps the other one
  selectedFolder.set(account.getSpecialFolder(SpecialFolder.Sent));
  flushSync();
  expect(highlightedRows(target)).toEqual(["Inbox", "Sent"]);

  // Ctrl+click on Inbox removes it, and the list makes Sent the selected folder
  ctrlClick(target, "Inbox");
  expect(highlightedRows(target)).toEqual(["Sent"]);
  expect(get(selectedFolder)).toBe(account.getSpecialFolder(SpecialFolder.Sent));
  target.remove();
});

function ctrlClick(target: HTMLElement, name: string) {
  let row = [...target.querySelectorAll(".row")].find(row => row.textContent.trim() == name);
  row.dispatchEvent(new MouseEvent("click", { ctrlKey: true, bubbles: true }));
  flushSync();
}

function highlightedRows(target: HTMLElement): string[] {
  return [...target.querySelectorAll(".row.selected")]
    .map(row => row.textContent.trim());
}
