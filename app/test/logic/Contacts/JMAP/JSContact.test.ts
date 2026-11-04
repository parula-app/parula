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

test("When the last phone number was deleted on the server, it's removed here, too", () => {
  // Stalwart removes the whole `phones` property, when the last one is gone
  let person = new Person();
  JSContact.toPerson(makeContact({ e1: "support@stripe.com" }), person);
  expect(person.phoneNumbers.length).toBe(1);

  let jscontact = makeContact({ e1: "support@stripe.com" });
  delete jscontact.phones;
  jscontact.name.full = "Stripe Support Team";
  JSContact.toPerson(jscontact, person);
  expect(person.phoneNumbers.length).toBe(0);
  expect(person.name).toBe("Stripe Support Team");
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
