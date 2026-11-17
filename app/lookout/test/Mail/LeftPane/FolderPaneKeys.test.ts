// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import type { MailAccount } from "../../../../logic/Mail/MailAccount";
import { Folder } from "../../../../logic/Mail/Folder";
import { RulesTestAccount } from "../Rules/RulesTestAccount";
import LeftPane from "../../../Mail/LeftPane/LeftPane.svelte";
import { renamingFolder } from "../../../Mail/LeftPane/FolderLine.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";

let account: MailAccount;
let app: Record<string, any> | null = null;

beforeAll(() => {
  // happy-dom has no layout
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  localStorage.clear();
  account = RulesTestAccount.create("keys", ["Inbox", "Projects", "Sent"]);
  let projects = RulesTestAccount.folder(account, "Projects");
  let plans = new Folder(account);
  plans.name = "Plans";
  plans.id = "keys-Plans";
  plans.parent = projects;
  projects.subFolders.add(plans);
  appGlobal.emailAccounts.add(account);
  let target = document.createElement("div");
  document.body.append(target);
  app = mount(LeftPane, { target, props: { accounts: appGlobal.emailAccounts, selectedAccount: account, selectedFolder: account.inbox } });
  flushSync();
});

afterEach(() => {
  renamingFolder.set(null);
  unmount(app);
  app = null;
  document.body.innerHTML = "";
  appGlobal.emailAccounts.remove(account);
  localStorage.clear();
});

/** The names of the folder rows, in the order shown */
function shownFolders(): string[] {
  return [...document.querySelectorAll(".folder-row .name")].map(name => name.textContent);
}

function selectedFolderName(): string {
  return document.querySelector(".folder-row.selected .name")?.textContent;
}

function selectedAccountName(): string {
  return document.querySelector(".account-row.selected .name")?.textContent;
}

function folderRow(name: string): HTMLElement {
  return [...document.querySelectorAll<HTMLElement>(".folder-row")].find(row => row.querySelector(".name")?.textContent == name);
}

/** Presses the key on the target, by default the selected folder, which has the focus after a click.
 * @returns whether the folder pane used the key, so that the browser doesn't scroll the pane */
function press(key: string, target: Element = document.querySelector(".folder-row.selected")): boolean {
  let event = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true });
  target.dispatchEvent(event);
  flushSync();
  return event.defaultPrevented;
}

test("Arrow Down and Up select the next and previous folder as shown, skipping collapsed subfolders", () => {
  let shown = shownFolders();
  expect(shown).toContain("Projects");
  expect(shown).not.toContain("Plans");
  expect(selectedFolderName()).toBe(shown[0]);
  for (let i = 1; i < shown.length; i++) {
    expect(press("ArrowDown")).toBe(true);
    expect(selectedFolderName()).toBe(shown[i]);
  }
  // Stays at the last folder, and the pane doesn't scroll
  expect(press("ArrowDown")).toBe(true);
  expect(selectedFolderName()).toBe(shown.at(-1));
  for (let i = shown.length - 2; i >= 0; i--) {
    expect(press("ArrowUp")).toBe(true);
    expect(selectedFolderName()).toBe(shown[i]);
  }
  expect(press("ArrowUp")).toBe(true);
  expect(selectedFolderName()).toBe(shown[0]);
});

test("Home and End select the first and last folder as shown", () => {
  let shown = shownFolders();
  expect(press("End")).toBe(true);
  expect(selectedFolderName()).toBe(shown.at(-1));
  expect(press("End")).toBe(true);
  expect(selectedFolderName()).toBe(shown.at(-1));
  expect(press("Home")).toBe(true);
  expect(selectedFolderName()).toBe(shown[0]);
  expect(press("Home")).toBe(true);
  expect(selectedFolderName()).toBe(shown[0]);
});

test("Arrow Down walks into an expanded subfolder", () => {
  folderRow("Projects").querySelector<HTMLElement>(".expander").click();
  flushSync();
  let shown = shownFolders();
  expect(shown.indexOf("Plans")).toBe(shown.indexOf("Projects") + 1);
  folderRow("Projects").click();
  flushSync();
  press("ArrowDown");
  expect(selectedFolderName()).toBe("Plans");
  press("ArrowDown");
  expect(selectedFolderName()).toBe(shown[shown.indexOf("Plans") + 1]);
  press("ArrowUp");
  press("ArrowUp");
  expect(selectedFolderName()).toBe("Projects");
});

test("Arrow keys, Home and End with modifiers are left alone", () => {
  let before = selectedFolderName();
  for (let key of ["ArrowDown", "End"]) {
    for (let modifier of ["shiftKey", "ctrlKey", "altKey", "metaKey"]) {
      let event = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true, [modifier]: true });
      document.querySelector(".folder-row.selected").dispatchEvent(event);
      flushSync();
      expect(event.defaultPrevented).toBe(false);
    }
  }
  expect(selectedFolderName()).toBe(before);
});

test("Arrow keys, Home and End in the rename field stay in the field", () => {
  renamingFolder.set(account.inbox);
  flushSync();
  let input = document.querySelector(".folder-row.selected input");
  expect(input).toBeTruthy();
  for (let key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
    expect(press(key, input)).toBe(false);
  }
  // The folder that is being renamed stays selected
  expect(document.querySelector(".folder-row.selected input")).toBe(input);
});

test("Arrow Up and Down in the account list select the previous and next entry", () => {
  let entries = [...document.querySelectorAll(".account-row .name")].map(name => name.textContent);
  expect(entries.length).toBeGreaterThan(1);
  expect(selectedAccountName()).toBe(entries.at(-1));
  for (let i = entries.length - 2; i >= 0; i--) {
    expect(press("ArrowUp", document.querySelector(".account-row.selected"))).toBe(true);
    expect(selectedAccountName()).toBe(entries[i]);
  }
  for (let i = 1; i < entries.length; i++) {
    expect(press("ArrowDown", document.querySelector(".account-row.selected"))).toBe(true);
    expect(selectedAccountName()).toBe(entries[i]);
  }
  expect(selectedFolderName()).toBe(shownFolders()[0]);
});

test("Home and End in the account list select the first and last entry", () => {
  let entries = [...document.querySelectorAll(".account-row .name")].map(name => name.textContent);
  expect(press("Home", document.querySelector(".account-row.selected"))).toBe(true);
  expect(selectedAccountName()).toBe(entries[0]);
  expect(press("End", document.querySelector(".account-row.selected"))).toBe(true);
  expect(selectedAccountName()).toBe(entries.at(-1));
  // The folders stay those of the account
  expect(selectedFolderName()).toBe(shownFolders()[0]);
});
