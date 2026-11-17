import type { Person } from "../Abstract/Person";
import { PersonUID } from "../Abstract/PersonUID";
import { appGlobal } from "../app";
import { promiseErrors } from "../util/flow/promiseUtil";
import { logErrorToServer } from "../util/error";
import { ArrayColl } from "svelte-collections";

/** Search all address books and server-based query-only address books for
 * a person whose name or email address matches the search string.
 * @throws in case of error */
export async function searchContacts(searchStr: string, skip: (person: PersonUID) => boolean): Promise<PersonUID[]> {
  if (!searchStr || searchStr.length < 2) {
    return [];
  }
  let searchStrParts = searchStr.toLowerCase().split(" ");
  let persons: Person[] = [];
  for (let ab of appGlobal.addressbooks) {
    persons.push(...ab.persons.filterOnce(person => searchStrParts.every(inputPart =>
      person.name?.toLowerCase().includes(inputPart) ||
      person.emailAddresses.some(c => c.value?.toLowerCase().includes(inputPart)))));
  }
  // `.contents`, because `Collection.map()` keeps observing the address book list
  // and would re-run this search whenever a GAL is added or removed
  let results = await Promise.allSettled(appGlobal.searchOnlyAddressbooks.contents.map(async ab => {
    let results = new ArrayColl<Person>;
    await ab.quickSearchAsync(searchStr.toLowerCase(), results);
    persons = persons.concat(results.contents);
  }));
  promiseErrors(results).forEach(ex => logErrorToServer(ex));
  let emailAddresses: PersonUID[] = [];
  for (let person of persons) {
    for (let c of person.emailAddresses.sortBy(c => c.preference)) {
      let n = new PersonUID(c.value, person.name);
      n.person = person;
      if (emailAddresses.find(e => e.emailAddress == n.emailAddress && e.name == n.name) ||
          skip(n)) {
        continue;
      }
      emailAddresses.push(n);
    }
  }
  console.log("Got", persons.length, "persons with ", emailAddresses.length, "email addresses for", searchStr);
  return emailAddresses;
}
