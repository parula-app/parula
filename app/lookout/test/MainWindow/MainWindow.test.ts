// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import MainWindow from "../../MainWindow/MainWindow.svelte";
import { MessageActions } from "../../Mail/MessageActions";
import { ContactActions } from "../../Contacts/ContactActions";
import { openApp } from "../../../frontend/AppsBar/selectedApp";
import { mailMustangApp } from "../../../frontend/Mail/MailMustangApp";
import { calendarMustangApp } from "../../../frontend/Calendar/CalendarMustangApp";
import { contactsMustangApp } from "../../../frontend/Contacts/ContactsMustangApp";
import { createNewEvent } from "../../../frontend/Calendar/event";
import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

vi.mock("../../../frontend/AppsBar/selectedApp", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../frontend/AppsBar/selectedApp")>(),
  openApp: vi.fn(),
}));
vi.mock("../../../frontend/Calendar/event", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../frontend/Calendar/event")>(),
  createNewEvent: vi.fn(),
}));

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let app: Record<string, any> | null = null;

beforeEach(() => {
  let target = document.createElement("div");
  document.body.append(target);
  app = mount(MainWindow, { target });
  flushSync();
});

afterEach(() => {
  unmount(app);
  app = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.mocked(openApp).mockClear();
  vi.mocked(createNewEvent).mockClear();
});

/** Presses the key in the window and returns whether the window handled it */
function handled(key: string, init: KeyboardEventInit = {}, target: HTMLElement = document.body): boolean {
  let event = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true, ...init });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function onMac() {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)");
}

test("Ctrl+1 to Ctrl+4 switch the module, by key position", () => {
  expect(handled("1", { code: "Digit1", ctrlKey: true })).toBe(true);
  expect(openApp).toHaveBeenLastCalledWith(mailMustangApp, mailMustangApp.windowParams);
  expect(handled("2", { code: "Digit2", ctrlKey: true })).toBe(true);
  expect(openApp).toHaveBeenLastCalledWith(calendarMustangApp, calendarMustangApp.windowParams);
  // Ctrl+3 was People in Outlook for 20 years, Ctrl+4 is People now
  expect(handled("3", { code: "Digit3", ctrlKey: true })).toBe(true);
  expect(openApp).toHaveBeenLastCalledWith(contactsMustangApp, contactsMustangApp.windowParams);
  expect(handled("4", { code: "Digit4", ctrlKey: true })).toBe(true);
  expect(openApp).toHaveBeenLastCalledWith(contactsMustangApp, contactsMustangApp.windowParams);
  expect(handled("1", { code: "Numpad1", ctrlKey: true })).toBe(true);
  expect(openApp).toHaveBeenLastCalledWith(mailMustangApp, mailMustangApp.windowParams);
  // AZERTY: the 1 key produces "&"
  expect(handled("&", { code: "Digit1", ctrlKey: true })).toBe(true);
  expect(handled("1", { code: "Digit1", metaKey: true })).toBe(true);
  expect(openApp).toHaveBeenCalledTimes(7);
  expect(handled("5", { code: "Digit5", ctrlKey: true })).toBe(false);
  expect(handled("1", { code: "Digit1" })).toBe(false);
  // Ctrl+Alt+1 is the calendar's Day view, Ctrl+Shift+1 the web build's module key
  expect(handled("1", { code: "Digit1", ctrlKey: true, altKey: true })).toBe(false);
  expect(handled("!", { code: "Digit1", ctrlKey: true, shiftKey: true })).toBe(false);
  expect(openApp).toHaveBeenCalledTimes(7);
});

