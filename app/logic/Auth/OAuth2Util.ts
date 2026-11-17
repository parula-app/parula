import type { WebBasedAuth } from "./WebBasedAuth";
import { OAuth2URLs, type Provider } from "./OAuth2URLs";
import { OAuth2 } from "./OAuth2";
import { OWAAuth } from "./OWAAuth";
import type { Account } from "../Abstract/Account";
import type { TCPAccount } from "../Abstract/TCPAccount";
import type { OWAAccount } from "../Mail/OWA/OWAAccount";

export function getOAuth2BuiltIn(config: Account): WebBasedAuth | undefined {
  if (config.protocol == "owa") {
    return new OWAAuth(config as OWAAccount);
  }
  let o = findOAuth2URLs(config);
  if (!o) {
    return null;
  }
  let oAuth2 = new OAuth2(config, o.tokenURL, o.authURL, o.authDoneURL, o.scope, o.clientID, o.clientSecret, o.doPKCE);
  oAuth2.setTokenURLPasswordAuth(o.tokenURLPasswordAuth);
  return oAuth2;
}

/** Which company runs the server of this account, if we know them. */
export function getProvider(config: Account): Provider | null {
  return findOAuth2URLs(config)?.provider ?? null;
}

function findOAuth2URLs(config: Account) {
  let hostname = (config as TCPAccount).hostname ??
    (config.url ? new URL(config.url).hostname : null);
  return OAuth2URLs.find(o => o.hostnames.some(h => h == hostname));
}
