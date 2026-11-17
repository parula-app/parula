import { Group } from "../../Abstract/Group";
import { Person } from "../../Abstract/Person";
import type { Addressbook } from "../Addressbook";
import { SQLPerson } from "./SQLPerson";
import { getDatabase } from "./SQLDatabase";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { dataError } from "../../util/error";
import { assert } from "../../util/util";
import { ArrayColl } from "svelte-collections";
import sql from "../../../../lib/rs-sqlite";
import { appGlobal } from "../../app";

export class SQLGroup extends Group {
  static async save(group: Group) {
    assert(group.addressbook?.dbID, "Need address book ID to save the group");
    let jsonStr = JSON.stringify(group.toExtraJSON(), null, 2);
    let lock = await group.storageLock.lock();
    try {
      if (!group.dbID) {
        let insert = await (await getDatabase()).run(sql`
          INSERT INTO "group" (
            name, description, pID, addressbookID, json
          ) VALUES (
            ${group.name}, ${group.description},
            ${group.id}, ${group.addressbook?.dbID}, ${jsonStr}
          )`);
        group.dbID = insert.lastInsertRowid;
      } else {
        await (await getDatabase()).run(sql`
          UPDATE "group" SET
            name = ${group.name}, description = ${group.description},
            pID = ${group.id}, addressbookID = ${group.addressbook?.dbID},
            json = ${jsonStr}
          WHERE id = ${group.dbID}
          `);
      }

      await this.saveMembers(group);

    } finally {
      lock.release();
    }
  }

  protected static async saveMembers(group: Group) {
    await (await getDatabase()).run(sql`
      DELETE FROM groupMember
      WHERE groupID = ${group.dbID}
      `);

    for (let person of group.participants) {
      await this.saveMember(group, person);
    }
  }

  protected static async saveMember(group: Group, person: Person) {
    if (!person.dbID) {
      await SQLPerson.save(person);
    }
    await (await getDatabase()).run(sql`
      INSERT INTO groupMember (
        groupID, personID
      ) VALUES (
        ${group.dbID}, ${person.dbID}
      )`);
  }

  /** Will also delete all group memberships, but not the persons itself */
  static async deleteIt(group: Group) {
    assert(group.dbID, "Need Group DB ID to delete");
    let lock = await group.storageLock.lock();
    try {
      let dbID = group.dbID;
      group.dbID = null;
      await (await getDatabase()).run(sql`
        DELETE FROM "group"
        WHERE id = ${dbID}
        `);
    } finally {
      lock.release();
    }
  }

  static async read(dbID: number, group: Group, row?: any): Promise<Group> {
    if (!row) {
      row = await (await getDatabase()).get(sql`
        SELECT
          name, description, pID, addressbookID, json
        FROM "group"
        WHERE id = ${dbID}
        `) as any;
    }
    group.dbID = sanitize.integer(dbID);
    group.name = sanitize.label(row.name);
    group.description = sanitize.label(row.description, "");
    group.id = sanitize.string(row.pID, null);
    group.fromExtraJSON(sanitize.json(row.json, {}));
    if (row.addressbookID) {
      let addressbookID = sanitize.integer(row.addressbookID);
      if (group.addressbook) {
        assert(group.addressbook.dbID == addressbookID, "Wrong addressbook");
      } else {
        group.addressbook = appGlobal.addressbooks.find(ab => ab.dbID == addressbookID);
      }
    }

    await SQLGroup.readMembers(group);
    return group;
  }

  protected static async readMembers(group: Group) {
    let rows = await (await getDatabase()).all(sql`
      SELECT
        personID
      FROM groupMember
      WHERE groupID = ${group.dbID}
      `) as any;
      // We could read the person details as well here, but
      // a) we already read persons, and b) there are not that many groups and members, so not worth it
    for (let row of rows) {
      try {
        let personID = sanitize.integer(row.personID);
        let person = findPersonByDBID(personID, group.addressbook);
        if (!person) {
          // Members can be in other addressbooks, which may not be read yet
          await Promise.all(appGlobal.addressbooks.contents.map(ab => ab.readPersonsFromDB()));
          person = findPersonByDBID(personID, group.addressbook);
        }
        if (!person) {
          person = new Person(); // `SQLPerson.read()` sets the addressbook of the person
          await SQLPerson.read(personID, person);
        }
        group.participants.add(person);
      } catch (ex) {
        dataError(ex);
      }
    }
  }

  /**
   * Also first reads the persons from DB.
   * @returns all groups with their members
   */
  static async readAll(addressbook: Addressbook): Promise<void> {
    assert(addressbook.dbID, "Need addressbook ID to read groups and persons from SQL database");

    // First read persons, so that we have the Person objects available as group members
    await addressbook.readPersonsFromDB();

    let rows = await (await getDatabase()).all(sql`
      SELECT
        id, name, description, pID, json
      FROM "group"
      WHERE addressbookID = ${addressbook.dbID}
      `) as any;
    let newGroups = new ArrayColl<Group>();
    for (let row of rows) {
      let group = addressbook.groups.find(group => group.dbID == row.id);
      if (!group) {
        group = addressbook.newGroup();
        newGroups.add(group);
      }
      await SQLGroup.read(row.id, group, row);
    }
    addressbook.groups.addAll(newGroups);
  }
}

/** @param ownAddressbook Searched first. It might not be in `appGlobal.addressbooks` (yet). */
function findPersonByDBID(dbID: number, ownAddressbook: Addressbook | null): Person | undefined {
  let person = ownAddressbook?.persons.find(person => person.dbID == dbID);
  if (person) {
    return person;
  }
  for (let addressbook of appGlobal.addressbooks) {
    person = addressbook.persons.find(person => person.dbID == dbID);
    if (person) {
      return person;
    }
  }
  return undefined;
}
