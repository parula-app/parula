// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { onKeyOnList } from "../../../frontend/Mail/Message/MessageKeyboard";
import { selectedMessage, selectedMessages } from "../../../frontend/Mail/Selected";
import { mailMustangApp } from "../../../frontend/Mail/MailMustangApp";
import { ArrayColl } from "svelte-collections";
import { get } from "svelte/store";
import { beforeEach, expect, test, vi } from "vitest";

/** Records which message functions the keys call */
class FakeMessage {
  name: string;
  calls: string[] = [];
  next: FakeMessage | null = null;
  previous: FakeMessage | null = null;
  folder = {
    getNewMessages: async () => { this.calls.push("getNewMessages") },
  };
  compose = {
    forward: async () => "forward of " + this.name,
    forwardAsAttachment: async () => "forward as attachment of " + this.name,
    replyToAuthor: () => "reply to " + this.name,
  };
  constructor(name: string) {
    this.name = name;
  }
  async markRead(read: boolean) {
    this.calls.push("markRead " + read);
  }
  async deleteMessage() {
    this.calls.push("deleteMessage");
  }
  async treatSpam(spam = true) {
    this.calls.push("treatSpam " + spam);
  }
  nextMessage(previous = false): FakeMessage | null {
    return previous ? this.previous : this.next;
  }
}

let first: FakeMessage;
let second: FakeMessage;
let third: FakeMessage;
let written: any[];

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true, ...init });
}

function select(...messages: FakeMessage[]) {
  selectedMessages.set(new ArrayColl(messages) as any);
  selectedMessage.set(messages[0] as any);
}

function selected(): FakeMessage[] {
  return get(selectedMessages).contents as any;
}

beforeEach(() => {
  first = new FakeMessage("first");
  second = new FakeMessage("second");
  third = new FakeMessage("third");
  first.next = second;
  second.previous = first;
  second.next = third;
  third.previous = second;
  written = [];
  vi.spyOn(mailMustangApp, "writeMail").mockImplementation((mail: any) => { written.push(mail) });
});

test("Ctrl+F forwards, Ctrl+Alt+F forwards as attachment", async () => {
  select(second);
  let event = press("f", { code: "KeyF", ctrlKey: true });
  await onKeyOnList(event);
  expect(event.defaultPrevented).toBe(true);
  await onKeyOnList(press("ƒ", { code: "KeyF", ctrlKey: true, altKey: true }));
  expect(written).toEqual(["forward of second", "forward as attachment of second"]);
});

test("Ctrl+D deletes all selected messages and selects the next one", async () => {
  select(second, third);
  await onKeyOnList(press("d", { code: "KeyD", ctrlKey: true }));
  expect(second.calls).toEqual(["deleteMessage"]);
  expect(third.calls).toEqual(["deleteMessage"]);
  expect(selected()).toEqual([third]);
});

test("Ctrl+Alt+J marks as not junk", async () => {
  select(first, second);
  await onKeyOnList(press("j", { code: "KeyJ", ctrlKey: true, altKey: true }));
  expect(first.calls).toEqual(["treatSpam false"]);
  expect(second.calls).toEqual(["treatSpam false"]);
});

test("Ctrl+. and Ctrl+, go to the next and previous message", async () => {
  select(second);
  await onKeyOnList(press(".", { code: "Period", ctrlKey: true }));
  expect(selected()).toEqual([third]);
  select(second);
  await onKeyOnList(press(",", { code: "Comma", ctrlKey: true }));
  expect(selected()).toEqual([first]);
});

test("Ctrl+Q marks as read and keeps Electron from quitting; Cmd+Q stays Quit", async () => {
  select(first);
  let ctrlQ = press("q", { code: "KeyQ", ctrlKey: true });
  await onKeyOnList(ctrlQ);
  expect(ctrlQ.defaultPrevented).toBe(true);
  expect(first.calls).toEqual(["markRead true"]);

  let cmdQ = press("q", { code: "KeyQ", metaKey: true });
  await onKeyOnList(cmdQ);
  expect(cmdQ.defaultPrevented).toBe(false);
  expect(first.calls).toEqual(["markRead true"]);
});

test("Ctrl+M gets new mail and keeps Electron from minimizing; Cmd+M stays Minimize", async () => {
  select(first);
  let ctrlM = press("m", { code: "KeyM", ctrlKey: true });
  await onKeyOnList(ctrlM);
  expect(ctrlM.defaultPrevented).toBe(true);
  let cmdM = press("m", { code: "KeyM", metaKey: true });
  await onKeyOnList(cmdM);
  expect(cmdM.defaultPrevented).toBe(false);
  expect(first.calls).toEqual(["getNewMessages"]);
});

test("Ctrl+Shift+V, Ctrl+Shift+Y and Ctrl+P ask the message toolbar", async () => {
  select(first);
  let requests: string[] = [];
  let onRequest = (event: Event) => requests.push(event.type);
  window.addEventListener("mail-move-popup", onRequest);
  window.addEventListener("mail-print", onRequest);
  await onKeyOnList(press("V", { code: "KeyV", ctrlKey: true, shiftKey: true }));
  await onKeyOnList(press("Y", { code: "KeyY", ctrlKey: true, shiftKey: true }));
  await onKeyOnList(press("p", { code: "KeyP", ctrlKey: true }));
  window.removeEventListener("mail-move-popup", onRequest);
  window.removeEventListener("mail-print", onRequest);
  expect(requests).toEqual(["mail-move-popup", "mail-move-popup", "mail-print"]);
});

test("Existing keys still work, and now also prevent the browser default", async () => {
  select(first);
  let ctrlR = press("r", { code: "KeyR", ctrlKey: true });
  await onKeyOnList(ctrlR);
  expect(ctrlR.defaultPrevented).toBe(true);
  expect(written).toEqual(["reply to first"]);

  let ctrlL = press("l", { code: "KeyL", ctrlKey: true });
  await onKeyOnList(ctrlL);
  expect(written).toEqual(["reply to first", "forward of first"]);

  let unknown = press("k", { code: "KeyK", ctrlKey: true });
  await onKeyOnList(unknown);
  expect(unknown.defaultPrevented).toBe(false);
});

test("Keys typed into a field inside the reading pane stay in the field", async () => {
  select(first);
  let input = document.createElement("input");
  document.body.append(input);
  let typed = press("Backspace", { code: "Backspace" });
  let handling: Promise<void>;
  input.addEventListener("keydown", event => handling = onKeyOnList(event));
  input.dispatchEvent(typed);
  await handling;
  expect(typed.defaultPrevented).toBe(false);
  expect(first.calls).toEqual([]);
  input.remove();
});
