// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { appGlobal } from "../../../logic/app";
import { Addressbook } from "../../../logic/Contacts/Addressbook";
import { MailAccount } from "../../../logic/Mail/MailAccount";
import AddressbookSelector from "../../Contacts/AddressbookSelector.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";

let app: Record<string, any> | null = null;

beforeAll(() => {
  // happy-dom has no layout
  Element.prototype.scrollIntoView ??= () => {};
});

function newAddressbook(name: string, mainAccount: MailAccount = null): Addressbook {
  let addressbook = new Addressbook();
  addressbook.name = name;
  addressbook.id = name;
  addressbook.mainAccount = mainAccount;
  return addressbook;
}

/** "My Contacts" with "Personal" and "Family", then the section of the account "Work" with "Colleagues" */
beforeEach(() => {
  let work = new MailAccount();
  work.name = "Work";
  appGlobal.addressbooks.replaceAll([newAddressbook("Personal"), newAddressbook("Family"), newAddressbook("Colleagues", work)]);
  appGlobal.searchOnlyAddressbooks.clear();
  let target = document.createElement("div");
  document.body.append(target);
  app = mount(AddressbookSelector, { target, props: { selectedAddressbook: null } });
  flushSync();
});

afterEach(() => {
  unmount(app);
  app = null;
  document.body.innerHTML = "";
  appGlobal.addressbooks.clear();
});

/** The names of the address book entries, in the order shown */
function shownNames(): string[] {
  return [...document.querySelectorAll(".addressbook-item .name")].map(name => name.textContent);
}

function selectedName(): string {
  return document.querySelector(".addressbook-item.selected .name")?.textContent;
}

/** @returns whether the list used the key, so that the browser doesn't scroll it */
function press(key: string): boolean {
  let event = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true });
  document.querySelector(".addressbook-item.selected").dispatchEvent(event);
  flushSync();
  return event.defaultPrevented;
}

test("Arrow keys, Home and End select the address books as shown", () => {
  let shown = shownNames();
  expect(shown).toHaveLength(4);
  expect(selectedName()).toBe(shown[0]);
  for (let i = 1; i < shown.length; i++) {
    expect(press("ArrowDown")).toBe(true);
    expect(selectedName()).toBe(shown[i]);
  }
  expect(press("ArrowDown")).toBe(true);
  expect(selectedName()).toBe(shown.at(-1));
  expect(press("Home")).toBe(true);
  expect(selectedName()).toBe(shown[0]);
  expect(press("End")).toBe(true);
  expect(selectedName()).toBe("Colleagues");
  expect(press("ArrowUp")).toBe(true);
  expect(selectedName()).toBe(shown.at(-2));
});

test("Address books in a collapsed section are skipped", () => {
  let myContacts = [...document.querySelectorAll<HTMLElement>(".collapsible-header")].find(header => !header.textContent.includes("Work"));
  myContacts.click();
  flushSync();
  expect(shownNames()).not.toContain("Personal");
  press("ArrowDown");
  expect(selectedName()).toBe("Colleagues");
  press("ArrowUp");
  expect(selectedName()).toBe(shownNames()[0]);
});
