// #if [MOBILE]
import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { FileViewer } from "@capacitor/file-viewer";
// #else
import { appGlobal } from "../app";
// #endif

export async function openExternalURL(url: string) {
  // #if [MOBILE]
  // <copied from="../../../desktop/backend/backend.ts" modified="true">
  /** Schemes that we let the OS open, see there why. A web app fully controls the URL of its links, too. */
  const kAllowedURLSchemes = [
    "https:",
    "http:",
    "mailto:",
    "tel:",
    "xmpp:",
    "matrix:",
  ];
  let scheme = new URL(url).protocol; // throws on a malformed URL
  if (!kAllowedURLSchemes.includes(scheme)) {
    throw new Error(`Refusing to open a ${scheme} URL in an OS app`);
  }
  // </copied>
  // Not `Browser.open()` of `@capacitor/browser`: It shows the page in a tab of Chrome or Safari in our app
  return await linkTapPlugin.open({ url });
  // #else
  return await appGlobal.remoteApp.openExternalURL(url);
  // #endif
}


/** Open the native desktop app with this file */
export async function openOSAppForFile(filePath: string) {
  // #if [MOBILE]
  await FileViewer.openDocumentFromLocalPath({ path: filePath });
  // #else
  await appGlobal.remoteApp.openFileInNativeApp(filePath);
  // #endif
}

// #if [MOBILE]
/** Android and iOS: Shows a web page in a native WebView over our app, jailed, with its own
 * cookies and storage, see `WebPagePlugin` in `mobile/` and `showNativePage()` in `WebView.svelte`.
 * A page stays alive while it's hidden. */
export const webPagePlugin = registerPlugin<WebPagePlugin>("WebPage");

interface WebPagePlugin {
  /**
   * Creates the page, if it's new, and shows or hides it.
   * @param id Our name for the page
   * @param url Loaded only when the page is new
   * @param profile The cookies and storage, e.g. of one account.
   *   Kept across app restarts, but on iOS 15 and 16 only until our app ends.
   * @param hidden Not over our app
   * @throws code "UNAVAILABLE", if Android System WebView is too old for profiles
   */
  open(options: { id: string, url: string, profile: string, hidden: boolean }): Promise<void>;
  /** Ends the page */
  close(options: { id: string }): Promise<void>;
  /** The user went back to our app. The page is hidden, but stays alive. */
  addListener(eventName: "hide", listener: (page: { id: string }) => void): Promise<PluginListenerHandle>;
  /** A link that the page can't show, e.g. `mailto:` */
  addListener(eventName: "link", listener: (link: { url: string }) => void): Promise<PluginListenerHandle>;
}

/** Android and iOS: The native app doesn't open a link that the user tapped on,
 * but gives it to us, see `LinkTapPlugin` in `mobile/` and `WebView.svelte`. */
export const linkTapPlugin = registerPlugin<LinkTapPlugin>("LinkTap");

interface LinkTapPlugin {
  addListener(eventName: "linkTap", listener: (tap: LinkTap) => void): Promise<PluginListenerHandle>;
  /** Opens the link in the default browser or another app, as Android and iOS do */
  open(options: { url: string }): Promise<void>;
}

export interface LinkTap {
  url: string;
  /** Where the user tapped, in CSS pixels of our window */
  x: number;
  y: number;
}
// #endif
