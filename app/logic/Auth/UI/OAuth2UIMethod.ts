import type { OAuth2UI } from "./OAuth2UI";
import { OAuth2Localhost } from "./OAuth2Localhost";
import { OAuth2SystemBrowser } from "./OAuth2SystemBrowser";
import { OAuth2Embed } from "./OAuth2Embed";
import { OAuth2Tab } from "./OAuth2Tab";
import { OAuth2Redirect } from "./OAuth2Redirect";
import type { OAuth2 } from "../OAuth2";
import { NotReached } from "../../util/util";

export enum OAuth2UIMethod {
  Embed = "embed",
  Tab = "tab",
  Localhost = "localhost",
  SystemBrowser = "system-browser",
  Redirect = "redirect",
}

export const mapBackOAuth2UIMethod = {
  "embed": OAuth2UIMethod.Embed,
  "tab": OAuth2UIMethod.Tab,
  "localhost": OAuth2UIMethod.Localhost,
  "system-browser": OAuth2UIMethod.SystemBrowser,
  "redirect": OAuth2UIMethod.Redirect,
};

export function newOAuth2UI(method: OAuth2UIMethod, oAuth2: OAuth2): OAuth2UI {
  if (method == OAuth2UIMethod.Localhost) {
    return new OAuth2Localhost(oAuth2);
  } else if (method == OAuth2UIMethod.SystemBrowser) {
    return new OAuth2SystemBrowser(oAuth2);
  } else if (method == OAuth2UIMethod.Embed) {
    return new OAuth2Embed(oAuth2);
  } else if (method == OAuth2UIMethod.Tab) {
    return new OAuth2Tab(oAuth2);
  } else if (method == OAuth2UIMethod.Redirect) {
    return new OAuth2Redirect(oAuth2);
  } else {
    throw new NotReached();
  }
}
