<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="account-row"
  class:selected
  class:dependent={account.isDependentAccount}
  role="option"
  tabindex="-1"
  aria-selected={selected}
  title={$account.emailAddress}
  on:click
  on:contextmenu={onContextMenu}>
  <hbox class="icon">
    <AccountIcon size={16} />
  </hbox>
  <span class="name">{$account.name}</span>
  {#if $account.fatalError}
    <span class="error" title={$account.fatalError.message}>
      <ErrorIcon size={14} />
    </span>
  {/if}
  <hbox flex />
  {#if !$account.isLoggedIn}
    <ConnectButton {account} />
  {:else if $unread > 0}
    <span class="count">{$unread}</span>
  {/if}
</div>
<ContextMenu bind:this={contextMenu}>
  <AccountMenu {account} />
</ContextMenu>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { FolderTreeActions } from "./FolderTreeActions";
  import AccountMenu from "./AccountMenu.svelte";
  import ConnectButton from "./ConnectButton.svelte";
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import AccountIcon from "lucide-svelte/icons/at-sign";
  import ErrorIcon from "lucide-svelte/icons/circle-alert";

  export let account: MailAccount;
  export let selected = false;

  $: rootFolders = account.rootFolders;
  $: inbox = $rootFolders && account.inbox;
  $: unread = FolderTreeActions.countStore(inbox, false);

  let contextMenu: ContextMenu;
  function onContextMenu(event: MouseEvent) {
    event.preventDefault();
    contextMenu.onContextMenu(event);
  }
</script>

<style>
  /* <copied to="FolderGroupListItem.svelte"> */
  .account-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-shrink: 0;
    position: relative;
    height: 30px;
    padding-inline: 8px;
    border-radius: var(--lo-radius-small);
    color: var(--lo-fg);
    cursor: pointer;
    user-select: none;
  }
  .account-row:hover {
    background-color: var(--lo-hover-bg);
  }
  .account-row.selected {
    background-color: var(--lo-selected-bg);
    font-weight: 600;
  }
  .account-row.selected::before {
    content: "";
    position: absolute;
    inset-inline-start: 0;
    top: 7px;
    bottom: 7px;
    width: 3px;
    border-radius: 2px;
    background-color: var(--lo-accent);
  }
  .account-row.selected:hover {
    background-color: var(--lo-selected-hover-bg);
  }
  .icon {
    flex-shrink: 0;
    margin-inline: 2px 8px;
    color: var(--lo-fg-secondary);
  }
  .selected .icon {
    color: var(--lo-accent-text);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .count {
    flex-shrink: 0;
    margin-inline-start: 8px;
    color: var(--lo-accent-text);
    font-size: 13px;
    font-weight: 600;
  }
  /* </copied> */
  .account-row.dependent {
    padding-inline-start: 24px;
  }
  .error {
    display: flex;
    flex-shrink: 0;
    margin-inline-start: 4px;
    color: var(--lo-danger);
  }
</style>
