import type { WebAppListed } from "../../../logic/WebApps/WebAppListed";
import { SetColl } from "svelte-collections";
import { writable } from "svelte/store";

export const webAppsRunning = new SetColl<WebAppListed>;
/** The web app currently visible */
export const showingWebApp = writable<WebAppListed | null>();
/** If a webapp is visible: same as showingWebApp
 * If no webapp visible: last showingWebApp */
export const selectedWebApp = writable<WebAppListed | null>();
/** The app store is visible, where the user adds web apps */
export const showWebAppStore = writable(false);
