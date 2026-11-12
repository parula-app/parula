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
// #endif
