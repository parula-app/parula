import { escapeAttr, escapeHTML } from "../../Files/FileType/htmlHelper";
import markdownit from "markdown-it";

/**
 * Converts a plaintext message body with XEP-0393 Message Styling to HTML:
 * `*bold*`, `_italic_`, `~strikethrough~`, `` `code` ``, ```` ``` ```` preformatted
 * blocks and `>` quotes, as Conversations, Dino and Gajim send it.
 * <https://xmpp.org/extensions/xep-0393.html>
 *
 * As the XEP recommends, the styling directives stay visible, e.g. "*bold*" in bold.
 * Only the ">" of quotes is replaced by the quote bar, as in Conversations.
 * All text is HTML-escaped, so the result has only the tags that we create here.
 */
export function messageStylingToHTML(body: string): string {
  return blocksToHTML(body.split("\n"));
}

/** Lines, preformatted blocks and quotes. Quotes can contain all blocks, also quotes. */
function blocksToHTML(lines: string[]): string {
  let html = "";
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("```")) {
      // Ends with a line of only "```", or with the parent block. Has no styling inside.
      let end = lines.indexOf("```", i + 1);
      if (end == -1) {
        end = lines.length - 1;
      }
      html += `<pre>${textToHTML(lines.slice(i, end + 1).join("\n"))}</pre>`;
      i = end;
    } else if (lines[i].startsWith(">")) {
      let end = i + 1;
      while (lines[end]?.startsWith(">")) {
        end++;
      }
      // Without the ">" and the first whitespace after it
      let quote = lines.slice(i, end).map(line => line.substring(isWhitespace(line[1]) ? 2 : 1));
      html += `<blockquote>${blocksToHTML(quote)}</blockquote>`;
      i = end - 1;
    } else {
      html += spansToHTML(lines[i]) + (i < lines.length - 1 ? "<br>" : "");
    }
  }
  return html;
}

/** The styled spans in one line, or in the content of another span. */
function spansToHTML(text: string): string {
  const tags: Record<string, string> = { "*": "strong", "_": "em", "~": "s", "`": "code" };
  let html = "";
  let plainStart = 0;
  // Directives that have no closing one later in the text. Keeps long messages fast.
  let unclosed = "";
  for (let i = 0; i < text.length; i++) {
    let directive = text[i];
    let tag = tags[directive];
    // An opening directive is at the start or after a whitespace, not before a whitespace, and not empty
    if (!tag || unclosed.includes(directive) || i > 0 && !isWhitespace(text[i - 1]) ||
        isWhitespace(text[i + 1]) || text[i + 1] == directive) {
      continue;
    }
    // Lazily matched: the first closing directive that is not after a whitespace
    let end = text.indexOf(directive, i + 2);
    while (end != -1 && isWhitespace(text[end - 1])) {
      end = text.indexOf(directive, end + 1);
    }
    if (end == -1) {
      unclosed += directive;
      continue;
    }
    let content = text.substring(i + 1, end);
    // Code has no styling inside. Other content is parsed like a line, because a directive
    // may open right after a different opening one, as in "*_bold italic_*".
    html += textToHTML(text.substring(plainStart, i)) +
      `<${tag}>${directive}${tag == "code" ? textToHTML(content) : spansToHTML(content)}${directive}</${tag}>`;
    plainStart = end + 1;
    i = end;
  }
  return html + textToHTML(text.substring(plainStart));
}

/** Whether `char` is a space, line break etc. False after the end of the text. */
function isWhitespace(char: string | undefined): boolean {
  return char?.trim() === "";
}

let linkify: any;
/** HTML-escaped text, with links for the URLs in it */
function textToHTML(text: string): string {
  // The XEP forbids Markdown parsers, but this is only the linkify-it of `convertTextToHTML()`
  linkify ??= markdownit().linkify;
  let html = "";
  let plainStart = 0;
  for (let link of linkify.match(text) ?? []) {
    html += escapeHTML(text.substring(plainStart, link.index)) +
      `<a href="${escapeAttr(link.url)}">${escapeHTML(link.text)}</a>`;
    plainStart = link.lastIndex;
  }
  return html + escapeHTML(text.substring(plainStart));
}
