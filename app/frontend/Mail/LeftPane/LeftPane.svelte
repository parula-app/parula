<vbox flex class="folder-pane">
    <hbox class="top window-drag">
      <vbox class="island">
        <SearchSwitcher bind:active={activeTab} />
      </vbox>
      <hbox flex />
      <hbox class="buttons">
        {#if activeTab == SearchView.Folder}
          <GetMailButton folder={selectedFolder ?? selectedAccount?.inbox} />
        {/if}
        {#if activeTab == SearchView.Folder || activeTab == SearchView.Person}
          <WriteButton account={selectedAccount}
            to={activeTab == SearchView.Person && $selectedPerson ? PersonUID.fromPerson($selectedPerson) : null } />
        {/if}
      </hbox>
    </hbox>

  {#if activeTab == SearchView.Person}
    <PersonsList
      persons={appGlobal.persons}
      bind:selected={$selectedPerson}
      selectedPersons={new ArrayColl()}
      on:selected={ev => showPerson(ev.detail as Person)}
      />
    <ViewSwitcher />
  {:else if activeTab == SearchView.Search}
    <SearchPane bind:searchMessages on:clear={endSearchMode} />
  {:else}
    <AccountList {accounts} bind:selectedAccount />
    <FolderList {folders} bind:selectedFolder bind:selectedFolders>
      <svelte:fragment slot="buttons" let:folder>
        <GetMailButton {folder} />
        <Button label={$t`Folder properties`} icon={MoreIcon} iconOnly plain
          onClick={() => onFolderSettings(folder)} />
      </svelte:fragment>
    </FolderList>
    {#if selectedFolder && !(selectedFolder instanceof SavedSearchFolder)}
      <TagsList folder={selectedFolder} bind:searchMessages />
    {/if}
    <hbox class="separator" />
    <ViewSwitcher />
  {/if}
  <GlobalSearchBar />
</vbox>

<script lang="ts">
  import GlobalSearchBar from "../../MainWindow/GlobalSearchBar.svelte";
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { type Folder } from "../../../logic/Mail/Folder";
  import type { EMail } from "../../../logic/Mail/EMail";
  import { Person } from "../../../logic/Abstract/Person";
  import { selectedPerson } from "../../Contacts/Person/Selected";
  import { PersonUID } from "../../../logic/Abstract/PersonUID";
  import { globalSearchTerm } from "../../AppsBar/selectedApp";
  import { newSearchEMail } from "../../../logic/Mail/Store/setStorage";
  import { selectedWorkspace } from "../../MainWindow/Selected";
  import { SavedSearchFolder } from "../../../logic/Mail/Virtual/SavedSearchFolder";
  import { openFolderProperties } from '../FolderPropertiesPage.svelte';
  import { appGlobal } from "../../../logic/app";
  import AccountList from "./AccountList.svelte";
  import FolderList from "./FolderList.svelte";
  import TagsList from "./TagsList.svelte";
  import SearchPane from "../Search/SearchPane.svelte";
  import PersonsList from "../../Contacts/Person/PersonsList.svelte";
  import GetMailButton from "./GetMailButton.svelte";
  import Button from '../../Shared/Button.svelte';
  import WriteButton from "./WriteButton.svelte";
  import ViewSwitcher from "./ViewSwitcher.svelte";
  import SearchSwitcher, { SearchView } from "./SearchSwitcher.svelte";
  import MoreIcon from "lucide-svelte/icons/ellipsis";
  import { catchErrors } from "../../Util/error";
  import { ArrayColl, type Collection } from 'svelte-collections';
  import { t } from '../../../l10n/l10n';

  export let accounts: Collection<MailAccount>; /** in */
  export let folders: Collection<Folder>; /** in */
  export let searchMessages: ArrayColl<EMail> | null; /** out */
  export let selectedAccount: MailAccount; /** in/out */
  export let selectedFolder: Folder; /** in/out */
  export let selectedFolders: ArrayColl<Folder>;
  export let activeTab: SearchView;

  $: if (!!$globalSearchTerm) openSearchPane();
  function openSearchPane() {
    activeTab = SearchView.Search;
  }
  if (activeTab == SearchView.Search && !$globalSearchTerm) {
    // reset, but only when opening, not while the user is changing the search term
    activeTab = SearchView.Folder;
  }
  $: activeTab, changeTab();
  function changeTab() {
    lastPerson = null;
    if (activeTab == SearchView.Search) {
      if ($globalSearchTerm == null) {
        $globalSearchTerm = "";
      }
    } else {
      searchMessages = null;
    }
  }
  function endSearchMode() {
    activeTab = SearchView.Folder;
  }

  let lastPerson: Person;
  async function showPerson(person: Person) {
    if (lastPerson == person || !person || !(person instanceof Person)) {
      return;
    }
    lastPerson = person;

    let search = newSearchEMail();
    search.workspace = $selectedWorkspace;
    search.includesPerson = person;
    let messages = await search.startSearch();

    if (lastPerson != person) { // User already clicked elsewhere.
      return;
    }
    searchMessages = messages;
  }

  function onFolderSettings(folder: Folder) {
    selectedFolder = folder;
    $openFolderProperties = true;
  }
</script>

<style>
  .folder-pane {
    box-shadow: 2px 0px 6px 0px rgba(0, 0, 0, 10%); /* Also on MessageList */
    z-index: 2;
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
  }

  .folder-pane :global(.persons) {
    margin-block-start: 8px;
  }
  .folder-pane :global(.account-list) {
    margin-block-start: -4px;
  }
  .folder-pane :global(.search) {
    margin-block-start: -2px;
  }
  .separator {
    margin-block-start: 20px;
  }
  .top :global(.svelteui-Tab) {
    padding: 8px 12px;
    height: unset;
  }
  .buttons {
    margin: 8px 8px 0 8px;
    align-items: end;
  }
  .buttons :global(button) {
    margin-inline-start: 6px;
  }
  .buttons :global(.icon) {
    padding: 4px;
  }
  .buttons :global(.get-mail) {
    height: 22px;
  }
  .island {
    margin: 8px 12px;
  }
  .folder-pane :global(.global-search-bar) {
    /* Same height and background as the `FolderFooter` next to it */
    height: 32px;
    padding-block: 2px;
    background-color: var(--main-bg);
  }
</style>
