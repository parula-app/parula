<FolderLine {folder} {depth} {isFavorite} bind:selectedFolder />
{#if isExpanded && $subFolders.hasItems}
  {#each $sortedSubFolders.each as subFolder (subFolder)}
    <svelte:self folder={subFolder} depth={depth + 1} bind:selectedFolder />
  {/each}
{/if}

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import FolderLine from "./FolderLine.svelte";

  export let folder: Folder;
  export let depth = 0;
  export let isFavorite = false;
  export let selectedFolder: Folder;

  $: subFolders = folder.subFolders;
  $: sortedSubFolders = folder.subFolders.sortBy(subFolder => subFolder.orderPos);
  /* <copied from="FolderLine.svelte"> */
  const expandedIDs = getLocalStorage<string[]>("lookout.mail.expandedFolders", []);
  $: nodeID = folder.account?.id + "/" + folder.id;
  $: isExpanded = !isFavorite && ($expandedIDs.value ?? []).includes(nodeID);
  /* </copied> */
</script>
