import { expect, test } from "vitest";
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { Person, ContactEntry } from "../../../../logic/Abstract/Person";
import * as vCard from "../../../../logic/Contacts/VCard/VCard";

function tels(vcf: string): string[] {
  return vcf.replace(/\r\n /g, "").split("\r\n").filter(line => /^TEL[;:]/i.test(line));
}

/** The TYPE values of a TEL line, in lower case, in any order and spelling */
function types(line: string): string[] {
  let params = line.slice(0, line.indexOf(":"));
  return [...params.matchAll(/;TYPE=("?)([^;:"]*)\1/gi)].flatMap(match => match[2].toLowerCase().split(",")).sort();
}

test("Mobile and fax numbers entered in our app are cell and fax numbers for other clients", () => {
  // RFC 6350 6.4.1 TEL TYPE: cell, fax
  let person = new Person();
  person.name = "Erika";
  person.phoneNumbers.add(new ContactEntry("+49 170 1234567", "mobile", "tel"));
  person.phoneNumbers.add(new ContactEntry("+49 30 7654321", "work", "fax"));
  person.phoneNumbers.add(new ContactEntry("+49 30 1234567", "work", "tel"));
  let lines = tels(vCard.personToVCard(person));
  expect(types(lines.find(line => line.includes("170")))).toContain("cell");
  expect(types(lines.find(line => line.includes("7654321")))).toEqual(expect.arrayContaining(["fax", "work"]));
  expect(types(lines.find(line => line.includes("1234567") && !line.includes("170")))).not.toContain("fax");

  let reread = new Person();
  vCard.convertVCardToPerson(vCard.personToVCard(person), reread);
  expect(reread.phoneNumbers.contents.map(entry => [entry.value, entry.purpose, entry.protocol]).sort()).toEqual([
    ["+49 170 1234567", "mobile", "tel"],
    ["+49 30 1234567", "work", "tel"],
    ["+49 30 7654321", "work", "fax"],
  ]);
});

test("Cell and fax numbers of other clients are mobile and fax numbers, URIs without tel:", () => {
  let person = new Person();
  vCard.convertVCardToPerson("BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Erika\r\n" +
    "TEL;TYPE=cell,voice:+49 170 1234567\r\n" +
    "TEL;TYPE=home,fax:+49 30 7654321\r\n" +
    "TEL;VALUE=URI;TYPE=work:tel:+49-30-1234567\r\n" +
    "END:VCARD\r\n", person);
  expect(person.phoneNumbers.contents.map(entry => [entry.value, entry.purpose, entry.protocol]).sort()).toEqual([
    ["+49 170 1234567", "mobile", "tel"],
    ["+49 30 7654321", "home", "fax"],
    ["+49-30-1234567", "work", "tel"],
  ]);
});
