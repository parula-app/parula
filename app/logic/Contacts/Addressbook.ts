import { Account } from "../Abstract/Account";
import { Person } from "../Abstract/Person";
import type { PersonUID } from "../Abstract/PersonUID";
import { Group } from "../Abstract/Group";
import type { Contact } from "../Abstract/Contact";
import type { PublicKey } from "../Mail/Encryption/PublicKey";
import { SQLGroup } from "./SQL/SQLGroup";
import { SQLPerson } from "./SQL/SQLPerson";
import { appGlobal } from "../app";
import { RunOnce } from "../util/flow/RunOnce";
import { AbstractFunction, NotReached } from "../util/util";
import { gt } from "../../l10n/l10n";
import { ArrayColl, Collection, mergeColl } from "svelte-collections";

export class Addressbook extends Account {
  readonly protocol: string = "addressbook-local";
  canSync: boolean = false;
  readonly persons = new ArrayColl<Person>();
  readonly groups = new ArrayColl<Group>();
  readonly contacts: Collection<Contact> = mergeColl(this.persons as Collection<Contact>, this.groups as Collection<Contact>);
  storage: AddressbookStorage | null = null;
  syncState: string | null = null;
  readDBRunOnce = new RunOnce();
  readDBPersonsRunOnce = new RunOnce();

  newPerson(): Person {
    return new Person(this);
  }
  newGroup(): Group {
    return new Group(this);
  }

  get isLoggedIn(): boolean {
    // Please override in subclasses
    return true; // for local addressbook
  }

  async syncOnStartup() {
    await super.syncOnStartup();
    await this.listContacts();
    await this.startupDependentAccounts();
  }

  async listContacts() {
    await this.readContactsFromDB();
  }

  async readFromDB(): Promise<void> {
    await this.readContactsFromDB();
  }

  async readContactsFromDB() {
    await this.readDBRunOnce.runOnce(async () => {
      if (!this.dbID) {
        await this.save();
      }
      await this.readPersonsFromDB();
      if (this.groups.isEmpty) {
        await SQLGroup.readAll(this);
      }
    });
  }

  /** Reads the persons, but not the groups.
   * Groups can have members from other addressbooks, e.g. the collected addressbook,
   * so reading the groups needs the persons of the other addressbooks,
   * but must not read their groups again. */
  async readPersonsFromDB() {
    await this.readDBPersonsRunOnce.runOnce(async () => {
      if (!this.dbID || this.persons.hasItems) {
        return;
      }
      await SQLPerson.readAll(this);
    });
  }

  /**
   * Searches for persons.
   *
   * The `searchTerm` may be in the name or in other fields, depending on the
   * implementation.
   *
   * @returns persons matching the `searchTerm`, in name or other fields.
   * This function may return an already populated collection, or subclasses
   * may populate the result collection only *after* the function has already returned.
   * The caller must watch the observer of the result collection.
   *
   * @see quickSearchAsync(), which returns only after the search is complete */
  quickSearch(searchTerm: string, fullSearch: boolean = false): Collection<Person> {
    if (!fullSearch) {
      return this.persons.filterOnce(p =>
        p.name?.toLowerCase().includes(searchTerm) ||
        p.emailAddresses.some(e => e.value.toLowerCase().includes(searchTerm)));
    }
    return this.persons.filterOnce(p =>
      p.name?.toLowerCase().includes(searchTerm) ||
      p.emailAddresses.some(e => e.value.toLowerCase().includes(searchTerm)) ||
      p.phoneNumbers.some(e => e.value.toLowerCase().includes(searchTerm)) ||
      p.chatAccounts.some(e => e.value.toLowerCase().includes(searchTerm)) ||
      p.streetAddresses.some(e => e.value.toLowerCase().includes(searchTerm)) ||
      p.notes?.toLowerCase().includes(searchTerm));
  }

  /** Adds matching persons to `results`. The caller must create the array.
   * The function returns only once the search is complete.
   *
   * @see quickSearch(), which returns immediately and populates results later */
  quickSearchAsync(searchTerm: string, results: ArrayColl<Person>) {
    results.addAll(this.quickSearch(searchTerm));
  }

  async save(): Promise<void> {
    await super.save();
    await this.storage?.saveAddressbook(this);
  }

  async deleteIt(): Promise<void> {
    await super.deleteIt();
    await this.storage?.deleteAddressbook(this);
    appGlobal.addressbooks.remove(this);
  }

  /** The access levels that this server can grant to other users.
   * Ordered from least to most permission. Used by @see `addSharedPerson()` */
  get sharePermissionLevels(): AddressbookShareCombinedPermissions[] {
    return [];
  }

  async getSharedPersons(): Promise<ArrayColl<PersonUID>> {
    return new ArrayColl<PersonUID>();
  }

  async deleteSharedPerson(Person: PersonUID) {
  }

  async addSharedPerson(person: PersonUID, access: AddressbookShareCombinedPermissions) {
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.syncState = json.syncState;
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.syncState = this.syncState;
    return json;
  }
}

/**
 * Addressbooks which can only be searched, not enumerated.
 * Usually server addressbooks with over 10000 persons,
 * e.g. enterprise employee list.
 */
export class SearchOnlyAddressbook extends Addressbook {
  listContacts(): never {
    throw new NotReached();
  }

  quickSearch(searchTerm: string): Collection<Person> {
    let results = new ArrayColl<Person>();
    this.quickSearchAsync(searchTerm, results)
      .catch(this.errorCallback);
    return results;
  }

  async quickSearchAsync(searchTerm: string, results: ArrayColl<Person>) {
    throw new AbstractFunction();
  }

  /** The encryption keys, e.g. the S/MIME certificate, that this directory
   * has for a person, who may be in another address book, or in none.
   * Reports errors, does not throw.
   * @param emailAddresses of the person */
  async fetchEncryptionKeys(emailAddresses: Collection<string>): Promise<Collection<PublicKey>> {
    return new ArrayColl<PublicKey>();
  }
}


export interface AddressbookStorage {
  savePerson(person: Person): Promise<void>;
  deletePerson(person: Person): Promise<void>;
  saveGroup(group: Group): Promise<void>;
  deleteGroup(group: Group): Promise<void>;
  saveAddressbook(addressbook: Addressbook): Promise<void>;
  deleteAddressbook(addressbook: Addressbook): Promise<void>;
}

export enum AddressbookShareCombinedPermissions {
  /** Can see all contacts details, but not modify */
  Read = "read",
  /** Can see and modify all details of all contacts, and add and delete contacts */
  Modify = "modify",
}
export const addressbookShareCombinedPermissionsLabels: Record<string, string> = {
  [AddressbookShareCombinedPermissions.Read]: gt`See all contact details`,
  [AddressbookShareCombinedPermissions.Modify]: gt`Modify, add and delete contacts`,
};
