import { expect, test } from "vitest";
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { Person, ContactEntry } from "../../../../logic/Abstract/Person";
import { StreetAddress } from "../../../../logic/Contacts/StreetAddress";
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

/** Two addresses as Stalwart returns them for a vCard with
 * `ADR;TYPE=work:;Building 2;Hauptstr. 1;Berlin;BE;10115;Germany` and
 * `ADR;TYPE=home:;;Gartenweg 5;Potsdam;BB;14467;Germany` */
function stalwartAddresses(): TJSContact["addresses"] {
  return {
    k1: {
      contexts: { work: true },
      components: [
        { kind: "apartment", value: "Building 2" },
        { kind: "name", value: "Hauptstr. 1" },
        { kind: "locality", value: "Berlin" },
        { kind: "region", value: "BE" },
        { kind: "postcode", value: "10115" },
        { kind: "country", value: "Germany" },
      ],
      timeZone: "Europe/Berlin",
      coordinates: "geo:52.52,13.40",
    },
    k2: {
      contexts: { private: true },
      components: [
        { kind: "name", value: "Gartenweg 5" },
        { kind: "locality", value: "Potsdam" },
        { kind: "region", value: "BB" },
        { kind: "postcode", value: "14467" },
        { kind: "country", value: "Germany" },
      ],
    },
  };
}

/** The fields of a `StreetAddress` that have a value, and the purpose */
function addressFields(entry: ContactEntry) {
  let fields = Object.entries(new StreetAddress(entry.value).toJSON()).filter(([, value]) => value);
  return { ...Object.fromEntries(fields), purpose: entry.purpose };
}

test("Street addresses from the server", () => {
  let person = new Person();
  let jscontact = makeContact({});
  jscontact.addresses = stalwartAddresses();
  JSContact.toPerson(jscontact, person);
  let addresses = person.streetAddresses.contents.map(addressFields);
  expect(addresses).toHaveLength(2);
  expect(addresses).toEqual(expect.arrayContaining([
    { instructions: "Building 2", street: "Hauptstr. 1", city: "Berlin", postalCode: "10115", state: "BE", country: "Germany", purpose: "work" },
    { street: "Gartenweg 5", city: "Potsdam", postalCode: "14467", state: "BB", country: "Germany", purpose: "home" },
  ]));
});

test("A street address entered by the user is saved as address components", () => {
  let person = new Person();
  let address = new StreetAddress();
  address.street = "Gartenweg 5";
  address.city = "Potsdam";
  address.postalCode = "14467";
  address.country = "Germany";
  person.streetAddresses.add(new ContactEntry(address.toString(), "home"));
  let jscontact = {} as TJSContact;
  JSContact.fromPerson(person, jscontact);

  let written = Object.values(jscontact.addresses);
  expect(written.length).toBe(1);
  expect(written[0].contexts).toEqual({ private: true });
  // Other clients read the components, in any order
  expect(written[0].components).toEqual(expect.arrayContaining([
    { kind: "locality", value: "Potsdam" },
    { kind: "postcode", value: "14467" },
    { kind: "country", value: "Germany" },
  ]));
  expect(written[0].components.map(component => component.value).join(" ")).toContain("Gartenweg");

  let readBack = new Person();
  JSContact.toPerson(jscontact, readBack);
  expect(readBack.streetAddresses.contents.map(addressFields)).toEqual([addressFields(person.streetAddresses.first)]);
});

test("Editing an address keeps the parts that we don't show", () => {
  let jscontact = makeContact({});
  jscontact.addresses = {
    a1: {
      full: "1600 Pennsylvania Ave NW\nWashington, DC 20500\nUSA",
      isOrdered: true,
      components: [
        { kind: "number", value: "1600" },
        { kind: "name", value: "Pennsylvania Ave" },
        { kind: "direction", value: "NW" },
        { kind: "locality", value: "Washington" },
        { kind: "region", value: "DC" },
        { kind: "postcode", value: "20500" },
        { kind: "country", value: "USA" },
      ],
      countryCode: "US",
      timeZone: "America/New_York",
    },
  };
  let person = new Person();
  JSContact.toPerson(jscontact, person);
  let entry = person.streetAddresses.first;
  let address = new StreetAddress(entry.value);
  expect(address.street).toBe("1600 Pennsylvania Ave");
  address.postalCode = "20501";
  entry.value = address.toString();

  JSContact.fromPerson(person, jscontact);
  // The address is ordered (`isOrdered`), so the order of its components is part of it
  expect(jscontact.addresses.a1.components).toEqual([
    { kind: "number", value: "1600" },
    { kind: "name", value: "Pennsylvania Ave" },
    { kind: "direction", value: "NW" },
    { kind: "locality", value: "Washington" },
    { kind: "region", value: "DC" },
    { kind: "postcode", value: "20501" },
    { kind: "country", value: "USA" },
  ]);
  expect(jscontact.addresses.a1.countryCode).toBe("US");
  expect(jscontact.addresses.a1.timeZone).toBe("America/New_York");
  expect(jscontact.addresses.a1.isOrdered).toBe(true);
  // `full`, if any, must not be the outdated one
  expect(jscontact.addresses.a1.full ?? "20501").toContain("20501");
});

test("An address with only the full text stays as it is, when not edited", () => {
  let jscontact = makeContact({});
  jscontact.addresses = { a1: { full: "Hauptstr. 1\n10115 Berlin", contexts: { work: true } } };
  let person = new Person();
  JSContact.toPerson(jscontact, person);
  expect(new StreetAddress(person.streetAddresses.first.value).street).toBe("Hauptstr. 1\n10115 Berlin");

  person.notes = "Edited something else";
  JSContact.fromPerson(person, jscontact);
  expect(jscontact.addresses.a1.full).toBe("Hauptstr. 1\n10115 Berlin");
  expect(jscontact.addresses.a1.components).toBeUndefined();
});
