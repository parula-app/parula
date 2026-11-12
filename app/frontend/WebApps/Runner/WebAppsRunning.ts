import type { WebAppListed } from "../../../logic/WebApps/WebAppListed";
import { AppWindow } from "../../MainWindow/AppWindow";
import { SetColl } from "svelte-collections";
import { writable } from "svelte/store";

export const webAppsRunning = AppWindow.perWindow(() => new SetColl<WebAppListed>);
/** The web app currently visible */
export const showingWebApp = AppWindow.perWindow(() => writable<WebAppListed | null>());
/** If a webapp is visible: same as showingWebApp
 * If no webapp visible: last showingWebApp */
export const selectedWebApp = AppWindow.perWindow(() => writable<WebAppListed | null>());
