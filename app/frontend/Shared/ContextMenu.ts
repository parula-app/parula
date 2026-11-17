import { openExternalURL } from "../../logic/util/os-integration";
import { appGlobal } from "../../logic/app";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { catchErrors } from "../Util/error";
import { NotImplemented, type URLString } from "../../logic/util/util";
import { blobToDataURL } from "../../logic/util/blob";
import { gt } from "../../l10n/l10n";
import { ArrayColl } from "svelte-collections";

/**
 * Handles the Electron `<webview>` `"context-menu"` event.
 *
 * Based on the context that the context menu was invoked on, i.e. what the user right-clicked on,
 * builds a list of menu items that apply to this situation.
 *
 * @param context @see <https://www.electronjs.org/docs/latest/api/webview-tag/#event-context-menu>
 * @returns The menu items with the label, icon and function, but no UI.
 *   You can show the UI based on that, using a UI library of your choice.
 *   You can also obviously add and remove menu items as you please.
 *
 * @example
 * ```
 * webviewE.addEventListener("context-menu", event => {
 *   let menuItems = buildContextMenu(event.params, webviewE.webContents);
 *   if (!menuItems) {
 *     return;
 *   }
 *   let menu = new ui.Menu();
 *   for (let item of menuItems) {
 *     menu.add(new ui.MenuItem(item.label, item.icon, item.action));
 *   }
 *   menu.show();
 * });
 * ```
 */
export async function buildContextMenu(context: ContextInfo, win: any): Promise<ArrayColl<MenuItem>> {
  context.isText = context.selectionText?.length > 0;
  context.isLink = !!context.linkURL;

  let menuItems = new ArrayColl<MenuItem>();
  function add(id: string, label: string, icon: string, action: Function, disabled: boolean = false) {
    let menuItem = new MenuItem(id, label, icon, () => catchErrors(() => action(context, win)));
    menuItem.disabled = disabled;
    menuItems.add(menuItem);
  }

  if (context.misspelledWord && context.isEditable && context.isText) {
    add("spellcheckerAddToDictionary", gt`Add word to dictionary`, null, learnSpelling);
    // TODO Spelling suggestions
  }
  if (context.isLink) {
    add("copyLink", gt`Copy link address`, null, copyLink);
    add("saveLink", gt`Save link target as…`, null, saveLinkAs);
  }
  if (context.isText || context.isEditable) {
    add("copy", gt`Copy`, null, copyText, context.isText && context.editFlags.canCopy);
  }
  if (context.isEditable) {
    add("cut", gt`Cut`, null, cutText, context.editFlags.canCut);
    add("paste", gt`Paste`, null, pasteText, context.editFlags.canPaste);
  }
  if (context.isText && !context.isLink) {
    add("search", gt`Search the web`, null, searchWeb);
    /* if (os == "mac") {
      add("lookup", gt`Look up`, null, lookUpSelection);
    } */
  }
  if (context.mediaType == "image") {
    add("copyImage", gt`Copy image`, null, copyImage);
    add("copyImageURL", gt`Copy image address`, null, copyImageURL);
    add("saveImage", gt`Save image...`, null, saveImage);
  }
  if (context.mediaType == "video") {
    add("copyVideoURL", gt`Copy video address`, null, copyVideoURL);
    add("saveVideo", gt`Save video`, null, saveVideo);
    add("saveVideoAs", gt`Save video as…`, null, saveVideoAs);
  }

  return menuItems;
}

export class MenuItem {
  id: string;
  label: string;
  icon: string;
  action: Function;
  /** Menu item should show up, but cannot be invoked.
   * When to use:
   * - Use `disabled = true` for menu items that apply, but cannot be used, for whatever reason.
   * - Menu items that do not apply to this type of context (e.g. image actions on text)
   *   should not be listed at all. */
  disabled: boolean = false;

  constructor(id: string, label: string, icon: string, action: Function) {
    this.id = id;
    this.label = label;
    this.icon = icon;
    this.action = action;
  }
}

