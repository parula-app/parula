import { ContactEntry, Person } from "../Abstract/Person";
import { PersonUID } from "../Abstract/PersonUID";
import type { Addressbook } from "../Contacts/Addressbook";
import { appGlobal } from "../app";
import { notifyChangedProperty } from "../util/Observable";
import { capitalizeWords, type URLString } from "../util/util";

export class ChatPersonUID extends PersonUID {
  @notifyChangedProperty
  chatID: string;
  @notifyChangedProperty
  protocol: string;
  @notifyChangedProperty
  picture: URLString | null;

  constructor(protocol: string, chatID: string, name?: string) {
    super();
    this.protocol = protocol;
    this.chatID = chatID;
    this.name = name || nameFromChatID(chatID);
  }

  findPerson() {
    if (this.person) {
      return this.person;
    }
    if (!this.chatID) {
      return undefined;
    }
    let chatID = this.chatID.toLowerCase();
    for (let ab of appGlobal.addressbooks) {
      let existing = ab.persons.find(p => p.chatAccounts.some(e => e.value?.toLowerCase() == chatID && e.protocol == this.protocol));
      if (existing) {
        return existing;
      }
    }
    return undefined;
  }

  createPerson(addressbook: Addressbook) {
    this.person = this.findPerson();
    if (this.person) {
      return this.person;
    }
    this.person = addressbook.newPerson();
    this.person.name = this.name || nameFromChatID(this.chatID);
    this.person.chatAccounts.add(new ContactEntry(this.chatID, "primary", this.protocol));
    addressbook.persons.add(this.person);
    return this.person;
  }

  matchesPerson(person: Person): boolean {
    // `chatID` is the ID on the chat server, and needs not be listed as chat account of the person
    return person && (this.person == person ||
      !!person.chatAccounts.find(e => e.value == this.chatID));
  }
}

export function nameFromChatID(chatID: string): string {
  let name: string;
  if (chatID.startsWith("@")) { // Matrix: @ben:matrix.org
    chatID = chatID.substring(1);
  } else if (chatID.includes("@")) { // Jabber: ben@jabber.mustang.im (like email address)
    name = chatID.split("@")[0];
  } else { // IRC, just nickname: benb
    name = chatID;
  }
  name = name.replace(/\./g, " ");
  name = capitalizeWords(name);
  return name;
}
