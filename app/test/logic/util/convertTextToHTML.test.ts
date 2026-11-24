// @vitest-environment happy-dom
// before DOMPurify loads
import "../../frontend/Util/happyDOMForDOMPurify";
import { convertTextToHTML } from "../../../logic/util/convertHTML";
import { expect, test } from "vitest";

function parse(plaintext: string): Document {
  return new DOMParser().parseFromString(convertTextToHTML(plaintext), "text/html");
}

test("Text right after a quote is not part of the quote", () => {
  let doc = parse("Fred wrote:\n> Can you come tomorrow?\nYes, I can.");
  let quote = doc.querySelector("blockquote");
  expect(quote.textContent).toContain("Can you come tomorrow?");
  expect(quote.textContent).not.toContain("Yes, I can.");
  expect(doc.body.textContent).toContain("Yes, I can.");
});

test("Text right after a nested quote is not part of the nested quote", () => {
  let doc = parse("> Yes, I can.\n>> Can you come tomorrow?\n> When?\nAt 10.");
  let outer = doc.querySelector("blockquote");
  let inner = outer.querySelector("blockquote");
  expect(inner.textContent).toContain("Can you come tomorrow?");
  expect(inner.textContent).not.toContain("When?");
  expect(outer.textContent).toContain("When?");
  expect(outer.textContent).not.toContain("At 10.");
  expect(doc.body.textContent).toContain("At 10.");
});

test("Quoted lines stay one paragraph", () => {
  let doc = parse("> Can you come\n> tomorrow?\n\nYes.");
  let paragraph = doc.querySelector("blockquote p");
  expect(paragraph.textContent).toContain("Can you come");
  expect(paragraph.textContent).toContain("tomorrow?");
});
