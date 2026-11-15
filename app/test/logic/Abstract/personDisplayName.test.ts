// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { PersonUID, personDisplayName, unknownPersonName } from "../../../logic/Abstract/PersonUID";
import { expect, test } from "vitest";

test("Unknown persons: Only the part before the @ is the name", () => {
  // Name set by the sender
  expect(unknownPersonName("Fred Flintstone", "fred@example.com")).toBe("Fred Flintstone");
  expect(unknownPersonName("service@paypal.com", "phishing@example.com")).toBe("service");
  expect(unknownPersonName("Fred @ Bedrock", "fred@example.com")).toBe("Fred");
  // No name: Fall back to the email address
  expect(unknownPersonName(null, "fred@example.com")).toBe("fred");
  expect(unknownPersonName("", "fred@example.com")).toBe("fred");
  expect(unknownPersonName("  ", "fred@example.com")).toBe("fred");
  // Nothing left of the name
  expect(unknownPersonName("@paypal", "fred@example.com")).toBe("fred");
  // Mailing lists
  expect(unknownPersonName("Fred Flintstone via Bedrock List", "list@example.com")).toBe("Fred Flintstone");
  // Nothing at all
  expect(unknownPersonName(null, null)).toBe("");
  expect(unknownPersonName(null, "fred")).toBe("fred");
});

test("personDisplayName() of unknown persons", () => {
  expect(personDisplayName(new PersonUID("phishing@example.com", "service@paypal.com"))).toBe("service");
  expect(personDisplayName(new PersonUID("fred@example.com"))).toBe("fred");
  expect(personDisplayName(new PersonUID("fred@example.com", "Fred Flintstone"))).toBe("Fred Flintstone");
  expect(personDisplayName(null)).toBe("");
});
