import { OAuth2UI } from "./OAuth2UI";
import { appGlobal } from "../../app";
import { k1MinuteMS } from "../../util/date";
import { UserCancelled, UserError, assert, type URLString } from "../../util/util";
import { gt } from "../../../l10n/l10n";

/**
 * Starts a local web server on http://localhost with a random port,
 * returns the login start URL, which you need to load in any browser,
 * and waits for the login page to redirect to the localhost end URL.
 * Extracts and returns the `authCode`.
 */
export class OAuth2Localhost extends OAuth2UI {
  /** Will be called when a login URL is ready.
   * Load this URL into the browser. */
  loginURLCallback: (url: URLString) => Promise<void>;
  protected onAbort: () => void;

  async login(): Promise<string> {
    assert(this.loginURLCallback, "Need URL callback");
    // Maybe re-use the running server for multiple logins at the same time?
    // Would need to use a URL param to distinguish between the results.
    // Use random port. Do all OAuth2 providers support http://localhost:* ?
    let port = 1024 + Math.ceil(Math.random() * 64000);
    let server = await appGlobal.remoteApp.newHTTPServer();
    await server.start(port);
    let doneURL = `http://localhost:${port}/login-success`;
    let url = await this.oAuth2.getAuthURL(doneURL);
    // console.log("OAuth2: Localhost: Load URL", url, "and done URL", doneURL);
    await this.loginURLCallback(url);
    let redirectedURL = await new Promise<URLString>((resolve, reject) => {
      // Close after 15 mins no result
      const minutes = 15;
      let killTimeout = setTimeout(() => {
        server.close();
        // Not `UserCancelled`, because we want to show that error msg to the user
        reject(new UserError(gt`Authentication page timed out after ${minutes} minutes`));
      }, minutes * k1MinuteMS);
      this.onAbort = () => {
        server.close();
        reject(new UserCancelled(gt`Login aborted by user`));
      }
      server.get("/login-success", (urlPath: URLString) => {
        // console.log("OAuth2: Login finished", url);
        clearTimeout(killTimeout);
        server.close();
        // Same origin as `doneURL`, so that `isAuthDoneURL()` can match it
        resolve(`http://localhost:${port}${urlPath}`);
      });
    });
    // Without this, anybody who reaches the port can hand us his own `code`
    assert(await this.oAuth2.isAuthDoneURL(redirectedURL),
      gt`The login response does not belong to this login attempt`);
    return this.oAuth2.getAuthCodeFromDoneURL(redirectedURL);
  }

  abort() {
    this.onAbort?.();
  }
}
