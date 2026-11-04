import { ContactBase } from './Contact';
import type { Addressbook } from '../Contacts/Addressbook';
import { StreetAddress } from '../Contacts/StreetAddress';
import type { PublicKey } from '../Mail/Encryption/PublicKey';
import { publicKeyFromJSON } from '../Mail/Encryption/KeyFromJSON';
import { getPublicKeyForPerson } from '../Mail/Encryption/KeyUtils';
import { SMIMEPublicKey } from '../Mail/Encryption/SMIME/SMIMEPublicKey';
import { appGlobal } from '../app';
import { notifyChangedObservable, notifyChangedProperty, Observable } from '../util/Observable';
import { ArrayColl } from 'svelte-collections';
import { sanitize } from '../../../lib/util/sanitizeDatatypes';
import { gt } from '../../l10n/l10n';

export class Person extends ContactBase {
  id: string;
  @notifyChangedProperty
  firstName: string | null;
  @notifyChangedProperty
  lastName: string | null;
  readonly groups = new ArrayColl<ContactEntry>();
  readonly emailAddresses = new ArrayColl<ContactEntry>();
  readonly chatAccounts = new ArrayColl<ContactEntry>();
  readonly phoneNumbers = new ArrayColl<ContactEntry>();
  /** `StreetAddress` */
  readonly streetAddresses = new ArrayColl<ContactEntry>();
  /** Webpages about the person */
  readonly urls = new ArrayColl<ContactEntry>();
  /** Custom user-defined fields */
  readonly custom = new ArrayColl<ContactEntry>();
  /** PGP public keys and S/MIME certiticates for this contact */
  @notifyChangedObservable
  readonly encryptionPublicKeys = new ArrayColl<PublicKey>();
  @notifyChangedProperty
  notes: string | null = "";

  @notifyChangedProperty
  company: string;
  @notifyChangedProperty
  department: string;
  @notifyChangedProperty
  position: string;

  /** How often this person has been contacted recently.
   * A combination of frequency and recency.
   * Higher is more popular. */
  @notifyChangedProperty
  popularity: number = 0;

  /**
   * Saves the contact to the server and to the database.
    */
  async save() {
    this.removeEmptyContactEntriesFrom([
      this.groups,
      this.emailAddresses,
      this.chatAccounts,
      this.phoneNumbers,
      this.streetAddresses,
      this.urls,
      this.custom,
    ]);
    await super.save();
    try {
      await this.saveToServer();
    } finally {
      // Why locally after server: Exchange assigns item ID etc., so need to store it locally.
      // Even a failed save may have created the contact, and losing its ID
      // would create a second one on the next save.
      await this.saveLocally();
    }
  }

  /**
   * Saves the contact locally to the database.
    */
  async saveLocally() {
    if (!this.addressbook.persons.contains(this)) {
      this.addressbook.persons.add(this);
    }
    await this.addressbook.storage.savePerson(this);
  }

  async saveToServer(): Promise<void> {
    // nothing to do for local persons
  }

  protected removeEmptyContactEntriesFrom(colls: ArrayColl<ContactEntry>[]) {
    for (let coll of colls) {
      coll.removeAll(coll.filterOnce(entry => !entry.value));
    }
  }

  /**
   * Deletes the contact on the server and from our database.
    */
  async deleteIt() {
    await this.deleteLocally();
    await this.deleteFromServer();
  }

  /**
   * Deletes the contact locally from the database.
    */
  async deleteLocally() {
    if (!this.addressbook) {
      return;
    }
    this.addressbook.persons.remove(this);
    if (this.dbID) {
      await this.addressbook.storage.deletePerson(this);
    }
  }

  async deleteFromServer(): Promise<void> {
    // nothing to do for local persons
  }

  /** Fetches the S/MIME certificate that the company directories have for
   * this person, unless we already have one.
   * Reports errors, does not throw. */
  async fetchEncryptionKeys(): Promise<void> {
    if (getPublicKeyForPerson(this, SMIMEPublicKey)) {
      return;
    }
    let emailAddresses = new ArrayColl(this.emailAddresses.contents.map(entry => entry.value));
    let found = await Promise.all(appGlobal.searchOnlyAddressbooks.contents.map(ab =>
      ab.fetchEncryptionKeys(emailAddresses)));
    for (let keys of found) {
      for (let key of keys) {
        this.addEncryptionPublicKey(key);
      }
    }
  }

  /** Adds a PGP key or S/MIME certificate for this contact,
   * unless we already have it. */
  addEncryptionPublicKey(key: PublicKey) {
    if (this.encryptionPublicKeys.some(existing => existing.id == key.id)) {
      return;
    }
    this.encryptionPublicKeys.add(key);
  }

