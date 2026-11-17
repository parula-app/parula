import { OAuth2UI } from "./OAuth2UI";
import { appGlobal } from "../../app";
import { UserCancelled, type URLString } from "../../util/util";
import { gt } from "../../../l10n/l10n";

/**
 * Opens a new window for OAuth2 login,
 * monitors the URL changes, and returns the `authCode`.
 */
export class OAuth2Window extends OAuth2UI {
  protected onAbort: () => void;

  /**
   * Does an interactive login
   * @returns authCode
   * @throws OAuth2Error
   */
  async login(): Promise<string> {
    let url = await this.oAuth2.getAuthURL();
    let { promise, resolve, reject } = Promise.withResolvers<string>();
    let closeWindow = await appGlobal.remoteApp.openBrowserWindow(url, this.oAuth2.account.webSessionID,
      // onNavigate
      async (url: URLString) => {
        try {
          if (await this.oAuth2.isAuthDoneURL(url)) {
            resolve(this.oAuth2.getAuthCodeFromDoneURL(url));
          }
        } catch (ex) {
          reject(ex);
        }
      },
      // onClosed. After `resolve()`, `reject()` does nothing.
      async () => reject(new UserCancelled(gt`Login window was closed by user`)));
    this.onAbort = () => reject(new UserCancelled(gt`Login aborted by user`));
    try {
      return await promise;
    } finally {
      await closeWindow();
    }
  }

  abort() {
    this.onAbort?.();
  }
}
