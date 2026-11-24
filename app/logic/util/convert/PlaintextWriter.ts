import { MarkdownWriter } from "./MarkdownWriter";

/** Marks a quoted line for `flowed()`. `text()` removes it from the text of the HTML. */
const kQuote = "\u0001";

/**
 * Writes HTML as plaintext, e.g. for the text part of an email, with the conventions of plaintext emails:
 * `*bold*`, `/italic/`, `_underline_`, `>` before quotes, `-- ` before the signature, and links as `text <URL>`.
 * Without images. Long lines are wrapped as format=flowed @see `flowed()`
 */
export class PlaintextWriter extends MarkdownWriter {
  protected readonly boldMarker = "*";
  protected readonly italicMarker = "/";
  protected readonly underlineMarker = "_";
  protected readonly lineBreak = "\n";

  write(html: string): string {
    return super.write(html).split("\n").map(line => this.flowed(line)).join("\n");
  }

  /** As RFC 3676 format=flowed asks: Lines longer than 78 characters wrapped at spaces into lines of 72,
   * with the space at the end. Quotes as `>>`. A space before a line that starts with a space, `>` or `From `.
   * @see `unwrapFormatFlowed()` reads it back */
  protected flowed(line: string): string {
    let depth = 0;
    while (line[depth] == kQuote) {
      depth++;
    }
    let prefix = depth ? ">".repeat(depth) + " " : "";
    let text = line.substring(depth);
    if (text == "-- ") {
      return prefix + text;
    }
    text = text.trimEnd();
    if (!text) {
      return prefix.trimEnd();
    }
    let lines: string[] = [];
    let maxLength = 72 - prefix.length;
    while (prefix.length + text.length > 78) {
      let space = text.lastIndexOf(" ", maxLength - 1);
      if (space <= 0) {
        space = text.indexOf(" ", maxLength); // A long word, e.g. a URL
      }
      if (space < 0) {
        break;
      }
      lines.push(text.substring(0, space + 1));
      text = text.substring(space + 1);
    }
    lines.push(text);
    return lines.map(part => prefix +
      (!depth && (part.startsWith(" ") || part.startsWith(">") || part.startsWith("From ")) ? " " : "") + part)
      .join("\n");
  }

  protected quote(text: string): string {
    return text.split("\n").map(line => kQuote + line).join("\n");
  }

  protected block(node: Node): string | null {
    if (node instanceof Element && node.nodeName == "FOOTER" && node.classList.contains("signature")) {
      // A line per paragraph
      return "-- \n" + this.blocks(node).replaceAll("\n\n", "\n");
    }
    return super.block(node);
  }

  protected heading(level: number, text: string): string {
    return this.emphasis(this.boldMarker, text);
  }

  protected codeBlock(code: string, language: string): string {
    return code;
  }

  protected text(text: string): string {
    return text.replaceAll(kQuote, "");
  }

  protected code(code: string): string {
    return code;
  }

  /** Without `*bold*` etc., because the URL follows */
  protected link(link: Element): string {
    let text = this.spaces(link.textContent);
    let trimmed = text.trim();
    let url = link.getAttribute("href") ?? "";
    if (!trimmed || !url || trimmed == url || "mailto:" + trimmed == url) {
      return text;
    }
    return text.replace(trimmed, trimmed + " <" + url + ">");
  }

  protected image(image: Element): string {
    return "";
  }
}
