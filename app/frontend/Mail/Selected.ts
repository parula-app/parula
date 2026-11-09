import type { MailAccount } from "../../logic/Mail/MailAccount";
import type { Folder } from "../../logic/Mail/Folder";
import type { EMail } from "../../logic/Mail/EMail";
import { QuickSearchEMail } from "../../logic/Mail/Store/QuickSearchEMail";
import { SearchView } from "./LeftPane/SearchSwitcher.svelte";
import { AppWindow } from "../MainWindow/AppWindow";
import type { ArrayColl } from "svelte-collections";
import { writable } from "svelte/store";

export const selectedAccount = AppWindow.perWindow(() => writable<MailAccount>());
export const selectedFolder = AppWindow.perWindow(() => writable<Folder>());
export const selectedMessage = AppWindow.perWindow(() => writable<EMail>());
export const selectedMessages = AppWindow.perWindow(() => writable<ArrayColl<EMail>>());
export const selectedSearchTab = AppWindow.perWindow(() => writable<SearchView>(SearchView.Folder));

/** The current quick search criteria that filter the message list.
 * Allows to restore the view after coming back. */
export const quickSearch = AppWindow.perWindow(() => new QuickSearchEMail());
