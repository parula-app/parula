import type { Workspace } from "../../logic/Abstract/Workspace";
import { AppWindow } from "./AppWindow";
import { writable } from "svelte/store";

export const selectedWorkspace = AppWindow.perWindow(() => writable<Workspace>());

/** Hack. Modify this store when you change the `Account.workspace`
 * of any account. This signals the UI to refresh the account lists.
 * The value of the store does not matter. */
export const changedWorkspace = writable(1);

/** The window has no title bar. The window buttons (macOS: traffic lights) are on top of the app bar,
 * and the workspace and the search are in the left bar of each app.
 * Secondary windows have them at the start of their header, see `SecondaryWindowButtons.svelte`.
 * Default on the web and on macOS, user preference `appearance.titleBar`.
 * Set by `MainWindow.svelte`. */
export const noTitleBar = writable(false);
