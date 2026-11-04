{#if $folders.hasItems}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="search-folders-row" role="treeitem" tabindex="-1" aria-selected="false" aria-expanded={isExpanded}
    on:click={onToggle}>
    <button class="expander" tabindex="-1" on:click|stopPropagation={onToggle}
      aria-label={isExpanded ? $t`Collapse` : $t`Expand`}>
      <ChevronIcon size={12} class="chevron {isExpanded ? 'expanded' : ''}" />
    </button>
    <span class="icon"><SearchFolderIcon size={16} /></span>
    <span class="name">{$t`Search Folders`}</span>
  </div>
  {#if isExpanded}
    {#each $folders.each as folder (folder)}
      <FolderNode {folder} depth={1} bind:selectedFolder />
    {/each}
  {/if}
{/if}

<script lang="ts">
  import type { SavedSearchFolder } from "../../../logic/Mail/Virtual/SavedSearchFolder";
  import type { Folder } from "../../../logic/Mail/Folder";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import FolderNode from "./FolderNode.svelte";
  import ChevronIcon from "lucide-svelte/icons/chevron-right";
  import SearchFolderIcon from "lucide-svelte/icons/folder-search";
  import type { Collection } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  export let folders: Collection<SavedSearchFolder>;
  export let nodeID: string;
  export let selectedFolder: Folder;

  const expandedIDs = getLocalStorage<string[]>("lookout.mail.expandedFolders", []);
  $: isExpanded = ($expandedIDs.value ?? []).includes(nodeID);

  /* <copied from="FolderLine.svelte"> */
  function onToggle() {
    let ids = ($expandedIDs.value ?? []).filter(existing => existing != nodeID);
    if (!isExpanded) {
      ids.push(nodeID);
    }
    $expandedIDs.value = ids;
  }
  /* </copied> */
</script>

<style>
  .search-folders-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-shrink: 0;
    height: 30px;
    padding-inline-end: 8px;
    border-radius: var(--lo-radius-small);
    color: var(--lo-fg);
    cursor: pointer;
    user-select: none;
  }
  .search-folders-row:hover {
    background-color: var(--lo-hover-bg);
  }
  /* <copied from="FolderLine.svelte"> */
  .expander {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    margin-inline-start: 2px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
    cursor: pointer;
  }
  .expander:hover {
    background-color: var(--lo-pressed-bg);
  }
  .expander :global(.chevron) {
    transition: transform 0.1s;
  }
  .expander :global(.chevron.expanded) {
    transform: rotate(90deg);
  }
  .icon {
    flex-shrink: 0;
    margin-inline: 2px 8px;
    color: var(--lo-fg-secondary);
  }
  /* </copied> */
</style>
