// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app";
import { ContactEntry } from "../../../../logic/Abstract/Person";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { getDatabase } from "../../../../logic/Contacts/SQL/SQLDatabase";
import { SQLAddressbookStorage } from "../../../../logic/Contacts/SQL/SQLAddressbookStorage";
import MailAutocomplete from "../../../Mail/Composer/MailAutocomplete.svelte";
import { InProcessSQLiteDatabase } from "../../../../test/logic/util/inProcessSQLite";
import { ArrayColl } from "svelte-collections";
import { flushSync, mount, unmount } from "svelte";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import sql from "../../../../../lib/rs-sqlite";

/* Like test/frontend/Contacts/PersonAutocomplete/newPersonName.test.ts:
 * The user types the email address of a person who is not in the address book.
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
  let tempDir = mkdtempSync(path.join(tmpdir(), "lookout-new-person-name-test-"));
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
  return rows.map(row => (row as { name: string }).name).join(", ");
}

let component: Record<string, any> | null = null;
let added: ArrayColl<PersonUID>;

function mountAutocomplete(askForName = true, recipients: PersonUID[] = []) {
  component && unmount(component);
  document.body.innerHTML = "";
  added = new ArrayColl<PersonUID>(recipients);
  let target = document.createElement("div");
  document.body.append(target);
  component = mount(MailAutocomplete, { target, props: {
    addresses: added,
    label: "To",
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
  return document.body.querySelector("input.typed");
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

function pressKey(input: HTMLInputElement, key: string) {
  let event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  flushSync();
  return event;
}

function click(element: Element) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  flushSync();
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

test("No name field for a search by name, or for a list of addresses", () => {
  type(emailInput(), "Fred Smi");
  expect(nameInput()).toBeNull();
  type(emailInput(), "anna@example.com; fred");
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
  expect(added.length).toEqual(0);
});

test("ENTER moves to the name, when the address book has no such person", async () => {
  type(emailInput(), kEMailAddress);
  await settle(50);
  pressKey(emailInput(), "Enter");
  await settle();

  expect(document.activeElement).toBe(nameInput());
  expect(nameInput().selectionStart).toEqual(0);
  expect(added.length).toEqual(0);
});

test("ENTER in the name adds the person, saves the contact, and allows to enter the next person", async () => {
  type(emailInput(), kEMailAddress);
  pressKey(emailInput(), "Tab");
  type(nameInput(), kRealName);
  pressKey(nameInput(), "Enter");
  await settle();

  expect(added.length).toEqual(1);
  expect(added.first.emailAddress).toEqual(kEMailAddress);
  expect(added.first.name).toEqual(kRealName);
  expect(added.first.person.name).toEqual(kRealName);
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
  expect(added.contents.map(person => person.name)).toEqual([kGuessedName]);
  expect(await savedPersons(appGlobal.collectedAddressbook)).toEqual(kGuessedName);
});

test("The Enter button adds the person", async () => {
  type(emailInput(), kEMailAddress);
  click(document.body.querySelector(".name-line button.add"));
  await settle();

  expect(added.contents.map(person => person.name)).toEqual([kGuessedName]);
  expect(await savedPersons(appGlobal.collectedAddressbook)).toEqual(kGuessedName);
});

// Lookout only: ; and , separate recipients, like in Outlook
test("; adds the person with the guessed name, and allows to type the next address", async () => {
  type(emailInput(), kEMailAddress);
  let event = pressKey(emailInput(), ";");
  await settle();

  expect(event.defaultPrevented).toBe(true);
  expect(added.contents.map(person => person.name)).toEqual([kGuessedName]);
  expect(await savedPersons(appGlobal.collectedAddressbook)).toEqual(kGuessedName);
  expect(emailInput().value).toEqual("");
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

test("Clicking outside adds the person, without taking the focus", async () => {
  let elsewhere = document.createElement("input");
  document.body.append(elsewhere);
  type(emailInput(), kEMailAddress);
  pressKey(emailInput(), "Tab");
  type(nameInput(), kRealName);

  elsewhere.focus();
  click(elsewhere);
  await settle();

  expect(added.contents.map(person => person.name)).toEqual([kRealName]);
  expect(await savedPersons(appGlobal.collectedAddressbook)).toEqual(kRealName);
  expect(document.activeElement).toBe(elsewhere);
});

test("Clicking the name does not add the person", async () => {
  type(emailInput(), kEMailAddress);
  nameInput().focus();
  click(nameInput());
  await settle();

  expect(added.length).toEqual(0);
  expect(document.activeElement).toBe(nameInput());
});

test("Saves the contact in the address book that the user picked", async () => {
  type(emailInput(), kEMailAddress);
  click(document.body.querySelector(".name-line button.addressbook"));
  let item = [...document.body.querySelectorAll<HTMLElement>("button.lo-menuitem")]
    .find(menuItem => menuItem.textContent.trim() == "Personal");
  click(item);
  await settle();
  pressKey(emailInput(), "Tab");
  pressKey(nameInput(), "Enter");
  await settle();

  expect(added.first.person.addressbook).toBe(appGlobal.personalAddressbook);
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
  expect(document.body.querySelector(".name-line button.addressbook")).not.toBeNull();

  pressKey(emailInput(), "Tab");
  await settle();
  expect(nameInput().value).toEqual(kRealName);
  expect(nameInput().selectionStart).toEqual(0);
  expect(document.body.querySelector(".name-line button.addressbook")).toBeNull();

  pressKey(nameInput(), "Enter");
  await settle();

  expect(added.first.person).toBe(person);
  expect(added.first.name).toEqual(kRealName);
  expect(await savedPersons(appGlobal.personalAddressbook)).toEqual("");
  expect(await savedPersons(appGlobal.collectedAddressbook)).toEqual("");
});

test("A known person: ENTER takes the search result", async () => {
  let person = addKnownPerson();
  type(emailInput(), kEMailAddress);
  await settle(50);
  expect(document.body.querySelector(".autocomplete-list .suggestion.highlighted")).not.toBeNull();
  pressKey(emailInput(), "Enter");
  await settle();

  expect(added.length).toEqual(1);
  expect(added.first.person).toBe(person);
  expect(added.first.name).toEqual(kRealName);
  expect(document.body.querySelector(".autocomplete-list")).toBeNull();
});

test("Clicking outside while a search result is shown adds that person", async () => {
  let person = addKnownPerson();
  type(emailInput(), kEMailAddress);
  await settle(50);
  expect(document.body.querySelector(".autocomplete-list .suggestion.highlighted")).not.toBeNull();

  click(document.body);
  await settle();

  expect(added.length).toEqual(1);
  expect(added.first.person).toBe(person);
  expect(added.first.name).toEqual(kRealName);
});

test("Without `askForName`, adds the typed email address right away, with the guessed name", async () => {
  mountAutocomplete(false);
  type(emailInput(), kEMailAddress);
  expect(nameInput()).toBeNull();
  pressKey(emailInput(), "Enter");
  await settle();

  expect(added.length).toEqual(1);
  expect(added.first.name).toEqual(kGuessedName);
  expect(await savedPersons(appGlobal.collectedAddressbook)).toEqual("");
});

test("Name and email address typed together are added right away", async () => {
  type(emailInput(), `${kRealName} <${kEMailAddress}>`);
  expect(nameInput()).toBeNull();
  pressKey(emailInput(), "Enter");
  await settle();

  expect(added.length).toEqual(1);
  expect(added.first.name).toEqual(kRealName);
  expect(added.first.emailAddress).toEqual(kEMailAddress);
});

function editedNameInput(): HTMLInputElement {
  return document.body.querySelector(".edited-person input.name");
}

test("Double-click on a recipient edits the name, and saves the new contact", async () => {
  mountAutocomplete(true, [new PersonUID(kEMailAddress, kGuessedName)]);
  document.body.querySelector(".recipient").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await settle();
  expect(document.activeElement).toBe(editedNameInput());
  expect(editedNameInput().value).toEqual(kGuessedName);

  type(editedNameInput(), kRealName);
  pressKey(editedNameInput(), "Enter");
  await settle();

  expect(editedNameInput()).toBeNull();
  expect(added.first.name).toEqual(kRealName);
  expect(document.body.querySelector(".recipient .name").textContent).toEqual(kRealName);
  expect(await savedPersons(appGlobal.collectedAddressbook)).toEqual(kRealName);
});

test("ESC cancels the name edit", async () => {
  mountAutocomplete(true, [new PersonUID(kEMailAddress, kGuessedName)]);
  document.body.querySelector(".recipient").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await settle();
  type(editedNameInput(), kRealName);
  pressKey(editedNameInput(), "Escape");
  await settle();

  expect(editedNameInput()).toBeNull();
  expect(added.first.name).toEqual(kGuessedName);
  expect(await savedPersons(appGlobal.collectedAddressbook)).toEqual("");
});

test("Editing the name of a known person leaves the contact alone", async () => {
  let person = addKnownPerson();
  mountAutocomplete(true, [PersonUID.fromPerson(person)]);
  document.body.querySelector(".recipient").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await settle();
  type(editedNameInput(), "Fred");
  click(document.body);
  await settle();

  expect(added.first.name).toEqual("Fred");
  expect(person.name).toEqual(kRealName);
  expect(await savedPersons(appGlobal.personalAddressbook)).toEqual("");
});
