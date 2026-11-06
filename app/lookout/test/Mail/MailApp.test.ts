// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { MailAccount } from "../../../logic/Mail/MailAccount";
import { Folder, SpecialFolder } from "../../../logic/Mail/Folder";
import type { EMail } from "../../../logic/Mail/EMail";
import { DummyMailStorage } from "../../../logic/Mail/Store/DummyMailStorage";
import { newSearchEMail } from "../../../logic/Mail/Store/setStorage";
import { SavedSearchFolder, savedSearchFolders } from "../../../logic/Mail/Virtual/SavedSearchFolder";
import { findOrCreatePersonUID } from "../../../logic/Abstract/PersonUID";
import { sleep } from "../../../logic/util/util";
import MailApp from "../../Mail/MailApp.svelte";
import { MessageActions } from "../../Mail/MessageActions";
import { SearchScope } from "../../Mail/Search/MailSearch";
import { mailSearchInput } from "../../Mail/Search/MailSearchBox.svelte";
import { isAdvancedSearchOpen, searchOptions } from "../../Mail/Selected";
import { openMoveMessages } from "../../Mail/Message/MessageMovePopup.svelte";
import { openNewFolder } from "../../Mail/LeftPane/NewFolderDialog.svelte";
import { openNewSearchFolder } from "../../Mail/Search/NewSearchFolderDialog.svelte";
import { printMessage } from "../../Mail/Message/MessagePrint.svelte";
import { statusBarContent } from "../../MainWindow/StatusBar.svelte";
import { selectedAccount, selectedFolder, selectedMessage, selectedMessages } from "../../../frontend/Mail/Selected";
import { globalSearchTerm, openApp } from "../../../frontend/AppsBar/selectedApp";
import { mailMustangApp } from "../../../frontend/Mail/MailMustangApp";
import { contactsMustangApp } from "../../../frontend/Contacts/ContactsMustangApp";
import { ArrayColl } from "svelte-collections";
import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
import { flushSync, mount, unmount } from "svelte";
import { get, writable } from "svelte/store";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

vi.mock("../../../frontend/AppsBar/selectedApp", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../frontend/AppsBar/selectedApp")>(),
  openApp: vi.fn(),
}));

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
  Element.prototype.scrollTo ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

/** What the keys did to the messages */
let done: string[] = [];
let inbox: Folder;
let app: Record<string, any> | null = null;

/** Newest first: Message 0, Message 1, Message 2 */
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
  folder.listMessages = async () => folder.messages;
  account.rootFolders.add(folder);
  for (let i = 0; i < 3; i++) {
    let email = folder.newEMail();
    email.id = `msg${i}@example.com`;
    email.pID = email.id;
    email.isRead = true;
    email.subject = "Message " + i;
    email.sent = new Date(2026, 8, 1, 12, -i);
    email.received = email.sent;
    email.from = findOrCreatePersonUID("alice@example.com", "Alice");
    email.contact = email.from;
    email.markRead = async (read = true) => { done.push(`${email.subject} read ${read}`) };
    email.markStarred = async (starred = true) => { done.push(`${email.subject} flagged ${starred}`) };
    email.treatSpam = async (spam = true) => { done.push(`${email.subject} junk ${spam}`) };
    email.deleteMessage = async () => { done.push(`${email.subject} deleted`) };
    email.loadBody = async () => {};
    folder.messages.add(email);
  }
  appGlobal.emailAccounts.add(account);
  return folder;
}

beforeEach(async () => {
  inbox = newTestInbox();
  selectedAccount.set(inbox.account);
  selectedFolder.set(inbox);
  selectedMessage.set(null);
  selectedMessages.set(new ArrayColl<EMail>());
  let target = document.createElement("div");
  document.body.append(target);
  // MailApp reads the route's location, so it needs svelte-navigator's router context
  let context = new Map<string, any>([
    ["@@svnav-ctx__ROUTER", {}],
    ["@@svnav-ctx__LOCATION", writable({ pathname: "/mail", state: null })],
  ]);
  app = mount(MailApp, { target, context });
  flushSync();
  // The list measures its rows asynchronously
  await sleep(0.01);
  flushSync();
});

