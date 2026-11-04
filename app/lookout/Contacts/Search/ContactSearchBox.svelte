<hbox class="contact-search-box" class:active={!!$options.term}>
  <SearchIcon size="16" />
  <input type="search" bind:this={inputEl}
    value={$options.term ?? ""}
    {placeholder}
    aria-label={placeholder}
    on:input={event => $options = { ...$options, term: event.currentTarget.value || null }}
    on:keydown={onKeyDown} />
  {#if $options.term}
    <button class="clear" title={$t`Close Search`} aria-label={$t`Close Search`}
      on:click={closeSearch}>
      <CloseIcon size="14" />
    </button>
  {/if}
</hbox>

<script lang="ts" context="module">
  import { writable } from "svelte/store";

  export const contactSearchInput = writable<HTMLInputElement | null>(null);
</script>

<script lang="ts">
  import { defaultContactSearchOptions } from "../ContactSearch";
  import { contactSearchOptions as options } from "../Person/Selected";
  import SearchIcon from "lucide-svelte/icons/search";
  import { onDestroy } from "svelte";
  import CloseIcon from "lucide-svelte/icons/x";
  import { t } from "../../../l10n/l10n";

  export let placeholder: string;

  let inputEl: HTMLInputElement;
  $: $contactSearchInput = inputEl ?? null;
  onDestroy(() => $contactSearchInput = null);

  // <copied from="../ContactsAppD.svelte">
  function closeSearch() {
    $options = defaultContactSearchOptions($options.scope);
  }
  // </copied>

  function onKeyDown(event: KeyboardEvent) {
    if (event.key == "Escape") {
      event.preventDefault();
      closeSearch();
    }
  }
</script>

<style>
  .contact-search-box {
    flex: 1;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 4px 0 10px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
    color: var(--lo-fg-secondary);
  }
  .contact-search-box:focus-within {
    border-color: var(--lo-accent);
    box-shadow: inset 0 -1px 0 var(--lo-accent);
  }
  input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--lo-fg);
    font: inherit;
  }
  input::-webkit-search-cancel-button {
    display: none;
  }
  .clear {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
    cursor: pointer;
  }
  .clear:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
</style>
