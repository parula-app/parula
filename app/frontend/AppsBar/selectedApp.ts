import type { MustangApp } from "./MustangApp";
import { createHashHistory } from "../Util/hashHistory";
import type AnyObject from "svelte-navigator/types/AnyObject";
import { appGlobal } from "../../logic/app";
import { minorError } from "../Util/error";
import { ArrayColl, MapColl } from "svelte-collections";
import { writable, get, type Writable } from "svelte/store";
import type RawLocation from "svelte-navigator/types/RawLocation";

export const selectedApp: Writable<MustangApp> = writable(null);
export const sidebarApp: Writable<MustangApp> = writable(null);
export const mustangApps = new ArrayColl<MustangApp>;

export const showDemoToggle: Writable<boolean> = writable(true);

/** Search bar in the window title, applies to all apps */
export const globalSearchTerm: Writable<string> = writable(null);

export const history = createHashHistory();

export type PageParams = Record<string, any>;
export function openApp(app: MustangApp, params: PageParams) {
  selectedApp.set(app);
  goTo(app.appURL, params);
}

export function goTo(pageURL: string, params: PageParams) {
  let location = window.location.hash.slice(1);
  let replace = pageURL == location;
  console.log("Go to", pageURL, replace ? "replace" : "", "from", location, "with params", params);
  history.navigate(pageURL, {
    replace,
    state: addParams(params),
  });
}

export function goBack() {
  history.navigate(-1);
}

/** When `goTo()` is called, we need to update `selectedApp` accordingly */
function syncSelectedApp(params: { location: RawLocation }) {
  let url = params.location.pathname as string;
  // Windows share their URL, e.g. one window per event, so find the window by its params
  let pageParams = getParams(params.location.state);
  for (let app of mustangApps) {
    let subApp = app.subApps.find(subApp => subApp.windowParams == pageParams && url.startsWith(subApp.appURL));
    if (subApp) {
      selectedApp.set(subApp);
      return;
    }
  }
  let matchingLength = 0;
  let selectedAppURL = get(selectedApp)?.appURL;
  if (selectedAppURL &&
      url.startsWith(selectedAppURL)) {
    matchingLength = selectedAppURL.length;
  }
  for (let app of mustangApps) {
    if (url.startsWith(app.appURL) &&
        app.appURL.length > matchingLength) {
      selectedApp.set(app);
      return;
    }
  }
}

export function bringAppToFront() {
  window.focus();
  appGlobal.remoteApp.unminimizeMainWindow()
    .catch(minorError);
}


/** History params
 * history state clones our objects, which fails. We need to keep the actual object around.
 * So, store the object here, generate an ID for it, and then store the ID on the history stack. */
const historyParams = new MapColl<number, any>();
let lastID = 1;
type HistoryIDObj = { id: number };

/** @returns ID. Put this as `state` on the history stack. */
function addParams(params: PageParams): HistoryIDObj {
  let id = lastID++;
  historyParams.set(id, params);
  return { id };
}
export function getParams(id: HistoryIDObj | AnyObject): PageParams {
  if (!id?.id) {
    return {};
  }
  return historyParams.get(id.id) ?? {};
}
/** TODO call this
 * a) when the user goes back in history and then forward, remove the orphaned entries, or
 * b) if the user goes forward, delete all entries > 20 pages back. */
function deletePage(id: HistoryIDObj | AnyObject): void {
  if (!id?.id) {
    return;
  }
  historyParams.delete(id.id);
}

// After `historyParams`, because `listen()` calls `syncSelectedApp()` right away
history.listen(syncSelectedApp);
