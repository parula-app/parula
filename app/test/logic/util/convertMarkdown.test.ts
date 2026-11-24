// @vitest-environment happy-dom
import { convertHTMLToMarkdown, convertMarkdownToHTML } from "../../../logic/util/convertHTML";
import { expect, test } from "vitest";

/** HTML as our editor writes it */
const kEditorHTML = [
  "<p>Some <strong>bold</strong>, <em>italic</em>, <s>struck</s>, <u>underlined</u> and <code>code</code> text.</p>",
  "<p>A <a href=\"https://example.com/a_(b)\">link</a><br>and a second line</p>",
  "<ul><li><p>One</p></li><li><p>Two</p><ol><li><p>Two A</p></li></ol></li></ul>",
  "<blockquote><p>Quoted</p></blockquote>",
  "<pre><code class=\"language-js\">let a = 1;\n```\n</code></pre>",
  "<hr>",
  "<p>Not markdown: *star* _under_ [bracket] &lt;tag&gt; ~~tilde~~ {curly} back\\slash</p>",
  "<p># not a heading</p><p>1. not a list</p><p>- not a list</p><p>&gt; not a quote</p>",
].join("");

test("HTML -> Markdown -> HTML keeps the content", () => {
  let markdown = convertHTMLToMarkdown(kEditorHTML);
  let html = convertMarkdownToHTML(markdown);
  expect(convertHTMLToMarkdown(html)).toEqual(markdown);
  let doc = new DOMParser().parseFromString(html, "text/html");
  expect(doc.querySelector("strong").textContent).toBe("bold");
  expect(doc.querySelector("em").textContent).toBe("italic");
  expect(doc.querySelector("s").textContent).toBe("struck");
  expect(doc.body.textContent).toContain("underlined");
  expect(doc.querySelector("p code").textContent).toBe("code");
  expect(doc.querySelector("a").getAttribute("href")).toBe("https://example.com/a_(b)");
  expect(doc.querySelector("br")).not.toBeNull();
  expect(doc.querySelectorAll("ul > li").length).toBe(2);
  expect(doc.querySelector("ul > li ol > li").textContent).toContain("Two A");
  expect(doc.querySelector("blockquote").textContent).toContain("Quoted");
  expect(doc.querySelector("pre code").textContent).toContain("let a = 1;\n```");
  expect(doc.querySelector("pre code").className).toContain("js");
  expect(doc.querySelector("hr")).not.toBeNull();
  expect(html).toContain("*star* _under_ [bracket] &lt;tag&gt; ~~tilde~~ {curly} back\\slash");
  expect(doc.querySelectorAll("h1, h2, ol + p, blockquote + p").length).toBe(0);
  expect(doc.body.textContent).toContain("# not a heading");
  expect(doc.body.textContent).toContain("1. not a list");
  expect(doc.body.textContent).toContain("- not a list");
  expect(doc.body.textContent).toContain("> not a quote");
});

test("Markdown of HTML is readable, without HTML", () => {
  let markdown = convertHTMLToMarkdown(kEditorHTML);
  expect(markdown).toContain("**bold**");
  expect(markdown).toContain("- One");
  expect(markdown).toContain("> Quoted");
  expect(markdown).not.toContain("<u>");
  expect(markdown).not.toContain("<p>");
});

test("The width of an image is an attribute", () => {
  let markdown = convertHTMLToMarkdown(`<p><img src="data:image/png;base64,AAAA" alt="Logo" containerstyle="width: 100px; height: auto;"> {width=7}</p>`);
  expect(markdown).toContain("![Logo](data:image/png;base64,AAAA){width=100}");
  expect(markdown).not.toContain("containerstyle");
  let html = convertMarkdownToHTML(markdown);
  let doc = new DOMParser().parseFromString(html, "text/html");
  expect(doc.querySelector("img").getAttribute("width")).toBe("100");
  expect(doc.querySelector("img").getAttribute("src")).toContain("AAAA");
  expect(doc.body.textContent).toContain("{width=7}");
});

test("HTML in Markdown stays text", () => {
  let html = convertMarkdownToHTML(`<script>alert(1)</script>\n\nText <img src="x" onerror="alert(2)"> [link](javascript:alert(3))`);
  let doc = new DOMParser().parseFromString(html, "text/html");
  expect(doc.querySelector("script, img, [onerror]")).toBeNull();
  expect(doc.querySelector("a")).toBeNull();
  expect(doc.body.textContent).toContain("<script>");
});

test("No empty lines from empty paragraphs and trailing line breaks", () => {
  let markdown = convertHTMLToMarkdown("<p></p><p>Text<br></p><p></p>");
  expect(markdown.trim()).toBe("Text");
});
