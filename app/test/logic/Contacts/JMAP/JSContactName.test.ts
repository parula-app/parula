import { expect, test } from "vitest";
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { JMAPPerson } from "../../../../logic/Contacts/JMAP/JMAPPerson";
import { JSContact } from "../../../../logic/Contacts/JMAP/JSContact";
import type { TJSContact } from "../../../../logic/Contacts/JMAP/TJSContact";

/** As Stalwart returns `N:Mustermann;Erika;Maria;Dr.;PhD` */
function serverCard(): TJSContact {
  return {
    "@type": "Card",
    version: "1.0",
    uid: "urn:uuid:7f6c1e2a-1111-4c5e-9d0a-000000000001",
    name: {
      full: "Dr. Erika Mustermann",
      components: [
        { kind: "surname", value: "Mustermann" },
        { kind: "given", value: "Erika" },
        { kind: "given2", value: "Maria" },
        { kind: "title", value: "Dr." },
        { kind: "credential", value: "PhD" },
      ],
    },
  } as TJSContact;
}

test("Clearing first and last name removes them on the server", () => {
  let jscontact = { name: { full: "Clear Me", components: [{ kind: "given", value: "Clear" }, { kind: "surname", value: "Me" }] } } as TJSContact;
  let person = new JMAPPerson(null);
  JSContact.toPerson(jscontact, person);
  person.firstName = "";
  person.lastName = "";
  JSContact.fromPerson(person, jscontact);
  expect(jscontact.name.components).toBeUndefined();

  let readBack = new JMAPPerson(null);
  JSContact.toPerson(jscontact, readBack);
  expect([readBack.firstName, readBack.lastName]).toEqual(["", ""]);
});

test("Only a first name gives no empty last name", () => {
  let person = new JMAPPerson(null);
  person.firstName = "Cher";
  let jscontact = {} as TJSContact;
  JSContact.fromPerson(person, jscontact);
  expect(jscontact.name.components.filter(c => c.kind == "surname")).toEqual([]);
  expect(jscontact.name.components.filter(c => c.kind == "given").map(c => c.value)).toEqual(["Cher"]);
});

test("Changing the last name keeps the other name parts", () => {
  let jscontact = serverCard();
  let person = new JMAPPerson(null);
  JSContact.toPerson(jscontact, person);
  person.lastName = "Musterfrau";
  JSContact.fromPerson(person, jscontact);
  // The name is not ordered (`isOrdered`), so the components may come in any order
  expect(jscontact.name.components).toHaveLength(5);
  expect(jscontact.name.components).toEqual(expect.arrayContaining([
    { kind: "surname", value: "Musterfrau" },
    { kind: "given", value: "Erika" },
    { kind: "given2", value: "Maria" },
    { kind: "title", value: "Dr." },
    { kind: "credential", value: "PhD" },
  ]));
});
