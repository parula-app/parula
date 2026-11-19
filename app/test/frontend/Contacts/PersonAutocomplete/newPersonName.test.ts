// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app";
import { ContactEntry } from "../../../../logic/Abstract/Person";
import type { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { getDatabase } from "../../../../logic/Contacts/SQL/SQLDatabase";
import { SQLAddressbookStorage } from "../../../../logic/Contacts/SQL/SQLAddressbookStorage";
import PersonAutocomplete from "../../../../frontend/Contacts/PersonAutocomplete/PersonAutocomplete.svelte";
import { InProcessSQLiteDatabase } from "../../../logic/util/inProcessSQLite";
import { flushSync, mount, unmount } from "svelte";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import sql from "../../../../../lib/rs-sqlite";

/* The user types the email address of a person who is not in the address book.
 * The bubble shows a name field next to it, with a name that we guessed. */

const kEMailAddress = "fred.smith@example.com";
const kGuessedName = "Fred Smith";
const kRealName = "Frederic Smith";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // The autocomplete component positions its list in the viewport
  (window as any).visualViewport ??= { height: 1000 };
  let tempDir = mkdtempSync(path.join(tmpdir(), "new-person-name-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
  } as any;
});

beforeEach(async () => {
  appGlobal.addressbooks.clear();
  appGlobal.personalAddressbook = await createAddressbook("Personal");
  appGlobal.collectedAddressbook = await createAddressbook("Collected");
});

async function createAddressbook(name: string): Promise<Addressbook> {
  let addressbook = new Addressbook();
  addressbook.name = name;
  addressbook.storage = new SQLAddressbookStorage();
  let row = await (await getDatabase()).run(sql`
    INSERT INTO addressbook (idStr, protocol) VALUES (${addressbook.id}, ${"test"})`);
  addressbook.dbID = row.lastInsertRowid;
  appGlobal.addressbooks.add(addressbook);
  return addressbook;
}

/** What the address book has on disk */
async function savedPersons(addressbook: Addressbook): Promise<string> {
  let rows = await (await getDatabase()).all(sql`
    SELECT name FROM person WHERE addressbookID = ${addressbook.dbID}`);
  return rows.map(row => row.name).join(", ");
}

let component: Record<string, any> | null = null;
let added: PersonUID[];

function mountAutocomplete(askForName = true) {
  component && unmount(component);
  document.body.innerHTML = "";
  added = [];
  let target = document.createElement("div");
  document.body.append(target);
  component = mount(PersonAutocomplete, { target, props: {
    onAddPerson: (person: PersonUID) => { added.push(person); },
    askForName,
  } });
  flushSync();
}

beforeEach(() => mountAutocomplete());

afterEach(() => {
  component && unmount(component);
  component = null;
  document.body.innerHTML = "";
});

async function settle(ms = 0) {
  await new Promise(resolve => setTimeout(resolve, ms));
  flushSync();
}

function emailInput(): HTMLInputElement {
  return document.body.querySelector("input.autocomplete-input");
}

function nameInput(): HTMLInputElement {
  return document.body.querySelector(".name-line input.name");
}

