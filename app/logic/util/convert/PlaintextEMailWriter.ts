import { MarkdownWriter } from "./MarkdownWriter";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

/**
 * Writes HTML as plaintext for emails: Markdown with the conventions of plaintext emails:
 * `*bold*`, `/italic/`, `_underline_`, `-- ` before the signature, and links as `text <URL>`. Without images.
 * Without escaping, because people read it.
 */
export class PlaintextEMailWriter extends MarkdownWriter {
  protected readonly boldMarker = "*";
  protected readonly italicMarker = "/";
  protected readonly underlineMarker = "_";
  protected readonly lineBreak = "\n";

  protected escape(text: string): string {
    return text;
  }

  /** A line per paragraph: Our editor writes each line of a signature, e.g. the name and the phone number,
   * as a paragraph, and in plaintext a signature has no empty lines */
  protected signature(content: string): string {
    return "-- \n" + content.replaceAll("\n\n", "\n");
  }

  /** Without `*bold*` etc., because the URL follows. Only http, https and mailto URLs. */
  protected link(content: string, link: HTMLElement): string {
    let text = link.textContent;
    let trimmed = text.trim();
    let url = sanitize.url(link.getAttribute("href"), null, ["https", "http", "mailto"]);
    if (!trimmed || !url || trimmed == url || "mailto:" + trimmed == url) {
      return text;
    }
    return text.replace(trimmed, trimmed + " <" + url + ">");
  }

  protected image(image: HTMLElement): string {
    return "";
  }
}
