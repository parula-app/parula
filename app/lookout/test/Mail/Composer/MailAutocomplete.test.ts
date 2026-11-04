// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import type { PersonUID } from "../../../../logic/Abstract/PersonUID";
import MailAutocomplete from "../../../Mail/Composer/MailAutocomplete.svelte";
import { ArrayColl } from "svelte-collections";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";

// Like frontend's PersonAutocomplete without the name field: no email goes out with a bare address

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let component: Record<string, any> | null = null;
let added: ArrayColl<PersonUID>;

beforeEach(() => {
  added = new ArrayColl<PersonUID>();
  let target = document.createElement("div");
  document.body.append(target);
  component = mount(MailAutocomplete, { target, props: { addresses: added, label: "To" } });
  flushSync();
});

afterEach(() => {
  unmount(component);
  component = null;
  document.body.innerHTML = "";
});

function input(): HTMLInputElement {
  return document.body.querySelector("input.typed");
}

/** Types the text and presses Enter */
function enter(text: string) {
  input().focus();
  input().value = text;
  input().dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
  input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  flushSync();
}

function paste(text: string) {
  let clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", text);
  input().dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  flushSync();
}

function addedRecipients(): string[] {
  return added.contents.map(recipient => `${recipient.name} <${recipient.emailAddress}>`);
}

test("Adds a plain email address and guesses the name", () => {
  enter("  fred.miller@example.com ");
  expect(addedRecipients()).toEqual(["Fred Miller <fred.miller@example.com>"]);
  expect(input().value).toBe("");
});

test("Adds name and email address", () => {
  enter("Fred Miller <fred@example.com>");
  enter("\"Miller, Anna\"<anna@example.com>");
  expect(addedRecipients()).toEqual([
    "Fred Miller <fred@example.com>",
    "Miller, Anna <anna@example.com>",
  ]);
});

test("Doesn't add text without a valid email address", () => {
  enter("Fred");
  enter("Fred <fred>");
  expect(addedRecipients()).toEqual([]);
});

test("Splits lists at ; , and line breaks, but not inside quotes or brackets", () => {
  paste("a@example.com; b@example.com, c@example.com\nd@example.com");
  expect(added.contents.map(recipient => recipient.emailAddress))
    .toEqual(["a@example.com", "b@example.com", "c@example.com", "d@example.com"]);
  added.clear();
  paste("\"Miller, Fred\" <fred@example.com>; anna@example.com");
  expect(addedRecipients()).toEqual(["Miller, Fred <fred@example.com>", "Anna <anna@example.com>"]);
  added.clear();
  paste("Miller, Fred <fred@example.com>;;");
  expect(addedRecipients()).toEqual(["Miller, Fred <fred@example.com>"]);
});

test("Adds the addresses of a list and keeps the other parts", () => {
  enter("anna@example.com; bert; Carla <carla@example.com>");
  expect(added.contents.map(recipient => recipient.emailAddress)).toEqual(["anna@example.com", "carla@example.com"]);
  expect(input().value).toBe("bert");
});
