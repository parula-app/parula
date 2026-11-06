import type { Person, ContactEntry } from "../../../logic/Abstract/Person";
import { AppWindow } from "../../MainWindow/AppWindow";
import { ArrayColl } from "svelte-collections";
import { writable } from "svelte/store";

export const selectedPerson = AppWindow.perWindow(() => writable<Person>(null));
export const selectedContactEntry = AppWindow.perWindow(() => writable<ContactEntry>(null));

export const newPerson = AppWindow.perWindow(() => writable<Person>(null));
export const lastPersons = new ArrayColl<Person>();
/*selectedPerson.subscribe(person => {
  lastPersons.remove(person);
  lastPersons.add(person);
});*/
