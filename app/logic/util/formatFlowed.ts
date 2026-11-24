import { assert } from "./util";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";

/**
 * Implements format=flowed (RFC 2646, RFC 3676),
 * and converts HTML to format=flowed, or to Markdown.
 *
 * format=flowed has the conventions of plaintext emails: `*bold*`, `/italic/`, `_underline_`, `>` before quotes,
 * `-- ` before the signature, and links as `text <URL>`, without images.
 * Lines longer than 78 characters are wrapped into lines of 72, as the RFC suggests. @see `unwrapFormatFlowed()`
 *
 * Markdown is not wrapped. The width of an image is an attribute, as in Pandoc: `![alt](src){width=200}`
 *
 * Neither has HTML: Elements like `<script>` and `<style>` are removed, links and images only with safe URLs,
 * and `<` in the Markdown text is escaped.
 *
 * @param markdown Write Markdown instead of format=flowed
 */
export function convertHTMLToFormatFlowed(html: string, markdown = false): string {
  let doc = new DOMParser().parseFromString(html, "text/html");
  return processBlocks(doc.body, { markdown, quoteLevel: 0, firstIndent: "", indent: "" });
}

type ToTextOptions = {
  /** Markdown instead of format=flowed */
  markdown: boolean,
  /** Number of `>` before each line */
  quoteLevel: number,
  /** Before the first line of the block, e.g. a list marker */
  firstIndent: string,
  /** Before the other lines, e.g. the indentation of a list item. As long as `firstIndent`. */
  indent: string,
};

/** @returns the blocks in `parent`, separated by an empty line */
function processBlocks(parent: Node, options: ToTextOptions): string {
  let blocks: string[] = [];
  let inline = "";
  // The first block gets the list marker, the others the indentation
  let next = () => blocks.length ? { ...options, firstIndent: options.indent } : options;
  for (let node of [...parent.childNodes, null]) { // null: the end, for the inline text before it
    if (node && !kBlocks.includes(node.nodeName)) {
      inline += processInline(node, options);
      continue;
    }
    let text = processLines(inline, next());
    if (text) {
      blocks.push(text);
    }
    inline = "";
    text = node ? processHTMLElement(node as Element, next()) : "";
    if (text) {
      blocks.push(text);
    }
  }
  return blocks.join("\n" + getQuotePrefix(options.quoteLevel).trimEnd() + "\n");
}

