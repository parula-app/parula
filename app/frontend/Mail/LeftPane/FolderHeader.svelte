<!-- Appears above the msg list -->
{#if account && !$account?.isLoggedIn || searchMessages || appGlobal.isMobile}
  <hbox class="folder-header font-normal">
    {#if searchMessages}
      {$t`Search results`}
    {:else if appGlobal.isMobile && folder}
      <hbox class="folder-name font-normal">
        {folder.name}
      </hbox>
    {/if}
    <hbox flex />
    {#if account && !$account?.isLoggedIn}
      <Button plain
        label={$t`Login`}
        icon={DisconnectedIcon}
        onClick={login}
        iconSize="16px" />
    {/if}
    <hbox flex />
    {#if $account?.isLoggedIn}
      <FolderMsgCount {folder} {searchMessages} />
    {/if}
  </hbox>
{/if}

<script lang="ts">
  import type { Folder } from '../../../logic/Mail/Folder';
  import type { EMail } from '../../../logic/Mail/EMail';
  import { appGlobal } from '../../../logic/app';
  import FolderMsgCount from './FolderMsgCount.svelte';
  import Button from '../../Shared/Button.svelte';
  import DisconnectedIcon from "lucide-svelte/icons/unplug";
  import { t } from '../../../l10n/l10n';
  import type { ArrayColl } from 'svelte-collections';

  export let folder: Folder;
  export let searchMessages: ArrayColl<EMail> | null; /** in */

  $: account = folder?.account;

  async function login() {
    await account.loginAndStartup(true);
  }
</script>

<style>
  .folder-header {
    align-items: center;
    justify-content: start;
    padding-block: 2px;
    padding-inline: 16px;
    color: var(--leftbar-fg);
    background-color: var(--leftbar-bg);
    box-shadow: 2px 0px 6px 0px rgba(0, 0, 0, 10%);
  }
  .folder-header :global(button) {
    margin-inline-end: 12px;
  }
  .folder-name {
    opacity: 70%;
    font-weight: bold;
  }
</style>
