import { ContactEntry, Person } from "../../Abstract/Person";
import { StreetAddress } from "../StreetAddress";
import type { Addressbook } from "../Addressbook";
import { getDatabase } from "./SQLDatabase";
import { appGlobal } from "../../app";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert, randomID } from "../../util/util";
import { ArrayColl, Collection } from "svelte-collections";
import sql from "../../../../lib/rs-sqlite";

export class SQLPerson {
  static async save(person: Person) {
    assert(person.addressbook?.dbID, "Need address book ID to save the person");
    let jsonStr = JSON.stringify(person.toExtraJSON(), null, 2);
    let lock = await person.storageLock.lock();
    try {
      if (!person.dbID) {
        let insert = await (await getDatabase()).run(sql`
          INSERT INTO person (
            name, firstName, lastName,
            picture, notes, popularity,
            pID, addressbookID, json
          ) VALUES (
            ${person.name}, ${person.firstName}, ${person.lastName},
            ${person.picture}, ${person.notes}, ${person.popularity},
            ${person.id}, ${person.addressbook?.dbID}, ${jsonStr}
          )`);
        person.dbID = insert.lastInsertRowid;
      } else {
        await (await getDatabase()).run(sql`
          UPDATE person SET
            name = ${person.name},
            firstName = ${person.firstName},
            lastName = ${person.lastName},
            picture = ${person.picture},
            notes = ${person.notes},
            popularity = ${person.popularity},
            pID = ${person.id},
            addressbookID = ${person.addressbook?.dbID},
            json = ${jsonStr}
          WHERE id = ${person.dbID}
          `);
      }
      await SQLPerson.saveContacts(person, person.emailAddresses, ContactType.EMailAddress);
      await SQLPerson.saveContacts(person, person.chatAccounts, ContactType.Chat);
      await SQLPerson.saveContacts(person, person.phoneNumbers, ContactType.Phone);
      await SQLPerson.saveContacts(person, person.streetAddresses, ContactType.StreetAddress);
      await SQLPerson.saveContacts(person, person.urls, ContactType.URL);
      await SQLPerson.saveContacts(person, person.custom, ContactType.Custom);
    } finally {
      lock.release();
    }
  }

  protected static async saveContacts(person: Person, contacts: Collection<ContactEntry>, contactType: ContactType) {
    // TODO Use a more elegant way to remove deleted entries
    await (await getDatabase()).run(sql`
      DELETE FROM personContact
      WHERE personID = ${person.dbID}
      AND type = ${contactType}
      `);

    for (let contact of contacts) {
      await SQLPerson.saveContact(person, contact, contactType);
    }
  }

  protected static async saveContact(person: Person, contact: ContactEntry, contactType: ContactType) {
    assert(person.dbID, "Need person ID to save the person");
    if (!contact.value) {
      return;
    }
    let json = contact.toJSON();
    await (await getDatabase()).run(sql`
      INSERT INTO personContact (
        personID, type, value,
        protocol, purpose, preference, json
      ) VALUES (
        ${person.dbID}, ${contactType}, ${contact.value},
        ${contact.protocol}, ${contact.purpose}, ${contact.preference},
        ${json ? JSON.stringify(json, null, 2) : null}
      )`);
  }

  static async deleteIt(person: Person) {
    assert(person.dbID, "Need Person DB ID to delete");
    let lock = await person.storageLock.lock();
    try {
      let dbID = person.dbID;
      person.dbID = null;
      await (await getDatabase()).run(sql`
        DELETE FROM person
        WHERE id = ${dbID}
        `);
    } finally {
      lock.release();
    }
  }

  static async read(dbID: number, person: Person, row?: any): Promise<Person> {
    if (!row) {
      row = await (await getDatabase()).get(sql`
        SELECT
          name, firstName, lastName,
          picture, notes, popularity, addressbookID, pID, json
        FROM person
        WHERE id = ${dbID}
        `) as any;
    }
    person.dbID = sanitize.integer(dbID);
    person.name = sanitize.label(row.name);
    person.firstName = sanitize.label(row.firstName, null);
    person.lastName = sanitize.string(row.lastName, null);
    person.picture = sanitize.url(row.picture, null, ["https", "http", "data"]);
    person.notes = sanitize.string(row.notes, null);
    person.popularity = sanitize.integer(row.popularity, null);
    person.id = sanitize.string(row.pID, randomID());
    person.fromExtraJSON(sanitize.json(row.json, {}));
    if (row.addressbookID) {
      let addressbookID = sanitize.integer(row.addressbookID);
      if (person.addressbook) {
        assert(person.addressbook.dbID == addressbookID, "Wrong addressbook");
      } else {
        person.addressbook = appGlobal.addressbooks.find(ab => ab.dbID == addressbookID);
      }
    }
    await SQLPerson.readContacts(person);
    return person;
  }

  protected static async readContacts(person: Person) {
    assert(person.dbID, "Need person ID to read the person");
    let rows = await (await getDatabase()).all(sql`
      SELECT
        type, value,
        protocol, purpose, preference, json
      FROM personContact
      WHERE personID = ${person.dbID}
      `) as any;
    for (let row of rows) {
      try {
        let purpose = sanitize.label(row.purpose, null);
        let contactEntry = new ContactEntry(sanitize.string(row.value), purpose);
        contactEntry.preference = sanitize.integer(row.preference, ContactEntry.defaultPreference);
        contactEntry.protocol = sanitize.string(row.protocol, null);
        contactEntry.fromJSON(sanitize.json(row.json, null));
        let type = row.type;
        if (type == ContactType.EMailAddress) {
          person.emailAddresses.add(contactEntry);
        } else if (type == ContactType.Chat) {
          person.chatAccounts.add(contactEntry);
        } else if (type == ContactType.Phone) {
          person.phoneNumbers.add(contactEntry);
        } else if (type == ContactType.StreetAddress) {
          new StreetAddress(contactEntry.value); // throws when malformatted
          person.streetAddresses.add(contactEntry);
        } else if (type == ContactType.URL) {
          person.urls.add(contactEntry);
        } else if (type == ContactType.Custom) {
          person.custom.add(contactEntry);
        } else {
          console.log("Unknown contact detail type", type, row);
          return; // Forward compatibility. Do not throw.
        }
      } catch (ex) {
        person.addressbook.errorCallback(ex);
      }
    }
  }

  static async readAll(addressbook: Addressbook): Promise<void> {
    let rows = await (await getDatabase()).all(sql`
      SELECT
        id, name, firstName, lastName,
        picture, notes, popularity, pID, json
      FROM person
      WHERE addressbookID = ${addressbook.dbID}
      `) as any;
    let newPersons = new ArrayColl<Person>();
    for (let row of rows) {
      try {
        let personID = sanitize.integer(row.id);
        let person = addressbook.persons.find(person => person.dbID == personID);
        if (!person) {
          person = addressbook.newPerson();
          newPersons.add(person);
        }
        person.addressbook = addressbook;
        await SQLPerson.read(row.id, person, row);
      } catch (ex) {
        addressbook.errorCallback(ex);
      }
    }
    addressbook.persons.addAll(newPersons);
  }
}

enum ContactType {
  EMailAddress = 1,
  Chat = 2,
  Phone = 3,
  StreetAddress = 4,
  URL = 5,
  Custom = 6,
}
