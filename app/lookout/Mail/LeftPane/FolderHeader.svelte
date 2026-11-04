<hbox class="list-header">
  {#if isSimplified}
    <span class="list-title" title={listTitle}>{listTitle}</span>
    <hbox flex />
    {#if needsConnect}
      <ConnectButton account={folderAccount} withLabel />
      <hbox flex />
    {/if}
    {#if !isSearchResult}
      <button class="header-button" class:active={hasFilter} bind:this={filterEl}
        on:click|stopPropagation={() => isFilterMenuOpen = !isFilterMenuOpen}
        title={$t`Filter *=> Show only some of the emails in the folder`} aria-haspopup="menu">
        <FilterIcon size={16} />
        <span class="button-label">{$t`Filter *=> Show only some of the emails in the folder`}</span>
      </button>
    {/if}
    <button class="header-button" bind:this={sortEl}
      on:click|stopPropagation={() => isSortMenuOpen = !isSortMenuOpen}
      title={$t`Sort *=> Change the sort order of the email list`} aria-haspopup="menu">
      <SortIcon size={16} />
      <span class="button-label">{arrangeLabel}</span>
    </button>
  {:else if isSearchResult}
    <span class="results-title">{$t`Results *=> Search results`}</span>
  {:else}
    <hbox class="pivots" role="tablist">
      <button class="pivot" role="tab" class:active={!isUnreadOnly} aria-selected={!isUnreadOnly}
        on:click={() => setUnreadOnly(false)}>
        {$t`All`}
      </button>
      <button class="pivot" role="tab" class:active={isUnreadOnly} aria-selected={isUnreadOnly}
        on:click={() => setUnreadOnly(true)}>
        {$t`Unread *=> State of the message that has not been read`}
      </button>
    </hbox>
    <hbox class="pivots quick-filters">
      <button class="pivot icon-pivot" class:active={$quickSearch.isStarred === true} aria-pressed={$quickSearch.isStarred === true}
        title={$t`Show only flagged messages`} aria-label={$t`Show only flagged messages`}
        on:click={() => toggleQuickFilter(QuickFilter.Flagged)}>
        <FlagIcon size={16} />
      </button>
      <button class="pivot icon-pivot" class:active={$quickSearch.hasAttachment === true} aria-pressed={$quickSearch.hasAttachment === true}
        title={$t`Show only messages with attachments`} aria-label={$t`Show only messages with attachments`}
        on:click={() => toggleQuickFilter(QuickFilter.Attachments)}>
        <AttachmentIcon size={16} />
      </button>
      <button class="pivot icon-pivot" class:active={isFolderSearchOpen} aria-pressed={isFolderSearchOpen}
        title={$t`Search only the currently displayed folder for a keyword`} aria-label={$t`Search only this folder`}
        on:click={toggleFolderSearch}>
        <SearchIcon size={16} />
      </button>
    </hbox>
    {#if isFolderSearchOpen}
      <input type="search" class="folder-search"
        bind:value={quickSearch.bodyText}
        placeholder={$t`Search only this folder`}
        aria-label={$t`Search only this folder`}
        autocomplete="off"
        on:keydown={onFolderSearchKey}
        use:focusOnMount />
    {/if}
  {/if}
  {#if !isSimplified}
  {#if !showsFolderSearch}
    <hbox flex />
  {/if}
  {#if needsConnect && !isSearchResult}
    <ConnectButton account={folderAccount} withLabel />
    <hbox flex />
  {/if}
  <button class="arrange" bind:this={arrangeEl} on:click|stopPropagation={() => isArrangeMenuOpen = !isArrangeMenuOpen}
    title={$t`Arrange By`} aria-haspopup="menu">
    {arrangeLabel}
    <ChevronIcon size={14} />
  </button>
  {/if}
</hbox>
<Menu bind:isMenuOpen={isArrangeMenuOpen} anchor={arrangeEl} placement="bottom-end">
  {#if !isSearchResult}
    <MenuLabel label={$t`Filter *=> Show only some of the emails in the folder`} />
    <MenuItem label={$t`All Mail`} checked={!hasFilter} onClick={clearFilter} />
    <MenuItem label={$t`Unread Mail`} checked={$quickSearch.isRead === false}
      onClick={() => toggleQuickFilter(QuickFilter.Unread)} />
    <MenuItem label={$t`Flagged Mail`} checked={$quickSearch.isStarred}
      onClick={() => toggleQuickFilter(QuickFilter.Flagged)} />
    <MenuItem label={$t`Mail with Attachments`} checked={$quickSearch.hasAttachment}
      onClick={() => toggleQuickFilter(QuickFilter.Attachments)} />
    <MenuDivider />
  {/if}
  <ArrangeByMenuItems {folder} withLabel withSortOrder />
</Menu>
<Menu bind:isMenuOpen={isFilterMenuOpen} anchor={filterEl} placement="bottom-end">
  <MenuItem label={$t`All`} icon={AllIcon} checkable checked={!hasFilter} onClick={clearFilter} />
  <MenuItem label={$t`Unread *=> State of the message that has not been read`} icon={UnreadIcon} checkable checked={$quickSearch.isRead === false}
    onClick={() => toggleQuickFilter(QuickFilter.Unread)} />
  <MenuItem label={$t`Flagged *=> State of the email that has been flagged for follow-up`} icon={FlagIcon} checkable checked={$quickSearch.isStarred}
    onClick={() => toggleQuickFilter(QuickFilter.Flagged)} />
  <MenuItem label={$t`Has files`} icon={AttachmentIcon} checkable checked={$quickSearch.hasAttachment}
    onClick={() => toggleQuickFilter(QuickFilter.Attachments)} />
</Menu>
<Menu bind:isMenuOpen={isSortMenuOpen} anchor={sortEl} placement="bottom-end">
  <SortMenuItems {folder} />
</Menu>

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { EMail } from "../../../logic/Mail/EMail";
  import { quickSearch } from "../../../frontend/Mail/Selected";
  import { globalSearchTerm } from "../../../frontend/AppsBar/selectedApp";
  import { catchErrors, showError } from "../../../frontend/Util/error";
  import { arrangeFields, viewSettingsStore } from "../ViewSettings/ViewSettings";
  import { hasSearchCriteria, toggleQuickFilter, QuickFilter } from "../MailFilters";
  import { QuickFilterList } from "../QuickFilterList";
  import { defaultSearchOptions } from "../Search/MailSearch";
  import { searchOptions } from "../Selected";
  import ConnectButton from "./ConnectButton.svelte";
  import ArrangeByMenuItems from "../ViewSettings/ArrangeByMenuItems.svelte";
  import SortMenuItems from "../ViewSettings/SortMenuItems.svelte";
  import Menu from "../../Shared/Menu/Menu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuLabel from "../../Shared/Menu/MenuLabel.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import ChevronIcon from "lucide-svelte/icons/chevron-down";
  import FilterIcon from "lucide-svelte/icons/list-filter";
  import SortIcon from "lucide-svelte/icons/arrow-down-wide-narrow";
  import AllIcon from "lucide-svelte/icons/mails";
  import UnreadIcon from "lucide-svelte/icons/mail";
  import FlagIcon from "lucide-svelte/icons/flag";
  import AttachmentIcon from "lucide-svelte/icons/paperclip";
  import SearchIcon from "lucide-svelte/icons/search";
  import type { RibbonLayout } from "../../Shared/Ribbon/RibbonGroup";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import type { ArrayColl, Collection } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  export let folder: Folder | null;
  export let selectedMessages: ArrayColl<EMail>;
  export let searchMessages: Collection<EMail> | null = null;
  export let isSearchResult = false;

  let arrangeEl: HTMLButtonElement;
  let isArrangeMenuOpen = false;
  let filterEl: HTMLButtonElement;
  let isFilterMenuOpen = false;
  let sortEl: HTMLButtonElement;
  let isSortMenuOpen = false;
  const ribbonLayout = getLocalStorage<RibbonLayout>("lookout.ribbon.layout", "classic");

  $: isSimplified = $ribbonLayout.value == "simplified";
  $: listTitle = isSearchResult ? $t`Results *=> Search results` : $folder?.name ?? "";

  $: settings = viewSettingsStore(folder);
  $: folderAccount = folder?.account;
  $: needsConnect = !!folderAccount && !$folderAccount.isLoggedIn;
  $: arrangeLabel = arrangeFields().find(arrangement => arrangement.id == $settings.arrangeBy)?.button ?? $t`By Date`;

  // <copied from="../../../frontend/Mail/LeftPane/FolderFooter.svelte">
  $: quickSearch.folder = folder;
  // </copied>
  const quickFilterList = new QuickFilterList();
  $: folderMessages = folder?.messages ?? null;
  $: folder && $quickSearch && folderMessages && $folderMessages && $selectedMessages && catchErrors(startSearch, showError);
  async function startSearch() {
    searchMessages = await quickFilterList.filter(quickSearch, selectedMessages);
  }

  $: hasFilter = $quickSearch && quickSearch.hasSearch();
  $: isUnreadOnly = $quickSearch.isRead === false;
  function setUnreadOnly(unreadOnly: boolean) {
    quickSearch.isRead = unreadOnly ? false : null;
  }

  // <copied to="FilterMenuItems.svelte">
  function clearFilter() {
    quickSearch.reset();
    if (hasSearchCriteria()) {
      $globalSearchTerm = null;
      $searchOptions = { ...defaultSearchOptions(), scope: $searchOptions.scope };
    }
  }
  // </copied>

  let isFolderSearchOpen = !!quickSearch.bodyText;
  $: showsFolderSearch = isFolderSearchOpen && !isSimplified && !isSearchResult;
  function toggleFolderSearch() {
    isFolderSearchOpen = !isFolderSearchOpen;
    if (!isFolderSearchOpen) {
      quickSearch.bodyText = null;
    }
  }
  function focusOnMount(input: HTMLInputElement) {
    input.focus();
  }
  function onFolderSearchKey(event: KeyboardEvent) {
    if (event.key == "Escape") {
      event.preventDefault();
      event.stopPropagation();
      toggleFolderSearch();
    }
  }
</script>

<style>
  .list-header {
    flex-shrink: 0;
    align-items: center;
    gap: 4px;
    height: 44px;
    padding: 0 8px 0 12px;
    border-bottom: 1px solid var(--lo-divider);
  }
  .pivots {
    gap: 4px;
    align-self: stretch;
  }
  .pivot {
    position: relative;
    padding: 0 8px;
    border: none;
    background: none;
    color: var(--lo-fg);
    font: inherit;
    font-size: 15px;
    cursor: pointer;
  }
  .pivot:hover {
    color: var(--lo-accent-text);
  }
  .pivot.active {
    color: var(--lo-accent-text);
    font-weight: 600;
  }
  .quick-filters {
    gap: 0;
  }
  .icon-pivot {
    display: flex;
    align-items: center;
    padding: 0 6px;
    color: var(--lo-fg-secondary);
  }
  .pivot.icon-pivot.active::after {
    left: 4px;
    right: 4px;
  }
  .folder-search {
    flex: 1 1 0;
    min-width: 80px;
    margin-inline: 4px;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
    color: var(--lo-fg);
    font: inherit;
    font-size: 13px;
  }
  .folder-search:focus {
    outline: none;
    border-color: var(--lo-accent);
  }
  .pivot.active::after {
    content: "";
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: 6px;
    height: 2px;
    border-radius: 1px;
    background-color: var(--lo-accent);
  }
  .list-title {
    overflow: hidden;
    font-size: 16px;
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .header-button {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .header-button:hover {
    background-color: var(--lo-hover-bg);
  }
  .header-button.active {
    background-color: var(--lo-selected-bg);
    color: var(--lo-accent-text);
  }
  .results-title {
    font-size: 15px;
    font-weight: 600;
  }
  .arrange {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 8px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .arrange:hover {
    background-color: var(--lo-hover-bg);
  }
</style>
