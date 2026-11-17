import { MailIdentity } from "../MailIdentity";
import type { JMAPAccount } from "./JMAPAccount";
import type { TJMAPIdentity, TJMAPEmailAddress } from "./TJMAPMail";
import type { TJMAPChangeResponse, TID } from "./TJMAPGeneric";
import { checkChangeError } from "./JMAPError";
import { convertHTMLToText, convertTextToHTML } from "../../util/convertHTML";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

/** <https://www.rfc-editor.org/rfc/rfc8621.html#section-6> */
export class JMAPIdentity extends MailIdentity {
  declare readonly account: JMAPAccount;
  /** ID in JMAP (`.id` is the ID in our config) */
  declare pID: TID;
  /** As it is on the server. null = not on the server */
  original: TJMAPIdentity | null = null;

  get canDelete(): boolean {
    return this.original?.mayDelete ?? true;
  }

  isSameAs(jmap: TJMAPIdentity): boolean {
    return this.pID
      ? this.pID == jmap.id
      // Created by the setup, before we ever talked to the server
      : this.emailAddress?.toLowerCase() == jmap.email?.toLowerCase();
  }

  fromJMAP(jmap: TJMAPIdentity) {
    this.pID = sanitize.nonemptystring(jmap.id);
    this.setEMailAddress(sanitize.nonemptystring(jmap.email));
    this.realname = sanitize.nonemptylabel(jmap.name, this.realname);
    this.replyTo = sanitize.emailAddress(jmap.replyTo?.[0]?.email, null);
    this.sendBCC.replaceAll(sanitize.array(jmap.bcc, [])
      .map(person => sanitize.emailAddress(person?.email, null))
      .filter(Boolean));
    this.signatureHTML = sanitize.nonemptystring(jmap.htmlSignature, null) ??
      (jmap.textSignature
       ? convertTextToHTML(sanitize.nonemptystring(jmap.textSignature, null))
       : null);
    this.original = jmap;
  }

  toJMAP(): Partial<TJMAPIdentity> {
    return {
      name: this.realname ?? "",
      replyTo: this.replyTo
        ? this.toJMAPAddresses([ this.replyTo ], this.original?.replyTo)
        : null,
      bcc: this.sendBCC.hasItems
        ? this.toJMAPAddresses(this.sendBCC.contents, this.original?.bcc)
        : null,
      htmlSignature: this.signatureHTML,
      textSignature: this.signatureHTML ? convertHTMLToText(this.signatureHTML) : null,
    };
  }

  /** We keep only the email address of these persons, so preserve
   * the names that the server has for them. */
  protected toJMAPAddresses(emailAddresses: string[], original: TJMAPEmailAddress[]): TJMAPEmailAddress[] {
    return emailAddresses.map(emailAddress => ({
      name: original?.find(person => person.email == emailAddress)?.name ?? null,
      email: emailAddress,
    }));
  }

  async saveToServer() {
    // The email address is immutable in JMAP, so an identity whose address the user
    // changed is created anew, and the old one deleted only after that succeeded.
    let obsoleteID = this.original && this.original.email != this.emailAddress
      ? this.original.id
      : null;
    let isNew = obsoleteID || !this.pID;
    if (isNew && this.isCatchAll) {
      // Neither Stalwart nor Cyrus let us create a catch-all identity, so keept it local only.
      // Only the server itself may offer one. @see RFC 8621 Section 6
      this.pID = null;
      this.original = null;
      return;
    }
    let jmap = this.toJMAP();
    if (isNew) {
      jmap.email = this.emailAddress;
    }

    let response = await this.account.makeSingleCall("Identity/set", {
      accountId: this.account.accountID,
      [isNew ? "create" : "update"]: {
        [isNew ? this.id : this.pID]: jmap,
      },
    }) as TJMAPChangeResponse<TJMAPIdentity>;
    checkChangeError(response);

    if (isNew) {
      this.pID = sanitize.nonemptystring(response.created[this.id].id);
    }
    this.original = { ...jmap, id: this.pID, email: this.emailAddress } as TJMAPIdentity;
    if (obsoleteID) {
      await this.destroyOnServer(obsoleteID);
    }
  }

  async deleteFromServer() {
    if (!this.pID) { // never saved to the server
      return;
    }
    await this.destroyOnServer(this.pID);
    this.pID = null;
    this.original = null;
  }

  protected async destroyOnServer(pID: TID) {
    let response = await this.account.makeSingleCall("Identity/set", {
      accountId: this.account.accountID,
      destroy: [pID],
    }) as TJMAPChangeResponse<TJMAPIdentity>;
    checkChangeError(response);
  }
}
