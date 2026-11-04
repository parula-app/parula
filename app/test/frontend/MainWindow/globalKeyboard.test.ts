// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { onKeyOnWindow } from "../../../frontend/MainWindow/GlobalKeyboard";
import { selectedApp } from "../../../frontend/AppsBar/selectedApp";
import { mailMustangApp } from "../../../frontend/Mail/MailMustangApp";
import { calendarMustangApp } from "../../../frontend/Calendar/CalendarMustangApp";
import { contactsMustangApp } from "../../../frontend/Contacts/ContactsMustangApp";
import { selectedAccount } from "../../../frontend/Mail/Selected";
import { newPerson, selectedPerson } from "../../../frontend/Contacts/Person/Selected";
import { createNewEvent } from "../../../frontend/Calendar/event";
import { getKeyDigit, isTextField } from "../../../frontend/Util/util";
import { Addressbook } from "../../../logic/Contacts/Addressbook";
import { get } from "svelte/store";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// Lets a test switch to the web build
const build = vi.hoisted(() => ({ webMail: null as any }));
vi.mock("../../../logic/build", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../logic/build")>(),
  get webMail() { return build.webMail; },
}));
vi.mock("../../../frontend/Calendar/event", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../frontend/Calendar/event")>(),
  createNewEvent: vi.fn(),
}));

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true, ...init });
}

/** Presses the key and returns whether the window handled it */
async function handled(key: string, init: KeyboardEventInit = {}): Promise<boolean> {
  let event = press(key, init);
  await onKeyOnWindow(event);
  return event.defaultPrevented;
}

function onMac() {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)");
}

beforeEach(() => {
  selectedApp.set(null);
});

afterEach(() => {
  build.webMail = null;
  vi.restoreAllMocks();
  vi.mocked(createNewEvent).mockClear();
});

test("Ctrl+1/2/3/4 switch to Mail, Calendar and People", async () => {
  expect(await handled("1", { code: "Digit1", ctrlKey: true })).toBe(true);
  expect(get(selectedApp)).toBe(mailMustangApp);
  expect(await handled("2", { code: "Digit2", ctrlKey: true })).toBe(true);
  expect(get(selectedApp)).toBe(calendarMustangApp);
  expect(await handled("3", { code: "Digit3", ctrlKey: true })).toBe(true);
  expect(get(selectedApp)).toBe(contactsMustangApp);
  selectedApp.set(null);
  expect(await handled("4", { code: "Digit4", ctrlKey: true })).toBe(true);
  expect(get(selectedApp)).toBe(contactsMustangApp);
  expect(await handled("5", { code: "Digit5", ctrlKey: true })).toBe(false);
  // AZERTY: the digit row types "&" etc. without Shift
  expect(await handled("&", { code: "Digit1", ctrlKey: true })).toBe(true);
  expect(get(selectedApp)).toBe(mailMustangApp);
  // Cmd on macOS
  onMac();
  expect(await handled("2", { code: "Digit2", metaKey: true })).toBe(true);
  expect(get(selectedApp)).toBe(calendarMustangApp);
  // Ctrl+Alt+digit is the calendar view switch, not the app switch
  expect(await handled("1", { code: "Digit1", ctrlKey: true, altKey: true })).toBe(false);
});

test("Web build uses Ctrl+Shift+digit, like Outlook on the web", async () => {
  build.webMail = "webmail";
  expect(await handled("1", { code: "Digit1", ctrlKey: true })).toBe(false);
  expect(get(selectedApp)).toBe(null);
  expect(await handled("!", { code: "Digit1", ctrlKey: true, shiftKey: true })).toBe(true);
  expect(get(selectedApp)).toBe(mailMustangApp);
  expect(await handled("@", { code: "Digit2", ctrlKey: true, shiftKey: true })).toBe(true);
  expect(get(selectedApp)).toBe(calendarMustangApp);
  build.webMail = null;
  expect(await handled("!", { code: "Digit1", ctrlKey: true, shiftKey: true })).toBe(false);
});

