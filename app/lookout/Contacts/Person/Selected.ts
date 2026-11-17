import type { Addressbook } from "../../../logic/Contacts/Addressbook";
import type { Contact } from "../../../logic/Abstract/Contact";
import { writable } from "svelte/store";

export const selectedAddressbook = writable<Addressbook | null>(null);
export const selectedContact = writable<Contact | null>(null);

export enum ContactSearchScope {
  CurrentFolder = "current",
  AllContactItems = "all",
}

export interface ContactSearchOptions {
  term: string | null;
  scope: ContactSearchScope;
  hasPhoneNumber: boolean;
  hasAddress: boolean;
  hasEMailAddress: boolean;
}

export const contactSearchOptions = writable<ContactSearchOptions>({
  term: null,
  scope: ContactSearchScope.CurrentFolder,
  hasPhoneNumber: false,
  hasAddress: false,
  hasEMailAddress: false,
});
