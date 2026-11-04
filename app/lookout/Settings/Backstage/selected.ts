import { writable } from "svelte/store";

export type BackstagePage = "info" | "open-export" | "print" | "account";

export const isBackstageOpen = writable(false);
export const backstagePage = writable<BackstagePage>("info");
