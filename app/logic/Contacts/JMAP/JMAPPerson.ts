import { Person } from '../../Abstract/Person';
import { JSContact } from './JSContact';
import type { TJMAPContact } from './TJSContact';
import type { TID, TJMAPChangeResponse, TJMAPGetResponse } from '../../Mail/JMAP/TJMAPGeneric';
import type { JMAPAddressbook } from './JMAPAddressbook';
import { checkChangeError } from '../../Mail/JMAP/JMAPError';
import { sanitize } from '../../../../lib/util/sanitizeDatatypes';
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

  /** Destroying a card removes it from all address books, so destroy it only if it is in no other address book. */
  async deleteFromServer() {
    if (!this.jmapID) { // never saved to the server
      return;
    }
    let getResponse = await this.account.makeSingleCall("ContactCard/get", {
      accountId: this.account.accountID,
      ids: [this.jmapID],
      properties: ["addressBookIds"],
    }) as TJMAPGetResponse<TJMAPContact>;
    let json = getResponse.list[0];
    if (!json) {
      return;
    }
    let addressbookID = this.addressbook.jmapID;
    let isInOtherAddressbooks = Object.keys(json.addressBookIds ?? {}).some(id => id != addressbookID);
    let change = isInOtherAddressbooks
      ? { update: { [this.jmapID]: { [`addressBookIds/${addressbookID}`]: null } } }
      : { destroy: [this.jmapID] };
    let setResponse = await this.account.makeSingleCall("ContactCard/set", {
      accountId: this.account.accountID,
      ...change,
    }) as TJMAPChangeResponse<TJMAPContact>;
    checkChangeError(setResponse);
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
