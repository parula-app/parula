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
import { AppWindow } from "../../frontend/MainWindow/AppWindow";
import { ArrayColl } from "svelte-collections";
import { writable } from "svelte/store";

export const updatingFolders = new ArrayColl<Folder>();

export const inlineReplies = AppWindow.perWindow(() => new ArrayColl<InlineReply>());

export const inlineRibbon = AppWindow.perWindow(() => writable<InlineRibbon | null>(null));

export const searchOptions = AppWindow.perWindow(() => writable<SearchOptions>(defaultSearchOptions()));

export const isAdvancedSearchOpen = AppWindow.perWindow(() => writable(false));

export const mailSearchInput = AppWindow.perWindow(() => writable<HTMLInputElement | null>(null));

export const isMailSearchFocused = AppWindow.perWindow(() => writable(false));

export const renamingFolder = AppWindow.perWindow(() => writable<Folder | null>(null));

export const printMessage = AppWindow.perWindow(() => writable<EMail | null>(null));

/** The dialogs that MailApp shows. The openers are mostly menu items, which are gone when the dialog shows. */
export const openMoveMessages = AppWindow.perWindow(() => writable<{ messages: EMail[], copy: boolean } | null>(null));
export const openNewFolder = AppWindow.perWindow(() => writable<{ account: MailAccount, parent: Folder | null } | null>(null));
export const openMoveFolder = AppWindow.perWindow(() => writable<Folder | null>(null));
export const openFolderProperties = AppWindow.perWindow(() => writable<{ folder: Folder, tab?: FolderPropertiesTab } | null>(null));
export const openReadingPaneOptions = AppWindow.perWindow(() => writable(false));
export const openColorCategories = AppWindow.perWindow(() => writable<TaggableObject[] | null>(null));
export const openSaveSearch = AppWindow.perWindow(() => writable<SearchEMail | null>(null));
export const openRulesFromSearch = AppWindow.perWindow(() => writable<SearchEMail | null>(null));
export const openAlwaysMove = AppWindow.perWindow(() => writable<EMail | null>(null));
export const openSearchPerson = AppWindow.perWindow(() => writable<{ fieldLabel: string, person: Person | null, onPick: (person: Person | null) => void } | null>(null));
export const openSharedFolder = AppWindow.perWindow(() => writable<MailAccount | null>(null));
export const openNewSearchFolder = AppWindow.perWindow(() => writable<{ account: MailAccount | null } | null>(null));
export const openCustomizeSearchFolder = AppWindow.perWindow(() => writable<SavedSearchFolder | null>(null));
export const openViewSettings = AppWindow.perWindow(() => writable<{ folder: Folder | null } | null>(null));
export const openShowColumns = AppWindow.perWindow(() => writable<{ folder: Folder | null } | null>(null));
export const openApplyView = AppWindow.perWindow(() => writable<{ folder: Folder | null } | null>(null));
export const askedScope = AppWindow.perWindow(() => writable<{ question: string, onChoice: (scope: ApplyScope | null) => void } | null>(null));
