// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import type { MailAccount } from "../../../../logic/Mail/MailAccount";
import { Folder } from "../../../../logic/Mail/Folder";
import { RulesTestAccount } from "../Rules/RulesTestAccount";
import FolderPicker from "../../../Mail/LeftPane/FolderPicker.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, expect, test } from "vitest";

let account: MailAccount;
let app: Record<string, any> | null = null;

beforeAll(() => {
  // happy-dom has no layout
  Element.prototype.scrollIntoView ??= () => {};
});

/** Folders "Inbox", "Projects" with subfolder "Plans", "Archive" (disabled), "Sent" */
function mountPicker(allowAccount: boolean) {
  account = RulesTestAccount.create("picker", ["Inbox", "Projects", "Archive", "Sent"]);
  let projects = RulesTestAccount.folder(account, "Projects");
  let plans = new Folder(account);
  plans.name = "Plans";
  plans.id = "picker-Plans";
  plans.parent = projects;
  projects.subFolders.add(plans);
  appGlobal.emailAccounts.add(account);
  let target = document.createElement("div");
  document.body.append(target);
  app = mount(FolderPicker, { target, props: {
    label: "Folders",
    allowAccount,
    selectedFolder: account.inbox,
    disableFolder: (folder: Folder) => folder.name == "Archive" ? "Not here" : false,
  } });
  flushSync();
}

afterEach(() => {
  unmount(app);
  app = null;
  document.body.innerHTML = "";
  appGlobal.emailAccounts.remove(account);
});

/** The names of the entries that can be selected, in the order shown */
function selectableNames(): string[] {
  return [...document.querySelectorAll(".folder-picker .node:not(.disabled) .name")].map(name => name.textContent);
}

function selectedName(): string {
  return document.querySelector(".folder-picker .node.selected .name")?.textContent;
}

/** @returns whether the picker used the key, so that the browser doesn't scroll it */
function press(key: string): boolean {
  let event = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true });
  document.querySelector(".folder-picker .node.selected").dispatchEvent(event);
  flushSync();
  return event.defaultPrevented;
}

test("Arrow keys, Home and End select the folders as shown, and skip disabled folders and the account", () => {
  mountPicker(false);
  let selectable = selectableNames();
  expect(selectable).toContain("Plans");
  expect(selectable).not.toContain("Archive");
  expect(selectable).not.toContain("picker");
  expect(selectedName()).toBe(selectable[0]);
  for (let i = 1; i < selectable.length; i++) {
    expect(press("ArrowDown")).toBe(true);
    expect(selectedName()).toBe(selectable[i]);
  }
  expect(press("ArrowDown")).toBe(true);
  expect(selectedName()).toBe(selectable.at(-1));
  expect(press("Home")).toBe(true);
  expect(selectedName()).toBe(selectable[0]);
  expect(press("ArrowUp")).toBe(true);
  expect(selectedName()).toBe(selectable[0]);
  expect(press("End")).toBe(true);
  expect(selectedName()).toBe(selectable.at(-1));
});

test("Where an account can be chosen, Home and Arrow Up reach the account", () => {
  mountPicker(true);
  expect(selectableNames()[0]).toBe("picker");
  press("Home");
  expect(selectedName()).toBe("picker");
  press("ArrowDown");
  expect(selectedName()).toBe(selectableNames()[1]);
  press("ArrowUp");
  expect(selectedName()).toBe("picker");
});
