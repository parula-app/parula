{#each $foldersSorted.each as folder (folder)}
  <FolderNode {folder} depth={0} bind:selectedFolder />
{:else}
  {#if !$account.isLoggedIn}
    <hbox class="empty">
      <span>{$t`Not connected`}</span>
      <ConnectButton {account} withLabel />
    </hbox>
  {/if}
{/each}
<SearchFoldersNode folders={accountSearches}
  nodeID={account.id + "/search-folders"} bind:selectedFolder />

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import type { Folder } from "../../../logic/Mail/Folder";
  import { savedSearchFolders, type SavedSearchFolder } from "../../../logic/Mail/Virtual/SavedSearchFolder";
  import FolderNode from "./FolderNode.svelte";
  import SearchFoldersNode from "./SearchFoldersNode.svelte";
  import ConnectButton from "./ConnectButton.svelte";
  import { t } from "../../../l10n/l10n";
  import type { Collection } from "svelte-collections";

  export let folders: Collection<Folder>;
  export let selectedFolder: Folder;
  export let account: MailAccount;

  $: foldersSorted = $folders.sortBy(f => f.orderPos);

  const accountSearches = savedSearchFolders.filterObservable(isOfAccount);
  $: account, filterSearches();
  function filterSearches() {
    accountSearches.replaceAll(savedSearchFolders.contents.filter(isOfAccount));
  }

  function isOfAccount(folder: SavedSearchFolder): boolean {
    return folder.search.account == account;
  }
</script>

<style>
  .empty {
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 4px 8px 4px 28px;
    color: var(--lo-fg-secondary);
    font-size: 13px;
  }
</style>
