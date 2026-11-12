// @vitest-environment happy-dom
import type { EMail } from "../../../../logic/Mail/EMail";
import { hasOwnText } from "../../../../frontend/Mail/Composer/CloseButton.svelte";
import { expect, test } from "vitest";

function hasOwnTextIn(html: string): boolean {
  return hasOwnText({ html } as EMail);
}

const kLongText = "This is a longer message that the user wrote, with enough words to count as real content of the email. It has two sentences.";

test("Empty and short mails have no user text", () => {
  expect(hasOwnTextIn("")).toBe(false);
  expect(hasOwnTextIn("<p></p>")).toBe(false);
  expect(hasOwnTextIn("<p>Thanks!</p>")).toBe(false);
});

test("Longer text counts as user text", () => {
  expect(hasOwnTextIn(`<p>${kLongText}</p>`)).toBe(true);
});

test("Quoted text does not count", () => {
  let reply = `<p class="quote-header">Anna wrote on 1/2/2026:</p><blockquote><p>${kLongText}</p></blockquote>`;
  expect(hasOwnTextIn(reply)).toBe(false);
  expect(hasOwnTextIn(`<p>${kLongText}</p>${reply}`)).toBe(true);
});

test("Whitespace does not count", () => {
  let spaced = "<p>" + "a ".repeat(60) + "</p>";
  expect(hasOwnTextIn(spaced)).toBe(false);
});
