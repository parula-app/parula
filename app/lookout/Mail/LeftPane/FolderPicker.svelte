<vbox class="folder-picker" role="tree" aria-label={label}>
  {#each $accounts.each as account (account.id)}
    <button type="button" class="node account"
      class:selected={allowAccount && selectedAccount == account && !selectedFolder}
      class:disabled={!allowAccount}
      role="treeitem"
      aria-selected={allowAccount && selectedAccount == account && !selectedFolder}
      on:click={() => onSelectAccount(account)}
      on:dblclick={() => allowAccount && dispatch("choose")}
      title={account.emailAddress}>
      <AccountIcon size={16} />
      <span class="name">{account.name}</span>
    </button>
    <FolderPickerNode folders={account.rootFolders} depth={1} {disableFolder} bind:selectedFolder bind:selectedAccount on:choose />
  {/each}
</vbox>

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { appGlobal } from "../../../logic/app";
  import FolderPickerNode from "./FolderPickerNode.svelte";
  import AccountIcon from "lucide-svelte/icons/at-sign";
  import { createEventDispatcher } from "svelte";

  export let label: string;
  export let selectedFolder: Folder | null = null;
  export let selectedAccount: MailAccount | null = null;
  export let allowAccount = false;
  export let disableFolder: (folder: Folder) => string | false = () => false;

  const dispatch = createEventDispatcher<{ choose: void }>();
  const accounts = appGlobal.emailAccounts;

  function onSelectAccount(account: MailAccount) {
    if (!allowAccount) {
      return;
    }
    selectedAccount = account;
    selectedFolder = null;
  }
</script>

<style>
  .folder-picker {
    min-height: 240px;
    max-height: 360px;
    padding: 4px;
    overflow-y: auto;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
  }
  .node {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-shrink: 0;
    gap: 6px;
    height: 28px;
    padding: 0 8px;
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
  .node.account {
    font-weight: 600;
  }
  .node.account.disabled {
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
