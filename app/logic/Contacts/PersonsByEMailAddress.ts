import type { ContactEntry, Person } from "../Abstract/Person";
import { arrayRemove } from "../util/util";
import type { Collection } from "svelte-collections";

/**
 * Finds the person with an email address, without going through all persons.
 * The app looks up the sender and the recipients of every email,
 * and an address book may have thousands of persons.
 *
 * Follows the changes: persons added and removed, and their email addresses
 * added, removed and changed.
 */
export class PersonsByEMailAddress {
  /** Lowercase email address -> the persons with this email address */
  protected readonly personsByAddress = new Map<string, Person[]>();
  /** Also keeps the observers alive: `registerObserver()` holds them only weakly */
  protected readonly observers = new Map<Person, EMailAddressesObserver>();

  /** @param persons Must be kept alive by the caller, which also keeps this object alive */
  constructor(persons: Collection<Person>) {
    persons.registerObserver(this);
    this.added(persons.contents);
  }

  /**
   * @param emailAddress must be lowercase
   * @returns the first person with this email address */
  get(emailAddress: string): Person | undefined {
    return this.personsByAddress.get(emailAddress)?.[0];
  }

  added(persons: Person[]) {
    for (let person of persons) {
      this.observers.set(person, new EMailAddressesObserver(this, person));
    }
  }

  removed(persons: Person[]) {
    for (let person of persons) {
      this.observers.get(person)?.stop();
      this.observers.delete(person);
    }
  }

  addAddress(emailAddress: string, person: Person) {
    let address = emailAddress?.toLowerCase();
    if (!address) {
      return;
    }
    let persons = this.personsByAddress.get(address);
    if (persons) {
      persons.push(person);
    } else {
      this.personsByAddress.set(address, [person]);
    }
  }

  removeAddress(emailAddress: string, person: Person) {
    let address = emailAddress?.toLowerCase();
    let persons = this.personsByAddress.get(address);
    if (!persons) {
      return;
    }
    arrayRemove(persons, person);
    if (!persons.length) {
      this.personsByAddress.delete(address);
    }
  }
}

/** Puts the email addresses of one person into the index, and follows their changes */
class EMailAddressesObserver {
  /** Stops following the changes of an email address */
  protected readonly unsubscribes = new Map<ContactEntry, () => void>();

  constructor(
    protected readonly index: PersonsByEMailAddress,
    protected readonly person: Person) {
    person.emailAddresses.registerObserver(this);
    this.added(person.emailAddresses.contents);
  }

  added(entries: ContactEntry[]) {
    for (let entry of entries) {
      this.index.addAddress(entry.value, this.person);
      // The user edits the address of an existing entry
      this.unsubscribes.set(entry, entry.subscribe((entry, propertyName, oldValue) => {
        if (propertyName == "value") {
          this.index.removeAddress(oldValue, this.person);
          this.index.addAddress(entry.value, this.person);
        }
      }));
    }
  }

  removed(entries: ContactEntry[]) {
    for (let entry of entries) {
      this.unsubscribes.get(entry)?.();
      this.unsubscribes.delete(entry);
      this.index.removeAddress(entry.value, this.person);
    }
  }

  stop() {
    this.person.emailAddresses.unregisterObserver(this);
    this.removed(this.person.emailAddresses.contents);
  }
}
