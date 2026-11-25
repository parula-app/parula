import { expect, test } from "vitest";
import { appGlobal } from "../../../logic/app.ts"; // defeats circular import
import { ContactEntry } from "../../../logic/Abstract/Person";

test("compare() is true only when value, purpose, protocol and preference are the same", () => {
  let entry = new ContactEntry("+49 30 1234567", "work", "tel", 1);
  expect(entry.compare(entry.clone())).toBe(true);
  expect(entry.compare(new ContactEntry("+49 30 1234568", "work", "tel", 1))).toBe(false);
  expect(entry.compare(new ContactEntry("+49 30 1234567", "home", "tel", 1))).toBe(false);
  expect(entry.compare(new ContactEntry("+49 30 1234567", "work", "fax", 1))).toBe(false);
  expect(entry.compare(new ContactEntry("+49 30 1234567", "work", "tel", 2))).toBe(false);
  expect(entry.compare(null)).toBe(false);
});

test("copyFrom() takes the value, purpose, protocol and preference, and keeps the protocol data", () => {
  let entry = new ContactEntry("old@example.com", "work", "mailto", 100);
  entry.json = { jmapID: "k1" };
  let other = new ContactEntry("new@example.com", "home", "mailto", 1);
  entry.copyFrom(other);
  expect(entry.compare(other)).toBe(true);
  expect(entry.json.jmapID).toBe("k1");
});

test("The original survives the database, next to the protocol data", () => {
  let entry = new ContactEntry("erika@chat.example", "work", "xmpp", 100);
  entry.json = { jmapID: "k1" };
  entry.original = entry.clone();
  entry.value = "erika@chat2.example";

  let read = new ContactEntry(entry.value, entry.purpose, entry.protocol, entry.preference);
  read.fromJSON(JSON.parse(JSON.stringify(entry.toJSON())));
  expect(read.json).toEqual({ jmapID: "k1" });
  expect(read.original.compare(entry.original)).toBe(true);
  expect(read.compare(read.original)).toBe(false);
});

test("Entries without original and without protocol data stay without", () => {
  let entry = new ContactEntry("erika@example.com", "work", "mailto");
  let read = new ContactEntry(entry.value);
  read.fromJSON(JSON.parse(JSON.stringify(entry.toJSON() ?? null)));
  expect(read.original).toBeNull();
  expect(read.json ?? null).toBeNull();
});
