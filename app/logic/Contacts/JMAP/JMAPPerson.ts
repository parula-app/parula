import { Person } from '../../Abstract/Person';
import { JSContact } from './JSContact';
import type { TJMAPContact } from './TJSContact';
import type { TID, TJMAPChangeResponse } from '../../Mail/JMAP/TJMAPGeneric';
import type { JMAPAddressbook } from './JMAPAddressbook';
import { checkChangeError } from '../../Mail/JMAP/JMAPError';
import { sanitize } from '../../../../lib/util/sanitizeDatatypes';
import type { Addressbook } from '../Addressbook';
import { assert } from '../../util/util';

export class JMAPPerson extends Person {
  declare addressbook: JMAPAddressbook | null;
  original: TJMAPContact;
  uid: string;
  jmapID: TID;
  /** For a given Person property, where JSContact supports multiple values indexed by ID,
   * but we support only one value, remember the ID we took, so that we write the same one back.
   * Person property name, e.g. `notes` -> JSContact ID in the map, e.g. `abc` in `jscontact.notes.abc.name` */
  propertyFieldIDs: Record<string, string> = {};

  get account() {
    return this.addressbook.account;
  }

  fromJMAP(jmap: TJMAPContact) {
    JSContact.toPerson(jmap, this);
    this.jmapID = sanitize.alphanumdash(jmap.id);
    this.original = jmap;
  }

  /** Within the same account, only changes the address book on the server,
   * so that everything that we don't show stays, e.g. the birthday. */
  async moveToAddressbook(newAddressbook: Addressbook): Promise<Person> {
    let isSameAccount = newAddressbook?.protocol == this.addressbook?.protocol &&
      newAddressbook.mainAccount == this.addressbook.mainAccount;
    if (!isSameAccount || newAddressbook == this.addressbook || !this.jmapID) {
      return await super.moveToAddressbook(newAddressbook);
    }
    let oldID = this.addressbook.jmapID;
    let newID = (newAddressbook as JMAPAddressbook).jmapID;
    let response = await this.account.makeSingleCall("ContactCard/set", {
      accountId: this.account.accountID,
      update: {
        [this.jmapID]: {
          [`addressBookIds/${oldID}`]: null,
          [`addressBookIds/${newID}`]: true,
        },
      },
    }) as TJMAPChangeResponse<TJMAPContact>;
    checkChangeError(response);
    if (this.original?.addressBookIds) {
      delete this.original.addressBookIds[oldID];
      this.original.addressBookIds[newID] = true;
    }
    this.addressbook.persons.remove(this);
    this.addressbook = newAddressbook as JMAPAddressbook;
    newAddressbook.persons.add(this);
    await this.saveLocally();
    return this;
  }

  async saveToServer() {
    let isNew = !this.original;
    let jscontact = this.original ?? {} as TJMAPContact;
    JSContact.fromPerson(this, jscontact); // overwrites `jscontact`, so must be first
    jscontact.addressBookIds ??= {};
    jscontact.addressBookIds[this.addressbook.jmapID] = true;
    if (!isNew) {
      delete jscontact.id; // immutable
      delete jscontact.uid; // ditto, and sending `null` deletes it on the server
    }
    assert(this.id, "ContactBase ctor should set this");

    let results = await this.account.makeSingleCall("ContactCard/set", {
      accountId: this.account.accountID,
      [isNew ? "create" : "update"]: {
        [isNew ? this.id : this.jmapID]: jscontact,
      },
    }) as TJMAPChangeResponse<TJMAPContact>;
    checkChangeError(results);

    this.original = jscontact;
    if (isNew) {
      this.jmapID = this.original.id = sanitize.alphanumdash(results.created[this.id].id);
      await this.saveLocally();
    }
  }

  async deleteFromServer() {
    if (!this.jmapID) { // never saved to the server
      return;
    }
    await this.account.makeSingleCall("ContactCard/set", {
      accountId: this.account.accountID,
      destroy: [this.jmapID],
    });
  }

  fromExtraJSON(json: any) {
    super.fromExtraJSON(json);
    this.uid = sanitize.nonemptystring(json.uid, null);
    this.original = sanitize.json(json.original, null); // as object, not string. null = never saved to the server
    this.jmapID = sanitize.alphanumdash(json.jmapID, null);
    this.propertyFieldIDs = {};
    for (let propName in sanitize.object(json.propertyFieldIDs, {})) {
      sanitize.alphanumdash(propName);
      this.propertyFieldIDs[propName] = sanitize.string(json.propertyFieldIDs[propName], null);
    }
  }
  toExtraJSON(): any {
    let json = super.toExtraJSON();
    json.uid = this.uid;
    json.original = this.original;
    json.jmapID = this.jmapID;
    json.propertyFieldIDs = this.propertyFieldIDs;
    return json;
  }
}
