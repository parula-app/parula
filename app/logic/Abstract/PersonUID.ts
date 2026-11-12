import { Group } from "./Group";
import type { Addressbook } from "../Contacts/Addressbook";
import { ContactEntry, Person } from "./Person";
import type { PublicKey } from "../Mail/Encryption/PublicKey";
import { getPublicKeyForPersonUID } from "../Mail/Encryption/KeyUtils";
import { SMIMEPublicKey } from "../Mail/Encryption/SMIME/SMIMEPublicKey";
import { appGlobal } from "../app";
import { Observable, notifyChangedProperty } from "../util/Observable";
import { capitalizeWords } from "../util/util";
import { ArrayColl } from "svelte-collections";

export class PersonUID extends Observable {
  @notifyChangedProperty
  name: string;
  @notifyChangedProperty
  emailAddress: string;
  @notifyChangedProperty
  person?: Person;
  /** A key that we know for this email address, but that is not saved in an
   * addressbook, e.g. the certificate of an email that this address signed.
   * `createPerson()` saves it with the contact. */
  @notifyChangedProperty
  encryptionPublicKey?: PublicKey;

  constructor(emailAddress?: string, name?: string) {
    super();
    this.emailAddress = emailAddress ?? kDummyPerson.emailAddress;
    this.name = name;
  }

  static fromPerson(person: Person) {
    let puid = new PersonUID(person.emailAddresses.first?.value, person.name);
    puid.person = person;
    return puid;
  }

  /** from `Person.emailAddresses` */
  static fromContactEntry(person: Person, entry: ContactEntry) {
    let puid = new PersonUID(entry.value, person.name);
    puid.person = person;
    return puid;
  }

  findPerson() {
    if (this.person) {
      return this.person;
    }
    return this.person = findPerson(this.emailAddress);
  }

  createPerson(addressbook: Addressbook) {
    this.person = this.findPerson();
    if (!this.person) {
      this.person = addressbook.newPerson();
      this.person.name = this.name || nameFromEmailAddress(this.emailAddress);
      this.person.emailAddresses.add(new ContactEntry(this.emailAddress, "primary"));
      addressbook.persons.add(this.person);
    }
    if (this.encryptionPublicKey) {
      this.person.addEncryptionPublicKey(this.encryptionPublicKey);
    }
    return this.person;
  }

  /** Fetches the S/MIME certificate that the company directories have for
   * this email address, unless we already have one.
   * Works also without contact.
   * Reports errors, does not throw. */
  async fetchEncryptionKeys(): Promise<void> {
    if (getPublicKeyForPersonUID(this, SMIMEPublicKey)) {
      return;
    }
    let person = this.findPerson();
    if (person) {
      await person.fetchEncryptionKeys();
      return;
    }
    let found = await Promise.all(appGlobal.searchOnlyAddressbooks.contents.map(ab =>
      ab.fetchEncryptionKeys(new ArrayColl([this.emailAddress]))));
    let key = found.flatMap(keys => keys.contents).find(key => !key.obsolete);
    if (key) {
      this.encryptionPublicKey = key;
    }
  }

  matchesPerson(person: Person): boolean {
    return person && !!person.emailAddresses.find(e => e.value == this.emailAddress);
  }

  matches(other: PersonUID): boolean {
    return other && other.emailAddress == this.emailAddress;
  }

  /** The email address does not belong to the end user,
   * but a mailling list or messaging system */
  get isProxyAddress(): boolean {
    return this.name?.includes(" via ") || this.name?.endsWith("@invalid");
  }

  get nameAndEMail(): string {
    return this.name + " <" + this.emailAddress + ">";
  }
  get nameOrEMail(): string {
    return this.name || this.emailAddress;
  }
  toString() {
    return this.nameOrEMail;
  }
}

const cachedPersonUIDs = new Map<string, WeakRef<PersonUID>>();
/** Drops the cache entry once the `PersonUID` itself is gone.
 * Otherwise we keep one dead entry per email address that we ever saw.
 * @see Abstract/Attachment */
const cachedPersonUIDsFinalizer = new FinalizationRegistry((key: string) => {
  if (!cachedPersonUIDs.get(key)?.deref()) {
    cachedPersonUIDs.delete(key);
  }
});

export function findOrCreatePersonUID(emailAddress: string, realname: string): PersonUID {
  if (!emailAddress && !realname) {
    return kDummyPerson;
  }
  let key = emailAddress + "|" + realname;
  let cached = cachedPersonUIDs.get(key)?.deref();
  if (cached) {
    return cached;
  }
  /* TODO If the person or email address is later added to the personal address book,
    add the `Person` to the cached `PersonUID` entry.
    We currently search all address books on every call to `personUID.findPerson()` */
  let existing = findPerson(emailAddress);
  let uid = new PersonUID(emailAddress, realname ?? existing?.name ?? emailAddress);
  if (existing) {
    uid.person = existing;
  }
  cachedPersonUIDs.set(key, new WeakRef(uid));
  cachedPersonUIDsFinalizer.register(uid, key);
  return uid;
}

export function findPerson(emailAddress: string): Person | undefined {
  if (!emailAddress) {
    return undefined;
  }
  emailAddress = emailAddress.toLowerCase();
  for (let ab of appGlobal.addressbooks) {
    let existing = ab.persons.find(p => p.emailAddresses.some(e => e.value?.toLowerCase() == emailAddress));
    if (existing) {
      return existing;
    }
  }
  return undefined;
}

export function findOrCreatePerson(emailAddress: string, name: string): Person {
  let person = findPerson(emailAddress);
  if (person) {
    return person;
  }
  person = appGlobal.collectedAddressbook.newPerson();
  person.name = name;
  person.emailAddresses.add(new ContactEntry(emailAddress, null, "mailto"));
  // Add it, so that the next call finds it, instead of creating a duplicate
  appGlobal.collectedAddressbook.persons.add(person);
  return person;
}

export function findPersonsWithName(name: string): ArrayColl<Person> {
  if (!name) {
    return undefined;
  }
  name = name.toLowerCase();
  let results = new ArrayColl<Person>();
  for (let ab of appGlobal.addressbooks) {
    results.addAll(ab.persons.contents.filter(p => p.name?.toLowerCase() == name));
  }
  return results;
}

export function personDisplayName(person: Person | Group | PersonUID) {
  if (!person) {
    return "";
  } else if (person instanceof Person || person instanceof Group) {
    return person.name;
  } else if (person instanceof PersonUID) {
    person.findPerson();
    if (person.person?.name) {
      return person.person.name;
    }
    if (!person.name) {
      return person.emailAddress?.replace(/@.*/, "") ?? "";
    }
    return person.name?.
      replace(/@.*/, "").
      replace(/ via .*/, "").
      substring(0, 30);
    /* Show domain - but too cluttered
    let domain = getBaseDomainFromHost(getDomainForEmailAddress(person.emailAddress));
    return person.name.substring(0, 20) + " @" + domain; */
  } else {
    return "Unknown contact type";
  }
}

export function nameFromEmailAddress(emailAddress: string): string {
  let name = emailAddress.split("@")[0];
  name = name.replace(/\./g, " ");
  name = capitalizeWords(name);
  return name;
}

export const kDummyPerson = new PersonUID("unknown@invalid", "");
