import type { EMail } from "../../logic/Mail/EMail";
import type { Folder } from "../../logic/Mail/Folder";
import type { MailAccount } from "../../logic/Mail/MailAccount";
import type { SearchEMail } from "../../logic/Mail/Store/SearchEMail";
import type { SavedSearchFolder } from "../../logic/Mail/Virtual/SavedSearchFolder";
import type { Person } from "../../logic/Abstract/Person";
import type { TaggableObject } from "../../logic/Abstract/Tag";
import type { InlineReply, InlineRibbon } from "./Composer/InlineReplies";
import type { FolderPropertiesTab } from "./FolderProperties.svelte";
import type { ApplyScope } from "./ViewSettings/ViewSettings";
import { defaultSearchOptions, type SearchOptions } from "./Search/MailSearch";
import { ArrayColl } from "svelte-collections";
import { writable } from "svelte/store";

export const updatingFolders = new ArrayColl<Folder>();

export const inlineReplies = new ArrayColl<InlineReply>();

export const inlineRibbon = writable<InlineRibbon | null>(null);

export const searchOptions = writable<SearchOptions>(defaultSearchOptions());

export const isAdvancedSearchOpen = writable(false);

export const mailSearchInput = writable<HTMLInputElement | null>(null);

export const isMailSearchFocused = writable(false);

export const renamingFolder = writable<Folder | null>(null);

export const printMessage = writable<EMail | null>(null);

/** The dialogs that MailApp shows. The openers are mostly menu items, which are gone when the dialog shows. */
export const openMoveMessages = writable<{ messages: EMail[], copy: boolean } | null>(null);
export const openNewFolder = writable<{ account: MailAccount, parent: Folder | null } | null>(null);
export const openMoveFolder = writable<Folder | null>(null);
export const openFolderProperties = writable<{ folder: Folder, tab?: FolderPropertiesTab } | null>(null);
export const openReadingPaneOptions = writable(false);
export const openColorCategories = writable<TaggableObject[] | null>(null);
export const openSaveSearch = writable<SearchEMail | null>(null);
export const openRulesFromSearch = writable<SearchEMail | null>(null);
export const openAlwaysMove = writable<EMail | null>(null);
export const openSearchPerson = writable<{ fieldLabel: string, person: Person | null, onPick: (person: Person | null) => void } | null>(null);
export const openSharedFolder = writable<MailAccount | null>(null);
export const openNewSearchFolder = writable<{ account: MailAccount | null } | null>(null);
export const openCustomizeSearchFolder = writable<SavedSearchFolder | null>(null);
export const openViewSettings = writable<{ folder: Folder | null } | null>(null);
export const openShowColumns = writable<{ folder: Folder | null } | null>(null);
export const openApplyView = writable<{ folder: Folder | null } | null>(null);
export const askedScope = writable<{ question: string, onChoice: (scope: ApplyScope | null) => void } | null>(null);
