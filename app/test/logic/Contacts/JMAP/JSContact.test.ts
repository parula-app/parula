import { expect, test } from "vitest";
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { Person } from "../../../../logic/Abstract/Person";
import { JSContact } from "../../../../logic/Contacts/JMAP/JSContact";
import type { TJSContact } from "../../../../logic/Contacts/JMAP/TJSContact";

function makeContact(emails: Record<string, string>): TJSContact {
  return {
    version: "1.0",
    uid: "1c2e3f4a-5b6c-7d8e-9f01-234567890abc",
    name: { full: "Stripe Support" },
    emails: Object.fromEntries(Object.entries(emails)
      .map(([id, address]) => [id, { address }])),
    phones: {
      p1: { number: "0123456789" },
    },
  } as TJSContact;
}

test("Email address as mailto: URL", () => {
  let person = new Person();
  JSContact.toPerson(makeContact({ e1: "mailto:support@stripe.com" }), person);
  expect(person.emailAddresses.contents.map(entry => entry.value)).toEqual(["support@stripe.com"]);
});

test("Malformed email address keeps the rest of the contact", () => {
  let person = new Person();
  JSContact.toPerson(makeContact({
    e1: "Not an address",
    e2: "support@stripe.com",
  }), person);
  expect(person.name).toEqual("Stripe Support");
  expect(person.emailAddresses.contents.map(entry => entry.value)).toEqual(["support@stripe.com"]);
  expect(person.phoneNumbers.contents.map(entry => entry.value)).toEqual(["0123456789"]);
});

test("Addresses deleted on the server are all removed, not only every other one", () => {
  let person = new Person();
  JSContact.toPerson(makeContact({
    e1: "one@example.com",
    e2: "two@example.com",
    e3: "three@example.com",
    e4: "four@example.com",
  }), person);
  expect(person.emailAddresses.length).toBe(4);

  JSContact.toPerson(makeContact({ e4: "four@example.com" }), person);
  expect(person.emailAddresses.contents.map(entry => entry.value)).toEqual(["four@example.com"]);
});

/** `JSON.parse()` makes `__proto__` an own property, like in a server response */
function fromServer(json: string): TJSContact {
  return JSON.parse(json);
}

test("An entry ID `__proto__` from the server changes no other object", () => {
  try {
    let person = new Person();
    JSContact.toPerson(fromServer(`{
      "uid": "u1",
      "emails": { "__proto__": { "address": "first@example.com" } },
      "notes": { "__proto__": { "note": "First note" } }
    }`), person);
    // The next version from the server has other IDs
    let jscontact = fromServer(`{
      "uid": "u1",
      "emails": { "e1": { "address": "second@example.com" } },
      "notes": { "n1": { "note": "Second note" } }
    }`);
    JSContact.toPerson(jscontact, person);
    expect(person.emailAddresses.contents.map(entry => entry.value)).toEqual(["second@example.com"]);
    expect(person.notes).toBe("Second note");

    person.notes = "Edited note";
    JSContact.fromPerson(person, jscontact);

    expect(({} as any).address).toBeUndefined();
    expect(({} as any).note).toBeUndefined();
    expect(jscontact.notes.n1.note).toBe("Edited note");
  } finally {
    for (let prop of ["address", "pref", "contexts", "note"]) {
      delete (Object.prototype as any)[prop];
    }
  }
});

test("An entry ID `__proto__` from the server is written back as such", () => {
  let jscontact = fromServer(`{
    "uid": "u1",
    "emails": { "__proto__": { "address": "first@example.com" } },
    "notes": { "__proto__": { "note": "First note" } }
  }`);
  let person = new Person();
  JSContact.toPerson(jscontact, person);
  person.emailAddresses.first.value = "edited@example.com";
  person.notes = "Edited note";

  JSContact.fromPerson(person, jscontact);

  expect(Object.keys(jscontact.emails)).toEqual(["__proto__"]);
  expect(jscontact.emails["__proto__"].address).toBe("edited@example.com");
  expect(Object.keys(jscontact.notes)).toEqual(["__proto__"]);
  expect(jscontact.notes["__proto__"].note).toBe("Edited note");
});

test("Addresses are removed when the server sends none", () => {
  let person = new Person();
  JSContact.toPerson(makeContact({ e1: "one@example.com" }), person);

  JSContact.toPerson({ version: "1.0", uid: "1c2e3f4a-5b6c-7d8e-9f01-234567890abc" } as TJSContact, person);

  expect(person.emailAddresses.length).toBe(0);
});
