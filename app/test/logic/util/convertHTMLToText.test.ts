// @vitest-environment happy-dom
import { convertHTMLToText } from "../../../logic/util/convertHTML";
import { expect, test } from "vitest";

test("Plaintext has the conventions of plaintext emails", () => {
  let text = convertHTMLToText([
    "<h2>Plan</h2>",
    "<p>Some <strong>bold</strong>, <em>italic</em>, <u>underlined</u> and <s>struck</s> text, and <code>code</code>.</p>",
    "<p>See <a href=\"https://example.com/plan\">the <strong><em>plan</em></strong></a>, <a href=\"https://example.com/\">https://example.com/</a> and <a href=\"mailto:fred@example.com\">fred@example.com</a>.</p>",
    "<ul><li>One</li><li>Two</li></ul><ol start=\"3\"><li>Three</li></ol>",
    "<p>Fred wrote:</p><blockquote type=\"cite\"><p>Hi</p><blockquote type=\"cite\"><p>Hello</p></blockquote></blockquote>",
    "<p>1. *Not* Markdown_escaped [x]</p>",
    "<footer class=\"signature\"><p>Fred Miller</p><p>Example Inc.</p></footer>",
  ].join(""));
  expect(text).toContain("*Plan*");
  expect(text).toContain("Some *bold*, /italic/, _underlined_ and ~~struck~~ text, and code.");
  expect(text).toContain("See the plan <https://example.com/plan>, https://example.com/ and fred@example.com.");
  expect(text).toContain("- One\n- Two\n\n3. Three");
  expect(text).toContain("Fred wrote:\n\n> Hi\n>\n> > Hello");
  expect(text).toContain("1. *Not* Markdown_escaped [x]");
  expect(text).toMatch(/\n\n-- \nFred Miller\nExample Inc\.$/);
});

test("Plaintext of an HTML mail from elsewhere", () => {
  let text = convertHTMLToText(`<html><head><title>News</title><style>p { color: red; }</style></head>
    <body><style>.x {}</style><script>alert(1)</script>
      <table><tr><td>
        <p>Hello
           World</p>
        <img src="https://example.com/logo.png" alt="Logo">
      </td></tr><tr><td><div>Second&nbsp;row</div></td></tr></table>
      Line<br>break
    </body></html>`);
  expect(text).toBe("Hello World\n\nSecond row\n\nLine\nbreak");
});