/** @see <https://www.electronjs.org/docs/latest/api/webview-tag/#event-context-menu> */
export interface ContextInfo {
  /** Type of the node the context menu was invoked on. */
  mediaType: "none" | "image" | "audio" | "video" | "canvas" | "file" | "plugin";
  /** Input source that invoked the context menu. */
  menuSourceType: "none" | "mouse" | "keyboard" | "touch" | "touchMenu" | "longPress" | "longTap" | "touchHandle" | "stylus" | "adjustSelection" | "adjustSelectionReset";
  /** The input field that the context menu was invoked on. */
  formControlType: "none" | "button-button" | "field-set" | "input-button" | "input-checkbox" | "input-color" | "input-date" | "input-datetime-local" | "input-email" | "input-file" | "input-hidden" | "input-image" | "input-month" | "input-number" | "input-password" | "input-radio" | "input-range" | "input-reset" | "input-search" | "input-submit" | "input-telephone" | "input-text" | "input-time" | "input-url" | "input-week" | "output" | "reset-button" | "select-list" | "select-list" | "select-multiple" | "select-one" | "submit-button" | "text-area";
  /** Whether the context menu was invoked on an image which has non - empty contents. */
  hasImageContents: boolean;
  /** Whether the context menu was invoked on a `<a href="...">...</a>`. */
  isLink: boolean;
  /** Whether any text is selected. */
  isText: boolean;
  /** Text of the selection that the context menu was invoked on. */
  selectionText: string;
  /** Title text of the selection that the context menu was invoked on. */
  titleText: string;
  /** Alt text of the selection that the context menu was invoked on. */
  altText: string;
  /** Start position of the selection text. */
  selectionStartOffset: number;
  /** The coordinates in the document space of the selection.
   * Type: Rectangle */
  selectionRect: any;
  /** x coordinate of the click */
  x: number;
  /** x coordinate of the click */
  y: number;
  /** The link that encloses the node the context menu was invoked on. */
  linkURL: URLString;
  /** Text associated with the link.May be an empty string if the contents of the link are an image. */
  linkText: string;
  /** The top level page that the context menu was invoked on. */
  pageURL: URLString;
  /** The subframe that the context menu was invoked on. */
  frameURL: URLString;
  /** The element that the context menu was invoked on.Elements with source URLs are images, audio and video. */
  srcURL: URLString;
  /** Suggested filename to be used when saving file through 'Save Link As' option of context menu.
   * Warning: This is suggested by the untrusted page, so the filename *must* be sanitized before use */
  suggestedFilename: string;
  /** The referrer policy of the frame on which the menu is invoked.
   * Type: Referrer */
  refererPolicy: any;
  /** The character encoding of the frame on which the menu was invoked. */
  frameCharset: string;
  /** Whether or not spellchecking is enabled. Only if the context is editable. */
  spellcheckEnabled: boolean;
  /** The misspelled word under the cursor, if any. */
  misspelledWord: string;
  /** Suggested words to show the user to replace the misspelledWord.Only available if there is a misspelled word and spellchecker is enabled. */
  dictionarySuggestions: string[];
  /** The state of the media element the context menu was invoked on. */
  mediaFlags: {
    inError: boolean;
    isPaused: boolean;
    isMuted: boolean;
    hasAudio: boolean;
    isLooping: boolean;
    isControlsVisible: boolean;
    canToggleControls: boolean;
    canPrint: boolean;
    canSave: boolean;
    canShowPictureInPicture: boolean;
    isShowingPictureInPicture: boolean;
    canRotate: boolean;
    canLoop: boolean;
  };
  /** Whether the context is editable. */
  isEditable: boolean;
  /** Whether the renderer believes it is able to perform the corresponding edit action. */
  editFlags: {
    canUndo: boolean;
    canRedo: boolean;
    canCut: boolean;
    canCopy: boolean;
    canPaste: boolean;
    canDelete: boolean;
    canSelectAll: boolean;
    canEditRichly: boolean;
  };
}

function copyText(context: ContextInfo, win: any) {
  win.copy();
  // or: copyToClipboard(context.selectionText);
}

function cutText(context: ContextInfo, win: any) {
  win.cut();
}

function pasteText(context: ContextInfo, win: any) {
  win.paste();
}

function selectAll(context: ContextInfo, win: any) {
  win.selectAll();
}

async function searchWeb(context: ContextInfo, win: any) {
  const url = new URL('https://www.google.com/search');
  url.searchParams.set('q', context.selectionText);
  await openBrowser(url.toString());
}

function lookUpSelection(context: ContextInfo, win: any) {
  win.showDefinitionForSelection();
}

async function saveImage(context: ContextInfo, win: any) {
  await download(context.srcURL, win, false);
}

async function saveVideo(context: ContextInfo, win: any) {
  await download(context.srcURL, win, false);
}

async function saveVideoAs(context: ContextInfo, win: any) {
  await download(context.srcURL, win, true);
}

async function copyLink(context: ContextInfo, win: any) {
  await copyToClipboard(context.linkURL);
  /* or:
  copyToClipboard({
    bookmark: context.linkText,
    text: context.linkURL,
  });
  */
}

async function saveLinkAs(context: ContextInfo, win: any) {
  await download(context.linkURL, win, true, context.suggestedFilename);
}

async function copyImage(context: ContextInfo, win: any) {
  win = await appGlobal.remoteApp.getWebContents(win.getWebContentsId());
  win.copyImageAt(context.x, context.y);
}

async function copyImageURL(context: ContextInfo, win: any) {
  await copyToClipboard(context.srcURL);
}

async function copyVideoURL(context: ContextInfo, win: any) {
  await copyToClipboard(context.srcURL);
}

function learnSpelling(context: ContextInfo, win: any) {
  win.session.addWordToSpellCheckerDictionary(context.misspelledWord);
}

function inspect(context: ContextInfo, win: any) {
  win.inspectElement(context.x, context.y);
  if (win.isDevToolsOpened()) {
    win.devToolsWebContents.focus();
  }
}

async function copyToClipboard(text: string | Object) {
  if (typeof (text) == "string") {
    await appGlobal.remoteApp.writeTextToClipboard(text);
  } else {
    throw new NotImplemented();
  }
}

async function openBrowser(url: URLString) {
  await openExternalURL(url);
}

async function download(url: URLString, window: any, howSaveAsDialog: boolean, filename?: string) {
  let urlObj = new URL(url);
  if (urlObj.protocol == "http:" || urlObj.protocol == "https:") {
    let blob = await (await fetch(url)).blob();
    url = await blobToDataURL(blob);
    filename = filename ?? urlObj.pathname.split("/").pop();
  }

  let a = document.createElement("a");
  a.href = url;
  a.setAttribute("target", "_blank"); // for non-same-origin images
  a.setAttribute("download", sanitize.filename(filename, ""));
  a.click();
  a.href = "";
}
