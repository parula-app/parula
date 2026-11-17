import { OAuth2UI } from "./OAuth2UI";
import { OpenIDConnect } from "../OpenIDConnect";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import type { OAuth2 } from "../OAuth2";

/**
 * For WebMail only.
 * Unloads our app, loads the OAuth2 login page into the browser instead,
 * and waits for it to redirect the browser back to our app.
 * Execution continues at the startup/login sequence again,
 * this time with credentials.
 */
export class OAuth2Redirect extends OAuth2UI {
  declare oAuth2: OAuth2;
  /** You must call this before calling `oAuth2.login(true)` */
  static load(oAuth2: OAuth2) {
    let emailAddress = sanitize.string(localStorage.getItem("oauth2.webmail.emailAddress"), null);
    oAuth2.account.username = emailAddress ?? "unknown"; // `OAuth2.getRefreshTokenFromStorage()` needs this to be set
    // oAuth2.idToken = sanitize.string(localStorage.getItem("oauth2.webmail.idToken"), null);
    console.log("OAuth2Redirect.load", "account username", oAuth2.account.username, "token hostname", new URL(oAuth2.tokenURL).host);
  }

  /**
   * Does an interactive login.
   * Attention: Unloads the current page!
   * Called indirectly by `OAuth2.login(true)`
   * @returns authCode
   * @throws WaitForRedirect - The page will unload, go to auth page, then the app will be loaded again
   * @throws OAuth2Error
   */
  async login(): Promise<string> {
    console.log("OAuth2Redirect.login", "account username", this.oAuth2.account.username, "token hostname", new URL(this.oAuth2.tokenURL).host);
    this.checkLoop();

    // If we're just coming back from successful OAuth2 authentication, then we're the return page and
    // the OAuth2 server will set the authCode as URL query param
    let query = new URLSearchParams(window.location.search);
    let authCode = query.get("code");
    if (authCode) {
      this.oAuth2.authDoneURL = OAuth2Redirect.appRedirectURL();
      this.oAuth2.codeVerifierPKCE = sanitize.string(localStorage.getItem("oauth2.webmail.pkce"), null);
      localStorage.setItem("oauth2.webmail.pkce", "");
      this.oAuth2.idTokenCallback = idToken => this.processIDToken(idToken);
      OAuth2Redirect.removeURLSearchParams();
      // setTimeout(() => this.confirmLoginSucceeded(), 10000); Safer. But doesn't run at all.
      this.confirmLoginSucceeded();
      return authCode;
    }

    // Do a full interactive login
    let authPageURL = await this.oAuth2.getAuthURL(OAuth2Redirect.appRedirectURL());
    window.location.assign(authPageURL);
    if (this.oAuth2.codeVerifierPKCE) {
      localStorage.setItem("oauth2.webmail.pkce", this.oAuth2.codeVerifierPKCE);
    }
    throw new WaitForRedirect("Waiting for login and redirect");
    // and we're gone! Our page will be replaced with the login page on the auth server.
    // If all goes well, we will load again, and this function will run again,
    // but this time with an authCode in localStorage.
    // Continued in logic/WebMail/login.ts
  }
  protected checkLoop() {
    let loopCounter = sanitize.integer(localStorage.getItem("oauth2.redirect.loopCounter"), 0);
    localStorage.setItem("oauth2.redirect.loopCounter", String(loopCounter + 1));
    assert(loopCounter < 2,
      "OAuth2 login succeeded, but didn't pass the right data to the webmail app");
  }
  protected confirmLoginSucceeded() {
    localStorage.setItem("oauth2.redirect.loopCounter", "0");
  }
  protected processIDToken(idToken: string) {
    localStorage.setItem("oauth2.webmail.idToken", idToken);
    let idParams = OpenIDConnect.decodeIDToken(idToken, this.oAuth2);
    console.log("ID Token contents", idParams);
    localStorage.setItem("oauth2.webmail.emailAddress", idParams.emailAddress);
    this.oAuth2.account.username = idParams.emailAddress; // Required by `OAuth2.storeRefreshToken()`
  }
  protected static removeURLSearchParams() {
    const url = new URL(window.location.href);
    url.search = '';
    history.pushState({}, '', url);
  }
  static appRedirectURL(): string {
    const url = new URL(window.location.href);
    url.search = '';
    return url.href;
  }
}

export class WaitForRedirect extends Error {
  doNotLog: true;
}
