// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { ContactEntry, Person } from "../../../../logic/Abstract/Person";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { searchPersons, SelectNamesField } from "../../../Mail/Composer/SelectNames";
import { beforeEach, expect, test } from "vitest";

let personal: Addressbook;
let work: Addressbook;
let anna: Person;
let bert: Person;
let carla: Person;
let dora: Person;

function newPerson(addressbook: Addressbook, name: string, ...emailAddresses: ContactEntry[]): Person {
  let person = new Person(addressbook);
  person.name = name;
  person.emailAddresses.addAll(emailAddresses);
  addressbook.persons.add(person);
  return person;
}

beforeEach(() => {
  personal = new Addressbook();
  personal.name = "Personal";
  work = new Addressbook();
  work.name = "Work";
  bert = newPerson(personal, "Bert Meier", new ContactEntry("bert@example.com", "work"));
  anna = newPerson(personal, "Anna Schmidt",
    new ContactEntry("anna@home.example", "home", null, 50),
    new ContactEntry("anna@work.example", "work", null, 10));
  carla = newPerson(personal, "Carla Diaz");
  dora = newPerson(work, "Dora Klein", new ContactEntry("dora@corp.example", "work"));
});

test("Lists only persons with an email address, sorted by name", () => {
  let persons = searchPersons([personal], "");
  expect(persons.contents).toEqual([anna, bert]);
});

test("Lists persons of all given address books", () => {
  let persons = searchPersons([personal, work], "");
  expect(persons.contents).toEqual([anna, bert, dora]);
});

test("Search matches name and email address", () => {
  expect(searchPersons([personal, work], "MEIER").contents).toEqual([bert]);
  expect(searchPersons([personal, work], "corp.example").contents).toEqual([dora]);
  expect(searchPersons([personal, work], "  anna ").contents).toEqual([anna]);
  expect(searchPersons([personal, work], "nobody").contents).toEqual([]);
});

test("Adds the preferred email address, without duplicates", () => {
  let field = new SelectNamesField("To");
  field.add([anna, bert, anna, carla]);
  let to = field.picks.contents;
  expect(to.map(recipient => recipient.emailAddress)).toEqual(["anna@work.example", "bert@example.com"]);
  expect(to[0].name).toBe("Anna Schmidt");
  expect(to[0].person).toBe(anna);
});

test("Name only searches only the name", () => {
  dora.position = "Anna's assistant";
  expect(searchPersons([personal, work], "anna").contents).toEqual([anna]);
  expect(searchPersons([personal, work], "work.example", true).contents).toEqual([]);
  expect(searchPersons([personal, work], "schmidt", true).contents).toEqual([anna]);
});

test("A single pick field keeps only the last pick", () => {
  let from = new SelectNamesField("From", [], true);
  from.add([anna]);
  from.add([bert, dora]);
  expect(from.picks.contents.map(pick => pick.emailAddress)).toEqual(["bert@example.com"]);
});

test("A pick field starts with the given picks and adds without duplicates", () => {
  let eve = new PersonUID("eve@example.com", "Eve");
  let users = new SelectNamesField("Add", [eve]);
  users.add([bert, bert]);
  expect(users.picks.contents.map(pick => pick.emailAddress)).toEqual(["eve@example.com", "bert@example.com"]);
});

