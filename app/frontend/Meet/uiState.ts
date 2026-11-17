import { AppWindow } from "../MainWindow/AppWindow";
import { writable } from "svelte/store";

export const showDialPad = AppWindow.perWindow(() => writable(false));
