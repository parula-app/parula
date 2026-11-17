import { OAuth2UI } from "./OAuth2UI";
import { UserCancelled, type URLString } from "../../util/util";
import { notifyChangedProperty } from "../../util/Observable";
import { gt } from "../../../l10n/l10n";

/**
 * Opens the OAuth2 login webpage in a dialog within the app main window,
 * monitors the URL changes, and returns the `authCode`.
 */
export class OAuth2Embed extends OAuth2UI {
  @notifyChangedProperty
  startURL: URLString;
  protected doneFunc: (authCode: string) => void;
  protected failFunc: (ex: Error) => void;

  /**
   * Does an interactive login
   * @returns authCode
   * @throws OAuth2Error
   */
  async login(): Promise<string> {
    this.startURL = await this.oAuth2.getAuthURL();
    console.log("OAuth2 start url", this.startURL);
    return new Promise((resolve, reject) => {
      this.doneFunc = resolve;
      this.failFunc = reject;
    });
  }
  async urlChanged(url: URLString) {
    if (await this.oAuth2.isAuthDoneURL(url)) {
      this.success(url);
    }
  }
  success(finalURL: URLString) {
    if (!this.doneFunc) {
      return; // E.g. the dialog was closed
    }
    try {
      this.doneFunc(this.oAuth2.getAuthCodeFromDoneURL(finalURL));
    } catch (ex) {
      this.failed(ex);
    }
  }
  failed(ex: Error) {
    this.failFunc?.(ex);
    this.failFunc = null;
    this.doneFunc = null;
  }
  abort() {
    this.failFunc?.(new UserCancelled(gt`Login aborted`));
    this.failFunc = null;
    this.doneFunc = null;
  }
}
