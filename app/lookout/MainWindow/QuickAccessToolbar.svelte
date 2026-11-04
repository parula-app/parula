{#if $position.value == placement && $isShown.value}
  <hbox class="quick-access {placement}" role="toolbar" aria-label={$t`Quick Access Toolbar`}>
    {#each shownCommands as command (command.id)}
      <QuickAccessButton {command} />
    {/each}
    <button type="button" class="customize" bind:this={customizeEl}
      class:open={isMenuOpen}
      title={$t`Customize Quick Access Toolbar`} aria-label={$t`Customize Quick Access Toolbar`}
      aria-haspopup="menu" aria-expanded={isMenuOpen}
      data-keytip-qat="customize"
      on:click|stopPropagation={() => isMenuOpen = !isMenuOpen}>
      <CustomizeIcon size={14} />
    </button>
    <Menu bind:isMenuOpen anchor={customizeEl} placement="bottom-start">
      <MenuLabel label={$t`Customize Quick Access Toolbar`} />
      {#each $commands as command (command.id)}
        <MenuItem label={command.label} checkable
          checked={$chosenIDs.value ? $chosenIDs.value.includes(command.id) : !!command.shownByDefault}
          onClick={() => { $chosenIDs.value = toggledQuickAccessIDs(command, $commands, $chosenIDs.value); }} />
      {/each}
      <MenuDivider />
      {#if placement == "above"}
        <MenuItem label={$t`Show Below the Ribbon`} onClick={() => { $position.value = "below"; }} />
      {:else}
        <MenuItem label={$t`Show Above the Ribbon`} onClick={() => { $position.value = "above"; }} />
      {/if}
      <MenuItem label={$t`Hide Quick Access Toolbar`} onClick={() => { $isShown.value = false; }} />
    </Menu>
  </hbox>
{/if}

<script lang="ts" context="module">
  import type { QuickAccessCommand } from "../Shared/QuickAccess/QuickAccess";
  import { writable } from "svelte/store";

  export const quickAccessCommands = writable<QuickAccessCommand[]>([]);
</script>

<script lang="ts">
  import { shownQuickAccessCommands, toggledQuickAccessIDs, type QuickAccessPosition } from "../Shared/QuickAccess/QuickAccess";
  import { getLocalStorage } from "../../frontend/Util/LocalStorage";
  import QuickAccessButton from "./QuickAccessButton.svelte";
  import Menu from "../Shared/Menu/Menu.svelte";
  import MenuItem from "../Shared/Menu/MenuItem.svelte";
  import MenuLabel from "../Shared/Menu/MenuLabel.svelte";
  import MenuDivider from "../Shared/Menu/MenuDivider.svelte";
  import CustomizeIcon from "lucide-svelte/icons/chevron-down";
  import { t } from "../../l10n/l10n";

  export let placement: QuickAccessPosition;

  const position = getLocalStorage<QuickAccessPosition>("lookout.qat.position", "above");
  const isShown = getLocalStorage<boolean>("lookout.quickaction.shown", false);
  const chosenIDs = getLocalStorage<string[] | null>("lookout.qat.commands", null);
  const commands = quickAccessCommands;

  let customizeEl: HTMLButtonElement;
  let isMenuOpen = false;

  $: shownCommands = shownQuickAccessCommands($commands, $chosenIDs.value);
</script>

<style>
  .quick-access {
    align-items: center;
    gap: 2px;
    app-region: no-drag;
  }
  .quick-access.below {
    flex-shrink: 0;
    height: 32px;
    padding: 0 8px;
  }
  .customize {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 28px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg);
  }
  .customize:hover {
    background-color: var(--lo-hover-bg);
  }
  .customize.open {
    background-color: var(--lo-pressed-bg);
  }
</style>
