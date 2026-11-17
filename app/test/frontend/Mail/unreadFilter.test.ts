// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { MailAccount } from "../../../logic/Mail/MailAccount";
import { Folder, SpecialFolder } from "../../../logic/Mail/Folder";
import type { EMail } from "../../../logic/Mail/EMail";
import { DummyMailStorage } from "../../../logic/Mail/Store/DummyMailStorage";
import { findOrCreatePersonUID } from "../../../logic/Abstract/PersonUID";
import { sleep } from "../../../logic/util/util";
import { quickSearch, selectedAccount, selectedFolder, selectedMessage } from "../../../frontend/Mail/Selected";
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
  // happy-dom has no layout, and a list of height 0 shows no rows
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    get() { return this.classList.contains("fast-list") ? 500 : 20; },
  });
});

/** The messages that the app marked as read */
let markedRead: EMail[] = [];

/** Newest first: Unread 0, Unread 1, Read 2, Unread 3 */
function newTestInbox(): Folder {
  appGlobal.remoteApp = {} as any;
  let account = new MailAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.storage = new DummyMailStorage();
  account.contentStorage.clear();
  let folder = new Folder(account);
  folder.name = "INBOX";
  folder.id = "INBOX";
  folder.specialFolder = SpecialFolder.Inbox;
  account.rootFolders.add(folder);
  for (let i = 0; i < 4; i++) {
    let email = folder.newEMail();
    email.id = `msg${i}@example.com`;
    email.pID = email.id;
    email.isRead = i == 2;
    email.subject = (email.isRead ? "Read " : "Unread ") + i;
    email.sent = new Date(2026, 8, 1, 12, -i);
    email.received = email.sent;
    email.from = findOrCreatePersonUID("alice@example.com", "Alice");
    email.contact = email.from;
    email.markRead = async function(read = true) {
      markedRead.push(this);
      this.isRead = read;
    };
    folder.messages.add(email);
  }
  appGlobal.emailAccounts.add(account);
  return folder;
}

let app: Record<string, any> | null = null;
let target: HTMLElement;

async function mountMailApp(folder: Folder, message: EMail) {
  selectedAccount.set(folder.account);
  selectedFolder.set(folder);
  selectedMessage.set(message);
  target = document.createElement("div");
  document.body.append(target);
  app = mount(MailApp, { target });
  flushSync();
  // The list measures its rows asynchronously, and shows only a few rows before
  await sleep(0.01);
  flushSync();
}

afterEach(() => {
  if (app) {
    unmount(app);
    app = null;
  }
  target?.remove();
  quickSearch.reset();
  selectedMessage.set(null);
  markedRead = [];
});

function subjectElements(): HTMLElement[] {
  return [...target.querySelectorAll<HTMLElement>(".message-list .row .subject")];
}

function shownSubjects(): string[] {
  return subjectElements().map(subjectE => subjectE.textContent.trim());
}

async function clickMessage(subject: string) {
  subjectElements().find(subjectE => subjectE.textContent.trim() == subject).click();
  flushSync();
  await sleep(0.5);
  flushSync();
}

async function clickUnreadFilter() {
  target.querySelector<HTMLButtonElement>(`button[title="Show only unread messages"]`).click();
  flushSync();
  // `FolderFooter` filters asynchronously, and the message header marks as read after 0.2 s
  await sleep(0.5);
  flushSync();
}

test("Turning on the unread filter while a read message is selected marks no message as read", async () => {
  let inbox = newTestInbox();
  let readMessage = inbox.messages.find(message => message.isRead);
  await mountMailApp(inbox, readMessage);
  expect(shownSubjects()).toEqual(["Unread 0", "Unread 1", "Read 2", "Unread 3"]);

  await clickUnreadFilter();
  expect(shownSubjects()).toEqual(["Unread 0", "Unread 1", "Unread 3"]);
  // The list had selected "Unread 3", which took the position of "Read 2", and marked it as read
  expect(get(selectedMessage)).toBeNull();
  expect(markedRead.map(message => message.subject)).toEqual([]);
  expect(inbox.messages.filterOnce(message => !message.isRead).length).toBe(3);
});

test("With the unread filter on, only the message that the user selects is marked as read", async () => {
  let inbox = newTestInbox();
  let readMessage = inbox.messages.find(message => message.isRead);
  await mountMailApp(inbox, readMessage);
  await clickUnreadFilter();

  await clickMessage("Unread 1");
  let unread1 = inbox.messages.find(message => message.subject == "Unread 1");
  expect(markedRead.map(message => message.subject)).toEqual(["Unread 1"]);
  expect(get(selectedMessage)).toBe(unread1);

  // Turning the filter off keeps the selected message
  await clickUnreadFilter();
  expect(shownSubjects()).toEqual(["Unread 0", "Unread 1", "Read 2", "Unread 3"]);
  expect(get(selectedMessage)).toBe(unread1);
  expect(markedRead.map(message => message.subject)).toEqual(["Unread 1"]);
});
