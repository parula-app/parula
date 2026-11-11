import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { UserError } from "../util/util";
import { gt } from "../../l10n/l10n";

export class OAuth2Error extends Error {
  authFail = true;
  isUserError = true;
}

export class OAuth2LoginNeeded extends UserError {
  authFail = true;
  constructor() {
    super(gt`Please login`);
  }
}

export class OAuth2ServerError extends OAuth2Error {
  code: string;
  codes: number[];
  details: any;
  consentRequired = false;
  adminPolicy = false;
  constructor(prefix: string, json: any) {
    let msg = prefix + ": " +
      sanitize.nonemptystring(json?.error_description, null)?.split(/[\r\n]/)[0].replace(/^\w+: /, "")
      ?? sanitize.nonemptystring(json?.error, null)?.replace("_", " ")
      ?? "Login failed. Unknown OAuth2 error.";
    super(msg);
    if (json.error == "access_denied") {
      this.consentRequired = true;
    }
    // Google
    if (json.error == "admin_policy_enforced") {
      this.adminPolicy = true;
    }
    // Microsoft
    const kErrorConsentRequiredEWS = 65001;
    const kErrorAdminPolicy = 90094;
    const kErrorRedirectURLWrong = 700009;
    // When handling auth code grant errors,
    // the code may only be available in the description string.
    if (!Array.isArray(json.error_codes) && /^AADSTS(\d+):/.test(json.error_description)) {
      json.error_codes = [+RegExp.$1];
    }
    if (json.error_codes?.includes(kErrorConsentRequiredEWS)) {
      this.consentRequired = true;
    }
    if (json.error_codes?.includes(kErrorAdminPolicy)) {
      this.adminPolicy = true;
    }
    if (json.error_codes?.includes(kErrorRedirectURLWrong)) {
      this.message = "Microsoft OAuth2: Redirect URL is wrong";
    }
    this.code = json.error;
    this.codes = json.error_codes;
    this.details = json;
    console.log("OAuth2 error", this, json);
  }
}
