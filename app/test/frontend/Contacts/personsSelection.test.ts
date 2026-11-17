// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { ContactEntry, Person } from "../../../logic/Abstract/Person";
import { Addressbook } from "../../../logic/Contacts/Addressbook";
import { newPerson, selectedPerson } from "../../../frontend/Contacts/Person/Selected";
import { selectedWorkspace } from "../../../frontend/MainWindow/Selected";
import { globalSearchTerm } from "../../../frontend/AppsBar/selectedApp";
import ContactsAppD from "../../../frontend/Contacts/ContactsAppD.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  appGlobal.remoteApp = {} as any;
});

beforeEach(() => {
  appGlobal.addressbooks.clear();
  selectedPerson.set(null);
  newPerson.set(null);
  selectedWorkspace.set(null);
  globalSearchTerm.set(null);
});

function newTestPersons(names: string[]): Person[] {
  let addressbook = new Addressbook();
  appGlobal.addressbooks.add(addressbook);
  return names.map(name => {
    let person = addressbook.newPerson();
    person.id = name;
    person.name = name;
    person.emailAddresses.add(new ContactEntry(`${name}@example.com`, "work"));
    addressbook.persons.add(person);
    return person;
  });
}

let contactsApp: Record<string, any> | null = null;

function mountContactsApp(): HTMLElement {
  closeContactsApp();
  let target = document.createElement("div");
  document.body.append(target);
  contactsApp = mount(ContactsAppD, { target });
  flushSync();
  return target;
}

/** The router destroys the app when the user switches to another app.
 * A living app would also keep reacting to the stores of the next test. */
function closeContactsApp() {
  contactsApp && unmount(contactsApp);
  contactsApp = null;
}

afterEach(closeContactsApp);

test("Selects only the person that the user selected in another app", () => {
  let persons = newTestPersons(["Anna", "Berta", "Charlotte"]);
  // The user read a mail from Anna, which selected her as person
  selectedPerson.set(persons[0]);

  let target = mountContactsApp();

  expect(target.querySelectorAll(".row.selected")).toHaveLength(1);
  expect(target.querySelector(".selection-toolbar")).toBeNull();
});

test("Shows the actions for multiple persons only when the user selected several", () => {
  let persons = newTestPersons(["Anna", "Berta", "Charlotte"]);
  selectedPerson.set(persons[0]);
  let target = mountContactsApp();
  expect(target.querySelector(".selection-toolbar")).toBeNull();

  let berta = [...target.querySelectorAll<HTMLElement>(".row")]
    .find(row => row.textContent.includes("Berta"));
  berta.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
  flushSync();

  expect(target.querySelector(".selection-toolbar")).not.toBeNull();
});
