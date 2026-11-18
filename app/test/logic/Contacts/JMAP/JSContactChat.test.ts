import { expect, test } from "vitest";
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { Person, ContactEntry } from "../../../../logic/Abstract/Person";
import { JSContact } from "../../../../logic/Contacts/JMAP/JSContact";
import type { TJSContact } from "../../../../logic/Contacts/JMAP/TJSContact";

/** Stalwart's JSContact for a vCard with `IMPP;TYPE=work:xmpp:erika@chat.example`,
 * and an entry of another JMAP client with only a user name */
function serverCard(): TJSContact {
  return {
    "@type": "Card",
    version: "1.0",
    uid: "urn:uuid:7f6c1e2a-1111-4c5e-9d0a-000000000001",
    name: { full: "Erika Mustermann" },
    onlineServices: {
      k1: { uri: "xmpp:erika@chat.example", contexts: { work: true } },
      k2: { user: "erika.m", service: "Signal" },
    },
  } as TJSContact;
}

test("Chat accounts from other clients", () => {
  let person = new Person();
  JSContact.toPerson(serverCard(), person);
  expect(person.chatAccounts.contents.map(entry => [entry.value, entry.protocol]).sort()).toEqual([
    ["erika.m", "signal"],
    ["erika@chat.example", "xmpp"],
  ]);
});

test("Saving leaves chat accounts that the user didn't change as they are", () => {
  let jscontact = serverCard();
  let person = new Person();
  JSContact.toPerson(jscontact, person);
  person.notes = "Changed something else";
  JSContact.fromPerson(person, jscontact);
  let { k1, k2 } = jscontact.onlineServices;
  expect([k1.uri, k1.user, k1.service]).toEqual(["xmpp:erika@chat.example", undefined, undefined]);
  expect([k2.uri, k2.user, k2.service]).toEqual([undefined, "erika.m", "Signal"]);
});

test("Editing a chat account that has only a URI", () => {
  let jscontact = serverCard();
  let person = new Person();
  JSContact.toPerson(jscontact, person);
  person.chatAccounts.first.value = "erika@other.example";
  JSContact.fromPerson(person, jscontact);
  // An outdated URI would still show the old address in other clients
  expect(jscontact.onlineServices.k1.uri ?? "erika@other.example").toContain("erika@other.example");

  let readBack = new Person();
  JSContact.toPerson(jscontact, readBack);
  expect(readBack.chatAccounts.first.value).toBe("erika@other.example");
});

test("New chat accounts get a URI, where the protocol has one", () => {
  // Stalwart drops chat accounts without URI
  let person = new Person();
  person.chatAccounts.add(new ContactEntry("fred@chat.example", "work", "xmpp"));
  person.chatAccounts.add(new ContactEntry("+49 170 1234567", "home", "signal"));
  let jscontact = {} as TJSContact;
  JSContact.fromPerson(person, jscontact);
  let written = Object.values(jscontact.onlineServices);
  expect(written).toHaveLength(2);
  let xmpp = written.find(service => JSON.stringify(service).includes("fred@chat.example"));
  expect(xmpp.uri).toBe("xmpp:fred@chat.example");
  expect(xmpp.service?.toLowerCase() ?? "xmpp").toBe("xmpp");
  let signal = written.find(service => JSON.stringify(service).includes("+49 170 1234567"));
  expect(signal.service?.toLowerCase()).toBe("signal");

  let readBack = new Person();
  JSContact.toPerson(jscontact, readBack);
  expect(readBack.chatAccounts.contents.map(entry => [entry.value, entry.protocol]).sort()).toEqual([
    ["+49 170 1234567", "signal"],
    ["fred@chat.example", "xmpp"],
  ]);
});

test("A chat account with an empty user name shows the URI", () => {
  let person = new Person();
  let jscontact = serverCard();
  jscontact.onlineServices = { k1: { user: "", uri: "xmpp:erika@chat.example" } };
  JSContact.toPerson(jscontact, person);
  expect(person.chatAccounts.contents.map(entry => [entry.value, entry.protocol])).toEqual([["erika@chat.example", "xmpp"]]);
});
