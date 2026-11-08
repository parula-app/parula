import { expect, test } from "vitest";
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { Person } from "../../../../logic/Abstract/Person";
import { JSContact } from "../../../../logic/Contacts/JMAP/JSContact";
import type { TJSContact } from "../../../../logic/Contacts/JMAP/TJSContact";

/** RFC 9553 allows a name with components only. Stalwart adds `full` itself, other servers may not. */
function card(name: TJSContact["name"]): TJSContact {
  return { "@type": "Card", version: "1.0", uid: "urn:uuid:3b1e5a7c-0d2f-4a8e-9b6c-1f2e3d4c5b6a", name } as TJSContact;
}

test("A name with only components, from RFC 9553 figure 6", () => {
  let person = new Person();
  JSContact.toPerson(card({ components: [{ kind: "given", value: "John" }, { kind: "surname", value: "Doe" }], isOrdered: true }), person);
  expect(person.name).toBe("John Doe");
  expect([person.firstName, person.lastName]).toEqual(["John", "Doe"]);
});

test("A name with separators and a default separator", () => {
  let person = new Person();
  JSContact.toPerson(card({
    components: [
      { kind: "surname", value: "Doe" },
      { kind: "separator", value: ", " },
      { kind: "given", value: "John" },
      { kind: "given2", value: "Philip" },
    ],
    isOrdered: true,
    defaultSeparator: " ",
  }), person);
  expect(person.name).toBe("Doe, John Philip");
});
