import { AppWindow } from "../../../frontend/MainWindow/AppWindow";
import { writable } from "svelte/store";

export type BackstagePage = "info" | "open-export" | "print" | "account";

export const isBackstageOpen = AppWindow.perMainWindow(() => writable(false));
export const backstagePage = AppWindow.perMainWindow(() => writable<BackstagePage>("info"));
