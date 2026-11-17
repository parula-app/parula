{#each $sortedFolders.each as folder (folder)}
  {@const disabledReason = disableFolder(folder)}
  <button type="button" class="node"
    class:selected={selectedFolder == folder}
    class:disabled={!!disabledReason}
    style="--depth: {depth};"
    role="treeitem"
    aria-selected={selectedFolder == folder}
    title={typeof disabledReason == "string" ? disabledReason : folder.fullPath}
    on:click={() => onSelect(folder, disabledReason)}
    on:dblclick={() => !disabledReason && dispatch("choose")}>
    <FolderIcon {folder} size="16px" />
    <span class="name">{FolderTreeActions.displayName(folder)}</span>
  </button>
  <svelte:self folders={folder.subFolders} depth={depth + 1} {disableFolder} bind:selectedFolder bind:selectedAccount on:choose />
{/each}

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { FolderTreeActions } from "./FolderTreeActions";
  import FolderIcon from "../../../frontend/Mail/LeftPane/FolderIcon.svelte";
  import type { Collection } from "svelte-collections";
  import { createEventDispatcher } from "svelte";

  export let folders: Collection<Folder>;
  export let depth = 1;
  export let selectedFolder: Folder | null = null;
  export let selectedAccount: MailAccount | null = null;
  export let disableFolder: (folder: Folder) => string | false = () => false;

  const dispatch = createEventDispatcher<{ choose: void }>();

  $: sortedFolders = folders.sortBy(folder => folder.orderPos);

  function onSelect(folder: Folder, disabledReason: string | false) {
    if (disabledReason) {
      return;
    }
    selectedFolder = folder;
    selectedAccount = folder.account;
  }
</script>

<style>
  .node {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-shrink: 0;
    gap: 6px;
    height: 28px;
    padding: 0 8px 0 calc(8px + var(--depth) * 16px);
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .node:hover:not(.disabled) {
    background-color: var(--lo-hover-bg);
  }
  .node.selected {
    background-color: var(--lo-selected-bg);
  }
  .node.disabled {
    color: var(--lo-fg-disabled);
    cursor: default;
  }
  .node :global(svg) {
    flex-shrink: 0;
    color: var(--lo-fg-secondary);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
