import { SMLProcessor } from "./SMLProcessor";
import type { EMail } from "../EMail";
import { fetchJSON, getBaseDomainFromURL, getDomainForEmailAddress } from "../../util/netUtil";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";

/**
 * Automatically answers registration email confirmations for the SML HTTP server.
 * Only if the server is ours or the email hoster itself.
 */
export abstract class RegisterSMLProcessor extends SMLProcessor {
  types = ["EMailRegisterAction"];
  context = "https://sml.mustang.im";
  async processSML(email: EMail, sml: any): Promise<void> {
    assert(sml.object?.["@type"] == "Account", "Not an account registration");
    let emailAddress = sanitize.emailAddress(sml.object.emailAddress);
    assert(email.to.first.emailAddress == emailAddress, "EMail address in SML registration and in To: does not match");
    let identity = email.folder.account.findIdentityForEMailAddress(emailAddress);
    assert(identity, "EMail address in registration does not match the email account");
    let smlAccount = identity.smlAccount;
    if (!smlAccount) { // we never asked for this registration
      return;
    }

    let confirmURL = sanitize.url(sml.target);
    let emailDomain = getDomainForEmailAddress(emailAddress);
    let domain = getBaseDomainFromURL(confirmURL);
    // Make sure that it's a trusted domain before confirming: Either our server or the email hoster
    if (!(domain == emailDomain || trustedDomains.includes(domain))) {
      return;
    }
    let oAuth2Response = await fetchJSON(confirmURL);
    smlAccount.setAccessToken(sanitize.nonemptystring(oAuth2Response.access_token));
    await smlAccount.save();
    await email.deleteMessage();
  };
}

// Fallback servers, when ISP doesn't offer the server
const trustedDomains = ["mustang.im", "beonex.com", "parula.app"];
