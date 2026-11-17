import { ContactEntry, Person } from "../../logic/Abstract/Person";
import { Group } from "../../logic/Abstract/Group";
import type { Contact } from "../../logic/Abstract/Contact";
import { PersonUID } from "../../logic/Abstract/PersonUID";
import type { Addressbook } from "../../logic/Contacts/Addressbook";
import type { Calendar } from "../../logic/Calendar/Calendar";
import { Participant } from "../../logic/Calendar/Participant";
import { InvitationResponse } from "../../logic/Calendar/Invitation/InvitationStatus";
import { appGlobal } from "../../logic/app";
import { mailMustangApp } from "../../frontend/Mail/MailMustangApp";
import { selectedAccount } from "../../frontend/Mail/Selected";
import { selectedCalendar } from "../../frontend/Calendar/selected";
import { setNewEventTime } from "../../frontend/Calendar/event";
import { openEvent } from "../../frontend/Calendar/open";
import { newPerson, selectedPerson } from "../../frontend/Contacts/Person/Selected";
import { selectedAddressbook, selectedContact } from "./Person/Selected";
import { showMessageBox, askYesNo } from "../Shared/Dialog/MessageBox";
import { appName } from "../../logic/build";
import { openExternalURL } from "../../logic/util/os-integration";
import { goTo, openApp } from "../../frontend/AppsBar/selectedApp";
import { contactsMustangApp } from "../../frontend/Contacts/ContactsMustangApp";
import { URLPart } from "../../logic/util/blob";
import { assert } from "../../logic/util/util";
import { gt } from "../../l10n/l10n";
import { get } from "svelte/store";

export class ContactActions {
  static targetAddressbook(selected: Addressbook | null): Addressbook {
    let addressbook = selected && appGlobal.addressbooks.contains(selected)
      ? selected
      : appGlobal.addressbooks.first;
    assert(addressbook, gt`Please add an addressbook first`);
    return addressbook;
  }

  static createPerson(addressbook: Addressbook): Person {
    let person = addressbook.newPerson();
    person.name = "";
    person.addressbook = addressbook;
    newPerson.set(person);
    return person;
  }

  static createColleague(colleague: Person): Person {
    let person = ContactActions.createPerson(colleague.addressbook);
    person.company = colleague.company;
    for (let entries of ["phoneNumbers", "streetAddresses", "urls"] as const) {
      person[entries].addAll(colleague[entries].contents
        .filter(entry => entry.purpose == "work")
        .map(entry => entry.clone()));
    }
    return person;
  }

  static async createEMailContact(addressbook: Addressbook, name: string, emailAddress: string): Promise<Person> {
    assert(emailAddress.includes("@"), gt`Please enter an email address`);
    let person = addressbook.newPerson();
    person.name = name || emailAddress;
    person.addressbook = addressbook;
    person.emailAddresses.add(new ContactEntry(emailAddress, "work"));
    await person.save();
    return person;
  }

  static createGroup(addressbook: Addressbook): Group {
    let group = addressbook.newGroup();
    group.name = "";
    group.addressbook = addressbook;
    return group;
  }

  static newContact(selected: Addressbook | null) {
    ContactActions.edit(ContactActions.createPerson(ContactActions.targetAddressbook(selected)));
  }

  static newGroup(selected: Addressbook | null) {
    ContactActions.edit(ContactActions.createGroup(ContactActions.targetAddressbook(selected)));
  }

  static edit(contact: Contact) {
    if (contact instanceof Group) {
      goTo(URLPart`/contacts/group/${contact.id}/edit`, { group: contact });
    } else {
      goTo(URLPart`/contacts/person/${contact.id}/edit`, { person: contact });
    }
  }

  static closeForm(savedContact: Contact | null) {
    if (savedContact) {
      selectedContact.set(savedContact);
      selectedPerson.set(savedContact instanceof Person ? savedContact : null);
    }
    goTo("/contacts", {});
  }

  static isUnsaved(contact: Contact): boolean {
    if (contact instanceof Group) {
      return !contact.addressbook?.groups.contains(contact);
    }
    return !contact.addressbook?.persons.contains(contact);
  }