  toString() {
    return this.name;
  }

  notifyObservers(propertyName?: string, oldValue?: any): void {
    if (propertyName == "name" && this.name && typeof (this.name) == "string") {
      this.fixName();
    }
    super.notifyObservers(propertyName, oldValue);
  }

  protected fixName(): void {
    let sp = this.name?.split(" ");
    if (!this.lastName || !this.firstName) {
      // Last word is last name, rest is first name
      if (sp.length > 1) {
        this.lastName = sp.pop();
        this.firstName = sp.join(" ");
      }
    } else {
      let lastNameStart = this.name.indexOf(" " + this.lastName);
      if (lastNameStart >= 0) { // editing first name
        this.lastName = this.name.substring(lastNameStart + 1).trim();
        this.firstName = this.name.substring(0, lastNameStart).trim();
      } else { // editing last name
        if (this.firstName == this.name.substring(0, this.firstName.length)) {
          this.lastName = this.name.substring(this.firstName.length + 1).trim();
        } else {
          this.firstName = "";
          this.lastName = "";
        }
      }
    }
  }

  async merge(other: Person) {
    this.picture = this.picture ?? other.picture;
    this.company = this.company ?? other.company;
    this.department = this.department ?? other.department;
    this.position = this.position ?? other.position;
    this.notes = ((this.notes || "") + (this.notes && other.notes ? "\n\n" : "") + (other.notes || "")) || null;
    this.emailAddresses.addAll(other.emailAddresses.filterOnce(o => !this.emailAddresses.find(t => t.value == o.value)));
    this.chatAccounts.addAll(other.chatAccounts.filterOnce(o => !this.chatAccounts.find(t => t.value == o.value)));
    this.phoneNumbers.addAll(other.phoneNumbers.filterOnce(o => !this.phoneNumbers.find(t => t.value == o.value)));
    this.streetAddresses.addAll(other.streetAddresses.filterOnce(o => !this.streetAddresses.find(t => t.value == o.value)));
    this.urls.addAll(other.urls.filterOnce(o => !this.urls.find(t => t.value == o.value)));
    this.groups.addAll(other.groups.filterOnce(o => !this.groups.find(t => t.value == o.value)));
    this.custom.addAll(other.custom.filterOnce(o => !this.custom.find(t => t.value == o.value)));
    await other.deleteIt();
  }

  /** Person class needs to match account class, so need to clone.
   * @returns reference to the new person created or the existing
   * person if it was already in the new addressbook or the
   * same addressbook type
   */
  async moveToAddressbook(newAddressbook: Addressbook): Promise<Person> {
    if (this.addressbook == newAddressbook || !newAddressbook) {
      return this;
    }
    let newPerson = newAddressbook.newPerson();
    // Server contacts have server IDs of the old account, so they need to be re-created.
    if (Object.getPrototypeOf(this) == Object.getPrototypeOf(newPerson) &&
        newAddressbook.protocol == "addressbook-local") {
      this.addressbook?.persons.remove(this);
      this.addressbook = newAddressbook;
      newAddressbook.persons.add(this);
      await this.save();
      return this;
    }
    newPerson.copyFrom(this);
    newPerson.addressbook = newAddressbook;
    this.addressbook?.persons.remove(this);
    newAddressbook.persons.add(newPerson);
    await this.deleteIt();
    await newPerson.save();
    return newPerson;
  }

  async copyToAddressbook(newAddressbook: Addressbook): Promise<void> {
    let newPerson = newAddressbook.newPerson();
    newPerson.copyFrom(this);
    newPerson.addressbook = newAddressbook;
    newAddressbook.persons.add(newPerson);
    await newPerson.save();
  }

  copyFrom(other: Person): void {
    this.name = other.name;
    this.firstName = other.firstName;
    this.lastName = other.lastName;
    this.picture = other.picture;
    this.company = other.company;
    this.department = other.department;
    this.position = other.position;
    this.notes = other.notes;
    this.emailAddresses.addAll(other.emailAddresses.map(ce => ce.clone()));
    this.chatAccounts.addAll(other.chatAccounts.map(ce => ce.clone()));
    this.phoneNumbers.addAll(other.phoneNumbers.map(ce => ce.clone()));
    this.streetAddresses.addAll(other.streetAddresses.map(ce => ce.clone()));
    this.urls.addAll(other.urls.map(ce => ce.clone()));
    this.groups.addAll(other.groups.map(ce => ce.clone()));
    this.custom.addAll(other.custom.map(ce => ce.clone()));
  }

