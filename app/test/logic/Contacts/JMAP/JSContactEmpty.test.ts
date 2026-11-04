import { expect, test } from "vitest";
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { JMAPPerson } from "../../../../logic/Contacts/JMAP/JMAPPerson";
import { JSContact } from "../../../../logic/Contacts/JMAP/JSContact";
import type { TJSContact } from "../../../../logic/Contacts/JMAP/TJSContact";

/** As Stalwart returns a vCard with NOTE, TITLE and ORG */
function serverCard(): TJSContact {
  return {
    "@type": "Card",
    version: "1.0",
    uid: "urn:uuid:7f6c1e2a-1111-4c5e-9d0a-000000000001",
    name: { full: "Erika Mustermann" },
    notes: { k1: { note: "Met at conference." } },
    titles: { k1: { name: "Lead Scientist", kind: "title" } },
    organizations: { k1: { name: "Example AG", units: [{ name: "Research" }] } },
  } as TJSContact;
}

/** Entries of these maps, as other clients see them */
function entries(jscontact: TJSContact) {
  return [jscontact.notes, jscontact.titles, jscontact.organizations].map(map => Object.values(map ?? {}));
}

test("A contact without note, job title and company gets no empty ones", () => {
  let person = new JMAPPerson(null);
  person.name = "Minimal";
  let jscontact = {} as TJSContact;
  JSContact.fromPerson(person, jscontact);
  expect(entries(jscontact)).toEqual([[], [], []]);
});

test("Clearing the note, job title and company removes them", () => {
  let jscontact = serverCard();
  let person = new JMAPPerson(null);
  JSContact.toPerson(jscontact, person);
  person.notes = "";
  person.position = "";
  person.company = "";
  person.department = "";
  JSContact.fromPerson(person, jscontact);
  expect(entries(jscontact)).toEqual([[], [], []]);
});

test("Only a department", () => {
  let person = new JMAPPerson(null);
  person.department = "Research";
  let jscontact = {} as TJSContact;
  JSContact.fromPerson(person, jscontact);
  let organizations = Object.values(jscontact.organizations);
  expect(organizations).toHaveLength(1);
  expect(organizations[0].units.map(unit => unit.name)).toEqual(["Research"]);
  expect(organizations[0].name || undefined).toBeUndefined();
});

test("Editing the note keeps title and company as they are", () => {
  let jscontact = serverCard();
  let person = new JMAPPerson(null);
  JSContact.toPerson(jscontact, person);
  person.notes = "Met at another conference.";
  JSContact.fromPerson(person, jscontact);
  expect(jscontact.notes).toEqual({ k1: { note: "Met at another conference." } });
  expect(jscontact.titles).toEqual(serverCard().titles);
  expect(jscontact.organizations).toEqual(serverCard().organizations);
});
