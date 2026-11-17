<vbox flex class="search-criteria">
  {#if showSearchTerm}
    <hbox class="term font-normal">
      {$t`Search for`}
      <SearchField bind:searchTerm={search.contentText}
        placeholder={$t`File name or content`} />
    </hbox>
  {/if}
  <Checkbox bind:checked={search.isStarred} allowIndetermined={true}
    label={$t`Starred`}
    classes="star {search.isStarred ? "starred" : ""}">
    <StarIcon size="16px" slot="icon" />
  </Checkbox>
  <Checkbox bind:checked={search.hasMIMETypesOn} allowIndetermined={true}
    on:change={updateTypes}
    label={$t`Attachment`}>
    <TypesIcon size="16px" slot="icon" />
  </Checkbox>
  {#if search.hasMIMETypes}
    <vbox flex class="listbox">
      <GenericFileTypesList bind:selectedMIMETypes={search.hasMIMETypes} />
    </vbox>
  {/if}
  <!-- TODO use Slider --
  <grid class="size">
    <Checkbox bind:checked={isMinSize}
      on:change={updateSizeMin}
      label="At least " />
    <input type="number" bind:value={minSizeMB}
      min={1} max={20} disabled={!isMinSize} />
    MB
    <Checkbox bind:checked={isMaxSize}
      on:change={updateSizeMax}
      label="Less than " />
    <input type="number" bind:value={maxSizeMB}
      min={1} max={20} maxlength="2" disabled={!isMaxSize} />
    MB
  </grid>
  -->
  <Checkbox bind:checked={hasTag} allowFalse={false} allowIndetermined={true}
    on:change={updateTag}
    label={$t`Tags`}>
    <TagIcon size="16px" slot="icon" />
  </Checkbox>
  {#if hasTag}
    <vbox class="tags">
      <TagSelector tags={availableTags} selectedTags={search.tags} canAdd={false} />
    </vbox>
  {/if}
  {#if appGlobal.fileSharingAccounts.length > 1}
    <Checkbox bind:checked={hasAccount} allowFalse={false} allowIndetermined={true}
      on:change={updateAccount}
      label={$t`${search.account?.name} account only`}>
      <AccountIcon size="16px" slot="icon" />
    </Checkbox>
    {#if search.account || search.directory}
      <vbox class="listbox">
        <AccountList accounts={appGlobal.fileSharingAccounts} bind:selectedAccount={search.account} />
      </vbox>
    {/if}
  {/if}
  {#if search.account}
    <Checkbox bind:checked={hasFolder} allowFalse={false} allowIndetermined={true}
      on:change={updateFolder}
      label={$t`${search.directory?.name} folder only`}>
      <FolderIcon size="16px" slot="icon" />
    </Checkbox>
    {#if hasFolder}
      <vbox flex class="listbox">
        <FolderList folders={search.account.rootDirs} bind:selectedFolder={search.directory} bind:selectedFolders />
      </vbox>
    {/if}
  {/if}
</vbox>

<script lang="ts">
  import { Directory } from "../../../logic/Files/Directory";
  import { SearchFile } from "../../../logic/Files/Store/SearchFile";
  import { availableTags } from "../../../logic/Abstract/Tag";
  import { selectedAccount, selectedFolder } from "../selected";
  import { appGlobal } from "../../../logic/app";
  import SearchField from "../../Shared/SearchField.svelte";
  import GenericFileTypesList from "../../Files/GenericFileTypesList.svelte";
  import AccountList from "../FolderLeftPane/AccountList.svelte";
  import FolderList from "../FolderLeftPane/FolderList.svelte";
  import TagSelector from "../../Shared/Tag/TagSelector.svelte";
  import Checkbox from "../../Shared/Checkbox.svelte";
  import StarIcon from "lucide-svelte/icons/star";
  import TypesIcon from "lucide-svelte/icons/paperclip";
  import AccountIcon from "lucide-svelte/icons/cloudy";
  import FolderIcon from "lucide-svelte/icons/folder";
  import TagIcon from "lucide-svelte/icons/tag";
  import { ArrayColl } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  /** The search criteria
   * in/out */
  export let search: SearchFile;

  export let showSearchTerm = true;

  // enable/disable fine-grained controls
  let hasAccount: boolean | null = null;
  let hasFolder: boolean | null = null;
  let hasTag: boolean | null = null;
  let hasSizeMin: boolean | null = null;
  let hasSizeMax: boolean | null = null;

  // Translate values from `SearchEMail` to how the UI controls show it
  let sizeMinMB: number;
  let sizeMaxMB: number;

  // Only when a different search is loaded, *not* on `$search` when its contents
  // change: that would write the values back while the search pane reads them.
  $: search, loadSearch()
  function loadSearch() {
    // Enable/disable: `SearchEmail` to controls
    hasAccount = search.account ? true : null;
    hasFolder = search.directory ? true : null;
    hasTag = search.tags.hasItems ? true : null;
    hasSizeMax = search.sizeMax ? true : null;
    hasSizeMin = search.sizeMin ? true : null;

    // Translate values from `SearchEMail` to UI controls
    sizeMinMB = search.sizeMin / 1048576;
    sizeMaxMB = search.sizeMax / 1048576;
  }

  // Translate values from UI controls to `SearchFiles`
  $: sizeMinMB, updateSizeMin();
  function updateSizeMin() {
    search.sizeMin = hasSizeMin ? sizeMinMB * 1048576 : null;
  }
  $: sizeMaxMB, updateSizeMax();
  function updateSizeMax() {
    search.sizeMax = hasSizeMax ? sizeMaxMB * 1048576 : null;
  }

  // Enable/disable: From UI controls to `SearchFiles`
  let selectedFolders: ArrayColl<Directory>;
  function updateAccount() {
    search.account = hasAccount ? $selectedAccount : null;
    if (!search.account) {
      search.directory = null;
    }
  }
  function updateFolder() {
    search.directory = hasFolder ? $selectedFolder : null;
  }
  function updateTag() {
    if (!hasTag) {
      search.tags?.clear();
    }
  }
  function updateTypes() {
    if (!search.hasMIMETypesOn) {
      search.hasMIMETypes.clear();
    }
  }
</script>

<style>
  .term {
    margin-block-start: 8px;
    margin-block-end: 24px;
    align-items: center;
  }
  .term :global(.search) {
    margin: 0px 8px;
  }
  .term :global(input) {
    font-size: 16px;
  }
  .search-criteria :global(.star.starred svg) {
    fill: orange;
  }
  .search-criteria :global(.unread.is-unread svg) {
    fill: green;
  }
  .listbox {
    margin-block-start: 4px;
    margin-block-end: 16px;
    min-height: 200px;
  }
  .tags {
    margin-block-start: 8px;
    margin-block-end: 16px;
    margin-inline-start: 8px;
  }
  /*
  grid.size {
    margin: 4px 0px 8px 32px;
    grid-template-columns: max-content max-content max-content;
  }
  input {
    text-align: center;
    width: unset;
    margin: 0px 8px;
  }
  input[disabled] {
    background-color: unset;
    border-bottom: unset;
  }
  */
</style>
