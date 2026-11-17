import type { Folder } from "../../logic/Mail/Folder";
import type { InlineReply, InlineRibbon } from "./Composer/InlineReplies";
import { defaultSearchOptions, type SearchOptions } from "./Search/MailSearch";
import { ArrayColl } from "svelte-collections";
import { writable } from "svelte/store";

export const updatingFolders = new ArrayColl<Folder>();

export const inlineReplies = new ArrayColl<InlineReply>();

export const inlineRibbon = writable<InlineRibbon | null>(null);

export const searchOptions = writable<SearchOptions>(defaultSearchOptions());

export const isAdvancedSearchOpen = writable(false);
