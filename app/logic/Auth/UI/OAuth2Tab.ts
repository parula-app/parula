import { OAuth2UI } from "./OAuth2UI";
import { UserCancelled, assert, type URLString } from "../../util/util";
import { ArrayColl } from "svelte-collections";
import { gt } from "../../../l10n/l10n";

/**
 * Opens the OAuth2 login webpage in a dialog within the app main window,
 * monitors the URL changes, and returns the `authCode`.
 */
export class OAuth2Tab extends OAuth2UI {
  startURL: URLString;
  protected doneFunc: (authCode: string) => void;
  protected failFunc: (ex: Error) => void;
  mustangApp: any; // LoginDialogMustangApp

  /**
   * Does an interactive login
   * @returns authCode
   * @throws OAuth2Error
   */
  async login(): Promise<string> {
    this.startURL = await this.oAuth2.getAuthURL();
    // console.log("OAuth2 start url", this.startURL);
    assert((oAuth2TabsOpen as any)._observers.size, "OAuth2 tab: Observer got lost"); // mailMustangApp.tabsObserver is gone
    oAuth2TabsOpen.add(this);
    return new Promise((resolve, reject) => {
      this.doneFunc = resolve;
      this.failFunc = reject;
    });
  }
  async urlChanged(url: URLString) {
    // console.log("OAuth2 page change to", url);
    if (await this.oAuth2.isAuthDoneURL(url)) {
      this.success(url);
    }
  }
  close() {
    oAuth2TabsOpen.remove(this);
  }
  success(finalURL: URLString) {
    if (!this.doneFunc) {
      return; // E.g. the tab was closed
    }
    this.close();
    try {
      this.doneFunc(this.oAuth2.getAuthCodeFromDoneURL(finalURL));
    } catch (ex) {
      this.failed(ex);
    }
  }
  failed(ex: Error) {
    this.close();
    this.failFunc?.(ex);
    this.failFunc = null;
    this.doneFunc = null;
  }

  abort() {
    this.close();
    this.failFunc?.(new UserCancelled(gt`Login aborted`));
    this.failFunc = null;
    this.doneFunc = null;
  }
}

export const oAuth2TabsOpen = new ArrayColl<OAuth2Tab>();
