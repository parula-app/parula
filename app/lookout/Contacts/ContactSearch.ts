import type { Contact } from "../../logic/Abstract/Contact";
import { Person } from "../../logic/Abstract/Person";
import type { Addressbook } from "../../logic/Contacts/Addressbook";
import { ArrayColl, mergeColls, type Collection } from "svelte-collections";
import { ContactSearchScope, type ContactSearchOptions } from "./Person/Selected";

export function defaultContactSearchOptions(scope: ContactSearchScope): ContactSearchOptions {
  return {
    term: null,
    scope,
    hasPhoneNumber: false,
    hasAddress: false,
    hasEMailAddress: false,
  };
}

export function hasContactRefiners(options: ContactSearchOptions): boolean {
  return options.hasPhoneNumber || options.hasAddress || options.hasEMailAddress;
}

export function findContacts(addressbooks: Iterable<Addressbook>, searchTerm: string): Collection<Contact> {
  searchTerm = searchTerm.toLowerCase();
  let results = new ArrayColl<Collection<Contact>>();
  for (let addressbook of addressbooks) {
    results.add(addressbook.quickSearch(searchTerm, true));
    results.add(addressbook.groups.filterOnce(group => group.name?.toLowerCase().includes(searchTerm)));
  }
  return mergeColls(results);
}

export function matchesContactRefiners(contact: Contact, options: ContactSearchOptions): boolean {
  if (!(contact instanceof Person)) {
    return false;
  }
  return (!options.hasPhoneNumber || contact.phoneNumbers.hasItems) &&
    (!options.hasAddress || contact.streetAddresses.hasItems) &&
    (!options.hasEMailAddress || contact.emailAddresses.hasItems);
}
