import { PlaintextEMailWriter } from "./PlaintextEMailWriter";

/** Plaintext for emails, with the long lines wrapped as format=flowed @see `lineEnds()` */
export class FormatFlowedWriter extends PlaintextEMailWriter {
  /** `lineEnds()` wraps the lines instead, with a space at the end */
  protected wrap(content: string, block: HTMLElement): string {
    return content;
  }

  /** As RFC 3676 format=flowed asks: Lines longer than 78 characters wrapped at spaces into lines of 72,
   * with the space at the end. A space before a line that starts with a space, `>` or `From `.
   * @see `unwrap()` reads it back */
  protected lineEnds(text: string): string {
    let lines: string[] = [];
    for (let line of text.split("\n")) {
      let depth = 0;
      while (line[depth] == ">") {
        depth++;
      }
      let prefix = depth ? ">".repeat(depth) + " " : "";
      let content = line.substring(depth);
      if (depth && content.startsWith(" ")) {
        content = content.substring(1);
      }
      if (content != "-- ") {
        content = content.trimEnd();
      }
      let parts: string[] = [];
      let maxLength = 72 - prefix.length;
      while (prefix.length + content.length > 78) {
        let space = content.lastIndexOf(" ", maxLength - 1);
        if (space <= 0) {
          space = content.indexOf(" ", maxLength); // A long word, e.g. a URL
        }
        if (space < 0) {
          break;
        }
        parts.push(content.substring(0, space + 1));
        content = content.substring(space + 1);
      }
      parts.push(content);
      for (let part of parts) {
        let isStuffed = !depth && (part.startsWith(" ") || part.startsWith(">") || part.startsWith("From "));
        lines.push(part ? prefix + (isStuffed ? " " : "") + part : prefix.trimEnd());
      }
    }
    return lines.join("\n");
  }

  /** Joins the lines that format=flowed (RFC 3676) wrapped, and removes the space-stuffing.
   * Quotes stay as `> ` and `>> `. */
  static unwrap(text: string): string {
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
}
