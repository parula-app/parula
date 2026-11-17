import { expect, test } from "vitest";
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { Person } from "../../../../logic/Abstract/Person";
import { JSContact } from "../../../../logic/Contacts/JMAP/JSContact";
import type { TJSContact } from "../../../../logic/Contacts/JMAP/TJSContact";

function readLinks(links: Record<string, any>): Person {
  let person = new Person();
  JSContact.toPerson({ "@type": "Card", version: "1.0", name: { full: "Erika" }, links, notes: { n1: { note: "Still here" } } } as TJSContact, person);
  return person;
}

test("A website without https:// from the server gets it", () => {
  // Older versions saved what the user typed into `<input type="url">`, e.g. just the host name
  let person = readLinks({ l1: { uri: "erika.example" } });
  expect(person.urls.first.value).toBe("https://erika.example");
  expect(person.urls.first.protocol).toBe("https");
});

test("Links that sanitize.url() or URL rejects are dropped, and the contact stays", () => {
  let person = readLinks({ l1: { uri: "javascript:alert(1)" }, l2: { uri: " javascript:alert(1)" }, l3: { uri: "https://exa mple/" }, l4: { uri: { evil: true } }, l5: { uri: "https://erika.example/" } });
  expect(person.urls.contents.map(entry => entry.value)).toEqual(["https://erika.example/"]);
  expect(person.notes).toBe("Still here");
});

test("The protocol of a link is its URL scheme", () => {
  let person = readLinks({ l1: { uri: "https://erika.example/" }, l2: { uri: "mailto:erika@example.com" }, l3: { uri: "tel:+49301234567" } });
  expect(person.urls.contents.map(entry => entry.protocol)).toEqual(["https", "mailto", "tel"]);
});
