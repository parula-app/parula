<!-- macOS: At the bottom of the left bar of each app -->
{#if noTitleBar}
  <hbox class="workspace-search-bar" class:compact>
    <WorkspaceButton />
    {#if compact}
      <SearchButton />
    {:else}
      <SearchField bind:searchTerm={$globalSearchTerm} />
    {/if}
  </hbox>
{/if}

<script lang="ts">
  import { noTitleBar } from "./Selected";
  import { globalSearchTerm } from "../AppsBar/selectedApp";
  import WorkspaceButton from "./WorkspaceButton.svelte";
  import SearchButton from "./SearchButton.svelte";
  import SearchField from "../Shared/SearchField.svelte";

  /** Only icons, for apps without a left bar */
  export let compact = false;
</script>

<style>
  .workspace-search-bar {
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
  }
  .workspace-search-bar :global(.search) {
    flex: 1 1 0;
    min-width: 0;
  }
  .compact {
    padding: 4px;
  }
</style>
