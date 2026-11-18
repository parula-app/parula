import { getInitials } from "../../../Shared/Person/Initials";
import { expect, test } from "vitest";

test("Initials of first and last name", () => {
  expect(getInitials("Anna Schmidt")).toBe("AS");
  expect(getInitials("Anna Maria Schmidt")).toBe("AS");
  expect(getInitials("  anna   schmidt  ")).toBe("AS");
});

test("Initials of a single word", () => {
  expect(getInitials("Board")).toBe("B");
  expect(getInitials("fred@example.com")).toBe("F");
});

test("Initials with accents, digits and other scripts", () => {
  expect(getInitials("Émile Zola")).toBe("ÉZ");
  expect(getInitials("1&1 Support")).toBe("1S");
  expect(getInitials("Юлия Иванова")).toBe("ЮИ");
});

test("Initials skip words that start with punctuation", () => {
  expect(getInitials("Anna (work)")).toBe("A");
  expect(getInitials("- Bert -")).toBe("B");
});

test("No initials", () => {
  expect(getInitials("")).toBe("");
  expect(getInitials("  ")).toBe("");
  expect(getInitials("&&&")).toBe("");
  expect(getInitials(null)).toBe("");
  expect(getInitials(undefined)).toBe("");
});
