import { MarkdownWriter } from "./MarkdownWriter";

/**
 * Writes HTML as plaintext, e.g. for the text part of an email, with the conventions of plaintext emails:
 * `*bold*`, `/italic/`, `_underline_`, `> ` before quotes, `-- ` before the signature, and links as `text <URL>`.
 * Without images.
 */
export class PlaintextWriter extends MarkdownWriter {
  protected readonly boldMarker = "*";
  protected readonly italicMarker = "/";
  protected readonly underlineMarker = "_";
  protected readonly lineBreak = "\n";

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
    return text;
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
