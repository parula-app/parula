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
  let title = linkTitle("https://a.b.d.foo.com/dtghdfhj");
  expect(title).toContain("foo.com");
  expect(title).toContain("https://a.b.d.foo.com/dtghdfhj");
});

test("The tooltip of a mailto: or tel: link shows the address, without \"null\" for the domain", () => {
  let mailTitle = linkTitle("mailto:fred@foo.com");
  expect(mailTitle).not.toContain("null");
  expect(mailTitle).toContain("fred@foo.com");

  let phoneTitle = linkTitle("tel:+491234567");
  expect(phoneTitle).not.toContain("null");
  expect(phoneTitle).toContain("+491234567");
});
