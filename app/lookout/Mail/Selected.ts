import type { Folder } from "../../logic/Mail/Folder";
import type { InlineReply, InlineRibbon } from "./Composer/InlineReplies";
import { defaultSearchOptions, type SearchOptions } from "./Search/MailSearch";
import { mailMustangApp } from "../../frontend/Mail/MailMustangApp";
import { ArrayColl } from "svelte-collections";
import { writable } from "svelte/store";

export const updatingFolders = new ArrayColl<Folder>();

export const inlineReplies = new ArrayColl<InlineReply>();
mailMustangApp.inlineDrafts = inlineReplies.map(reply => reply.draft);

export const inlineRibbon = writable<InlineRibbon | null>(null);

export const searchOptions = writable<SearchOptions>(defaultSearchOptions());

export const isAdvancedSearchOpen = writable(false);