const kBlocks = ["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "BLOCKQUOTE", "PRE", "HR",
  "DIV", "FOOTER", "HEADER", "SECTION", "ARTICLE", "MAIN", "NAV", "ASIDE", "ADDRESS", "CENTER", "FIGURE", "FIGCAPTION",
  "TABLE", "CAPTION", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH", "DL", "DT", "DD", "DETAILS", "SUMMARY", "FORM", "FIELDSET"];

/** @returns the lines of a block element, with the quote prefix and the indentation */
function processHTMLElement(element: Element, options: ToTextOptions): string {
  let name = element.nodeName;
  if (name == "P") {
    return processLines(processChildNodes(element, options), options);
  } else if (name[0] == "H" && "123456".includes(name[1])) {
    let text = processChildNodes(element, options);
    return processLines(options.markdown ? "#".repeat(Number(name[1])) + " " + text : emphasis("*", text), options);
  } else if (name == "UL" || name == "OL") {
    let number = parseInt(element.getAttribute("start")) || 1;
    return [...element.children].map((item, i) => {
      let marker = name == "OL" ? `${number + i}. ` : "* ";
      return processBlocks(item, {
        ...options,
        firstIndent: (i ? options.indent : options.firstIndent) + marker,
        indent: options.indent + " ".repeat(marker.length),
      });
    }).filter(item => item).join("\n");
  } else if (name == "BLOCKQUOTE") {
    return processBlocks(element, { ...options, quoteLevel: options.quoteLevel + 1 });
  } else if (name == "PRE") {
    let code = element.textContent;
    if (code.endsWith("\n")) {
      code = code.slice(0, -1);
    }
    let lines = code.split("\n");
    if (options.markdown) {
      let language = [...element.querySelector("code")?.classList ?? []]
        .find(cssClass => cssClass.startsWith("language-"))?.substring("language-".length) ?? "";
      let fence = "```";
      while (code.includes(fence)) {
        fence += "`";
      }
      lines = [fence + language, ...lines, fence];
    }
    return lines.map((line, i) => prefixLine(line.trimEnd(), i ? options.indent : options.firstIndent, options)).join("\n");
  } else if (name == "HR") {
    return prefixLine("---", options.firstIndent, options);
  } else if (name == "FOOTER" && element.classList.contains("signature") && !options.markdown) {
    // A line per paragraph
    let emptyLine = getQuotePrefix(options.quoteLevel).trimEnd();
    return getQuotePrefix(options.quoteLevel) + "-- \n" +
      processBlocks(element, options).split("\n").filter(line => line != emptyLine).join("\n");
  }
  return processBlocks(element, options);
}

/** Wraps a paragraph, which has "\n" for its line breaks
 * @returns the lines with the quote prefix and the indentation */
function processLines(inline: string, options: ToTextOptions): string {
  let lines: string[] = [];
  for (let text of inline.trim().split("\n")) {
    text = text.trim();
    let maxLength = 78 - getQuotePrefix(options.quoteLevel).length - options.indent.length;
    while (!options.markdown && text.length > maxLength) {
      let space = text.lastIndexOf(" ", maxLength - 7); // lines of 72
      if (space <= 0) {
        space = text.indexOf(" ", maxLength - 6); // A long word, e.g. a URL
      }
      if (space < 0) {
        break;
      }
      lines.push(text.substring(0, space + 1)); // ends with space = flowed line
      text = text.substring(space + 1);
    }
    lines.push(text);
  }
  if (!lines.join("")) {
    return "";
  }
  return lines.map((line, i) => prefixLine(line, i ? options.indent : options.firstIndent, options))
    .join(options.markdown ? "\\\n" : "\n");
}

/** Space-stuffing: A line that starts with a space, `>` or `From ` gets a space, which the reader removes.
 * In a quote, the space after the `>` is that space. */
function prefixLine(line: string, indent: string, options: ToTextOptions): string {
  line = indent + line;
  if (!line) {
    return getQuotePrefix(options.quoteLevel).trimEnd();
  }
  if (!options.markdown && !options.quoteLevel && (line.startsWith(" ") || line.startsWith(">") || line.startsWith("From "))) {
    line = " " + line;
  }
  return getQuotePrefix(options.quoteLevel) + line;
}

function processChildNodes(node: Node, options: ToTextOptions): string {
  let text = "";
  for (let child of node.childNodes) {
    text += processInline(child, options);
  }
  return text;
}

/** @returns "\n" for line breaks */
function processInline(node: Node, options: ToTextOptions): string {
  let name = node.nodeName;
  if (node.nodeType == node.TEXT_NODE) {
    // Like HTML shows it: line breaks and other white space as one space
    let text = "";
    for (let char of node.textContent) {
      if (!" \n\t\r".includes(char)) {
        text += char;
      } else if (!text.endsWith(" ")) {
        text += " ";
      }
    }
    return options.markdown ? escapeMarkdown(text) : text;
  } else if (!(node instanceof Element) || ["SCRIPT", "STYLE", "TEMPLATE", "TITLE", "IFRAME", "OBJECT", "EMBED", "svg", "math"].includes(name)) {
    return "";
  } else if (name == "BR") {
    return "\n";
  } else if (name == "STRONG" || name == "B") {
    return emphasis(options.markdown ? "**" : "*", processChildNodes(node, options));
  } else if (name == "EM" || name == "I") {
    return emphasis(options.markdown ? "*" : "/", processChildNodes(node, options));
  } else if (name == "U") {
    return emphasis(options.markdown ? "" : "_", processChildNodes(node, options)); // Markdown has no underline
  } else if (name == "S" || name == "DEL" || name == "STRIKE") {
    return emphasis("~~", processChildNodes(node, options));
  } else if (name == "CODE") {
    let code = node.textContent.replaceAll("\n", " ");
    if (!options.markdown) {
      return code;
    }
    let fence = "`";
    while (code.includes(fence)) {
      fence += "`";
    }
    let padding = code.startsWith("`") || code.endsWith("`") ? " " : "";
    return fence + padding + code + padding + fence;
  } else if (name == "A") {
    // Only http, https and mailto, so that there's no `javascript:` link
    let url = sanitize.url(node.getAttribute("href"), null, ["https", "http", "mailto"]);
    if (options.markdown) {
      return url ? "[" + processChildNodes(node, options) + "](" + markdownURL(url, node.getAttribute("title")) + ")" : processChildNodes(node, options);
    }
    // Without `*bold*` etc., because the URL follows
    let text = processInline(node.ownerDocument.createTextNode(node.textContent), options);
    let trimmed = text.trim();
    return !trimmed || !url || trimmed == url || "mailto:" + trimmed == url ? text : text.replace(trimmed, trimmed + " <" + url + ">");
  } else if (name == "IMG") {
    let src = sanitize.url(node.getAttribute("src"), null, ["https", "http", "data"]);
    if (!options.markdown || !src) {
      return "";
    }
    // With the width that the user gave the image in our editor
    let style = node.ownerDocument.createElement("div").style;
    style.cssText = node.getAttribute("containerstyle") ?? "";
    let width = parseInt(node.getAttribute("width")) || (style.width.endsWith("px") ? parseInt(style.width) : 0);
    return "![" + escapeMarkdown(node.getAttribute("alt") ?? "") + "](" + markdownURL(src, node.getAttribute("title")) + ")" +
      (width ? `{width=${width}}` : "");
  }
  return processChildNodes(node, options);
}

/** Puts the spaces outside of the markers, because Markdown ignores `** bold**` */
function emphasis(marker: string, content: string): string {
  let text = content.trim();
  if (!text) {
    return content;
  }
  let start = content.indexOf(text);
  return content.substring(0, start) + marker + text + marker + content.substring(start + text.length);
}

function markdownURL(url: string, title: string | null): string {
  if (url.includes(" ") || url.includes(")")) {
    url = "<" + url + ">";
  }
  return title ? url + ' "' + title.replaceAll('"', '\\"') + '"' : url;
}

/** @returns `text` with backslashes before the characters that Markdown would interpret */
function escapeMarkdown(text: string): string {
  let escaped = "";
  for (let char of text) {
    // `{` would be the attributes of an image before it
    escaped += "\\`*_[]<{".includes(char) ? "\\" + char : char;
  }
  escaped = escaped.replaceAll("~~", "\\~\\~");
  // Special only at the start of a line, e.g. a heading or list
  let start = escaped.length - escaped.trimStart().length;
  let digits = start;
  while ("0123456789".includes(escaped[digits] ?? "_")) {
    digits++;
  }
  if ("#>-+=".includes(escaped[start] ?? "_")) {
    return escaped.substring(0, start) + "\\" + escaped.substring(start);
  } else if (digits > start && ".)".includes(escaped[digits] ?? "_")) {
    return escaped.substring(0, digits) + "\\" + escaped.substring(digits);
  }
  return escaped;
}

function getQuotePrefix(quoteLevel: number): string {
  let quotePrefix = "";
  for (let i = 0; i < quoteLevel; i++) {
    quotePrefix += ">";
  }
  if (quoteLevel) {
    quotePrefix += " ";
  }
  return quotePrefix;
}

type ToHTMLOptions = {
  inlineTextToHTMLConverter: ((inline: string) => string) | null,
  delSp: boolean,
  emptyLineAfterP: boolean,
};


/**
 * Implements format=flowed (RFC 2646, RFC 3676),
 * and converts format=flowed to HTML.
 *
 * @param formatFlowed
 * @param options
 *   @param inlineTextToHTMLConverter Function to run for each paragraph.
 *   @param inline {string} The part within a `<p>`, <div>`, `<br>`.
 *   @returns HTML string,
 *     possibly with inline HTML elements, like `<bold>`, `<a href="">` etc.,
 *     but without block-level elements.
 *   @param delSp {boolean} (Optional, default false)
 *     Content-Type: text/plain; format=flowed; delsp=yes
 * @returns HTML
 */
export function convertFormatFlowedToHTML(formatFlowed: string,
  inlineTextToHTMLConverter: ((inline: string) => string) | null,
  delSp = false,
  emptyLineAfterP = false
): string {
  let lines = formatFlowed.split("\n");
  let htmlE: HTMLElement = document.createElement("html");
  let bodyE: HTMLElement = document.createElement("body");
  htmlE.appendChild(bodyE);
  let currentE: HTMLElement = bodyE;
  let textBlock = ""; // flowing lines wrapped into a single string
  let previousQuoteLevel = 0;
  let pClosed = false;
  for (let line of lines) {
    let quoteLevel = 0;
    if (line.startsWith(">")) {
      for (; line[quoteLevel] == ">"; quoteLevel++) {
      }
      line = line.slice(quoteLevel);
    }
    let quoteLevelDifference = quoteLevel - previousQuoteLevel;
    previousQuoteLevel = quoteLevel;
    if (quoteLevelDifference == 0) {
      // do nothing
    } else if (quoteLevelDifference > 0) {
      // add `<blockquote>`
      for (let i = 0; i < quoteLevelDifference; i++) {
        // Close any other block level elements before the quote, e.g. signatures
        while (currentE.nodeName != "BLOCKQUOTE" && currentE.nodeName != "BODY" && currentE.parentElement) {
          currentE = currentE.parentElement;
        }
        let blockquoteE = document.createElement("blockquote");
        blockquoteE.setAttribute("type", "cite");
        currentE.appendChild(blockquoteE);
        currentE = blockquoteE;
      }
    } else if (quoteLevelDifference < 0) {
      // close `<blockquote>`
      for (let i = 0; i < -quoteLevelDifference; i++) {
        // Close any other block level elements within the quote
        while (currentE.nodeName != "BLOCKQUOTE" && currentE.nodeName != "BODY" && currentE.parentElement) {
          currentE = currentE.parentElement;
        }
        assert(currentE.parentElement, "Not enough <blockquote>s");
        currentE = currentE.parentElement;
      }
    }

    if (line == "-- ") {
      let signatureE = document.createElement("footer");
      currentE.appendChild(signatureE);
      currentE = signatureE;
      continue;
      /* Don't need to explicitly close the `<footer>`, because
       * a) If it's in a quote, or before a quote, then the blockquote logic will close the element.
       * b) It it's a sig of this email, then by definition it spans until the end of the document. */
    }
    if (line.startsWith(" ")) {
      line = line.slice(1);
    }

    // Flowed line
    if (line.endsWith(" ")) {
      if (delSp) {
        line = line.slice(0, -1);
      }
      textBlock += line;
      continue;
    }

    // End of flowed lines, or fixed line
    textBlock += line;

    if (emptyLineAfterP && pClosed && !line) {
      pClosed = false;
      continue;
    }

    if (inlineTextToHTMLConverter && line) {
      currentE.insertAdjacentHTML("beforeend", inlineTextToHTMLConverter(textBlock));
    } else {
      let pE = document.createElement("p");
      pE.textContent = textBlock;
      currentE.appendChild(pE);
    }
    textBlock = "";
    pClosed = true;
  }

  // Convert HTML DOM to HTML string
  // (XMLSerializer would escape `>` in `<style>` etc.)
  return htmlE.outerHTML;
}

function getPath(currentE: HTMLElement): string {
  let path: string[] = [];
  let walkerE = currentE;
  path.push(walkerE.nodeName);
  while (walkerE.parentElement) {
    walkerE = walkerE.parentElement;
    path.push(walkerE.nodeName);
  }
  return path.reverse().join(" > ");
}

/** Joins the lines that format=flowed (RFC 3676) wrapped, and removes the space-stuffing.
 * Quotes stay as `> ` and `>> `. @see `convertHTMLToFormatFlowed()`, which wraps them */
export function unwrapFormatFlowed(text: string): string {
  let lines: string[] = [];
  let isFlowed = false;
  let previousDepth = 0;
  for (let line of text.split(/\r?\n/)) {
    let depth = 0;
    while (line[depth] == ">") {
      depth++;
    }
    let content = line.substring(depth);
    if (content.startsWith(" ")) {
      content = content.substring(1);
    }
    if (isFlowed && depth == previousDepth && content != "-- ") {
      lines[lines.length - 1] += content;
    } else {
      lines.push(depth ? ">".repeat(depth) + (content ? " " : "") + content : content);
    }
    isFlowed = content.endsWith(" ") && content != "-- ";
    previousDepth = depth;
  }
  return lines.join("\n");
}