  toExtraJSON(): any {
    let json = super.toExtraJSON();
    json.company = this.company;
    json.department = this.department;
    json.position = this.position;
    json.encryptionPublicKeys = this.encryptionPublicKeys.contents.map(key => key.toJSON());
    return json;
  }

  fromExtraJSON(json: any) {
    super.fromExtraJSON(json);
    this.company = sanitize.string(json.company, null);
    this.department = sanitize.string(json.department, null);
    this.position = sanitize.string(json.position, null);
    this.encryptionPublicKeys.clear();
    for (let keyJSON of sanitize.array(json.encryptionPublicKeys, [])) {
      try {
        let key = publicKeyFromJSON(sanitize.json(keyJSON, null));
        this.encryptionPublicKeys.add(key);
      } catch (ex) {
        this.addressbook?.errorCallback(ex);
      }
    }
  }

  /** The contact information as human-readable text, e.g. for the clipboard.
   * The notes are left out, because they are private remarks about the person. */
  toPlaintext(): string {
    let sections = [
      [this.name, this.position, this.department, this.company].filter(line => line).join("\n"),
      this.contactEntriesToPlaintext(gt`Mail`, this.emailAddresses),
      this.contactEntriesToPlaintext(gt`Chat`, this.chatAccounts),
      this.contactEntriesToPlaintext(gt`Phone numbers`, this.phoneNumbers),
      this.contactEntriesToPlaintext(gt`Street address`, this.streetAddresses,
        value => new StreetAddress(value).toPlaintext()),
      this.contactEntriesToPlaintext(gt`Website`, this.urls),
      this.contactEntriesToPlaintext(gt`Groups`, this.groups),
    ];
    return sections.filter(section => section).join("\n\n") + "\n";
  }

  protected contactEntriesToPlaintext(headerName: string, entries: ArrayColl<ContactEntry>, valueToPlaintext = (value: string) => value): string {
    if (entries.isEmpty) {
      return "";
    }
    let lines = entries.contents.map(entry => entry.toPlaintext(valueToPlaintext(entry.value)));
    return [headerName, ...lines].join("\n");
  }
}

export class ContactEntry extends Observable {
  @notifyChangedProperty
  value: string; // email address, or phone number etc.
  @notifyChangedProperty
  protocol: string | null; // "email", "tel", "fax", "matrix", "xmpp" etc.
  @notifyChangedProperty
  purpose: string | null; // "work", "home", "mobile", "other", "Teams", "WhatsApp", or any other text
  /** Least preferred, per RFC 6350 5.3 @see <https://www.rfc-editor.org/rfc/rfc6350#section-5.3> */
  static defaultPreference = 100;
  /** Lower is more preferred */
  @notifyChangedProperty
  preference: number = ContactEntry.defaultPreference;
  json: any;

  constructor(value: string, purpose: string | null = null, protocol: string | null = null, preference: number = ContactEntry.defaultPreference) {
    super();
    this.value = value;
    this.purpose = purpose;
    this.protocol = protocol;
    this.preference = preference;
  }

  clone(): ContactEntry {
    return new ContactEntry(this.value, this.purpose, this.protocol, this.preference);
  }

  /** This entry as human-readable text, e.g. "Work: joe@example.com"
   * @param value The value as text, in case it needs conversion, e.g. street addresses */
  toPlaintext(value = this.value): string {
    if (!this.purpose) {
      return value;
    }
    // Multi-line values, e.g. street addresses, start on their own line
    return this.purposeLabel + (value.includes("\n") ? ":\n" : ": ") + value;
  }

  /** The purpose, translated for the user, e.g. "Work" */
  get purposeLabel(): string {
    return ContactEntry.purposeLabels[this.purpose] ??
      ContactEntry.hiddenPurposeLabels[this.purpose] ??
      this.purpose ??
      "";
  }

  /** The purpose values that we want to show to the user for him to select from */
  static readonly purposeLabels = {
    "work": gt`Work *=> Business address or phone number`,
    "home": gt`Home *=> Private address or phone number`,
    "mobile": gt`Mobile *=> Cell phone number`,
    "other": gt`Other *=> Email address or phone number that is not home or work`,
  }

  /** The purpose values that the application might set, but we don't want the user to select these */
  static readonly hiddenPurposeLabels = {
    "primary": gt`Primary *=> Most important email address for that person`,
    "collected": gt`Collected *=> Email address that was automatically added to the contacts`,
    null: gt`Select *=> Select what this email address is for`,
  }
}
