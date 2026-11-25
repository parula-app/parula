import { expect, test } from "vitest";
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { Person } from "../../../../logic/Abstract/Person";
import * as vCard from "../../../../logic/Contacts/VCard/VCard";

/** Entries with details that our app doesn't show: phone types, grouped labels, URIs, address labels */
const serverVCard = `BEGIN:VCARD
VERSION:4.0
UID:urn:uuid:7f6c1e2a-1111-4c5e-9d0a-000000000002
FN:Erika Mustermann
N:Mustermann;Erika;;;
TEL;TYPE=work,voice;VALUE=uri:tel:+49-30-1234567
TEL;TYPE=cell,voice;PREF=1:+49 170 1234567
item1.TEL;TYPE=fax:+49 30 7654321
item1.X-ABLabel:Office fax
EMAIL;TYPE=work;PID=1.1:erika@work.example
EMAIL;TYPE=home,internet:erika@home.example
IMPP;X-SERVICE-TYPE=Jabber;TYPE=work:xmpp:erika@chat.example
URL;TYPE=work;MEDIATYPE=text/html:https://erika.example/
ADR;TYPE=work;LABEL="Musterstr. 1\\n10115 Berlin";GEO="geo:52.5,13.4":;;Musterstr. 1;Berlin;;10115;Germany
NOTE:Met at conference.
END:VCARD
`.replace(/\n/g, "\r\n");

const kEntryLines = /^(item\d+\.)?(TEL|EMAIL|IMPP|URL|ADR)[;:]/;

function entryLines(vcf: string): string[] {
  return vcf.replace(/\r\n /g, "").split("\r\n").filter(line => kEntryLines.test(line));
}

test("Saving after editing something else leaves all contact entries exactly as they were", () => {
  let person = new Person();
  vCard.convertVCardToPerson(serverVCard, person);
  person.notes = "Met at another conference.";
  let saved = vCard.getUpdatedVCard(person, vCard.parseContact(serverVCard));
  expect(new Set(entryLines(saved))).toEqual(new Set(entryLines(serverVCard)));
  expect(saved).toContain("NOTE:Met at another conference.");
});

test("Only the entry that the user changed is written anew", () => {
  let person = new Person();
  vCard.convertVCardToPerson(serverVCard, person);
  let changed = person.emailAddresses.find(entry => entry.value == "erika@home.example");
  changed.value = "erika@home2.example";
  let saved = vCard.getUpdatedVCard(person, vCard.parseContact(serverVCard));
  let unchanged = entryLines(serverVCard).filter(line => !line.includes("erika@home.example"));
  for (let line of unchanged) {
    expect(entryLines(saved)).toContain(line);
  }
  expect(saved).not.toContain("erika@home.example");

  let reread = new Person();
  vCard.convertVCardToPerson(saved, reread);
  expect(reread.emailAddresses.contents.map(entry => entry.value).sort())
    .toEqual(["erika@home2.example", "erika@work.example"]);
});

test("A removed and a new entry", () => {
  let person = new Person();
  vCard.convertVCardToPerson(serverVCard, person);
  person.phoneNumbers.remove(person.phoneNumbers.find(entry => entry.value.includes("170")));
  person.phoneNumbers.add(person.phoneNumbers.first.clone()); // the same number a second time
  let saved = vCard.getUpdatedVCard(person, vCard.parseContact(serverVCard));
  let phones = entryLines(saved).filter(line => /^(item\d+\.)?TEL/.test(line));
  expect(phones.length).toBe(3);
  expect(saved).not.toContain("170");

  let reread = new Person();
  vCard.convertVCardToPerson(saved, reread);
  expect(reread.phoneNumbers.length).toBe(3);
});
