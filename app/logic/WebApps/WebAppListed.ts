import { getUILocale } from "../../l10n/l10n";
import { sourceLocale } from "../../l10n/list";
import { getAllAccounts, type Account } from "../Abstract/Account";
import { Provider } from "../Auth/OAuth2URLs";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { assert } from "../util/util";

/**
 * A third party web app listed in our app store.
 * The user can select and use this app.
 */
export class WebAppListed {
  /** e.g. "microsoft-word" */
  id: string;
  /** Categories to which this app belongs.
   * E.g. `[ "productivity|word-processing" ]` */
  categoryFullIDs: string[];
  /** Human-readable name,
   * translated into the user's language.
   * Must be short, i.e. 1-2 words.
   * Use "en" as fallback.
   * iso 2-letter lang code -> name
   * e.g. `{
   *   "en": "Microsoft Word",
   * }`
   */
  name: Record<string, string>;
  /** Human-readable description, usually 1 paragraph,
  * translated into the user's language.
  * Same format as `name`. */
  description: Record<string, string>;
  /** URL path to an icon for this category.
   * Either absolute, or relative to the UI path. */
  icon: string;
  /** Description of the application, by the vendor itself.
   * URL */
  homepage: string;
  /** Page which describes the pricing options.
   * URL */
  pricePage: string;
  /** Launch the application itself.
   * URL */
  start: string;
  /** Which login the app needs, and therefore which accounts we can offer for it. */
  loginType: WebAppLoginType;

  /** The provider that the app needs an account of, or null if any account works */
  get loginProvider(): Provider | null {
    return sanitize.translate(this.loginType, {
      [WebAppLoginType.Office365]: Provider.Office365,
      [WebAppLoginType.Google]: Provider.Google,
    }, null);
  }

  /** The name in the user's language, or a fallback when not available */
  get nameTranslated(): string {
    return this.name[getUILocale()] ??
      this.name[sourceLocale] ??
      "";
  }
  /** The description in the user's language, or a fallback when not available */
  get descriptionTranslated(): string {
    return this.description[getUILocale()] ??
      this.description[sourceLocale] ??
      "";
  }

  /** The cookie storage. For `<webview partition="persist:...">` */
  webSessionID: string | null;
  /** Load the app in the cookie storage of this account. Should match `sessionID` */
  account: Account | null;

  instantiate(account?: Account): WebAppListed {
    let app = this.clone();
    assert(app.id, "Need app ID");
    assert(app.start, "Need app start URL");
    app.account = account;
    app.webSessionID = account?.webSessionID ??
      "webapp:" + app.id + ":" + crypto.randomUUID().substring(0, 6);
    console.log("adding", app);
    return app;
  }

  clone(): WebAppListed {
    return WebAppListed.fromJSON(this.toJSON());
  }
  static fromJSON(json: any): WebAppListed {
    let result = new WebAppListed();
    for (let name of WebAppListed.jsonProps) {
      result[name] = json[name];
    }
    result.loginType = sanitize.enum(json.loginType, Object.values(WebAppLoginType), WebAppLoginType.Account);
    if (result.webSessionID) {
      result.account = getAllAccounts().find(acc => acc.webSessionID == result.webSessionID);
    }
    return result;
  }
  toJSON(): any {
    let json = {} as any;
    for (let name of WebAppListed.jsonProps) {
      json[name] = this[name];
    }
    return json;
  }
  protected static jsonProps = ['id', 'categoryFullIDs', 'name', 'description', 'icon',
    'homepage', 'pricePage', 'start', 'loginType', 'webSessionID',];
}

/** Which login a web app needs. Decides which accounts we offer for it in the app store. */
export enum WebAppLoginType {
  /** The app works without any login. */
  None = "none",
  /** Any of the user's accounts, or a login that the user makes in the app itself. */
  Account = "account",
  /** Only an account of this provider. @see `loginProvider` */
  Office365 = "office365",
  Google = "google",
}
