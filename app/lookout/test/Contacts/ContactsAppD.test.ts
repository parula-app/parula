// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { appGlobal } from "../../../logic/app";
import { Addressbook } from "../../../logic/Contacts/Addressbook";
import { ContactEntry, Person } from "../../../logic/Abstract/Person";
import ContactsAppD from "../../Contacts/ContactsAppD.svelte";
import { LetterIndex } from "../../Contacts/LetterIndex";
import { defaultContactSearchOptions } from "../../Contacts/ContactSearch";
import { ContactView } from "../../Contacts/Person/ContactColumns";
import { contactSearchOptions, ContactSearchScope, selectedAddressbook, selectedContact } from "../../Contacts/Person/Selected";
import { selectedPerson } from "../../../frontend/Contacts/Person/Selected";
import { statusBarContent } from "../../MainWindow/StatusBar.svelte";
import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeAll, beforeEach, expect, test, vi, type MockInstance } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollTo ??= () => {};
});

let addressbook: Addressbook;
let app: Record<string, any> | null = null;
let compareByName: MockInstance;

function newPerson(name: string, phoneNumber?: string): Person {
  let person = new Person(addressbook);
  person.name = name;
  if (phoneNumber) {
    person.phoneNumbers.add(new ContactEntry(phoneNumber, "work"));
  }
  addressbook.persons.add(person);
  return person;
}

/** The names on the address cards, in the shown order */
function cardNames(): string[] {
  return [...document.querySelectorAll(".address-card .card-name")].map(card => card.textContent.trim());
}

function cardOf(name: string): HTMLElement {
  return [...document.querySelectorAll<HTMLElement>(".address-card")]
    .find(card => card.querySelector(".card-name").textContent.trim() == name);
}

beforeEach(() => {
  localStorage.clear();
  getLocalStorage<ContactView>("lookout.contacts.view").value = ContactView.Card;
  addressbook = new Addressbook();
  addressbook.name = "Personal";
  appGlobal.addressbooks.replaceAll([addressbook]);
  appGlobal.searchOnlyAddressbooks.clear();
  newPerson("Carla Diaz", "+49 30 555");
  newPerson("Anna Schmidt");
  newPerson("Bert Meier");
  compareByName = vi.spyOn(LetterIndex, "compareByName");
  let target = document.createElement("div");
  document.body.append(target);
  app = mount(ContactsAppD, { target });
  flushSync();
});

afterEach(() => {
  unmount(app);
  app = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  contactSearchOptions.set(defaultContactSearchOptions(ContactSearchScope.CurrentFolder));
  selectedAddressbook.set(null);
  selectedContact.set(null);
  selectedPerson.set(null);
});

test("The cards show the contacts sorted by name, and a new contact appears in its place", () => {
  expect(cardNames()).toEqual(["Anna Schmidt", "Bert Meier", "Carla Diaz"]);
  newPerson("Beate Lang");
  flushSync();
  expect(cardNames()).toEqual(["Anna Schmidt", "Beate Lang", "Bert Meier", "Carla Diaz"]);
  expect(get(statusBarContent).left[0].label).toBe("Items: 4");
});

test("Editing a contact updates its card, without sorting all contacts again", () => {
  let bert = addressbook.persons.find(person => person.name == "Bert Meier");
  compareByName.mockClear();
  bert.company = "ACME";
  flushSync();
  expect(cardOf("Bert Meier").textContent).toContain("ACME");
  expect(compareByName).not.toHaveBeenCalled();
});

test("A renamed contact keeps its place until the list is built again", () => {
  let anna = addressbook.persons.find(person => person.name == "Anna Schmidt");
  anna.name = "Zoe Schmidt";
  flushSync();
  expect(cardNames()).toEqual(["Zoe Schmidt", "Bert Meier", "Carla Diaz"]);
  selectedAddressbook.set(addressbook);
  flushSync();
  expect(cardNames()).toEqual(["Bert Meier", "Carla Diaz", "Zoe Schmidt"]);
});

test("Refining the search shows only the matching contacts, and a new match appears in its place", () => {
  contactSearchOptions.set({ ...defaultContactSearchOptions(ContactSearchScope.CurrentFolder), hasPhoneNumber: true });
  flushSync();
  expect(cardNames()).toEqual(["Carla Diaz"]);
  newPerson("Anton Weber", "+49 89 123");
  newPerson("Dora Klein");
  flushSync();
  expect(cardNames()).toEqual(["Anton Weber", "Carla Diaz"]);
});
