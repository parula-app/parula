import type { MailIdentity } from "../../../logic/Mail/MailIdentity";

export class SignatureEdits {
  readonly edits: Record<string, string> = {};
  protected readonly identities = new Map<string, MailIdentity>();

  start(identity: MailIdentity | null) {
    if (!identity || this.identities.has(identity.id)) {
      return;
    }
    this.identities.set(identity.id, identity);
    this.edits[identity.id] = identity.signatureHTML ?? "";
  }

  isChanged(identity: MailIdentity | null): boolean {
    if (!identity || !this.identities.has(identity.id)) {
      return false;
    }
    return SignatureEdits.normalized(this.edits[identity.id]) != SignatureEdits.normalized(identity.signatureHTML);
  }

  async save(identity: MailIdentity | null) {
    if (!this.isChanged(identity)) {
      return;
    }
    identity.signatureHTML = SignatureEdits.normalized(this.edits[identity.id]) || null;
    await identity.save();
    this.edits[identity.id] = identity.signatureHTML ?? "";
  }

  async saveAll() {
    for (let identity of this.identities.values()) {
      await this.save(identity);
    }
  }

  static hasText(html: string | null): boolean {
    if (!html) {
      return false;
    }
    let doc = new DOMParser().parseFromString(html, "text/html");
    return !!doc.body.textContent?.trim() || !!doc.body.querySelector("img, hr");
  }

  static normalized(html: string | null): string {
    return SignatureEdits.hasText(html) ? html.trim() : "";
  }
}
