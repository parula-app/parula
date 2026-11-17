import type { MailIdentity } from "../../../logic/Mail/MailIdentity";
import type { SMIMEPrivateKey } from "../../../logic/Mail/Encryption/SMIME/SMIMEPrivateKey";
import { saveBlobAsFile } from "../../../frontend/Util/util";
import { UserError } from "../../../logic/util/util";
import { gt } from "../../../l10n/l10n";

export class CertificateRequest {
  name = "";
  emailAddress = "";
  organization = "";
  department = "";
  city = "";
  state = "";
  country = "";

  static forIdentity(identity: MailIdentity, locale = navigator.language): CertificateRequest {
    let request = new CertificateRequest();
    request.name = identity?.realname ?? "";
    request.emailAddress = identity?.emailAddress ?? "";
    try {
      request.country = new Intl.Locale(locale).region ?? "";
    } catch (ex) {
      request.country = "";
    }
    return request;
  }

  get subject(): Record<string, string> {
    let subject: Record<string, string> = {
      E: this.emailAddress.trim(),
      CN: this.name.trim(),
      O: this.organization.trim(),
      OU: this.department.trim(),
      L: this.city.trim(),
      ST: this.state.trim(),
      C: this.country.trim().toUpperCase(),
    };
    for (let field in subject) {
      if (!subject[field]) {
        delete subject[field];
      }
    }
    return subject;
  }

  validate() {
    if (!this.name.trim()) {
      throw new UserError(gt`Please enter your name for the certificate`);
    }
    if (!this.emailAddress.trim()) {
      throw new UserError(gt`The certificate needs an e-mail address`);
    }
    if (this.country.trim() && !/^[A-Za-z]{2}$/.test(this.country.trim())) {
      throw new UserError(gt`Please enter the country or region as a code with 2 letters, e.g. DE or US`);
    }
  }

  async save(key: SMIMEPrivateKey) {
    this.validate();
    // <copied from="../../../frontend/Settings/Mail/Account/EncryptionKey.svelte" onExportCSR()>
    await saveBlobAsFile(await key.generateCSRFile(this.subject));
    // </copied>
  }
}
