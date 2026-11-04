<hbox class="slot-button" bind:this={anchorEl}>
  <button type="button" class="main" title={onClick ? $t`Edit the ${slot.label} details` : slot.label}
    on:click={onMainClick}>
    {slot.label}{onClick ? "…" : ""}
  </button>
  <button type="button" class="arrow" aria-label={$t`Choose the field`} aria-haspopup="menu"
    on:click|stopPropagation={() => isMenuOpen = !isMenuOpen}>
    <ChevronDownIcon size="12" />
  </button>
</hbox>
<Menu bind:isMenuOpen anchor={anchorEl} placement="bottom-start">
  {#each slots as listed (listed.id)}
    <MenuItem label={listed.label} checked={!!$entries && !!listed.entryIn(entries)} checkable
      onClick={() => { slot = listed; }} />
  {/each}
</Menu>

<script lang="ts">
  import type { ContactEntry } from "../../../logic/Abstract/Person";
  import type { ContactSlot } from "./ContactSlots";
  import Menu from "../../Shared/Menu/Menu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
  import type { ArrayColl } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  export let slots: readonly ContactSlot[];
  export let slot: ContactSlot;
  export let entries: ArrayColl<ContactEntry>;
  export let onClick: () => void = null;

  let anchorEl: HTMLElement;
  let isMenuOpen = false;

  function onMainClick() {
    if (onClick) {
      onClick();
    } else {
      isMenuOpen = !isMenuOpen;
    }
  }
</script>

<style>
  .slot-button {
    align-items: stretch;
    width: 100%;
    height: 28px;
    box-sizing: border-box;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-pane-bg);
  }
  button {
    display: flex;
    align-items: center;
    padding: 0 8px;
    border: none;
    background: none;
    color: var(--lo-fg);
    font: inherit;
    cursor: pointer;
  }
  .main {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .arrow {
    flex: none;
    padding: 0 6px;
    border-inline-start: 1px solid var(--lo-input-border);
    color: var(--lo-fg-secondary);
  }
  button:hover {
    background-color: var(--lo-hover-bg);
  }
  button:focus-visible {
    outline: 2px solid var(--lo-focus-ring);
    outline-offset: -2px;
  }
</style>
