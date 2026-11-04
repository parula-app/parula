<button class="addressbook-item nav-entry"
  class:selected={isSelected}
  class:indented
  on:click
  on:contextmenu={onContextMenu}
  title={addressbook ? $addressbook.name : label}
  aria-current={isSelected}>
  <svelte:component this={icon} size={16} class="icon" />
  <span class="name">{addressbook ? $addressbook.name : label}</span>
  {#if shownCount}
    <span class="count">{shownCount}</span>
  {/if}
</button>

{#if addressbook}
  <ContextMenu bind:this={contextMenu}>
    {#if isWritable}
      <MenuItem label={$t`Rename Folder`} icon={RenameIcon}
        onClick={() => isRenaming = true} />
    {/if}
    {#if $addressbooks.contains(addressbook) && !addressbook.mainAccount}
      <MenuItem label={$t`Delete Folder`} icon={DeleteIcon}
        onClick={() => ContactActions.deleteFolder(addressbook)} />
    {/if}
    {#if addressbook.canSync}
      <MenuItem label={$t`Update Folder`} icon={SyncIcon}
        onClick={() => ContactActions.sync(addressbook)} />
    {/if}
    <MenuDivider />
    <MenuItem label={$t`Properties… *=> Show the settings of the selected folder`} icon={PropertiesIcon}
      onClick={() => isPropertiesOpen = true} />
  </ContextMenu>
  {#if isRenaming}
    <RenameDialog account={addressbook} title={$t`Rename Folder`} on:close={() => isRenaming = false} />
  {/if}
  {#if isPropertiesOpen}
    <AddressBookPropertiesDialog {addressbook} on:close={() => isPropertiesOpen = false} />
  {/if}
{/if}

<script lang="ts">
  import type { Addressbook } from "../../logic/Contacts/Addressbook";
  import { ContactActions } from "./ContactActions";
  import { appGlobal } from "../../logic/app";
  import ContextMenu from "../Shared/Menu/ContextMenu.svelte";
  import MenuItem from "../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../Shared/Menu/MenuDivider.svelte";
  import AddressBookPropertiesDialog from "./AddressBookPropertiesDialog.svelte";
  import RenameDialog from "../Settings/Shared/RenameDialog.svelte";
  import AddressbookIcon from "lucide-svelte/icons/book-user";
  import RenameIcon from "lucide-svelte/icons/pencil-line";
  import SyncIcon from "lucide-svelte/icons/refresh-cw";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import PropertiesIcon from "lucide-svelte/icons/file-cog";
  import { t } from "../../l10n/l10n";

  export let addressbook: Addressbook = null;
  export let label: string = null;
  export let icon: ConstructorOfATypedSvelteComponent = AddressbookIcon;
  export let count: number = null;
  export let isSelected = false;
  export let indented = true;

  let contextMenu: ContextMenu;
  const addressbooks = appGlobal.addressbooks;
  let isRenaming = false;
  let isPropertiesOpen = false;

  $: contacts = addressbook?.contacts;
  $: shownCount = count ?? $contacts?.length;
  $: isWritable = addressbook && appGlobal.addressbooks.contains(addressbook);

  function onContextMenu(event: MouseEvent) {
    if (!addressbook) {
      return;
    }
    event.preventDefault();
    contextMenu.onContextMenu(event);
  }
</script>

<style>
  .addressbook-item {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 4px 8px;
    border: none;
    background: none;
    color: var(--lo-fg);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .addressbook-item.indented {
    padding-inline-start: 28px;
  }
  .addressbook-item :global(.icon) {
    flex-shrink: 0;
    color: var(--lo-fg-secondary);
  }
  .addressbook-item.selected :global(.icon) {
    color: var(--lo-accent-text);
  }
  .name {
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .count {
    flex-shrink: 0;
    font-size: var(--lo-font-size-small);
    font-weight: normal;
    color: var(--lo-fg-secondary);
  }
</style>
