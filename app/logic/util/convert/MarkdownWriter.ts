import TurndownService from "turndown";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

/**
 * Writes HTML as Markdown with turndown, e.g. for the pages of topics.
 * The Markdown has no HTML, also not for other apps: Elements like `<script>` and `<style>` are removed,
 * links and images only with safe URLs, and `<` in the text is escaped.
 * The width of an image is an attribute, as in Pandoc: `![alt](src){width=200}`
 * @see `convertMarkdownToHTML()` reads it back.
 *
 * Subclasses write other text formats with the same rules, by overriding the markers and functions,
 * e.g. `boldMarker` or `lineEnds()`.
 */
export class MarkdownWriter {
  protected readonly boldMarker: string = "**";
  protected readonly italicMarker: string = "*";
  /** Markdown has no underline */
  protected readonly underlineMarker: string = "";
  /** A line break within a paragraph */
  protected readonly lineBreak: string = "\\\n";
  /** Elements that become their contents. All others are removed, with their contents. */
  protected readonly allowedTags: string[] = ["A", "ABBR", "ADDRESS", "ARTICLE", "ASIDE", "B", "BDI", "BDO", "BIG",
    "BLOCKQUOTE", "BR", "CAPTION", "CENTER", "CITE", "CODE", "DATA", "DD", "DEL", "DETAILS", "DFN", "DIV", "DL", "DT",
    "EM", "FIGCAPTION", "FIGURE", "FONT", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HGROUP", "HR", "I",
    "IMG", "INS", "KBD", "LI", "MAIN", "MARK", "NAV", "OL", "P", "PICTURE", "PRE", "Q", "RP", "RT", "RUBY", "S", "SAMP",
    "SECTION", "SMALL", "SPAN", "STRIKE", "STRONG", "SUB", "SUMMARY", "SUP", "TABLE", "TBODY", "TD", "TFOOT", "TH",
    "THEAD", "TIME", "TR", "TT", "U", "UL", "VAR", "WBR"];
  /** Elements that are always removed, with their contents, also if `allowedTags` has them */
  protected readonly removedTags: string[] = ["SCRIPT", "STYLE", "TEMPLATE", "TITLE", "HEAD", "IFRAME", "OBJECT",
    "EMBED", "svg", "math"];
  protected readonly turndown = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "*",
    codeBlockStyle: "fenced",
  });

  constructor() {
    this.turndown.remove(node => this.removedTags.includes(node.nodeName) || !this.allowedTags.includes(node.nodeName));
    this.turndown.escape = text => this.escape(text);
    this.turndown.addRule("paragraph", {
      filter: "p",
      replacement: (content, paragraph) => "\n\n" + this.wrap(content, paragraph) + "\n\n",
    });
    this.turndown.addRule("lineBreak", {
      filter: "br",
      replacement: (content, br) => br.nextSibling ? this.lineBreak : "", // not at the end of a paragraph
    });
    this.turndown.addRule("strong", {
      filter: ["strong", "b"],
      replacement: content => this.emphasis(this.boldMarker, content),
    });
    this.turndown.addRule("emphasis", {
      filter: ["em", "i"],
      replacement: content => this.emphasis(this.italicMarker, content),
    });
    this.turndown.addRule("underline", {
      filter: "u",
      replacement: content => this.emphasis(this.underlineMarker, content),
    });
    this.turndown.addRule("strikethrough", {
      // A function, because the tag names of TypeScript don't have the deprecated `strike`
      filter: node => ["S", "DEL", "STRIKE"].includes(node.nodeName),
      replacement: content => this.emphasis("~~", content),
    });
    this.turndown.addRule("listItem", {
      filter: "li",
      replacement: (content, item) => {
        let list = item.parentNode as Element;
        let marker = list.nodeName == "OL"
          ? `${(parseInt(list.getAttribute("start")) || 1) + [...list.children].indexOf(item)}. `
          : "* ";
        // Our editor writes `<li><p>`, where `wrap()` wraps the paragraph
        let lines = (item.querySelector("p") ? content : this.wrap(content, item)).trim().split("\n");
        return marker + lines.map((line, i) => i && line ? " ".repeat(marker.length) + line : line).join("\n") +
          (item.nextSibling ? "\n" : "");
      },
    });
    this.turndown.addRule("quote", {
      filter: "blockquote",
      // `>>` for a quote in a quote, as format=flowed needs it
      replacement: content => "\n\n" + content.trim().split("\n")
        .map(line => line.startsWith(">") ? ">" + line : line ? "> " + line : ">").join("\n") + "\n\n",
    });
    this.turndown.addRule("signature", {
      filter: node => node.nodeName == "FOOTER" && node.classList.contains("signature"),
      replacement: content => "\n\n" + this.signature(content.trim()) + "\n\n",
    });
    this.turndown.addRule("link", {
      filter: "a",
      replacement: (content, link) => this.link(content, link),
    });
    this.turndown.addRule("image", {
      filter: "img",
      replacement: (content, image) => this.image(image),
    });
  }

  write(html: string): string {
    return this.lineEnds(this.turndown.turndown(new DOMParser().parseFromString(html, "text/html").body));
  }

  /** Markdown makes the lines of a paragraph one paragraph again, so long lines are wrapped into lines of 72,
   * without the quote markers and the indentation, which the rules of the quote and the list add.
   * Only before a letter, so that a line can't start a list, a heading or a quote. */
  protected wrap(content: string, block: HTMLElement): string {
    let width = 72;
    for (let node = block; node; node = node.parentElement) {
      if (node.nodeName == "BLOCKQUOTE" || node.nodeName == "LI") {
        width -= 2;
      }
    }
    let isBreak = (line: string, space: number) => space > 0 && line[space + 1]?.toLowerCase() != line[space + 1]?.toUpperCase();
    let lines: string[] = [];
    for (let line of content.split("\n")) {
      while (line.length > width) {
        let space = line.lastIndexOf(" ", width);
        while (space > 0 && !isBreak(line, space)) {
          space = line.lastIndexOf(" ", space - 1);
        }
        if (space <= 0) {
          space = line.indexOf(" ", width); // A long word, e.g. a URL
          while (space > 0 && !isBreak(line, space)) {
            space = line.indexOf(" ", space + 1);
          }
        }
        if (space <= 0) {
          break;
        }
        lines.push(line.substring(0, space));
        line = line.substring(space + 1);
      }
      lines.push(line);
    }
    return lines.join("\n");
  }

  /** How the lines end. Markdown keeps them as they are, after `wrap()`. */
  protected lineEnds(text: string): string {
    return text;
  }

  /** `{` would be the attributes of an image before it. markdown-it also has `~~strikethrough~~`. */
  protected escape(text: string): string {
    return TurndownService.prototype.escape(text)
      .replaceAll("<", "\\<").replaceAll("{", "\\{").replaceAll("~~", "\\~\\~");
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

  /** Markdown has no signature, so it's text like the rest */
  protected signature(content: string): string {
    return content;
  }

  /** Only http, https and mailto, so that there's no `javascript:` link */
  protected link(content: string, link: HTMLElement): string {
    let url = sanitize.url(link.getAttribute("href"), null, ["https", "http", "mailto"]);
    return url ? "[" + content + "](" + this.url(url, link.getAttribute("title")) + ")" : content;
  }

  /** With the width that the user gave the image in our editor */
  protected image(image: HTMLElement): string {
    let src = sanitize.url(image.getAttribute("src"), null, ["https", "http", "data"]);
    if (!src) {
      return "";
    }
    let style = image.ownerDocument.createElement("div").style;
    style.cssText = image.getAttribute("containerstyle") ?? "";
    let width = parseInt(image.getAttribute("width")) || (style.width.endsWith("px") ? parseInt(style.width) : 0);
    return "![" + this.escape(image.getAttribute("alt") ?? "") + "](" + this.url(src, image.getAttribute("title")) + ")" +
      (width ? `{width=${width}}` : "");
  }

  protected url(url: string, title: string | null): string {
    if (url.includes(" ") || url.includes(")")) {
      url = "<" + url + ">";
    }
    return title ? url + ' "' + title.replaceAll('"', '\\"') + '"' : url;
  }
}
