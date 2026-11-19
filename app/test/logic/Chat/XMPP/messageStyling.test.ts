// @vitest-environment happy-dom
import { messageStylingToHTML } from "../../../../logic/Chat/XMPP/XMPPMessageStyling";
import { describe, expect, test } from "vitest";

function parse(body: string): HTMLElement {
  return new DOMParser().parseFromString(messageStylingToHTML(body), "text/html").body;
}

/** The text of each styled element, e.g. `{ strong: ["*bold*"] }` */
function styles(body: string): Record<string, string[]> {
  let result: Record<string, string[]> = {};
  for (let el of parse(body).querySelectorAll("*")) {
    if (el.localName != "br") {
      (result[el.localName] ??= []).push(el.textContent);
    }
  }
  return result;
}

describe("XEP-0393 Message Styling: spans", () => {
  test("The examples of the XEP that are styled", () => {
    expect(styles("plain span")).toEqual({});
    expect(styles("*strong span*")).toEqual({ strong: ["*strong span*"] });
    expect(styles("plain _emphasis_ plain")).toEqual({ em: ["_emphasis_"] });
    expect(styles("`pre` plain *strong*")).toEqual({ code: ["`pre`"], strong: ["*strong*"] });
    expect(styles("*strong*plain*")).toEqual({ strong: ["*strong*"] });
    expect(styles("* plain *strong*")).toEqual({ strong: ["*strong*"] });
    expect(styles("Everyone ~dis~likes cake.")).toEqual({ s: ["~dis~"] });
  });

  test("The examples of the XEP that are not styled", () => {
    for (let body of ["not strong*", "*not strong", "*not \n strong*", "*not *strong", "**", "***", "****"]) {
      expect(styles(body), body).toEqual({});
    }
  });

  test("Directives inside words and between numbers are text", () => {
    expect(styles("call snake_case_name() with 2*3*4 in ~/dir")).toEqual({});
  });

  test("Spans can be nested, but not overlap", () => {
    expect(styles("*_bold italic_*")).toEqual({ strong: ["*_bold italic_*"], em: ["_bold italic_"] });
    expect(styles("This is *`monospace and bold`*")).toEqual({ strong: ["*`monospace and bold`*"], code: ["`monospace and bold`"] });
    expect(styles("*this cannot _overlap*_")).toEqual({ strong: ["*this cannot _overlap*"] });
  });

  test("Code spans have no styling inside", () => {
    expect(styles("_no pre `with *children*`_")).toEqual({ em: ["_no pre `with *children*`_"], code: ["`with *children*`"] });
  });

  test("The text stays as sent, with the directives", () => {
    let body = "Say *hello* to _Bob_ and ~Eve~ with `ls -l`";
    expect(parse(body).textContent).toBe(body);
  });

  test("A long message without closing directives is fast", () => {
    let body = "*a _b ~c `d ".repeat(30000);
    expect(styles(body)).toEqual({});
  });
});

describe("XEP-0393 Message Styling: blocks", () => {
  test("A preformatted block has no styling inside, and ends with a line of only ```", () => {
    let result = styles("```js\n*not bold* ```\n```\n*bold*");
    expect(result.pre).toEqual(["```js\n*not bold* ```\n```"]);
    expect(result.strong).toEqual(["*bold*"]);
  });

  test("A preformatted block ends with the quote that it is in", () => {
    let body = parse("> ```\n> (println \"Hello, world!\")\n\nThe entire blockquote is a preformatted text block, but this line is plaintext!");
    expect(body.querySelector("blockquote > pre")?.textContent).toContain("println");
    expect(body.querySelector("blockquote")?.textContent).not.toContain("plaintext");
    expect(body.textContent).toContain("plaintext");
  });

  test("Quotes can be nested and have styling", () => {
    let body = parse(">> That that is, *is*.\n> Said the old hermit of Prague.\n\nWho?");
    expect(body.querySelector("blockquote > blockquote")?.textContent).toBe("That that is, *is*.");
    expect(body.querySelector("blockquote blockquote strong")?.textContent).toBe("*is*");
    expect(body.querySelector("blockquote")?.textContent).toContain("Said the old hermit");
    expect(body.querySelector("blockquote")?.textContent).not.toContain("Who?");
    expect(body.textContent).not.toContain(">");
  });

  test("Spans can't span lines", () => {
    expect(styles("There are three blocks in this body, one per line,\nbut there is no *formatting\nas spans* may not escape blocks.")).toEqual({});
  });
});

describe("XEP-0393 Message Styling: links and HTML", () => {
  test("URLs are links, also in spans", () => {
    let body = parse("see https://example.com/a_b_c and *https://example.org/*");
    let links = [...body.querySelectorAll("a")].map(a => a.getAttribute("href"));
    expect(links).toContain("https://example.com/a_b_c");
    expect(links).toContain("https://example.org/");
    expect(body.querySelector("strong a")).toBeTruthy();
  });

  test("HTML in the body is text, not HTML", () => {
    let message = [
      `<script>alert(1)</script> <img src=x onerror=alert(2)>`,
      `*<b onclick=alert(3)>bold</b>* _<i>_ ~<s>~ \`<code>\``,
      `https://example.com/"onmouseover="alert(4)'<x>`,
      "```",
      "<iframe src=javascript:alert(5)>",
      "```",
      "> <svg onload=alert(6)> &lt;script&gt;",
    ].join("\n");
    let body = parse(message);
    for (let el of body.querySelectorAll("*")) {
      expect(["strong", "em", "s", "code", "pre", "blockquote", "br", "a"]).toContain(el.localName);
      for (let attribute of el.getAttributeNames()) {
        expect(attribute).toBe("href");
        expect(el.getAttribute("href")).toMatch(/^https:\/\/example\.com\//);
      }
    }
    expect(body.textContent).toContain("<script>alert(1)</script>");
    expect(body.textContent).toContain("<iframe src=javascript:alert(5)>");
    expect(body.textContent).toContain("&lt;script&gt;");
  });
});
