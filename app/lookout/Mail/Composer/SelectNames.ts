import type { Person } from "../../../logic/Abstract/Person";
import type { Addressbook } from "../../../logic/Contacts/Addressbook";
import { PersonUID } from "../../../logic/Abstract/PersonUID";
import { ArrayColl, mergeColls, type Collection } from "svelte-collections";

export class SelectNamesField {
  readonly picks: ArrayColl<PersonUID>;

  constructor(readonly label: string, initial: PersonUID[] = [], readonly single = false) {
    this.picks = new ArrayColl(initial);
  }

  add(persons: Iterable<Person>) {
    for (let person of persons) {
      let entry = person.emailAddresses.sortBy(entry => entry.preference).first;
      if (!entry?.value || this.picks.some(pick => pick.emailAddress == entry.value)) {
        continue;
      }
      let pick = PersonUID.fromContactEntry(person, entry);
      if (this.single) {
        this.picks.replaceAll([pick]);
        return;
      }
      this.picks.add(pick);
    }
  }

  remove(recipient: PersonUID) {
    this.picks.remove(recipient);
  }
}

export function searchPersons(addressbooks: Iterable<Addressbook>, searchTerm: string, nameOnly = false): Collection<Person> {
  let term = searchTerm.trim().toLowerCase();
  let results = new ArrayColl<Collection<Person>>();
  for (let addressbook of addressbooks) {
    results.add(term ? addressbook.quickSearch(term, !nameOnly) : addressbook.persons);
  }
  return mergeColls(results)
    .filterObservable(person => person.emailAddresses.hasItems &&
      (!nameOnly || !term || !!person.name?.toLowerCase().includes(term)))
    .sortBy(person => person.name?.toLowerCase() ?? "");
}
