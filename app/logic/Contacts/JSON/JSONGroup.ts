import { Group } from "../../Abstract/Group";
import { Person } from "../../Abstract/Person";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { dataError } from "../../util/error";
import { assert } from "../../util/util";
import { appGlobal } from "../../app";

export class JSONGroup {
  static save(group: Group): any {
    assert(group.addressbook?.id, "Need address book ID to save the group");
    let json: any = {};
    json.id = group.id;
    json.name = group.name;
    json.description = group.description;
    json.addressbookID = group.addressbook?.id;
    return json;
  }

  static saveMembers(group: Group, json: any): any {
    json.members = [];
    for (let person of group.participants) {
      assert(person.id, "Need person ID to save the member");
      json.members.push(person.id);
    }
    return json;
  }

  static read(group: Group, json: any): Group {
    group.id = sanitize.string(json.id, null);
    group.name = sanitize.label(json.name);
    group.description = sanitize.label(json.description, "");
    if (json.addressbookID) {
      let addressbookID = sanitize.nonemptystring(json.addressbookID);
      if (group.addressbook) {
        assert(group.addressbook.id == addressbookID, "Wrong addressbook");
      } else {
        group.addressbook = appGlobal.addressbooks.find(ab => ab.id == addressbookID);
      }
    }

    JSONGroup.readMembers(group, json);
    return group;
  }

  /** This function assumes that the `Person`s have already been loaded,
    * because it cannot load the DB. */
  static readMembers(group: Group, json: any) {
    for (let member of json.members) {
      try {
        let personID = sanitize.nonemptystring(member);
        let person = group.addressbook?.persons.find(p => p.id == personID) as Person;
        if (!person) {
          for (let ab of appGlobal.addressbooks) {
            person = ab.persons.find(p => p.id == personID);
            if (person) {
              break;
            }
          }
        }
        group.participants.add(person);
      } catch (ex) {
        dataError(ex);
      }
    }
  }
}