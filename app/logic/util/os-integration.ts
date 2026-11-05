// #if [MOBILE]
import { Browser } from "@capacitor/browser";
import { FileViewer } from "@capacitor/file-viewer";
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
// #else
import { appGlobal } from "../app";
// #endif

export async function openExternalURL(url: string) {
  // #if [MOBILE]
  return await Browser.open({ url });
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
/** Android only, see `LinkTapPlugin.kt` */
export const linkTapPlugin = Capacitor.isPluginAvailable("LinkTap") ? registerPlugin<LinkTapPlugin>("LinkTap") : null;

interface LinkTapPlugin {
  addListener(eventName: "linkTap", listener: (tap: LinkTap) => void): Promise<PluginListenerHandle>;
  open(options: { url: string }): Promise<void>;
  openWith(options: { url: string }): Promise<void>;
}

export interface LinkTap {
  url: string;
  /** Where the user tapped, in CSS pixels of the window */
  x: number;
  y: number;
}
// #endif
