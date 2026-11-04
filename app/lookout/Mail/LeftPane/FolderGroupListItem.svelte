<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="account-row"
  class:selected
  role="option"
  tabindex="-1"
  aria-selected={selected}
  on:click>
  <hbox class="icon">
    <svelte:component this={icon} size={16} />
  </hbox>
  <span class="name">{label}</span>
  <hbox flex />
  {#if $unread > 0}
    <span class="count">{$unread}</span>
  {/if}
</div>

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import { FolderTreeActions } from "./FolderTreeActions";

  export let label: string;
  export let icon: ConstructorOfATypedSvelteComponent;
  export let inbox: Folder | null = null;
  export let selected = false;

  $: unread = FolderTreeActions.countStore(inbox, false);
</script>

<style>
  /* <copied from="AccountListItem.svelte"> */
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
</style>
