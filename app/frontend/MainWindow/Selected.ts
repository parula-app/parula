import type { Workspace } from "../../logic/Abstract/Workspace";
import { getOSName } from "../Util/util";
import { webMail } from "../../logic/build";
import { getUILocale } from "../../l10n/l10n";
import { rtlLocales } from "../../l10n/list";
import { writable } from "svelte/store";

export const selectedWorkspace = writable<Workspace>();

/** Hack. Modify this store when you change the `Account.workspace`
 * of any account. This signals the UI to refresh the account lists.
 * The value of the store does not matter. */
export const changedWorkspace = writable(1);

/** macOS: The window has no title bar. The traffic lights are on top of the app bar,
 * and the workspace and the search are in the left bar of each app.
 * If the UI language and macOS have different writing directions,
 * then the traffic lights are on the other side, so we show the window header. */
export const noTitleBar = !webMail && getOSName() == "macintosh" &&
  rtlLocales.includes(getUILocale()) == rtlLocales.includes(navigator.language);