test("New items from any module", () => {
  let mail = { to: [] };
  let writeMail = vi.spyOn(mailMustangApp, "writeMail").mockImplementation(() => {});
  vi.spyOn(MessageActions, "accountForNewMail").mockReturnValue({ newEMailFrom: () => mail } as any);
  let newMeeting = vi.spyOn(MessageActions, "newMeeting").mockImplementation(() => {});
  let newContact = vi.spyOn(MessageActions, "newContact").mockImplementation(() => {});
  let newGroup = vi.spyOn(ContactActions, "newGroup").mockImplementation(() => {});

  expect(handled("M", { code: "KeyM", ctrlKey: true, shiftKey: true })).toBe(true);
  expect(writeMail).toHaveBeenCalledWith(mail);
  expect(handled("A", { code: "KeyA", ctrlKey: true, shiftKey: true })).toBe(true);
  expect(createNewEvent).toHaveBeenCalledTimes(1);
  expect(handled("Q", { code: "KeyQ", ctrlKey: true, shiftKey: true })).toBe(true);
  expect(newMeeting).toHaveBeenCalledTimes(1);
  expect(handled("C", { code: "KeyC", ctrlKey: true, shiftKey: true })).toBe(true);
  expect(newContact).toHaveBeenCalledTimes(1);
  expect(handled("L", { code: "KeyL", ctrlKey: true, shiftKey: true })).toBe(true);
  expect(newGroup).toHaveBeenCalledWith(null);
  expect(handled("B", { code: "KeyB", ctrlKey: true, shiftKey: true })).toBe(true);
  expect(openApp).toHaveBeenLastCalledWith(contactsMustangApp, {});
  // Ctrl+Shift+I is the DevTools key of Electron and the browser, not Go to Inbox
  expect(handled("I", { code: "KeyI", ctrlKey: true, shiftKey: true })).toBe(false);
  expect(handled("M", { code: "KeyM", ctrlKey: true, shiftKey: true, altKey: true })).toBe(false);
  expect(writeMail).toHaveBeenCalledTimes(1);
});

test("F3 and Ctrl+E go to the search box", () => {
  let searchInput = () => document.querySelector(".title-bar .search-box input");
  expect(searchInput()).toBeTruthy();
  expect(handled("F3", { code: "F3" })).toBe(true);
  expect(document.activeElement).toBe(searchInput());
  (document.activeElement as HTMLElement).blur();
  expect(handled("e", { code: "KeyE", ctrlKey: true })).toBe(true);
  expect(document.activeElement).toBe(searchInput());
  (document.activeElement as HTMLElement).blur();
  expect(handled("F3", { code: "F3", shiftKey: true })).toBe(false);
});

test("Alt+Q goes to the search box when no Tell me took it", () => {
  let searchInput = () => document.querySelector(".title-bar .search-box input");
  expect(handled("q", { code: "KeyQ", altKey: true })).toBe(true);
  expect(document.activeElement).toBe(searchInput());
  (document.activeElement as HTMLElement).blur();

  // A ribbon's Tell me handles the key before
  let tellMe = (event: KeyboardEvent) => event.preventDefault();
  window.addEventListener("keydown", tellMe);
  expect(handled("q", { code: "KeyQ", altKey: true })).toBe(true);
  window.removeEventListener("keydown", tellMe);
  expect(document.activeElement).not.toBe(searchInput());

  // Option+Q types "œ" on macOS
  onMac();
  expect(handled("œ", { code: "KeyQ", altKey: true })).toBe(false);
  expect(document.activeElement).not.toBe(searchInput());
});

test("Ctrl+F1 collapses and expands the ribbon also when no ribbon is shown", () => {
  let ribbonCollapsed = getLocalStorage<boolean>("lookout.ribbon.collapsed", false);
  let wasCollapsed = !!ribbonCollapsed.value;
  expect(handled("F1", { code: "F1", ctrlKey: true })).toBe(true);
  expect(!!ribbonCollapsed.value).toBe(!wasCollapsed);
  expect(handled("F1", { code: "F1", ctrlKey: true })).toBe(true);
  expect(!!ribbonCollapsed.value).toBe(wasCollapsed);
  expect(handled("F1", { code: "F1" })).toBe(false);
  // A shown ribbon handles the key before
  let ribbon = (event: KeyboardEvent) => event.preventDefault();
  window.addEventListener("keydown", ribbon);
  expect(handled("F1", { code: "F1", ctrlKey: true })).toBe(true);
  window.removeEventListener("keydown", ribbon);
  expect(!!ribbonCollapsed.value).toBe(wasCollapsed);
});

test("Plain keys and other combinations are left to the pages", () => {
  expect(handled("a", { code: "KeyA" })).toBe(false);
  expect(handled("n", { code: "KeyN", ctrlKey: true })).toBe(false);
  expect(handled("Delete", { code: "Delete" })).toBe(false);
  expect(handled("Escape", { code: "Escape" })).toBe(false);
});

test("Keys that a page or the text editor already handled stay with them", () => {
  let pageListener = (event: KeyboardEvent) => event.preventDefault();
  window.addEventListener("keydown", pageListener);
  expect(handled("1", { code: "Digit1", ctrlKey: true })).toBe(true);
  window.removeEventListener("keydown", pageListener);
  expect(openApp).not.toHaveBeenCalled();

  let editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  document.body.append(editor);
  expect(handled("1", { code: "Digit1", ctrlKey: true }, editor)).toBe(false);
  expect(openApp).not.toHaveBeenCalled();
});
