import { LetterIndex } from "../../Contacts/LetterIndex";
import type { PersonOrGroup } from "../../../frontend/Contacts/Person/PersonOrGroup";
import { expect, test } from "vitest";

// LetterIndex needs only the name, so plain objects stand in for persons and groups
function contacts(...names: string[]): PersonOrGroup[] {
  return names.map(name => ({ name }) as PersonOrGroup);
}

function sorted(...names: string[]): PersonOrGroup[] {
  return contacts(...names).sort(LetterIndex.compareByName);
}

test("Letter of a name", () => {
  expect(LetterIndex.letterFor("anna")).toBe("A");
  expect(LetterIndex.letterFor("  Bert ")).toBe("B");
  expect(LetterIndex.letterFor("Ägidius")).toBe("A");
  expect(LetterIndex.letterFor("Émile")).toBe("E");
  expect(LetterIndex.letterFor("Łukasz")).toBe("Ł");
  expect(LetterIndex.letterFor("Юлия")).toBe("Ю");
  expect(LetterIndex.letterFor("1&1 Support")).toBe("#");
  expect(LetterIndex.letterFor("@home")).toBe("#");
  expect(LetterIndex.letterFor("")).toBe("#");
  expect(LetterIndex.letterFor(null)).toBe("#");
  expect(LetterIndex.letterFor(undefined)).toBe("#");
});

test("Sort by name ignores case and accents, numbers first", () => {
  let names = sorted("zoe", "Émile", "anna", "Bert", "1&1", "eva", "Anton").map(contact => contact.name);
  expect(names).toEqual(["1&1", "anna", "Anton", "Bert", "Émile", "eva", "zoe"]);
});

test("Sort puts contacts without name first, without crash", () => {
  let names = sorted("Bert", null, "Anna").map(contact => contact.name);
  expect(names).toEqual([null, "Anna", "Bert"]);
});

test("First contact of each letter", () => {
  let list = sorted("Anna", "Anton", "Bert", "Émile", "Eva", "1&1");
  let index = new LetterIndex(list);
  expect(index.contactAtOrAfter("#").name).toBe("1&1");
  expect(index.contactAtOrAfter("A").name).toBe("Anna");
  expect(index.contactAtOrAfter("E").name).toBe("Émile");
  expect(index.hasLetter("E")).toBe(true);
});

test("Jump to a letter", () => {
  let list = sorted("Anna", "Bert", "Doris", "Zoe");
  let index = new LetterIndex(list);
  expect(index.contactAtOrAfter("A").name).toBe("Anna");
  expect(index.contactAtOrAfter("D").name).toBe("Doris");
  // No C: the next letter that has contacts
  expect(index.contactAtOrAfter("C").name).toBe("Doris");
  expect(index.contactAtOrAfter("E").name).toBe("Zoe");
  expect(index.contactAtOrAfter("#").name).toBe("Anna");
  expect(index.hasLetter("B")).toBe(true);
  expect(index.hasLetter("C")).toBe(false);
});

test("Jump to a letter after the last one", () => {
  let index = new LetterIndex(sorted("Anna", "Bert"));
  expect(index.contactAtOrAfter("X")).toBeNull();
});

test("Jump to a letter outside the alphabet index", () => {
  let index = new LetterIndex(sorted("Łukasz", "Anna"));
  expect(index.contactAtOrAfter("Ł").name).toBe("Łukasz");
  expect(index.contactAtOrAfter("Ж")).toBeNull();
});

test("Empty list", () => {
  let index = new LetterIndex([]);
  expect(index.contactAtOrAfter("A")).toBeNull();
  expect(index.hasLetter("A")).toBe(false);
});

test("Alphabet index has # first, then A to Z", () => {
  expect(LetterIndex.alphabet[0]).toBe("#");
  expect(LetterIndex.alphabet[1]).toBe("A");
  expect(LetterIndex.alphabet[26]).toBe("Z");
  expect(LetterIndex.alphabet.length).toBe(27);
});
