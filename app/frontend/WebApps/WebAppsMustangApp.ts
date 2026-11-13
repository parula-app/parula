import { MustangApp } from "../AppsBar/MustangApp";
import type { WebAppListed } from "../../logic/WebApps/WebAppListed";
import AppsApp from "./WebAppsApp.svelte";
import appsLauncherIcon from '../asset/icon/appBar/appsLauncher.svg?raw';
import { gt } from "../../l10n/l10n";

export class WebAppsMustangApp extends MustangApp {
  id = "webapps";
  get name() {
    return gt`Apps`;
  }
  icon = appsLauncherIcon;
  appURL = "/webapp";
  //subApps = appGlobal.webApps.myApps.map(app => new WebAppSubMustangApp(app));
}

export const webAppsMustangApp = new WebAppsMustangApp();

export class WebAppSubMustangApp extends MustangApp {
  webApp: WebAppListed;
  constructor(webApp: WebAppListed) {
    super();
    this.webApp = webApp;
    this.id = webApp.id;
    this.appURL = "/webapp/app/" + this.id;
    this.icon = wrapPNGinSVG(webApp.icon);
  }

  get name() {
    return this.webApp.nameTranslated;
  }
}

function wrapPNGinSVG(imageURL: string): string {
  return `<svg><image href=${imageURL} height="100%" width="100%" /></svg>`;
}
