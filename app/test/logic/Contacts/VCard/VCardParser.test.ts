import { expect, test } from "vitest";
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { Person } from "../../../../logic/Abstract/Person";
import { JSONPerson } from "../../../../logic/Contacts/JSON/JSONPerson";
import * as vCard from "../../../../logic/Contacts/VCard/VCard";
import * as fs from "node:fs/promises";

const replacement = `BEGIN:VCARD
VERSION:4.0
PRODID:-//Beonex//appName//EN
UID:1c2e3f4a-5b6c-7d8e-9f01-234567890abc
FN:Joe Bloggs
PHOTO;VALUE=uri:data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABA
 AEAAAICTAEAOw==
N:Bloggs;Joe;;;
EMAIL;TYPE=WORK,PREF;PREF=1:joe@example.org
EMAIL;TYPE=WORK:bloggs@example.org
EMAIL;TYPE=HOME:joe.bloggs@example.com
TEL;VALUE=text;TYPE=WORK,PREF;PREF=1:0123456789
TEL;VALUE=text;TYPE=HOME:0987654321
IMPP;TYPE=HOME,PREF;PREF=1:aim:joebloggs
URL;TYPE=WORK,PREF;PREF=1:https://example.org/joe.bloggs/
URL;TYPE=HOME:https://example.com/joe.bloggs/
ADR;TYPE=WORK:PO Box;Suite;Street;City;Region;Postal Code;Country
NOTE:Do Re Mi Fa So La Ti Do
ORG:Example;Management
TITLE:Manager
X-CUSTOM1:Custom
END:VCARD
`.replace(/\n/g, "\r\n");

function toJSON(person: Person) {
  person.id = undefined;
  person.addressbook = { id: true };
  return JSONPerson.saveContacts(person, JSONPerson.save(person));
}

const dataDir = new URL("./TestData/", import.meta.url);
const allFiles = await fs.readdir(dataDir);
const testFiles = allFiles.filter(name => name.endsWith(".vcf")).map(name => name.slice(0, -4));
test.each(testFiles)("Parse %s", async name => {
  // Read the test cases from disk
  const vcf = await fs.readFile(new URL(name + ".vcf", dataDir), { encoding: 'utf-8' });
  const card = vCard.parseContact(vcf);
  const json = JSON.parse(await fs.readFile(new URL(name + ".json", dataDir), { encoding: 'utf-8' }));
  json.addressbookID = true;
  json.popularity = 0;
  const person = new Person();
  vCard.updatePerson(card, person);
  expect(toJSON(person)).toEqual(json);

  // Replace the test data with new data and serialise the result
  vCard.updatePerson(vCard.parseContact(replacement), person);
  const serialised = vCard.getUpdatedVCard(person, card);

  // Check that the serialisation contains the new data
  for (let line of replacement.match(/^\w.+/gm)) {
    if (line.startsWith("UID:")) {
      continue; // The contact keeps the UID that it has on the server, checked below
    }
    expect(serialised).toContain(line);
  }

  // Check that the serialisation still includes old data
  for (let line of vcf.match(/^\w.+/gm)) {
    // Ignore lines that we know we will have rewritten
    if (!/\b(version|prodid|fn|photo|n|email|tel|impp|url|adr|note|org|title|role|x-custom\d+)[:;]/i.test(line)) {
      expect(serialised).toContain(line);
    }
  }

  // Check that parsing the new serialisation returns the same result
  const updated = new Person();
  vCard.updatePerson(vCard.parseContact(serialised), updated);
  expect(toJSON(updated)).toEqual(toJSON(person));
});

test("Write new VCard", async () => {
  const person = new Person();
  vCard.convertVCardToPerson(replacement, person);
  const serialised = vCard.personToVCard(person);
  expect(serialised).toBe(replacement);
});