test("Ctrl+Shift+M writes a new mail", async () => {
  let written: any[] = [];
  vi.spyOn(mailMustangApp, "writeMail").mockImplementation((mail: any) => { written.push(mail) });
  selectedAccount.set({ newEMailFrom: () => "new mail" } as any);
  expect(await handled("M", { code: "KeyM", ctrlKey: true, shiftKey: true })).toBe(true);
  expect(written).toEqual(["new mail"]);
  // Without Shift, Ctrl+M is Electron's Minimize
  expect(await handled("m", { code: "KeyM", ctrlKey: true })).toBe(false);
  selectedAccount.set(null);
});

test("Ctrl+Shift+A and Ctrl+Shift+Q create a new event", async () => {
  expect(await handled("A", { code: "KeyA", ctrlKey: true, shiftKey: true })).toBe(true);
  expect(await handled("Q", { code: "KeyQ", ctrlKey: true, shiftKey: true })).toBe(true);
  expect(createNewEvent).toHaveBeenCalledTimes(2);
});

test("Ctrl+Shift+C creates a new contact, Ctrl+Shift+B shows the contacts", async () => {
  let addressbook = new Addressbook();
  addressbook.name = "Test";
  appGlobal.addressbooks.add(addressbook);
  expect(await handled("C", { code: "KeyC", ctrlKey: true, shiftKey: true })).toBe(true);
  expect(get(selectedApp)).toBe(contactsMustangApp);
  expect(get(newPerson)?.addressbook).toBe(addressbook);
  expect(get(selectedPerson)).toBe(get(newPerson));
  newPerson.set(null);
  selectedPerson.set(null);
  appGlobal.addressbooks.remove(addressbook);

  selectedApp.set(null);
  expect(await handled("B", { code: "KeyB", ctrlKey: true, shiftKey: true })).toBe(true);
  expect(get(selectedApp)).toBe(contactsMustangApp);
  // Ctrl+Shift+I stays Electron's DevTools
  expect(await handled("I", { code: "KeyI", ctrlKey: true, shiftKey: true })).toBe(false);
});

test("Ctrl+Shift+B is not taken from text fields", async () => {
  let editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  let paragraph = document.createElement("p");
  editor.append(paragraph);
  document.body.append(editor);
  let event = press("B", { code: "KeyB", ctrlKey: true, shiftKey: true });
  paragraph.addEventListener("keydown", keyEvent => onKeyOnWindow(keyEvent));
  paragraph.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(get(selectedApp)).toBe(null);
  editor.remove();
});

test("F3 and Alt+Q go to the search field, Alt+Q not on macOS", async () => {
  let header = document.createElement("div");
  header.className = "window-header";
  header.innerHTML = `<div class="search-box"><input type="search"></div>`;
  document.body.append(header);
  let search = header.querySelector("input");
  let input = document.createElement("input");
  document.body.append(input);

  input.focus();
  expect(await handled("F3", { code: "F3" })).toBe(true);
  expect(document.activeElement).toBe(search);
  input.focus();
  expect(await handled("F3", { code: "F3", shiftKey: true })).toBe(false);
  expect(document.activeElement).toBe(input);
  expect(await handled("q", { code: "KeyQ", altKey: true })).toBe(true);
  expect(document.activeElement).toBe(search);

  input.focus();
  onMac();
  expect(await handled("œ", { code: "KeyQ", altKey: true })).toBe(false);
  expect(document.activeElement).toBe(input);

  // Keys that another handler already took
  let alreadyHandled = press("F3", { code: "F3" });
  alreadyHandled.preventDefault();
  await onKeyOnWindow(alreadyHandled);
  expect(document.activeElement).toBe(input);
  header.remove();
  input.remove();
});

test("isTextField", () => {
  let input = document.createElement("input");
  let div = document.createElement("div");
  let notEditable = document.createElement("div");
  notEditable.setAttribute("contenteditable", "false");
  expect(isTextField(input)).toBe(true);
  expect(isTextField(div)).toBe(false);
  expect(isTextField(notEditable)).toBe(false);
  expect(isTextField(null)).toBe(false);
});

test("getKeyDigit", () => {
  expect(getKeyDigit(press("1", { code: "Digit1" }))).toBe(1);
  expect(getKeyDigit(press("&", { code: "Digit1" }))).toBe(1);
  expect(getKeyDigit(press("3", { code: "Numpad3" }))).toBe(3);
  expect(getKeyDigit(press("a", { code: "KeyA" }))).toBe(null);
});
