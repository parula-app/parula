import type { Addressbook } from "../../../logic/Contacts/Addressbook";
import type { Contact } from "../../../logic/Abstract/Contact";
import { AppWindow } from "../../../frontend/MainWindow/AppWindow";
import { writable } from "svelte/store";

export const selectedAddressbook = AppWindow.perWindow(() => writable<Addressbook | null>(null));
export const selectedContact = AppWindow.perWindow(() => writable<Contact | null>(null));
export const contactSearchInput = AppWindow.perWindow(() => writable<HTMLInputElement | null>(null));

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

export const contactSearchOptions = AppWindow.perWindow(() => writable<ContactSearchOptions>({
  term: null,
  scope: ContactSearchScope.CurrentFolder,
  hasPhoneNumber: false,
  hasAddress: false,
  hasEMailAddress: false,
}));
