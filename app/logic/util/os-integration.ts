// #if [MOBILE]
import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { FileViewer } from "@capacitor/file-viewer";
// #else
import { appGlobal } from "../app";
// #endif

export async function openExternalURL(url: string) {
  // #if [MOBILE]
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

/** Android and iOS: Shows a login page in a native WebView over our app, jailed,
 * with its own cookies and storage, see `LoginWebViewPlugin` in `mobile/`
 * and `OAuth2EmbeddedBrowser.svelte`. Only one at a time. */
export const loginWebViewPlugin = registerPlugin<LoginWebViewPlugin>("LoginWebView");

interface LoginWebViewPlugin {
  /**
   * @param profile The cookies and storage, e.g. of one account. Kept across app restarts.
   * @param doneURL Pages under this URL are not loaded, but only reported with `navigate`
   * @param script Runs in each page, after it loaded
   * @throws code "UNAVAILABLE", if Android System WebView is too old
   */
  open(options: { url: string, profile: string, doneURL?: string, script?: string }): Promise<void>;
  /** Without `close` event */
  close(): Promise<void>;
  /** For each page that the WebView goes to */
  addListener(eventName: "navigate", listener: (page: { url: string }) => void): Promise<PluginListenerHandle>;
  /** The user closed it */
  addListener(eventName: "close", listener: () => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
// #endif
