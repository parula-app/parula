import { gt, locale, setUILocale } from "../../l10n/l10n";
import { generateMessageID } from "../../l10n/generateMessageID";
import de from "../../l10n/locales/de/messages.json";
import fr from "../../l10n/locales/fr/messages.json";
import { get } from "svelte/store";
import { expect, test } from "vitest";

const kCancelID = generateMessageID("Cancel");

test("English before a language is loaded", () => {
  expect(gt`Cancel`).toBe("Cancel");
});

test("Load a language", async () => {
  await setUILocale("de");
  expect(get(locale)).toBe("de");
  expect(gt`Cancel`).toBe(de[kCancelID]);
  expect(gt`Cancel`).not.toBe("Cancel");
});

test("Switch to another language", async () => {
  await setUILocale("fr");
  expect(get(locale)).toBe("fr");
  expect(gt`Cancel`).toBe(fr[kCancelID]);
  await setUILocale("en-US");
  expect(get(locale)).toBe("en");
  expect(gt`Cancel`).toBe("Cancel");
});

test("Locale codes", async () => {
  await setUILocale("de-AT");
  expect(get(locale)).toBe("de");
  await setUILocale("en-AU");
  expect(get(locale)).toBe("en-GB");
  await setUILocale("xx-YY");
  expect(get(locale)).toBe("en");
});

test("The last switch wins, even if an earlier language loads slower", async () => {
  await setUILocale("de"); // loaded already, so loading it again is fast
  let slow = setUILocale("ja");
  let fast = setUILocale("de");
  await Promise.all([slow, fast]);
  expect(get(locale)).toBe("de");
  expect(gt`Cancel`).toBe(de[kCancelID]);
});