afterEach(() => {
  unmount(app);
  app = null;
  document.body.innerHTML = "";
  appGlobal.emailAccounts.remove(inbox.account);
  vi.restoreAllMocks();
  vi.mocked(openApp).mockClear();
  done = [];
  globalSearchTerm.set(null);
  mailSearchInput.set(null);
  isAdvancedSearchOpen.set(false);
});

/** Presses the key on the mail page and returns whether the mail page handled it */
function handled(key: string, init: KeyboardEventInit = {}, target: HTMLElement = document.body): boolean {
  let code = /^[a-z]$/i.test(key) ? "Key" + key.toUpperCase() : key;
  let event = new KeyboardEvent("keydown", { key, code, cancelable: true, bubbles: true, ...init });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function select(...messages: EMail[]) {
  get(selectedMessages).replaceAll(messages);
  selectedMessage.set(messages[0] ?? null);
  flushSync();
}

function message(i: number): EMail {
  return inbox.messages.contents.find(email => email.subject == "Message " + i);
}

test("Replying and forwarding", async () => {
  let compose = { replyToAuthor: () => "reply", replyAll: () => "reply all", forwardAsAttachment: async () => "forward as attachment" };
  vi.spyOn(message(1), "compose", "get").mockReturnValue(compose as any);
  let respond = vi.spyOn(MessageActions, "respond").mockImplementation(async () => {});
  let forward = vi.spyOn(MessageActions, "forward").mockImplementation(async () => {});
  let writeMail = vi.spyOn(mailMustangApp, "writeMail").mockImplementation(() => {});
  select(message(1));

  expect(handled("r", { ctrlKey: true })).toBe(true);
  expect(respond).toHaveBeenLastCalledWith(message(1), "reply");
  // With Shift, the browser reports the uppercase letter
  expect(handled("R", { ctrlKey: true, shiftKey: true })).toBe(true);
  expect(respond).toHaveBeenLastCalledWith(message(1), "reply all");
  expect(handled("f", { ctrlKey: true })).toBe(true);
  expect(forward).toHaveBeenCalledWith(message(1), expect.any(KeyboardEvent));
  expect(handled("f", { ctrlKey: true, altKey: true })).toBe(true);
  await vi.waitFor(() => expect(writeMail).toHaveBeenLastCalledWith("forward as attachment"));

  // Several messages: nothing to reply to
  select(message(0), message(1));
  expect(handled("r", { ctrlKey: true })).toBe(true);
  expect(respond).toHaveBeenCalledTimes(2);
});

test("New mail", () => {
  let writeMail = vi.spyOn(mailMustangApp, "writeMail").mockImplementation(() => {});
  let newMail = {};
  vi.spyOn(MessageActions, "accountForNewMail").mockReturnValue({ newEMailFrom: () => newMail } as any);
  expect(handled("n", { metaKey: true })).toBe(true);
  expect(handled("M", { ctrlKey: true, shiftKey: true })).toBe(true);
  expect(writeMail).toHaveBeenCalledTimes(2);
  expect(writeMail).toHaveBeenLastCalledWith(newMail);
});

test("Delete, archive, read state, flag", async () => {
  let deletePermanently = vi.spyOn(MessageActions, "deletePermanently").mockImplementation(async () => {});
  let archive = vi.spyOn(MessageActions, "archive").mockImplementation(async () => {});
  select(message(0), message(2));

  expect(handled("Delete")).toBe(true);
  expect(handled("d", { ctrlKey: true })).toBe(true);
  expect(handled("q", { ctrlKey: true })).toBe(true);
  expect(handled("u", { ctrlKey: true })).toBe(true);
  expect(handled("Insert")).toBe(true);
  await vi.waitFor(() => expect(done).toEqual([
    "Message 0 deleted", "Message 2 deleted",
    "Message 0 deleted", "Message 2 deleted",
    "Message 0 read true", "Message 2 read true",
    "Message 0 read false", "Message 2 read false",
    "Message 0 flagged true", "Message 2 flagged true",
  ]));

  expect(handled("Delete", { shiftKey: true })).toBe(true);
  expect(deletePermanently).toHaveBeenCalledWith([message(0), message(2)]);
  // Outlook: Backspace archives (frontend deletes)
  expect(handled("Backspace")).toBe(true);
  expect(archive).toHaveBeenCalledWith([message(0), message(2)]);

  // Nothing selected
  select();
  done = [];
  expect(handled("Delete")).toBe(true);
  expect(handled("Backspace")).toBe(true);
  expect(archive).toHaveBeenCalledTimes(1);
  expect(done).toEqual([]);
});

test("Mustang keys for junk and read: Ctrl+J junk, Ctrl+Alt reverses (like Outlook's Ctrl+Alt+J)", async () => {
  select(message(1));
  expect(handled("j", { ctrlKey: true })).toBe(true);
  expect(handled("j", { metaKey: true })).toBe(true);
  expect(handled("u", { ctrlKey: true, altKey: true })).toBe(true);
  // AltGr layouts: Ctrl+Alt+U types another character, the physical key counts
  expect(handled("€", { code: "KeyU", ctrlKey: true, altKey: true })).toBe(true);
  expect(handled("ĵ", { code: "KeyJ", ctrlKey: true, altKey: true })).toBe(true);
  await vi.waitFor(() => expect(done).toEqual([
    "Message 1 junk true", "Message 1 junk true",
    "Message 1 read true", "Message 1 read true",
    "Message 1 junk false",
  ]));
});

test("Folders and dialogs", () => {
  select(message(1));
  expect(handled("V", { ctrlKey: true, shiftKey: true })).toBe(true);
  expect(get(openMoveMessages)).toEqual({ messages: [message(1)], copy: false });
  expect(handled("Y", { ctrlKey: true, shiftKey: true })).toBe(true);
  expect(get(openMoveMessages)).toEqual({ messages: [message(1)], copy: true });
  openMoveMessages.set(null);
  expect(handled("E", { ctrlKey: true, shiftKey: true })).toBe(true);
  expect(get(openNewFolder)).toEqual({ account: inbox.account, parent: inbox });
  openNewFolder.set(null);
  expect(handled("P", { ctrlKey: true, shiftKey: true })).toBe(true);
  expect(get(openNewSearchFolder)).toEqual({ account: inbox.account });
  openNewSearchFolder.set(null);
  expect(handled("F", { ctrlKey: true, shiftKey: true })).toBe(true);
  expect(get(isAdvancedSearchOpen)).toBe(true);
  expect(handled("B", { ctrlKey: true, shiftKey: true })).toBe(true);
  expect(openApp).toHaveBeenCalledWith(contactsMustangApp, {});
  // Ctrl+Shift+I is the DevTools key of Electron and the browser, so Lookout doesn't take it for Go to Inbox
  expect(handled("I", { ctrlKey: true, shiftKey: true })).toBe(false);

  let print = vi.fn();
  let unsubscribe = printMessage.subscribe(print);
  expect(handled("p", { ctrlKey: true })).toBe(true);
  expect(print).toHaveBeenCalledWith(message(1));
  unsubscribe();
  printMessage.set(null);

  expect(document.querySelector("dialog")).toBe(null);
  expect(handled("y", { ctrlKey: true })).toBe(true);
  flushSync();
  expect(document.querySelector("dialog")).not.toBe(null);
});

test("Next and previous message", () => {
  select(message(0));
  expect(handled(".", { code: "Period", ctrlKey: true })).toBe(true);
  expect(get(selectedMessage)).toBe(message(1));
  expect(handled(".", { code: "Period", ctrlKey: true })).toBe(true);
  expect(get(selectedMessage)).toBe(message(2));
  expect(handled(",", { code: "Comma", ctrlKey: true })).toBe(true);
  expect(get(selectedMessage)).toBe(message(1));
});

test("Send/receive and search", () => {
  let sendReceiveAll = vi.spyOn(MessageActions, "sendReceiveAll").mockImplementation(async () => {});
  let getNewMail = vi.spyOn(MessageActions, "getNewMail").mockImplementation(async () => {});
  expect(handled("F9")).toBe(true);
  expect(handled("m", { ctrlKey: true })).toBe(true);
  expect(sendReceiveAll).toHaveBeenCalledTimes(2);
  // Cmd+M and Cmd+Q stay Minimize and Quit on macOS
  expect(handled("m", { metaKey: true })).toBe(false);
  expect(handled("q", { metaKey: true })).toBe(false);
  expect(handled("F9", { shiftKey: true })).toBe(true);
  expect(getNewMail).toHaveBeenCalledWith(inbox);

  let searchBox = document.createElement("input");
  document.body.append(searchBox);
  mailSearchInput.set(searchBox);
  expect(handled("e", { ctrlKey: true })).toBe(true);
  expect(document.activeElement).toBe(searchBox);
  searchBox.blur();
  expect(handled("F3")).toBe(true);
  expect(document.activeElement).toBe(searchBox);
  searchBox.blur();
  expect(handled("k", { ctrlKey: true, altKey: true })).toBe(true);
  expect(get(searchOptions).scope).toBe(SearchScope.CurrentFolder);
  expect(document.activeElement).toBe(searchBox);
  expect(handled("a", { ctrlKey: true, altKey: true }, searchBox)).toBe(true);
  expect(get(searchOptions).scope).toBe(SearchScope.AllAccounts);
});

test("Escape closes the search", () => {
  globalSearchTerm.set("invoice");
  flushSync();
  expect(handled("Escape")).toBe(true);
  expect(get(globalSearchTerm)).toBe(null);
  flushSync();
  expect(handled("Escape")).toBe(false);
});

test("In text fields, only the keys for new mail, send/receive and search work", () => {
  let sendReceiveAll = vi.spyOn(MessageActions, "sendReceiveAll").mockImplementation(async () => {});
  select(message(1));
  let input = document.createElement("input");
  document.querySelector(".mail-page").append(input);
  expect(handled("Delete", {}, input)).toBe(false);
  expect(handled("u", { ctrlKey: true }, input)).toBe(false);
  expect(handled("F9", {}, input)).toBe(true);
  expect(sendReceiveAll).toHaveBeenCalledTimes(1);
  expect(done).toEqual([]);
});

test("Thunderbird keys of the frontend are not bound", () => {
  select(message(1));
  expect(handled("m")).toBe(false);
  expect(handled("s")).toBe(false);
  expect(handled("j")).toBe(false);
  expect(handled("f")).toBe(false);
  expect(handled("b")).toBe(false);
  expect(handled("l", { ctrlKey: true })).toBe(false);
  expect(handled("L", { ctrlKey: true, shiftKey: true })).toBe(false);
  expect(handled("N", { ctrlKey: true, shiftKey: true })).toBe(false);
  expect(handled("F5")).toBe(false);
  expect(handled("r", { altKey: true })).toBe(false);
  expect(done).toEqual([]);
});

test("The status bar shows the folder that is getting new mail", async () => {
  let finish: () => void;
  inbox.account.loginAndStartup = async () => {};
  inbox.getNewMessages = () => new Promise(resolve => finish = () => resolve(new ArrayColl<EMail>()));
  let getting = MessageActions.getNewMail(inbox);
  flushSync();
  expect(get(statusBarContent).right[0]).toMatchObject({ label: expect.stringContaining("Updating"), busy: true });
  await vi.waitFor(() => expect(finish).toBeDefined());
  finish();
  await getting;
  flushSync();
  expect(get(statusBarContent).right.some(item => item.busy)).toBe(false);
});

test("A search folder shows under its account, and selecting folders doesn't pile up subscriptions on it", () => {
  let search = newSearchEMail();
  search.account = inbox.account;
  let searchFolder = new SavedSearchFolder(search);
  searchFolder.name = "From Alice";
  let sent = new Folder(inbox.account);
  sent.name = "Sent";
  inbox.account.rootFolders.add(sent);
  let separateAccountList = getLocalStorage<boolean>("lookout.mail.separateAccountList", true);
  separateAccountList.value = true;
  savedSearchFolders.add(searchFolder);
  try {
    flushSync();
    expect(document.querySelectorAll(".search-folders-row").length).toBe(1);
    let subscriptions = searchFolder._observers.length;
    for (let i = 0; i < 3; i++) {
      selectedFolder.set(sent);
      flushSync();
      selectedFolder.set(inbox);
      flushSync();
    }
    expect(searchFolder._observers.length).toBe(subscriptions);
  } finally {
    savedSearchFolders.remove(searchFolder);
    separateAccountList.value = true;
  }
  flushSync();
  expect(document.querySelectorAll(".search-folders-row").length).toBe(0);
});
