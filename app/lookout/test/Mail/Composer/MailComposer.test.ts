// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { MailIdentity } from "../../../../logic/Mail/MailIdentity";
import { Folder, SpecialFolder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { sleep } from "../../../../logic/util/util";
import MailComposer from "../../../Mail/Composer/MailComposer.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollTo ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

let account: MailAccount;
let mail: EMail;
let compose: { send: () => Promise<void>, saveAsDraft: () => Promise<void> };
let app: Record<string, any> | null = null;

beforeEach(async () => {
  appGlobal.remoteApp = {} as any;
  account = new MailAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.realname = "Test User";
  account.storage = new DummyMailStorage();
  let identity = new MailIdentity(account);
  identity.emailAddress = account.emailAddress;
  identity.realname = account.realname;
  account.identities.add(identity);
  for (let specialFolder of [SpecialFolder.Inbox, SpecialFolder.Sent, SpecialFolder.Drafts]) {
    let folder = new Folder(account);
    folder.name = folder.id = specialFolder;
    folder.specialFolder = specialFolder;
    account.rootFolders.add(folder);
  }
  appGlobal.emailAccounts.add(account);
  mail = account.newEMailFrom();
  mail.identity = identity;
  mail.subject = "Hello";
  mail.to.add(new PersonUID("fred@example.com", "Fred"));
  compose = { send: vi.fn(async () => {}), saveAsDraft: vi.fn(async () => {}) };
  vi.spyOn(mail, "compose", "get").mockReturnValue(compose as any);

  let target = document.createElement("div");
  document.body.append(target);
  app = mount(MailComposer, { target, props: { mail, autofocus: false } });
  flushSync();
  // The text editor starts asynchronously
  await vi.waitFor(() => expect(document.querySelector(".composer [contenteditable]")).not.toBe(null));
});

afterEach(() => {
  unmount(app);
  app = null;
  document.body.innerHTML = "";
  appGlobal.emailAccounts.remove(account);
  vi.restoreAllMocks();
});

/** Presses the key in the composer and returns whether the composer handled it */
function handled(key: string, init: KeyboardEventInit = {}): boolean {
  let code = /^[a-z]$/i.test(key) ? "Key" + key.toUpperCase() : key;
  let event = new KeyboardEvent("keydown", { key, code, cancelable: true, bubbles: true, ...init });
  document.querySelector(".composer-page").dispatchEvent(event);
  flushSync();
  return event.defaultPrevented;
}

function onMac() {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)");
}

test("Ctrl+Enter and Alt+S send", async () => {
  expect(handled("Enter", { ctrlKey: true })).toBe(true);
  expect(handled("Enter", { metaKey: true })).toBe(true);
  expect(handled("s", { altKey: true })).toBe(true);
  // Alt+S on a Mac keyboard layout gives "ß"
  expect(handled("ß", { code: "KeyS", altKey: true })).toBe(true);
  await sleep(0.01);
  expect(compose.send).toHaveBeenCalledTimes(4);
  expect(compose.saveAsDraft).not.toHaveBeenCalled();
});

test("Ctrl+S saves", async () => {
  expect(handled("s", { ctrlKey: true })).toBe(true);
  await sleep(0.01);
  expect(compose.saveAsDraft).toHaveBeenCalledTimes(1);
  expect(compose.send).not.toHaveBeenCalled();
});

function dialogText(): string {
  return document.querySelector("dialog")?.textContent ?? "";
}

test("Ctrl+K inserts a link", () => {
  expect(handled("k", { ctrlKey: true })).toBe(true);
  expect(dialogText()).toContain("Hyperlink");
});

test("F4 finds", () => {
  expect(handled("F4")).toBe(true);
  expect(dialogText()).toContain("Find what");
  expect(dialogText()).not.toContain("Replace with");
});

test("Ctrl+H replaces", () => {
  expect(handled("h", { metaKey: true })).toBe(true);
  expect(dialogText()).toContain("Replace with");
});

test("Keys don't work while a dialog of the composer is open", async () => {
  expect(handled("k", { ctrlKey: true })).toBe(true);
  expect(handled("s", { ctrlKey: true })).toBe(false);
  await sleep(0.01);
  expect(compose.saveAsDraft).not.toHaveBeenCalled();
});

test("Plain keys and other combinations do nothing", async () => {
  expect(handled("Enter")).toBe(false);
  expect(handled("Enter", { ctrlKey: true, shiftKey: true })).toBe(false);
  expect(handled("S", { ctrlKey: true, shiftKey: true })).toBe(false);
  expect(handled("s", { ctrlKey: true, altKey: true })).toBe(false);
  expect(handled("Enter", { altKey: true })).toBe(false);
  expect(handled("K", { ctrlKey: true, shiftKey: true })).toBe(false);
  expect(handled("F4", { altKey: true })).toBe(false);
  // Ctrl+F is the event form's Forward
  expect(handled("f", { ctrlKey: true })).toBe(false);
  expect(dialogText()).toBe("");
  await sleep(0.01);
  expect(compose.send).not.toHaveBeenCalled();
  expect(compose.saveAsDraft).not.toHaveBeenCalled();
});

test("macOS: Option+S types ß, so it doesn't send", async () => {
  onMac();
  expect(handled("ß", { code: "KeyS", altKey: true })).toBe(false);
  expect(handled("Enter", { metaKey: true })).toBe(true);
  expect(handled("s", { metaKey: true })).toBe(true);
  await sleep(0.01);
  expect(compose.send).toHaveBeenCalledTimes(1);
  expect(compose.saveAsDraft).toHaveBeenCalledTimes(1);
});
