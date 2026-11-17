// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { appGlobal } from "../../../logic/app";
import { Addressbook } from "../../../logic/Contacts/Addressbook";
import { DummyAddressbookStorage } from "../../../logic/Contacts/SQL/DummyAddressbookStorage";
import { ContactEntry, Person } from "../../../logic/Abstract/Person";
import { findPerson } from "../../../logic/Abstract/PersonUID";
import { beforeEach, expect, test } from "vitest";
import v8 from "node:v8";
import vm from "node:vm";

let addressbook: Addressbook;

beforeEach(() => {
  addressbook = new Addressbook();
  addressbook.storage = new DummyAddressbookStorage();
  appGlobal.addressbooks.replaceAll([addressbook]);
});

function addPerson(name: string, emailAddress: string): Person {
  let person = addressbook.newPerson();
  person.name = name;
  person.emailAddresses.add(new ContactEntry(emailAddress, "work"));
  addressbook.persons.add(person);
  return person;
}

test("Finds the person, ignoring case", () => {
  let fred = addPerson("Fred", "Fred@example.com");
  addPerson("Wilma", "wilma@example.com");
  expect(findPerson("fred@EXAMPLE.com")).toBe(fred);
  expect(findPerson("barney@example.com")).toBeUndefined();
});

test("Finds persons added and drops persons removed after a search", () => {
  let fred = addPerson("Fred", "fred@example.com");
  expect(findPerson("barney@example.com")).toBeUndefined();
  let barney = addPerson("Barney", "barney@example.com");
  expect(findPerson("barney@example.com")).toBe(barney);
  addressbook.persons.remove(fred);
  expect(findPerson("fred@example.com")).toBeUndefined();
});

test("Follows email addresses added, changed and removed", () => {
  let fred = addPerson("Fred", "fred@example.com");
  expect(findPerson("fred@example.com")).toBe(fred);
  let entry = new ContactEntry("", "home"); // like the UI: add an empty field, then type
  fred.emailAddresses.add(entry);
  entry.value = "Fred@Bedrock.example";
  expect(findPerson("fred@bedrock.example")).toBe(fred);
  fred.emailAddresses.first.value = "fred@quarry.example";
  expect(findPerson("fred@quarry.example")).toBe(fred);
  expect(findPerson("fred@example.com")).toBeUndefined();
  fred.emailAddresses.remove(entry);
  expect(findPerson("fred@bedrock.example")).toBeUndefined();
  expect(findPerson("fred@quarry.example")).toBe(fred);
});

test("Finds the other person with the same email address", () => {
  let fred = addPerson("Fred", "info@bedrock.example");
  let wilma = addPerson("Wilma", "info@bedrock.example");
  expect(findPerson("info@bedrock.example")).toBe(fred);
  addressbook.persons.remove(fred);
  expect(findPerson("info@bedrock.example")).toBe(wilma);
});

test("Follows changes after a garbage collection", async () => {
  v8.setFlagsFromString("--expose-gc");
  let gc = vm.runInNewContext("gc");
  let fred = addPerson("Fred", "fred@example.com");
  await new Promise(resolve => setTimeout(resolve)); // WeakRefs are cleared only after the current task
  gc();
  let barney = addPerson("Barney", "barney@example.com");
  expect(findPerson("barney@example.com")).toBe(barney);
  fred.emailAddresses.add(new ContactEntry("fred@bedrock.example", "home"));
  expect(findPerson("fred@bedrock.example")).toBe(fred);
});
