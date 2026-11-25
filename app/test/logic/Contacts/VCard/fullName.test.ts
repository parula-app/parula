import { expect, test } from "vitest";
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { Person } from "../../../../logic/Abstract/Person";
import * as vCard from "../../../../logic/Contacts/VCard/VCard";

function read(lines: string): Person {
  let person = new Person();
  vCard.convertVCardToPerson("BEGIN:VCARD\r\nVERSION:3.0\r\n" + lines + "END:VCARD\r\n", person);
  return person;
}

test("A contact whose vCard has only the name parts, no full name, gets its name from them", () => {
  // e.g. vCard 2.1, where FN is optional
  let person = read("N:Mustermann;Erika;;;\r\n");
  expect(person.name).toContain("Erika");
  expect(person.name).toContain("Mustermann");
  expect(person.firstName).toBe("Erika");
  expect(person.lastName).toBe("Mustermann");
});

test("Only a last name", () => {
  expect(read("N:Mustermann;;;;\r\n").name).toBe("Mustermann");
});

test("The full name is used as it is, when there is one", () => {
  expect(read("FN:Dr. Erika Mustermann\r\nN:Mustermann;Erika;;Dr.;\r\n").name).toBe("Dr. Erika Mustermann");
});
