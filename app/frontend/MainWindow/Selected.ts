import type { Workspace } from "../../logic/Abstract/Workspace";
import { AppWindow } from "./AppWindow";
import { writable } from "svelte/store";

export const selectedWorkspace = AppWindow.perWindow(() => writable<Workspace>());

/** Hack. Modify this store when you change the `Account.workspace`
 * of any account. This signals the UI to refresh the account lists.
 * The value of the store does not matter. */
export const changedWorkspace = writable(1);
