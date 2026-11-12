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
import LookoutComposerWindow from "../../../Mail/Composer/ComposerWindow.svelte";
import { mailMustangApp } from "../../../../frontend/Mail/MailMustangApp";
import { AppWindow } from "../../../../frontend/MainWindow/AppWindow";
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
let compose: { send: (onClose: () => void) => Promise<void>, saveAsDraft: () => Promise<void> };
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
  if (app) {
    unmount(app);
  }
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

/** Stands in for the composer's own window */
class ComposerWindow extends AppWindow {
  constructor() {
    super(window, "composer", AppWindow.main);
  }
}

/** Mounts the composer again, as in its own window */
async function mountInComposerWindow(): Promise<ComposerWindow> {
  unmount(app);
  document.body.innerHTML = "";
  let composerWindow = new ComposerWindow();
  vi.spyOn(composerWindow, "close").mockImplementation(() => {});
  let target = document.createElement("div");
  document.body.append(target);
  app = mount(MailComposer, { target, props: { mail, autofocus: false }, context: new Map([["appWindow", composerWindow]]) });
  flushSync();
  await vi.waitFor(() => expect(document.querySelector(".composer [contenteditable]")).not.toBe(null));
  return composerWindow;
}

function popOutButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>(".title-buttons button")]
    .find(button => button.textContent.includes("Pop Out"));
}

const kOwnText = "<p>" + "This is what I want to say about it. ".repeat(4) + "</p>";

test("Pop Out on the composer page opens Lookout's composer in its own window", async () => {
  let open = vi.spyOn(AppWindow.prototype, "open").mockImplementation(async () => null);
  vi.spyOn(AppWindow.main.window.history, "go").mockImplementation(() => {});
  popOutButton().click();
  await sleep(0.01);
  expect(open).toHaveBeenCalledWith(LookoutComposerWindow, { mail }, 1000);
});

test("In its own window, the composer has no Pop Out, and Close closes the window", async () => {
  let composerWindow = await mountInComposerWindow();
  expect(popOutButton()).toBeUndefined();
  document.querySelector<HTMLButtonElement>(".title-buttons .close").click();
  flushSync();
  expect(composerWindow.close).toHaveBeenCalledTimes(1);
  unmount(app);
  app = null;
  await sleep(0.01);
  expect(compose.saveAsDraft).not.toHaveBeenCalled();
});

test("When the user closes the composer's window, it saves the draft, if the user wrote text", async () => {
  await mountInComposerWindow();
  unmount(app);
  app = null;
  await sleep(0.01);
  expect(compose.saveAsDraft).not.toHaveBeenCalled();

  await mountInComposerWindow();
  // The sanitizer doesn't work in happy-dom
  vi.spyOn(mail, "html", "get").mockReturnValue(kOwnText);
  unmount(app);
  app = null;
  await sleep(0.01);
  expect(compose.saveAsDraft).toHaveBeenCalledTimes(1);
});

test("Send closes the composer's window, and a failed send opens the composer again", async () => {
  let composerWindow = await mountInComposerWindow();
  let writeMail = vi.spyOn(mailMustangApp, "writeMail").mockImplementation(() => {});
  compose.send = vi.fn(async (onClose: () => void) => onClose());
  expect(handled("Enter", { ctrlKey: true })).toBe(true);
  await sleep(0.01);
  expect(composerWindow.close).toHaveBeenCalledTimes(1);
  expect(writeMail).not.toHaveBeenCalled();

  composerWindow = await mountInComposerWindow();
  vi.spyOn(console, "error").mockImplementation(() => {});
  compose.send = vi.fn(async (onClose: () => void) => {
    onClose();
    throw new Error("Server not reachable");
  });
  expect(handled("Enter", { ctrlKey: true })).toBe(true);
  await sleep(0.01);
  expect(composerWindow.close).toHaveBeenCalledTimes(1);
  expect(writeMail).toHaveBeenCalledWith(mail);
});
