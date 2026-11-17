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

test("Links that sanitize.url() rejects are not shown", () => {
  // `erika.example`: a website that older versions saved without https://
  let person = readLinks({ l1: { uri: "javascript:alert(1)" }, l2: { uri: "erika.example" }, l3: { uri: "https://erika.example/" } });
  expect(person.urls.contents.map(entry => entry.value)).toEqual(["https://erika.example/"]);
});

test("A malformed link from a buggy server keeps the rest of the contact", () => {
  let person = readLinks({ l1: { uri: "https://exa mple/" }, l2: { uri: { evil: true } }, l3: { uri: "https://erika.example/" } });
  expect(person.urls.contents.map(entry => entry.value)).toContain("https://erika.example/");
  expect(person.notes).toBe("Still here");
});
