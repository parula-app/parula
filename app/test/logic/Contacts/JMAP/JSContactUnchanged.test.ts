import { expect, test } from "vitest";
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { JMAPPerson } from "../../../../logic/Contacts/JMAP/JMAPPerson";
import { JSContact } from "../../../../logic/Contacts/JMAP/JSContact";
import type { TJSContact } from "../../../../logic/Contacts/JMAP/TJSContact";

/** As Stalwart returns a vCard 4 contact of another client: TEL as `tel:` URIs, IMPP, URL, EMAIL without type */
function serverCard(): TJSContact {
  return {
    "@type": "Card",
    version: "1.0",
    uid: "urn:uuid:7f6c1e2a-1111-4c5e-9d0a-000000000001",
    name: { full: "Erika Mustermann" },
    phones: {
      k1: { number: "tel:+49-30-1234567", contexts: { work: true }, features: { voice: true } },
      k2: { number: "tel:+49-170-1234567", features: { mobile: true, voice: true } },
      k3: { number: "tel:+49-30-7654321", contexts: { private: true }, features: { fax: true } },
    },
    emails: {
      k1: { address: "erika@work.example", contexts: { work: true }, pref: 1 },
      k2: { address: "erika@home.example" },
    },
    onlineServices: {
      k1: { uri: "xmpp:erika@chat.example", contexts: { work: true } },
    },
    links: {
      k1: { uri: "https://erika.example/" },
      k2: { uri: "https://blog.erika.example/", contexts: { private: true } },
    },
    notes: { k1: { note: "Met at conference." } },
  } as TJSContact;
}

const kEntryProperties = ["phones", "emails", "onlineServices", "links"];

test("Saving after editing something else leaves all contact entries exactly as they were", () => {
  let jscontact = serverCard();
  let person = new JMAPPerson(null);
  JSContact.toPerson(jscontact, person);
  person.notes = "Met at another conference.";
  JSContact.fromPerson(person, jscontact);
  for (let property of kEntryProperties) {
    expect(jscontact[property], property).toEqual(serverCard()[property]);
  }
});

test("Also after the contact was stored in the database and read again", () => {
  let jscontact = serverCard();
  let person = new JMAPPerson(null);
  JSContact.toPerson(jscontact, person);
  for (let entries of [person.phoneNumbers, person.emailAddresses, person.chatAccounts, person.urls]) {
    for (let entry of entries) {
      // As `SQLPerson` saves and reads it
      entry.fromJSON(JSON.parse(JSON.stringify(entry.toJSON())));
      entry.protocol ??= null;
    }
  }
  person.notes = "Met at another conference.";
  JSContact.fromPerson(person, jscontact);
  for (let property of kEntryProperties) {
    expect(jscontact[property], property).toEqual(serverCard()[property]);
  }
});

test("Only the entry that the user changed is written", () => {
  let jscontact = serverCard();
  let person = new JMAPPerson(null);
  JSContact.toPerson(jscontact, person);
  person.phoneNumbers.getIndex(2).value = "+49 30 7654322";
  JSContact.fromPerson(person, jscontact);
  let original = serverCard();
  expect(jscontact.phones.k1).toEqual(original.phones.k1);
  expect(jscontact.phones.k2).toEqual(original.phones.k2);
  expect(jscontact.phones.k3.number).toBe("+49 30 7654322");
  expect(jscontact.emails).toEqual(original.emails);
  expect(jscontact.links).toEqual(original.links);
});

test("What we remember about the entries is not sent to the server", () => {
  let jscontact = serverCard();
  let person = new JMAPPerson(null);
  JSContact.toPerson(jscontact, person);
  person.phoneNumbers.getIndex(0).value = "+49 30 1234568";
  person.emailAddresses.getIndex(1).purpose = "home";
  JSContact.fromPerson(person, jscontact);
  let sent = JSON.stringify(jscontact);
  expect(sent).not.toContain("original");
  expect(sent).not.toContain("jmapID");
});
