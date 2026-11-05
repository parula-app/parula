import { Group } from '../../Abstract/Group';
import type { JMAPAddressbook } from './JMAPAddressbook';
import type { JMAPPerson } from './JMAPPerson';
import type { TJMAPContact } from './TJSContact';
import type { TID, TJMAPChangeResponse } from '../../Mail/JMAP/TJMAPGeneric';
import { checkChangeError } from '../../Mail/JMAP/JMAPError';
import { appGlobal } from "../../app";
import { sanitize } from '../../../../lib/util/sanitizeDatatypes';

/** A contact card of kind "group".
 * <https://www.rfc-editor.org/rfc/rfc9610.html#section-3> */
export class JMAPGroup extends Group {
  declare addressbook: JMAPAddressbook | null;
  original: TJMAPContact;
  jmapID: TID;
  uid: string;

  get account() {
    return this.addressbook.account;
  }

  fromJMAP(jmap: TJMAPContact) {
    this.jmapID = sanitize.alphanumdash(jmap.id);
    this.uid = sanitize.nonemptystring(jmap.uid, null);
    this.name = sanitize.nonemptylabel(jmap.name?.full, null) ??
      sanitize.nonemptylabel((jmap.name?.components ?? []).map(component => sanitize.label(component.value, "")).filter(value => value).join(" "), "");
    this.description = sanitize.label(Object.values(jmap.notes ?? {})[0]?.note, "");
    this.original = jmap;
  }

  /** Members are persons, by UID, from any JMAP address book.
   * A person that is in several address books is still one member. */
  findMembers() {
    let memberUIDs = Object.keys(this.original?.members ?? {});
    let members = new Map<string, JMAPPerson>();
    for (let person of this.allJMAPPersons()) {
      if (memberUIDs.includes(person.uid) && !members.has(person.uid)) {
        members.set(person.uid, person);
      }
    }
    this.participants.replaceAll([...members.values()]);
  }

  protected allJMAPPersons(): JMAPPerson[] {
    return appGlobal.addressbooks.contents
      .filter(addressbook => addressbook.protocol == this.addressbook.protocol)
      .flatMap(addressbook => addressbook.persons.contents) as JMAPPerson[];
  }

  async saveToServer() {
    let knownUIDs = new Set(this.allJMAPPersons().map(person => person.uid));
    let members: Record<string, true> = {};
    for (let uid of Object.keys(this.original?.members ?? {})) {
      if (!knownUIDs.has(uid)) {
        members[uid] = true; // Keep the members that we can't see, e.g. in an address book that is no longer shared with us
      }
    }
    for (let person of this.participants) {
      let uid = (person as JMAPPerson).uid;
      if (uid) {
        members[uid] = true;
      }
    }
    let name = { ...this.original?.name, full: this.name };
    let isNew = !this.original;
    let card: Partial<TJMAPContact> = {
      "@type": "Card",
      version: "1.0",
      uid: this.uid ??= "urn:uuid:" + crypto.randomUUID(),
      kind: "group",
      name,
      members,
      addressBookIds: { [this.addressbook.jmapID]: true },
    };
    let response = await this.account.makeSingleCall("ContactCard/set", {
      accountId: this.account.accountID,
      ...(isNew
        ? { create: { [this.id]: card } }
        : { update: { [this.jmapID]: { name, members } } }),
    }) as TJMAPChangeResponse<TJMAPContact>;
    checkChangeError(response);
    if (isNew) {
      this.original = card as TJMAPContact;
      this.jmapID = this.original.id = sanitize.alphanumdash(response.created[this.id].id);
    } else {
      this.original.name = name;
      this.original.members = members;
    }
  }

  async deleteFromServer() {
    if (!this.jmapID) { // never saved to the server
      return;
    }
    let response = await this.account.makeSingleCall("ContactCard/set", {
      accountId: this.account.accountID,
      destroy: [this.jmapID],
    }) as TJMAPChangeResponse<TJMAPContact>;
    checkChangeError(response);
  }

  fromExtraJSON(json: any) {
    super.fromExtraJSON(json);
    this.original = sanitize.json(json.original, null); // as object, not string. null = never saved to the server
    this.jmapID = sanitize.alphanumdash(json.jmapID, null);
    this.uid = sanitize.nonemptystring(json.uid, null);
  }
  toExtraJSON(): any {
    let json = super.toExtraJSON();
    json.original = this.original;
    json.jmapID = this.jmapID;
    json.uid = this.uid;
    return json;
  }
}
