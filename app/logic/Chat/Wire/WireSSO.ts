import { WireError, parseZuidCookie } from "./WireTransport";
import { kSSOURLScheme } from "./clientInfo";
import type { WireSession } from "./WireSession";
import { WebBasedAuth } from "../../Auth/WebBasedAuth";
import { OAuth2Embed } from "../../Auth/UI/OAuth2Embed";
import type { OAuth2UI } from "../../Auth/UI/OAuth2UI";
import { LoginError } from "../../Abstract/Account";
import { notifyChangedProperty } from "../../util/Observable";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert, UserError, type URLString } from "../../util/util";
import { gt } from "../../../l10n/l10n";

/** Login via the team's own identity provider (SAML2 single sign-on).
 *
 * We never see the credentials: the identity provider does, in a browser
 * window. It hands the result back by sending that window to a private
 * `wire…://` URL which carries the `zuid` cookie — the only long-lived
 * credential an SSO account ever has, because there is no password to log in
 * with a second time.
 *
 * That makes this the same kind of login as OAuth2, so it is a `WebBasedAuth`
 * and reuses the same login-window UI: the window reports every URL it goes to,
 * `isAuthDoneURL()` recognizes ours, and `getAuthCodeFromDoneURL()` reads the
 * cookie out of it. */
export class WireSSO extends WebBasedAuth {
  readonly session: WireSession;
  /** The team's login code `wire-<uuid>`, or the bare identity provider ID */
  code: string;
  /** Shows the login page and reports the URLs it navigates to.
   * Our UI hands us one, so that it can render the window itself. */
  @notifyChangedProperty
  ui: OAuth2UI | null = null;
  /** Where the login window ends up. The scheme must start with `wire`,
   * or the server refuses to redirect to it. */
  authDoneURL: URLString = `${kSSOURLScheme}://sso/`;
  /** New for each attempt: proves that a verdict URL is the answer to *our*
   * login, and not another page handing us a session that is not ours. */
  protected secret: string | null = null;
  protected userIDFromVerdict: string | null = null;

  constructor(session: WireSession) {
    super(null); // The account, for the login window. Set by the UI.
    this.session = session;
  }

  /** @param interactive false = use the stored cookie, or fail
   * @returns accessToken
   * @throws LoginError, if we would need the user and may not ask */
  async login(interactive: boolean): Promise<string> {
    if (this.session.transport.cookie) {
      await this.session.refreshToken();
      return this.accessToken = this.session.transport.accessToken;
    }
    if (!interactive) {
      throw new LoginError(null, gt`Please log in again`);
    }
    return await this.loginWithUI();
  }

  /** @returns accessToken */
  async loginWithUI(): Promise<string> {
    await this.checkCode();
    this.ui ??= new OAuth2Embed(this);
    try {
      let cookie = await this.ui.login();
      return await this.getAccessTokenFromAuthCode(cookie);
    } finally {
      this.ui = null;
    }
  }

  abort() {
    this.ui?.abort();
  }

  /** The URL to load in the login window. The server answers it with a page
   * that posts a SAML request to the identity provider; the browser then
   * wanders through the provider's login pages and finally comes back to
   * `authDoneURL`. Unversioned, exactly as the official clients load it. */
  async getAuthURL(doneURL?: URLString): Promise<URLString> {
    this.authDoneURL = doneURL ?? this.authDoneURL;
    this.secret = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    /* The server rejects a redirect URL longer than 140 bytes, so keep these
     * short. It fills in `$cookie` with an entire `Set-Cookie` header value,
     * `$userid` with our user ID, and `$label` with the reason it refused. */
    let params = new URLSearchParams({
      success_redirect: `${this.authDoneURL}?s=${this.secret}&c=$cookie&u=$userid`,
      error_redirect: `${this.authDoneURL}?s=${this.secret}&e=$label`,
      label: this.session.cookieLabel,
    });
    return `${this.session.transport.baseURL}/sso/initiate-login/${this.idpID}?${params}`;
  }

  async isAuthDoneURL(url: URLString): Promise<boolean> {
    if (!url?.startsWith(this.authDoneURL)) {
      return false;
    }
    return !!this.secret && new URL(url).searchParams.get("s") == this.secret;
  }

  /** @param url The URL that the login window came back to
   * @returns the `zuid` cookie
   * @throws UserError, if the identity provider or the backend refused */
  getAuthCodeFromDoneURL(url: URLString): string {
    let params = new URL(url).searchParams;
    let refused = sanitize.string(params.get("e"), null);
    if (refused) {
      throw new UserError(ssoErrorMessage(refused));
    }
    let cookie = parseZuidCookie(sanitize.string(params.get("c"), ""));
    assert(cookie, gt`The login did not give us a session`);
    this.userIDFromVerdict = sanitize.string(params.get("u"), null);
    return cookie;
  }

  /** @param authCode the `zuid` cookie from the login window
   * @returns accessToken */
  async getAccessTokenFromAuthCode(authCode: string): Promise<string> {
    this.session.transport.cookie = authCode;
    this.session.userID ??= this.userIDFromVerdict;
    await this.session.refreshToken();
    return this.accessToken = this.session.transport.accessToken;
  }

  /** The identity provider ID: the login code without its `wire-` prefix */
  get idpID(): string {
    let code = this.code?.trim().toLowerCase().replace(/^wire-/, "");
    assert(kUUIDRegExp.test(code ?? ""), gt`This is not a valid login code`);
    return code;
  }

  /** Is this login code real? Ask before opening a window, or the user is
   * looking at a raw JSON error page in a browser. */
  protected async checkCode(): Promise<void> {
    try {
      /* This is the one route that answers `text/plain`, and the backend is
       * strict about it: our usual `Accept: application/json` gets a 406. */
      await this.session.transport.head(`/sso/initiate-login/${this.idpID}`,
        { headers: { Accept: "text/plain" } });
    } catch (ex) {
      if (ex instanceof WireError && ex.httpCode == 404) {
        throw new UserError(gt`This is not a valid login code`);
      }
      throw ex;
    }
  }

  get isLoggedIn(): boolean {
    return !!this.session.transport.accessToken;
  }

  get authorizationHeader(): string {
    return `Bearer ${this.session.transport.accessToken}`;
  }

  async logout(): Promise<void> {
    await this.session.logout();
  }

  /** Forgets the login, without telling the server */
  async reset(): Promise<void> {
    this.session.transport.cookie = null;
    this.session.transport.accessToken = null;
    this.accessToken = null;
  }

  setTokenURLPasswordAuth() {
    // Single sign-on has neither a token URL nor a password.
  }

  toConfigJSON(): any {
    return {
      code: this.code,
    };
  }
}

/** Why the login failed, as the server labelled it. As in the official clients,
 * these stay vague on purpose: the user cannot fix any of them, and the labels
 * describe SAML internals. */
function ssoErrorMessage(label: string): string {
  if (label == "not-found") {
    return gt`Unknown login code`;
  } else if (label == "forbidden") {
    return gt`Your identity provider refused the login`;
  } else if (label == "sso-disabled") {
    return gt`Single sign-on is turned off for your team`;
  } else if (label == "bad-team") {
    return gt`Your account belongs to a different team`;
  }
  return gt`Single sign-on failed. Please ask your team administrator.` + ` (${label})`;
}

const kUUIDRegExp = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
