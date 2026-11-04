<hbox class="section-header">
  <CollapsibleHeader label={account ? $account.name : label} tooltip={account ? $account.emailAddress : tooltip} {collapsed} large={!!account}
    on:click={() => setCollapsed(!collapsed)}
    on:contextmenu={onContextMenu}>
    {#if account && $account.fatalError}
      <span class="error" title={$account.fatalError.message}>
        <ErrorIcon size={14} />
      </span>
    {/if}
  </CollapsibleHeader>
  {#if account && !$account.isLoggedIn}
    <ConnectButton {account} />
  {/if}
</hbox>
{#if account}
  <ContextMenu bind:this={contextMenu}>
    <AccountMenu {account} />
  </ContextMenu>
{/if}

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import AccountMenu from "./AccountMenu.svelte";
  import ConnectButton from "./ConnectButton.svelte";
  import CollapsibleHeader from "../../Shared/CollapsibleHeader.svelte";
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import ErrorIcon from "lucide-svelte/icons/circle-alert";

  export let id: string;
  export let label: string = null;
  export let tooltip: string = null;
  export let account: MailAccount = null;

  const collapsedIDs = getLocalStorage<string[]>("lookout.mail.collapsedSections", []);
  $: collapsed = ($collapsedIDs.value ?? []).includes(id);

  function setCollapsed(isCollapsed: boolean) {
    let ids = ($collapsedIDs.value ?? []).filter(existing => existing != id);
    if (isCollapsed) {
      ids.push(id);
    }
    $collapsedIDs.value = ids;
  }

  let contextMenu: ContextMenu;
  function onContextMenu(event: MouseEvent) {
    if (!contextMenu) {
      return;
    }
    event.preventDefault();
    contextMenu.onContextMenu(event);
  }
</script>

<style>
  .section-header {
    align-items: end;
    flex-shrink: 0;
  }
  .section-header > :global(.collapsible-header) {
    flex: 1 1 0;
    min-width: 0;
  }
  .section-header > :global(button.connect) {
    height: 28px;
    margin-inline-start: 2px;
  }
  .error {
    display: flex;
    flex-shrink: 0;
    color: var(--lo-danger);
  }
</style>
