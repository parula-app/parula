// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { onKeyOnContacts } from "../../../frontend/Contacts/ContactsKeyboard";
import { newPerson, selectedPerson } from "../../../frontend/Contacts/Person/Selected";
import { Addressbook } from "../../../logic/Contacts/Addressbook";
import { get } from "svelte/store";
import { expect, test } from "vitest";

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true, ...init });
}

test("Ctrl+N creates a new contact in the shown addressbook", () => {
  let addressbook = new Addressbook();
  addressbook.name = "Test";
  appGlobal.addressbooks.add(addressbook);
  let event = press("n", { ctrlKey: true });
  onKeyOnContacts(event, addressbook);
  expect(event.defaultPrevented).toBe(true);
  let person = get(newPerson);
  expect(person).toBeTruthy();
  expect(person.addressbook).toBe(addressbook);
  expect(get(selectedPerson)).toBe(person);

  // A second Ctrl+N (Cmd+N, with Caps Lock) goes back to the unsaved new contact
  onKeyOnContacts(press("N", { metaKey: true }), addressbook);
  expect(get(newPerson)).toBe(person);
  newPerson.set(null);
  selectedPerson.set(null);
  appGlobal.addressbooks.remove(addressbook);
});

test("Other keys are left alone", () => {
  for (let event of [press("n"), press("N", { ctrlKey: true, shiftKey: true }), press("n", { ctrlKey: true, altKey: true })]) {
    onKeyOnContacts(event, null);
    expect(event.defaultPrevented).toBe(false);
  }
  expect(get(newPerson)).toBeFalsy();
});

test("Ctrl+E goes to the search field", () => {
  let header = document.createElement("div");
  header.className = "window-header";
  header.innerHTML = `<div class="search-box"><input type="search"></div>`;
  document.body.append(header);
  let event = press("e", { ctrlKey: true });
  onKeyOnContacts(event, null);
  expect(event.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(header.querySelector("input"));
  header.remove();
});

test("Ctrl+N in a text field is left to the field", () => {
  let input = document.createElement("input");
  document.body.append(input);
  let event = press("n", { ctrlKey: true });
  input.addEventListener("keydown", keyEvent => onKeyOnContacts(keyEvent, null));
  input.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(get(newPerson)).toBeFalsy();
  input.remove();
});