  static async deleteContacts(contacts: Contact[]): Promise<boolean> {
    assert(contacts.length, gt`Please select a contact first`);
    let saved = contacts.filter(contact => !ContactActions.isUnsaved(contact));
    if (saved.length && !await showMessageBox(gt`Delete`, saved.length == 1
        ? gt`Do you want to permanently delete the contact ${saved[0].name}?`
        : gt`Do you want to permanently delete the ${saved.length} selected contacts?`)) {
      return false;
    }
    if (contacts.includes(get(newPerson))) {
      newPerson.set(null);
    }
    await Promise.all(saved.map(contact => contact.deleteIt()));
    return true;
  }

  static expandGroups(contacts: Iterable<Contact>): Person[] {
    let persons = new Set<Person>();
    for (let contact of contacts) {
      if (contact instanceof Group) {
        for (let member of contact.participants) {
          persons.add(member);
        }
      } else {
        persons.add(contact);
      }
    }
    return [...persons];
  }

  static recipientsOf(contacts: Iterable<Contact>): PersonUID[] {
    let recipients: PersonUID[] = [];
    for (let person of ContactActions.expandGroups(contacts)) {
      let entry = person.emailAddresses.sortBy(address => address.preference).first ?? null;
      if (entry?.value && !recipients.some(recipient => recipient.emailAddress == entry.value)) {
        recipients.push(PersonUID.fromContactEntry(person, entry));
      }
    }
    return recipients;
  }

  static hasEmailAddress(contacts: Iterable<Contact>): boolean {
    return ContactActions.expandGroups(contacts).some(person => person.emailAddresses.hasItems);
  }

  static writeMail(contacts: Iterable<Contact>) {
    let account = get(selectedAccount) ?? appGlobal.emailAccounts.first;
    assert(account, gt`Please set up an email account before sending mail`);
    let mail = account.newEMailFrom();
    mail.to.addAll(ContactActions.recipientsOf(contacts));
    mailMustangApp.writeMail(mail);
  }

  static newMeeting(contacts: Iterable<Contact>, calendar: Calendar | null) {
    calendar ??= get(selectedCalendar) ?? appGlobal.calendars.first;
    assert(calendar, gt`Please set up a calendar first`);
    selectedCalendar.set(calendar);
    let event = calendar.newEvent();
    setNewEventTime(event, false, new Date());
    for (let recipient of ContactActions.recipientsOf(contacts)) {
      let participant = new Participant(recipient.emailAddress, recipient.name, InvitationResponse.Unknown);
      participant.person = recipient.person;
      event.participants.add(participant);
    }
    openEvent(event, true);
  }

  static async copyTo(contacts: Iterable<Contact>, addressbook: Addressbook) {
    await Promise.all([...contacts]
      .filter(contact => contact instanceof Person && contact.addressbook != addressbook)
      .map(person => (person as Person).copyToAddressbook(addressbook)));
  }

  static show(contact: Contact) {
    selectedAddressbook.set(null);
    selectedContact.set(contact);
    selectedPerson.set(contact instanceof Person ? contact : null);
    openApp(contactsMustangApp, {});
  }

  static async call(phoneNumber: string) {
    await openExternalURL("tel:" + phoneNumber.replace(/[^+\d]/g, ""));
  }

  static async deleteFolder(addressbook: Addressbook) {
    if (!await askYesNo(gt`Delete Folder`, addressbook.protocol == "addressbook-local"
        ? gt`Are you sure that you want to delete the address book "${addressbook.name}" and all contacts in it?`
        : gt`Do you want to remove the address book "${addressbook.name}" from ${appName}? This does not change the address book on the server.`)) {
      return;
    }
    if (get(selectedAddressbook) == addressbook) {
      selectedAddressbook.set(null);
    }
    await addressbook.deleteIt();
  }

  static async sync(addressbook: Addressbook) {
    assert(addressbook?.canSync, "Cannot sync " + addressbook?.protocol);
    if (!addressbook.isLoggedIn) {
      await addressbook.login(true);
    }
    await addressbook.listContacts();
  }
}
