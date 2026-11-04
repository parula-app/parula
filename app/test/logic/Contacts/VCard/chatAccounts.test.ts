import { expect, test } from "vitest";
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { Person, ContactEntry } from "../../../../logic/Abstract/Person";
import * as vCard from "../../../../logic/Contacts/VCard/VCard";

function impps(vcf: string): string[] {
  return vcf.replace(/\r\n /g, "").split("\r\n").filter(line => /^IMPP[;:]/i.test(line));
}

test("A chat account entered in our app is saved as a URI", () => {
  // IMPP is a URI, RFC 6350 6.4.3
  let person = new Person();
  person.name = "Erika";
  person.chatAccounts.add(new ContactEntry("erika@chat.example", "work", "xmpp"));
  person.chatAccounts.add(new ContactEntry("erika@sip.example", "work", "sip"));
  let saved = vCard.personToVCard(person);
  let values = impps(saved).map(line => line.slice(line.indexOf(":") + 1));
  expect(values.sort()).toEqual(["sip:erika@sip.example", "xmpp:erika@chat.example"]);

  let reread = new Person();
  vCard.convertVCardToPerson(saved, reread);
  expect(reread.chatAccounts.contents.map(entry => [entry.protocol, entry.value]).sort())
    .toEqual([["sip", "erika@sip.example"], ["xmpp", "erika@chat.example"]]);
});

test("A chat account of another client shows the address without the scheme, and edits stay URIs", () => {
  let person = new Person();
  vCard.convertVCardToPerson("BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Erika\r\nIMPP;TYPE=work:xmpp:erika@chat.example\r\nEND:VCARD\r\n", person);
  let chat = person.chatAccounts.first;
  expect([chat.protocol, chat.value]).toEqual(["xmpp", "erika@chat.example"]);
  chat.value = "erika@chat2.example";
  let saved = vCard.personToVCard(person);
  expect(impps(saved).some(line => line.endsWith(":xmpp:erika@chat2.example"))).toBe(true);
});

test("Chat accounts without a URI form stay as they are", () => {
  let person = new Person();
  person.name = "Erika";
  person.chatAccounts.add(new ContactEntry("aim:erika", "work"));
  person.chatAccounts.add(new ContactEntry("xmpp:erika@chat.example", "work", "xmpp"));
  let values = impps(vCard.personToVCard(person)).map(line => line.slice(line.indexOf(":") + 1));
  expect(values.sort()).toEqual(["aim:erika", "xmpp:erika@chat.example"]);
});
