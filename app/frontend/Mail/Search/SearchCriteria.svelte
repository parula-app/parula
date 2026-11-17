<vbox flex class="search-criteria">
  {#if showSearchTerm}
    <hbox class="term font-normal">
      <SearchField bind:searchTerm={search.bodyText}
        placeholder={$t`Mail content or subject`} />
    </hbox>
  {/if}
  <Checkbox bind:checked={search.isOutgoing} allowIndetermined={true}
    label={$t`Sent by me`}>
    <OutgoingIcon size="16px" slot="icon" />
  </Checkbox>
  <Checkbox bind:checked={isUnread} allowIndetermined={true}
    on:change={updateUnread}
    label={isUnread === false ? $t`Read *=> State of the message that has been read` : $t`Unread *=> State of the message that has not been read`}
    classes="unread {isUnread ? "is-unread" : ""}">
    <CircleIcon size="16px" slot="icon" />
  </Checkbox>
  <Checkbox bind:checked={search.isStarred} allowIndetermined={true}
    label={$t`Starred`}
    classes="star {search.isStarred ? "starred" : ""}">
    <StarIcon size="16px" slot="icon" />
  </Checkbox>
  <Checkbox bind:checked={search.hasAttachment} allowIndetermined={true}
    on:change={updateAttachment}
    label={$t`Attachment`}>
    <AttachmentIcon size="16px" slot="icon" />
  </Checkbox>
  {#if search.hasAttachment}
    <vbox flex class="listbox">
      <GenericFileTypesList bind:selectedMIMETypes={search.hasAttachmentMIMETypes} />
    </vbox>
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
  {/if}
  <Checkbox bind:checked={hasPerson} allowFalse={false} allowIndetermined={true}
    on:change={updatePerson}
    label="{hasPerson ? search.includesPerson?.name ?? $t`Person` : $t`Person`}">
    <PersonIcon size="16px" slot="icon" />
  </Checkbox>
  {#if hasPerson}
    <vbox flex class="listbox">
      <!-- showSearch=false is a workaround for:
       1. Enter name that is not in results ->
       2. PersonsList clears `search.includesPerson` ->
       3. `search` changes ->
       4. `loadSearch()` triggers (it should not) ->
       5. `hasPerson = false` ->
       6. PersonsList disappears ->
       7. User cannot correct search -->
      <PersonsList persons={availablePersons} bind:selected={search.includesPerson} showSearch={false} />
    </vbox>
  {/if}
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
  {#if showAccount && appGlobal.emailAccounts.length > 1}
    <Checkbox bind:checked={hasAccount} allowFalse={false} allowIndetermined={true}
      on:change={updateAccount}
      label={$t`${search.account?.name} account only`}>
      <AccountIcon size="16px" slot="icon" />
    </Checkbox>
    {#if search.account || search.folder}
      <vbox class="listbox">
        <AccountList accounts={appGlobal.emailAccounts} bind:selectedAccount={search.account} />
      </vbox>
    {/if}
  {/if}
  {#if search.account}
    <Checkbox bind:checked={hasFolder} allowFalse={false} allowIndetermined={true}
      on:change={updateFolder}
      label={$t`${search.folder?.name} folder only`}>
      <FolderIcon size="16px" slot="icon" />
    </Checkbox>
    {#if hasFolder}
      <vbox flex class="listbox">
        <FolderList folders={search.account.rootFolders} bind:selectedFolder={search.folder} bind:selectedFolders />
      </vbox>
    {/if}
  {/if}
</vbox>

<script lang="ts">
  import { SearchEMail } from "../../../logic/Mail/Store/SearchEMail";
  import { availableTags } from "../../../logic/Abstract/Tag";
  import { personsInEMails } from "../../../logic/Mail/Person";
  import { Folder } from "../../../logic/Mail/Folder";
  import { EMail } from "../../../logic/Mail/EMail";
  import { selectedAccount, selectedFolder } from "../Selected";
  import { appGlobal } from "../../../logic/app";
  import SearchField from "../../Shared/SearchField.svelte";
  import GenericFileTypesList from "../../Files/GenericFileTypesList.svelte";
  import PersonsList from "../../Contacts/Person/PersonsList.svelte";
  import AccountList from "../LeftPane/AccountList.svelte";
  import FolderList from "../LeftPane/FolderList.svelte";
  import TagSelector from "../../Shared/Tag/TagSelector.svelte";
  import Checkbox from "../../Shared/Checkbox.svelte";
  import OutgoingIcon from "lucide-svelte/icons/arrow-big-left";
  import StarIcon from "lucide-svelte/icons/star";
  import CircleIcon from "lucide-svelte/icons/circle";
  import AttachmentIcon from "lucide-svelte/icons/paperclip";
  import AccountIcon from "lucide-svelte/icons/mail";
  import FolderIcon from "lucide-svelte/icons/folder";
  import TagIcon from "lucide-svelte/icons/tag";
  import PersonIcon from "lucide-svelte/icons/user-round";
  import { ArrayColl, Collection } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  /** The search criteria
   * in/out */
  export let search: SearchEMail;

  export let showSearchTerm = true;
  export let showAccount = true;
  export let searchMessages: Collection<EMail> = null;

  // enable/disable fine-grained controls
  let hasAccount: boolean | null = null;
  let hasFolder: boolean | null = null;
  let hasTag: boolean | null = null;
  let hasSizeMin: boolean | null = null;
  let hasSizeMax: boolean | null = null;
  let hasPerson: boolean | null = null;

  // Translate values from `SearchEMail` to how the UI controls show it
  let isUnread: boolean | null = null;
  let sizeMinMB: number;
  let sizeMaxMB: number;

  $: search, loadSearch() // $search causes loop
  function loadSearch() {
    // Enable/disable: `SearchEmail` to controls
    hasAccount = search.account ? true : null;
    hasFolder = search.folder ? true : null;
    hasPerson = search.includesPerson ? true : null;
    hasTag = search.tags.hasItems ? true : null;
    hasSizeMax = search.sizeMax ? true : null;
    hasSizeMin = search.sizeMin ? true : null;

    // Translate values from `SearchEMail` to UI controls
    isUnread = search.isRead === false ? true : (search.isRead === true ? false : null);
    sizeMinMB = search.sizeMin / 1048576;
    sizeMaxMB = search.sizeMax / 1048576;
  }

  // Translate values from UI controls to `SearchEMail`
  function updateUnread() {
    search.isRead = isUnread === false ? true : (isUnread == true ? false : null);
  }
  $: sizeMinMB, updateSizeMin();
  function updateSizeMin() {
    search.sizeMin = hasSizeMin ? sizeMinMB * 1048576 : null;
  }
  $: sizeMaxMB, updateSizeMax();
  function updateSizeMax() {
    search.sizeMax = hasSizeMax ? sizeMaxMB * 1048576 : null;
  }

  // Enable/disable: From UI controls to `SearchEMail`
  let selectedFolders: ArrayColl<Folder>;
  function updateAccount() {
    search.account = hasAccount ? $selectedAccount : null;
    if (!search.account) {
      search.folder = null;
    }
  }
  function updateFolder() {
    search.folder = hasFolder ? $selectedFolder : null;
  }
  $: availablePersons = hasPerson && searchMessages ? personsInEMails(searchMessages) : appGlobal.personalAddressbook?.persons;
  function updatePerson() {
    if (!hasPerson) {
      search.includesPerson = null;
    }
  }
  function updateTag() {
    if (!hasTag) {
      search.tags?.clear();
    }
  }
  function updateAttachment() {
    if (!search.hasAttachment) {
      search.hasAttachmentMIMETypes.clear();
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
