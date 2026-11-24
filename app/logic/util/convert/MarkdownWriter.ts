import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

/**
 * Writes HTML as Markdown, e.g. for the pages of topics.
 * Converts what our HTML editor writes. Other elements, e.g. `<div>` or `<span>`, become their contents.
 * The Markdown has no HTML, also not for other apps: Elements like `<script>` and `<style>` are removed,
 * links and images only with safe URLs, and `<` in the text is escaped.
 * The width of an image is an attribute, as in Pandoc: `![alt](src){width=200}`
 * @see `convertMarkdownToHTML()` reads it back.
 */
export class MarkdownWriter {
  protected readonly boldMarker: string = "**";
  protected readonly italicMarker: string = "*";
  protected readonly strikeMarker: string = "~~";
  /** Markdown has no underline */
  protected readonly underlineMarker: string = "";
  /** Between the lines of a paragraph */
  protected readonly lineBreak: string = "\\\n";

  write(html: string): string {
    let body = new DOMParser().parseFromString(html, "text/html").body;
    return this.blocks(body);
  }

  /** @returns the blocks in `parent`, separated by an empty line */
  protected blocks(parent: Node): string {
    let blocks: string[] = [];
    let inline = "";
    for (let node of parent.childNodes) {
      let block = this.block(node);
      if (block == null) {
        inline += this.inline(node);
        continue;
      }
      blocks.push(this.lines(inline), block);
      inline = "";
    }
    blocks.push(this.lines(inline));
    return blocks.filter(block => block).join("\n\n");
  }

  /** @returns null, if `node` is not a block */
  protected block(node: Node): string | null {
    let name = node.nodeName;
    if (name == "P") {
      return this.lines(this.inlines(node));
    } else if (name.length == 2 && name[0] == "H" && "123456".includes(name[1])) {
      return this.heading(Number(name[1]), this.lines(this.inlines(node)));
    } else if (name == "UL" || name == "OL") {
      let number = parseInt((node as Element).getAttribute("start")) || 1;
      let items: string[] = [];
      for (let item of (node as Element).children) {
        let marker = name == "OL" ? `${number++}. ` : "* ";
        let indent = " ".repeat(marker.length);
        let lines = this.blocks(item).split("\n");
        items.push(marker + lines.map((line, i) => i && line ? indent + line : line).join("\n"));
      }
      return items.join("\n");
    } else if (name == "BLOCKQUOTE") {
      return this.quote(this.blocks(node));
    } else if (name == "PRE") {
      let code = node.textContent;
      if (code.endsWith("\n")) {
        code = code.slice(0, -1);
      }
      let language = [...(node as Element).querySelector("code")?.classList ?? []]
        .find(cssClass => cssClass.startsWith("language-"))?.substring("language-".length) ?? "";
      return this.codeBlock(code, language);
    } else if (name == "HR") {
      return "---";
    } else if (["DIV", "FOOTER", "HEADER", "SECTION", "ARTICLE", "MAIN", "NAV", "ASIDE", "ADDRESS", "CENTER",
      "FIGURE", "FIGCAPTION", "TABLE", "CAPTION", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH", "DL", "DT", "DD",
      "DETAILS", "SUMMARY", "FORM", "FIELDSET"].includes(name)) {
      return this.blocks(node);
    }
    return null;
  }

  protected quote(text: string): string {
    return text.split("\n").map(line => line ? "> " + line : ">").join("\n");
  }

  protected heading(level: number, text: string): string {
    return "#".repeat(level) + " " + text;
  }

  protected codeBlock(code: string, language: string): string {
    let fence = "```";
    while (code.includes(fence)) {
      fence += "`";
    }
    return fence + language + "\n" + code + "\n" + fence;
  }

  protected inlines(parent: Node): string {
    let text = "";
    for (let node of parent.childNodes) {
      text += this.inline(node);
    }
    return text;
  }

  /** @returns "\n" for line breaks. @see `lines()` */
  protected inline(node: Node): string {
    let name = node.nodeName;
    if (name == "#text") {
      return this.text(this.spaces(node.textContent));
    } else if (!(node instanceof Element) || ["SCRIPT", "STYLE", "TEMPLATE", "TITLE", "IFRAME", "OBJECT", "EMBED", "svg", "math"].includes(name)) {
      return "";
    } else if (name == "BR") {
      return "\n";
    } else if (name == "STRONG" || name == "B") {
      return this.emphasis(this.boldMarker, this.inlines(node));
    } else if (name == "EM" || name == "I") {
      return this.emphasis(this.italicMarker, this.inlines(node));
    } else if (name == "S" || name == "DEL" || name == "STRIKE") {
      return this.emphasis(this.strikeMarker, this.inlines(node));
    } else if (name == "U") {
      return this.emphasis(this.underlineMarker, this.inlines(node));
    } else if (name == "CODE") {
      return this.code(node.textContent.replaceAll("\n", " "));
    } else if (name == "A") {
      return this.link(node);
    } else if (name == "IMG") {
      return this.image(node);
    }
    return this.inlines(node);
  }

  /** Puts the spaces outside of the markers, because Markdown ignores `** bold**` */
  protected emphasis(marker: string, content: string): string {
    let text = content.trim();
    if (!text) {
      return content;
    }
    let start = content.indexOf(text);
    return content.substring(0, start) + marker + text + marker + content.substring(start + text.length);
  }

  /** Like HTML shows it: line breaks and other white space as one space */
  protected spaces(text: string): string {
    let result = "";
    for (let char of text) {
      if (!" \n\t\r".includes(char)) {
        result += char;
      } else if (!result.endsWith(" ")) {
        result += " ";
      }
    }
    return result;
  }

  protected text(text: string): string {
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

  protected code(code: string): string {
    let fence = "`";
    while (code.includes(fence)) {
      fence += "`";
    }
    let padding = code.startsWith("`") || code.endsWith("`") ? " " : "";
    return fence + padding + code + padding + fence;
  }

  /** Only http, https and mailto, so that there's no `javascript:` link */
  protected link(link: Element): string {
    let url = sanitize.url(link.getAttribute("href"), null, ["https", "http", "mailto"]);
    return url ? "[" + this.inlines(link) + "](" + this.url(url, link.getAttribute("title")) + ")" : this.inlines(link);
  }

  /** With the width that the user gave the image in our editor */
  protected image(image: Element): string {
    let src = sanitize.url(image.getAttribute("src"), null, ["https", "http", "data"]);
    if (!src) {
      return "";
    }
    let style = image.ownerDocument.createElement("div").style;
    style.cssText = image.getAttribute("containerstyle") ?? "";
    let width = parseInt(image.getAttribute("width")) || (style.width.endsWith("px") ? parseInt(style.width) : 0);
    return "![" + this.text(image.getAttribute("alt") ?? "") + "](" + this.url(src, image.getAttribute("title")) + ")" +
      (width ? `{width=${width}}` : "");
  }

  protected url(url: string, title: string | null): string {
    if (url.includes(" ") || url.includes(")")) {
      url = "<" + url + ">";
    }
    return title ? url + ' "' + title.replaceAll('"', '\\"') + '"' : url;
  }

  /** Turns the line breaks from `inline()` into `lineBreak` */
  protected lines(inline: string): string {
    return inline.trim().split("\n").map(line => line.trim()).join(this.lineBreak);
  }
}
