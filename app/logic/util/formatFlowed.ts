import { assert } from "./util";

/**
 * Implements format=flowed (RFC 2646, RFC 3676),
 * and converts HTML to format=flowed.
 *
 * @param html
 * @param inlineHTMLToTextConverter Function to run for each paragraph.
 *   @param inline {DOM} The part within block-level elements,
 *     like `<p>`, <div>`, `<br>`.
 *   @returns plain text,
 *     possibly with markdown or other plaintext formatting,
 *     but without line breaks.
 * @param emptyLineAfterP {boolean} (optional, default false)
 *     Emit an empty line in the plaintext after each `<p>`
 * @returns format=flowed
 */
export function convertHTMLToFormatFlowed(html: string,
  inlineHTMLToTextConverter: ((inline: any) => string) | null,
  emptyLineAfterP = false,
): string {
  let options: ToTextOptions = {
    inlineHTMLToTextConverter,
    emptyLineAfterP,
  };
  let doc = new DOMParser().parseFromString(html, "text/html");
  let htmlE = doc.documentElement;
  return processHTMLElement(htmlE, 0, options);
}

function processHTMLElement(currentE: HTMLElement | null, quoteLevel: number, options: ToTextOptions): string {
  if (!currentE) {
    return "";
  }
  let tag = currentE.nodeName.toLowerCase();
  // console.log("processing <" + tag + ">");
  if (tag == "html") {
    return processHTMLElement(currentE.querySelector("body"), quoteLevel, options);
  }
  if (tag == "b" || tag == "strong") {
    return "**" + processChildNodes(currentE, quoteLevel, options) + "**";
  }
  if (tag == "i" || tag == "em") {
    return "*" + processChildNodes(currentE, quoteLevel, options) + "*";
  }
  if (tag == "footer") {
    return "-- \n" + processChildNodes(currentE, quoteLevel, options);
  }
  if (tag == "p") {
    let previousTag = currentE.previousElementSibling?.nodeName?.toLowerCase();
    let prefixLine = options.emptyLineAfterP && (previousTag == "p" || previousTag == "blockquote");
    // let nextTag = currentE.nextElementSibling?.nodeName?.toLowerCase();
    // let suffixLine = false && options.emptyLineAfterP && nextTag != "p" && nextTag != "blockquote";
    let emptyLine = getQuotePrefix(quoteLevel).trimEnd() + "\n";
    return (prefixLine ? emptyLine : "") +
      processChildNodes(currentE, quoteLevel, options);
  }
  if (tag == "blockquote") {
    quoteLevel++;
  }
  return processChildNodes(currentE, quoteLevel, options);
}

function processTextNode(node: Node, quoteLevel: number, options: ToTextOptions): string {
  if (!node || node.textContent?.trim() == "") {
    return "";
  }
  // console.log("processing text node -" + node.textContent + "-");
  let text: string;
  if (false && options.inlineHTMLToTextConverter) {
    text = options.inlineHTMLToTextConverter(node);
  } else {
    text = node.textContent?.replaceAll("\n", "") ?? "";
  }

  // Line breaks
  let lines: string[] = [];
  const kMaxLineLength = 75;
  let maxLength = kMaxLineLength - quoteLevel - (quoteLevel ? 1 : 0);
  while (text.length > maxLength) {
    let spacePos = text.lastIndexOf(" ", maxLength);
    if (spacePos == -1) {
      spacePos = text.indexOf(" ");
    }
    if (spacePos == -1) {
      break;
    }
    let line = text.slice(0, spacePos + 1); // ends with space = flowed line
    lines.push(line);
    text = text.slice(spacePos + 1);
  }
  lines.push(text.trimEnd()); // does not end with space = paragraph end

  // Space stuffing of "From"
  if (!quoteLevel) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("From")) {
        lines[i] = " " + lines[i];
      }
    }
  }

  let quotePrefix = getQuotePrefix(quoteLevel);
  // console.log("text " + quotePrefix + lines.join("\n" + quotePrefix));
  return quotePrefix + lines.join("\n" + quotePrefix) + "\n";
}

function processChildNodes(node: Node, quoteLevel: number, options: ToTextOptions): string {
  let text = "";
  for (let child of node.childNodes) {
    if (child.nodeType == child.ELEMENT_NODE) {
      text += processHTMLElement(child as HTMLElement, quoteLevel, options);
    } else if (child.nodeType == child.TEXT_NODE) {
      text += processTextNode(child, quoteLevel, options);
    }
  }
  return text;
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


type ToTextOptions = {
  inlineHTMLToTextConverter: ((inline: any) => string) | null,
  emptyLineAfterP: boolean,
};

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
