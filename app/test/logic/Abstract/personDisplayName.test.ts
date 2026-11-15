// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { findOrCreatePersonUID, personDisplayName } from "../../../logic/Abstract/PersonUID";
import { expect, test } from "vitest";

test("Names in emails: Only the part before the @", () => {
  let sender = findOrCreatePersonUID("phishing@example.com", "service@paypal.com");
  expect(sender.name).toBe("service");
  expect(sender.emailAddress).toBe("phishing@example.com");
  expect(findOrCreatePersonUID("fred@example.com", "Fred @ Bedrock").name).toBe("Fred");
  expect(findOrCreatePersonUID("fred@example.com", "Fred Flintstone").name).toBe("Fred Flintstone");
  // Nothing left of the name
  expect(findOrCreatePersonUID("fred@example.com", "@paypal").name).not.toBe("");
  // Mailing lists are still recognized
  expect(findOrCreatePersonUID("list@example.com", "Fred Flintstone via Bedrock List").isProxyAddress).toBe(true);
});

test("personDisplayName() of unknown persons", () => {
  expect(personDisplayName(findOrCreatePersonUID("phishing@example.com", "service@paypal.com"))).toBe("service");
  expect(personDisplayName(findOrCreatePersonUID("fred@example.com", null))).toBe("fred");
  expect(personDisplayName(findOrCreatePersonUID("fred@example.com", "@paypal"))).toBe("fred");
  expect(personDisplayName(findOrCreatePersonUID("fred@example.com", "Fred Flintstone"))).toBe("Fred Flintstone");
  expect(personDisplayName(null)).toBe("");
});
