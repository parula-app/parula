import type { WebAppListed } from "../../../logic/WebApps/WebAppListed";
import { selectedWebApp, showingWebApp, webAppsRunning } from "./WebAppsRunning";
import { openApp } from "../../AppsBar/selectedApp";
import { AppWindow } from "../../MainWindow/AppWindow";
import { webAppsMustangApp } from "../WebAppsMustangApp";

export function startWebApp(webApp: WebAppListed) {
  let appWindow = AppWindow.current().mainWindow;
  appWindow.uiState(webAppsRunning).add(webApp);
  appWindow.uiState(showingWebApp).set(webApp);
  appWindow.uiState(selectedWebApp).set(webApp);
  openApp(webAppsMustangApp, {});
}
