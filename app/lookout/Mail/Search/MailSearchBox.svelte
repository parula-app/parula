<vbox class="mail-search-box" bind:this={boxEl}>
  <hbox class="search" class:has-search={!!typed}>
    <button type="button" class="scope" bind:this={scopeButton}
      title={$t`Choose where to search`}
      aria-haspopup="menu" aria-expanded={isScopeOpen}
      on:click|stopPropagation={() => isScopeOpen = !isScopeOpen}>
      <span class="scope-label">{scopeLabel(scope)}</span>
      <ChevronIcon size={14} />
    </button>
    <hbox class="divider" />
    <SearchIcon size={16} />
    <input type="search" bind:value={typed} bind:this={inputEl}
      placeholder={$t`Search`} spellcheck={false}
      role="combobox" aria-expanded={suggestions.length > 0} aria-autocomplete="list"
      on:input={onInput} on:keydown={onKeyDown}
      on:focus={() => { isInputFocused = true; }}
      on:blur={() => { isInputFocused = false; }} />
    {#if typed}
      <button type="button" class="icon-button" title={$t`Clear`} aria-label={$t`Clear`}
        on:click={onClear}>
        <ClearIcon size={16} />
      </button>
    {/if}
    <button type="button" class="icon-button advanced" class:open={$isAdvancedSearchOpen}
      title={$t`Advanced Search - Narrow your search with options like sender, date, scope and attachments`}
      aria-label={$t`Advanced Search`} aria-expanded={$isAdvancedSearchOpen}
      on:click={() => $isAdvancedSearchOpen ? closeAdvanced() : openAdvanced()}>
      <svelte:component this={$isAdvancedSearchOpen ? ChevronUpIcon : ChevronIcon} size={16} />
    </button>
  </hbox>
  <Menu bind:isMenuOpen={isScopeOpen} anchor={scopeButton} placement="bottom-start">
    {#each scopes as option}
      <MenuItem label={scopeLabel(option)}
        checkable checked={option == scope}
        disabled={!isScopeAvailable(option, $selectedAccount, $selectedFolder) && $t`Select a folder of an account first`}
        onClick={() => $searchOptions = { ...$searchOptions, scope: option }} />
    {/each}
  </Menu>
  {#if suggestions.length && !$isAdvancedSearchOpen}
    <vbox class="suggestions" role="listbox" aria-label={$t`Suggestions *=> List of suggested persons for the search`}>
      <hbox class="suggestions-header">{$t`People *=> or Persons - Short word, less than 10 characters`}</hbox>
      {#each suggestions as person, index (person)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <hbox class="suggestion" class:active={index == activeSuggestion}
          role="option" aria-selected={index == activeSuggestion}
          on:mousedown|preventDefault={() => pickPerson(person)}>
          <PersonCircle name={person.name} picture={person.picture} size={24} />
          <vbox class="suggestion-text">
            <span class="suggestion-name">{person.name}</span>
            <span class="suggestion-address">{person.emailAddresses.sortBy(entry => entry.preference).first?.value ?? ""}</span>
          </vbox>
        </hbox>
      {/each}
    </vbox>
  {/if}
  {#if $isAdvancedSearchOpen && draft}
    <vbox class="advanced-popup">
      <SearchCriteria bind:draft account={$selectedAccount} folder={$selectedFolder} on:search={onAdvancedSearch} />
    </vbox>
  {/if}
</vbox>
<svelte:window on:mousedown={onClickOutside} />

<script lang="ts" context="module">
  import { writable } from "svelte/store";

  export const mailSearchInput = writable<HTMLInputElement | null>(null);
</script>

<script lang="ts">
  import { globalSearchTerm } from "../../../frontend/AppsBar/selectedApp";
  import { selectedAccount, selectedFolder } from "../../../frontend/Mail/Selected";
  import { isScopeAvailable, effectiveScope, scopeLabel, SearchScope } from "./MailSearch";
  import { isAdvancedSearchOpen, searchOptions } from "../Selected";
  import { AdvancedSearchDraft } from "./AdvancedSearchDraft";
  import SearchCriteria from "./SearchCriteria.svelte";
  import { searchPersons } from "../Composer/SelectNames";
  import type { Person } from "../../../logic/Abstract/Person";
  import { appGlobal } from "../../../logic/app";
  import PersonCircle from "../../Contacts/Person/PersonCircle.svelte";
  import Menu from "../../Shared/Menu/Menu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import SearchIcon from "lucide-svelte/icons/search";
  import ClearIcon from "lucide-svelte/icons/x";
  import ChevronIcon from "lucide-svelte/icons/chevron-down";
  import ChevronUpIcon from "lucide-svelte/icons/chevron-up";
  import { get } from "svelte/store";
  import { onDestroy } from "svelte";
  import { t } from "../../../l10n/l10n";

  const scopes = [SearchScope.AllAccounts, SearchScope.CurrentAccount, SearchScope.CurrentFolder];
  $: scope = effectiveScope($searchOptions, $selectedAccount, $selectedFolder);

  let boxEl: HTMLElement;
  let inputEl: HTMLInputElement;
  $: $mailSearchInput = inputEl ?? null;
  onDestroy(() => $mailSearchInput = null);
  let scopeButton: HTMLButtonElement;
  let isScopeOpen = false;
  let draft: AdvancedSearchDraft = null;

  let typed = $globalSearchTerm ?? "";
  $: takeGlobalTerm($globalSearchTerm);
  function takeGlobalTerm(term: string | null) {
    if ((term ?? "") != typed.toLowerCase()) {
      typed = term ?? "";
    }
  }

  function onInput() {
    $globalSearchTerm = typed.toLowerCase() || null;
  }

  let isInputFocused = false;
  let activeSuggestion = -1;
  $: suggestions = isInputFocused && typed.trim().length >= 2
    ? searchPersons(appGlobal.addressbooks, typed.trim(), true).contents.slice(0, 5)
    : [];
  $: typed, activeSuggestion = -1;

  function pickPerson(person: Person) {
    typed = "";
    $globalSearchTerm = null;
    isInputFocused = false;
    $searchOptions = { ...$searchOptions, person, isOutgoing: null };
  }

  function onClear() {
    typed = "";
    $globalSearchTerm = null;
    inputEl?.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (suggestions.length && (event.key == "ArrowDown" || event.key == "ArrowUp")) {
      event.preventDefault();
      let next = activeSuggestion + (event.key == "ArrowDown" ? 1 : -1);
      activeSuggestion = Math.max(-1, Math.min(suggestions.length - 1, next));
      return;
    }
    if (event.key == "Enter" && activeSuggestion >= 0 && suggestions[activeSuggestion]) {
      event.preventDefault();
      pickPerson(suggestions[activeSuggestion]);
      return;
    }
    if (event.key == "Escape" && suggestions.length) {
      event.preventDefault();
      event.stopPropagation();
      isInputFocused = false;
      return;
    }
    if (event.key == "Escape" && $isAdvancedSearchOpen) {
      event.preventDefault();
      event.stopPropagation();
      closeAdvanced();
    }
  }

  $: updateDraft($isAdvancedSearchOpen);
  function updateDraft(isOpen: boolean) {
    draft = isOpen ? draft ?? new AdvancedSearchDraft(get(searchOptions), get(globalSearchTerm)) : null;
  }

  function openAdvanced() {
    $isAdvancedSearchOpen = true;
  }

  function closeAdvanced() {
    $isAdvancedSearchOpen = false;
  }

  function onAdvancedSearch() {
    $searchOptions = draft.toOptions();
    $globalSearchTerm = draft.keywords.trim().toLowerCase() || null;
    closeAdvanced();
  }

  function onClickOutside(event: MouseEvent) {
    if (!$isAdvancedSearchOpen) {
      return;
    }
    let target = event.target as HTMLElement;
    if (boxEl?.contains(target) || target?.closest?.("dialog, .popup, .submenu-layer")) {
      return;
    }
    closeAdvanced();
  }
</script>

<style>
  .mail-search-box {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    app-region: no-drag;
  }
  .search {
    height: 30px;
    box-sizing: border-box;
    padding: 0 2px 0 0;
    gap: 6px;
    align-items: center;
    background-color: var(--lo-input-bg);
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
    color: var(--lo-fg-secondary);
  }
  .search:hover {
    border-color: var(--lo-border-strong);
  }
  .search:focus-within {
    border-color: var(--lo-border-strong);
    border-bottom: 2px solid var(--lo-accent);
  }
  .scope {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 100%;
    max-width: 40%;
    padding: 0 8px 0 10px;
    border: none;
    border-radius: var(--lo-radius-small) 0 0 var(--lo-radius-small);
    background-color: transparent;
    color: var(--lo-fg);
    font: inherit;
    font-size: 13px;
    white-space: nowrap;
  }
  .scope:hover,
  .scope[aria-expanded="true"] {
    background-color: var(--lo-hover-bg);
  }
  .scope-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .divider {
    align-self: stretch;
    width: 1px;
    margin: 5px 4px 5px 0;
    background-color: var(--lo-divider);
  }
  input {
    flex: 1 1 0;
    min-width: 0;
    border: none;
    background-color: transparent;
    color: var(--lo-fg);
    font: inherit;
    font-size: var(--lo-font-size);
    outline: none;
  }
  input::-webkit-search-cancel-button {
    display: none;
  }
  .icon-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background-color: transparent;
    color: var(--lo-fg-secondary);
  }
  .icon-button:hover,
  .icon-button.open {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  .suggestions {
    position: absolute;
    top: calc(100% + 4px);
    inset-inline: 0;
    z-index: 20;
    padding: 4px 0;
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius);
    background-color: var(--lo-pane-bg);
    box-shadow: var(--lo-shadow-popup);
    color: var(--lo-fg);
    app-region: no-drag;
  }
  .suggestions-header {
    padding: 4px 12px;
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
    font-weight: 600;
  }
  .suggestion {
    align-items: center;
    gap: 10px;
    padding: 4px 12px;
    cursor: default;
  }
  .suggestion:hover,
  .suggestion.active {
    background-color: var(--lo-hover-bg);
  }
  .suggestion-text {
    min-width: 0;
  }
  .suggestion-name,
  .suggestion-address {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .suggestion-address {
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
  .advanced-popup {
    position: absolute;
    top: calc(100% + 4px);
    inset-inline: 0;
    min-width: 440px;
    z-index: 20;
    padding: 16px;
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius);
    background-color: var(--lo-pane-bg);
    box-shadow: var(--lo-shadow-popup);
    color: var(--lo-fg);
    app-region: no-drag;
  }
</style>
