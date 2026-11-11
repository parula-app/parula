// @vitest-environment happy-dom
// before DOMPurify loads
import "../../frontend/Util/happyDOMForDOMPurify";
import { sanitizeHTML } from "../../../logic/util/convertHTML";
import { expect, test } from "vitest";

/** The tooltip that a link in a mail gets */
function linkTitle(href: string): string {
  let html = sanitizeHTML(`<p><a href="${href}">link</a></p>`);
  return new DOMParser().parseFromString(html, "text/html").querySelector("a").getAttribute("title");
}

test("The tooltip of a web link shows the domain and the URL", () => {
  expect(linkTitle("https://a.b.d.foo.com/dtghdfhj")).toBe("foo.com\n\nhttps://a.b.d.foo.com/dtghdfhj");
});

test("The tooltip of a mailto: or tel: link shows the URL", () => {
  expect(linkTitle("mailto:fred@foo.com")).toBe("mailto:fred@foo.com");
  expect(linkTitle("tel:+491234567")).toBe("tel:+491234567");
});
