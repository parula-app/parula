import type { SettingsCategory } from "../SettingsCategory";
import type { Account } from "../../../logic/Abstract/Account";
import { AppWindow } from "../../MainWindow/AppWindow";
import { writable } from "svelte/store";

export const selectedCategory = AppWindow.perWindow(() => writable<SettingsCategory>());
export const selectedAccount = AppWindow.perWindow(() => writable<Account>());

