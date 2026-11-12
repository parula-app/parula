// #if [MOBILE]
import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { FileViewer } from "@capacitor/file-viewer";
// #else
import { appGlobal } from "../app";
// #endif

export async function openExternalURL(url: string) {
  // #if [MOBILE]
  /** Schemes that we let the OS open. The same as `kAllowedURLSchemes` in `desktop/backend/backend.ts`,
   * see there why. A web app fully controls the URL of its links, too. */
  const kAllowedURLSchemes = ["https:", "http:", "mailto:", "tel:", "xmpp:", "matrix:"];
  let scheme = new URL(url).protocol; // throws on a malformed URL
  if (!kAllowedURLSchemes.includes(scheme)) {
    throw new Error(`Refusing to open a ${scheme} URL in an OS app`);
  }
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
// #endif
