/** The HTML body of an email that the user writes: our signature, the quote and the user's text */
export class MailBody {
  /** Keep in sync with content.css */
  static readonly kSignatureSelector = "footer.signature, .moz-signature, .gmail_signature";
  protected readonly doc: Document;

  constructor(html: string | null) {
    this.doc = new DOMParser().parseFromString(html ?? "", "text/html");
  }

  get html(): string {
    return this.doc.head.childElementCount
      ? this.doc.documentElement.outerHTML
      : this.doc.body.innerHTML;
  }

  /** The signature of the From identity, while composing.
   * Only on the top level, so not the signatures of forwarded mails. */
  get ownSignature(): Element | null {
    return this.topLevel.find(e => e.hasAttribute("data-own-signature")) ?? null;
  }

  /** No text and no image, e.g. `<p></p>` from the editor */
  get isEmpty(): boolean {
    return !this.doc.body.textContent.trim() && !this.doc.body.querySelector("img");
  }

  protected get topLevel(): Element[] {
    return Array.from(this.doc.body.children);
  }

  /**
   * Replaces our signature. If there is none yet, adds it between the user's text
   * and the quote or forwarded mail, or at the end.
   * @param forEditing Adds an empty line before a signature at the end, for the user to type in
   * @returns false, if nothing changed
   */
  setOwnSignature(signatureHTML: string | null, forEditing = true): boolean {
    let footerE = this.newOwnSignature(signatureHTML);
    let existing = this.ownSignature;
    if (!footerE.textContent.trim() && !footerE.querySelector("img")) {
      existing?.remove();
      return !!existing;
    }
    if (existing?.isEqualNode(footerE)) {
      return false;
    }
    if (existing) {
      existing.replaceWith(footerE);
      return true;
    }
    let quoteStartE = this.topLevel.find(e => e.matches("blockquote, hr, .quote-header"));
    // The editor drops the class of the quote header
    let previousE = quoteStartE?.previousElementSibling;
    if (quoteStartE?.tagName == "BLOCKQUOTE" && previousE?.tagName == "P" && previousE.textContent.trim()) {
      quoteStartE = previousE;
    }
    if (quoteStartE?.previousElementSibling) {
      quoteStartE.before(footerE);
      return true;
    }
    let lastE = this.doc.body.lastElementChild;
    let endsWithEmptyLine = lastE?.tagName == "P" && !lastE.textContent.trim() && !lastE.querySelector("img");
    if (forEditing && !endsWithEmptyLine) {
      this.doc.body.append(this.doc.createElement("p"));
    }
    this.doc.body.append(footerE);
    return true;
  }

  /** Whether our signature is this one, e.g. the one that the user picked.
   * The editor may change the HTML, so this compares the text. */
  isOwnSignature(signatureHTML: string | null): boolean {
    let ownE = this.ownSignature;
    return !!ownE && this.normalizedText(ownE) == this.normalizedText(this.newOwnSignature(signatureHTML));
  }

  protected newOwnSignature(signatureHTML: string | null): Element {
    let footerE = this.doc.createElement("footer");
    footerE.className = "signature";
    footerE.setAttribute("data-own-signature", "");
    footerE.innerHTML = signatureHTML ?? "";
    this.removeSeparatorLine(footerE);
    return footerE;
  }

  /** The plaintext version already starts the signature with `-- ` */
  protected removeSeparatorLine(signatureE: Element) {
    let firstNode = (parent: Node) => Array.from(parent.childNodes)
      .find(node => node.nodeType != Node.TEXT_NODE || node.textContent.trim());
    let first = firstNode(signatureE);
    if (first?.nodeName == "P" || first?.nodeName == "DIV") {
      if (first.textContent.trim() == "--") {
        first.remove();
        return;
      }
      first = firstNode(first);
    }
    if (first?.nodeType == Node.TEXT_NODE && first.textContent.trim() == "--" &&
        first.nextSibling?.nodeName == "BR") {
      first.nextSibling.remove();
      first.remove();
    }
  }

  removeSignatures() {
    for (let signatureE of this.doc.querySelectorAll(MailBody.kSignatureSelector)) {
      signatureE.remove();
    }
  }

  /** Whether the user wrote something, apart from the quote and the signatures.
   * E.g. to close the composer without asking to save. */
  get hasUserText(): boolean {
    let bodyE = this.doc.body.cloneNode(true) as Element;
    for (let notUserE of bodyE.querySelectorAll("blockquote, " + MailBody.kSignatureSelector)) {
      notUserE.remove();
    }
    let text = bodyE.textContent.replace(/\s+/g, "");
    return text.length >= 100; // Ignore attribution line before quote. TODO Match more precisely
  }

  /** Removes the marker of our signature, and adds `appendHTML` to the signature */
  prepareForSending(appendHTML: string | null) {
    let signatureE = this.ownSignature;
    for (let markedE of this.doc.querySelectorAll("[data-own-signature]")) {
      markedE.removeAttribute("data-own-signature");
    }
    if (appendHTML && !this.signatureEndsWith(appendHTML)) {
      if (!signatureE) {
        signatureE = this.doc.createElement("footer");
        signatureE.className = "signature";
        this.doc.body.append(signatureE);
      }
      signatureE.insertAdjacentHTML("beforeend", appendHTML);
    }
  }

  /** E.g. when sending again after an error */
  protected signatureEndsWith(html: string): boolean {
    let appendE = this.doc.createElement("div");
    appendE.innerHTML = html;
    let text = this.normalizedText(appendE);
    return this.topLevel.some(e => e.matches(MailBody.kSignatureSelector) &&
      this.normalizedText(e.lastElementChild) == text);
  }

  protected normalizedText(e: Element | null): string {
    return e?.textContent.replace(/\s+/g, " ").trim() ?? "";
  }

  /** The start of the text in one line, with " · " between the lines,
   * e.g. to show a signature in a menu */
  get textLine(): string {
    const kMaxLength = 60;
    let bodyE = this.doc.body.cloneNode(true) as Element;
    for (let lineE of bodyE.querySelectorAll("p, div, li, br, h1, h2, h3, h4, h5, h6, tr")) {
      lineE.after("\u2029");
    }
    let text = bodyE.textContent.split("\u2029")
      .map(line => line.replace(/\s+/g, " ").trim())
      .filter(line => line)
      .join(" · ");
    return text.length > kMaxLength ? text.slice(0, kMaxLength - 1).trimEnd() + "…" : text;
  }
}