function type(input: HTMLInputElement, text: string) {
  input.focus();
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

function pressKey(input: HTMLInputElement, key: string, eventType = "keydown") {
  let event = new KeyboardEvent(eventType, { key, bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  flushSync();
  return event;
}

test("Shows the guessed name while the user types the email address", () => {
  expect(nameInput()).toBeNull();
  type(emailInput(), "fred.smith@");
  expect(nameInput().value).toEqual(kGuessedName);
  type(emailInput(), "fred@");
  expect(nameInput().value).toEqual("Fred");
});

test("No guessed name, while nothing is typed before the @", () => {
  type(emailInput(), "@example.com");
  expect(nameInput().value).toEqual("");
});

test("No name field for a search by name", () => {
  type(emailInput(), "Fred Smi");
  expect(nameInput()).toBeNull();
});

test("TAB moves to the name, with the cursor at the start", async () => {
  type(emailInput(), kEMailAddress);
  let event = pressKey(emailInput(), "Tab");
  await settle();

  expect(event.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(nameInput());
  expect(nameInput().selectionStart).toEqual(0);
  expect(nameInput().selectionEnd).toEqual(0);
  expect(added).toHaveLength(0);
});

test("ENTER moves to the name, when the address book has no such person", async () => {
  type(emailInput(), kEMailAddress);
  await settle(200); // `delay` of the autocomplete, then the search
  pressKey(emailInput(), "Enter", "keypress");
  await settle();

  expect(document.activeElement).toBe(nameInput());
  expect(nameInput().selectionStart).toEqual(0);
  expect(added).toHaveLength(0);
});

test("ENTER in the name adds the person, saves the contact, and allows to enter the next person", async () => {
  type(emailInput(), kEMailAddress);
  pressKey(emailInput(), "Tab");
  type(nameInput(), kRealName);
  pressKey(nameInput(), "Enter");
  await settle();

  expect(added).toHaveLength(1);
  expect(added[0].emailAddress).toEqual(kEMailAddress);
  expect(added[0].name).toEqual(kRealName);
  expect(added[0].person.name).toEqual(kRealName);
  expect(await savedPersons(appGlobal.collectedAddressbook)).toEqual(kRealName);
  expect(nameInput()).toBeNull();
  expect(emailInput().value).toEqual("");
  expect(document.activeElement).toBe(emailInput());
});

test("TAB in the name adds the person, too", async () => {
  type(emailInput(), kEMailAddress);
  pressKey(emailInput(), "Tab");
  let event = pressKey(nameInput(), "Tab");
  await settle();

  expect(event.defaultPrevented).toBe(true);
  expect(added.map(person => person.name)).toEqual([kGuessedName]);
  expect(await savedPersons(appGlobal.collectedAddressbook)).toEqual(kGuessedName);
});

test("The name typed before the email address was finished stays", () => {
  type(emailInput(), "fred@");
  pressKey(emailInput(), "Tab");
  type(nameInput(), kRealName);
  type(emailInput(), kEMailAddress);

  expect(nameInput().value).toEqual(kRealName);
});

test("Guesses the name of the next person again, after the user edited the name", async () => {
  type(emailInput(), "anna@example.com");
  pressKey(emailInput(), "Tab");
  type(nameInput(), "Anna Berg");
  pressKey(nameInput(), "Enter");
  await settle();

  type(emailInput(), kEMailAddress);
  expect(nameInput().value).toEqual(kGuessedName);
});

test("TAB keeps the cursor where the user left it in a name that they edited", async () => {
  type(emailInput(), kEMailAddress);
  pressKey(emailInput(), "Tab");
  await settle();
  type(nameInput(), kRealName);
  nameInput().setSelectionRange(3, 3);
  emailInput().focus();

  pressKey(emailInput(), "Tab");
  await settle();
  expect(document.activeElement).toBe(nameInput());
  expect(nameInput().selectionStart).toEqual(3);
});

test("Clicking outside adds the person, without taking the focus", async () => {
  let elsewhere = document.createElement("input");
  document.body.append(elsewhere);
  type(emailInput(), kEMailAddress);
  pressKey(emailInput(), "Tab");
  type(nameInput(), kRealName);

  elsewhere.focus();
  elsewhere.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await settle();

  expect(added.map(person => person.name)).toEqual([kRealName]);
  expect(await savedPersons(appGlobal.collectedAddressbook)).toEqual(kRealName);
  expect(document.activeElement).toBe(elsewhere);
});

test("Clicking the name does not add the person", async () => {
  type(emailInput(), kEMailAddress);
  nameInput().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await settle();

  expect(added).toHaveLength(0);
});

test("Saves the contact in the address book that the user picked", async () => {
  type(emailInput(), kEMailAddress);
  let select = document.body.querySelector<HTMLSelectElement>(".name-line select");
  select.selectedIndex = [...select.options].findIndex(option => option.textContent.trim() == "Personal");
  select.dispatchEvent(new Event("change", { bubbles: true }));
  flushSync();
  pressKey(emailInput(), "Tab");
  pressKey(nameInput(), "Enter");
  await settle();

  expect(added[0].person.addressbook).toBe(appGlobal.personalAddressbook);
  expect(await savedPersons(appGlobal.personalAddressbook)).toEqual(kGuessedName);
  expect(await savedPersons(appGlobal.collectedAddressbook)).toEqual("");
});

function addKnownPerson() {
  let person = appGlobal.personalAddressbook.newPerson();
  person.name = kRealName;
  person.emailAddresses.add(new ContactEntry(kEMailAddress, "work"));
  appGlobal.personalAddressbook.persons.add(person);
  return person;
}

test("A known person: Shows the name from the address book in the name field, and leaves the contact alone", async () => {
  let person = addKnownPerson();

  type(emailInput(), kEMailAddress);
  expect(nameInput().value).toEqual(kGuessedName); // no lookup on every key press
  expect(document.body.querySelector(".name-line select")).not.toBeNull();

  pressKey(emailInput(), "Tab");
  await settle();
  expect(nameInput().value).toEqual(kRealName);
  expect(nameInput().selectionStart).toEqual(0);
  expect(document.body.querySelector(".name-line select")).toBeNull();

  pressKey(nameInput(), "Enter");
  await settle();

  expect(added[0].person).toBe(person);
  expect(added[0].name).toEqual(kRealName);
  expect(await savedPersons(appGlobal.personalAddressbook)).toEqual("");
  expect(await savedPersons(appGlobal.collectedAddressbook)).toEqual("");
});

test("After adding a known person, the list of the earlier search stays closed", async () => {
  addKnownPerson();
  type(emailInput(), kEMailAddress);
  await settle(200); // `delay` of the autocomplete, then the search
  expect(document.body.querySelector(".autocomplete-list-item")).not.toBeNull();
  pressKey(emailInput(), "Tab");
  await settle();
  pressKey(nameInput(), "Enter");
  await settle(200);

  expect(added).toHaveLength(1);
  expect(document.activeElement).toBe(emailInput());
  expect(document.body.querySelector(".autocomplete-list").classList.contains("hidden")).toBe(true);
});

test("Clicking outside while a search result is shown adds that person", async () => {
  let person = addKnownPerson();
  type(emailInput(), kEMailAddress);
  await settle(200); // `delay` of the autocomplete, then the search
  expect(document.body.querySelector(".autocomplete-list-item.selected")).not.toBeNull();

  document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await settle();

  expect(added).toHaveLength(1);
  expect(added[0].person).toBe(person);
  expect(added[0].name).toEqual(kRealName);
});

test("Without `askForName`, adds the typed email address right away, with the guessed name", async () => {
  mountAutocomplete(false);
  type(emailInput(), kEMailAddress);
  expect(nameInput()).toBeNull();
  await settle(200);
  pressKey(emailInput(), "Enter", "keypress");
  await settle();

  expect(added).toHaveLength(1);
  expect(added[0].name).toEqual(kGuessedName);
  expect(await savedPersons(appGlobal.collectedAddressbook)).toEqual("");
});

test("Name and email address typed together are added right away", async () => {
  type(emailInput(), `${kRealName} <${kEMailAddress}>`);
  expect(nameInput()).toBeNull();
  await settle(200);
  pressKey(emailInput(), "Enter", "keypress");
  await settle();

  expect(added).toHaveLength(1);
  expect(added[0].name).toEqual(kRealName);
  expect(added[0].emailAddress).toEqual(kEMailAddress);
});
