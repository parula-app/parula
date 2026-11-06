<button type="button" class="lo-menuitem {classes}"
  class:checked={isChecked}
  class:danger
  class:disabled={!!disabled}
  disabled={!!disabled}
  role={checkable ? "menuitemcheckbox" : "menuitem"}
  aria-checked={checkable ? !!isChecked : undefined}
  aria-haspopup={hasSubMenu ? "menu" : undefined}
  title={tooltipCalc}
  tabindex="-1"
  on:click={onClicked}
  bind:this={buttonEl}>
  <span class="icon-column">
    {#if icon}
      <span class="icon"><svelte:component this={icon} size="16" /></span>
    {:else if $$slots.icon}
      <span class="icon"><slot name="icon" /></span>
    {:else if isChecked}
      <span class="check"><CheckIcon size="16" /></span>
    {/if}
  </span>
  <span class="label">
    {#if $$slots.label}
      <slot name="label" />
    {:else}
      {label}
    {/if}
  </span>
  {#if shortCutInfo}
    <span class="shortcut">{shortCutInfo}</span>
  {/if}
  {#if hasSubMenu}
    <span class="submenu-arrow"><ChevronRightIcon size="14" /></span>
  {/if}
</button>

<script lang="ts">
  import { showError } from "../../../frontend/Util/error";
  import CheckIcon from "lucide-svelte/icons/check";
  import ChevronRightIcon from "lucide-svelte/icons/chevron-right";
  import { getContext } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let label: string = null;
  export let icon: ConstructorOfATypedSvelteComponent = null;
  export let onClick: (event: Event) => void = null;
  export let disabled: boolean | string = false;
  export let tooltip: string = null;
  export let shortCutInfo: string = null;
  export let checked = false;
  export let selected = false;
  export let checkable = false;
  export let danger = false;
  export let hasSubMenu = false;
  export let keepOpen = false;
  export let classes = "";
  export let errorCallback = showError;
  export let buttonEl: HTMLButtonElement = null;

  $: isChecked = !!checked || selected;
  $: tooltipCalc = typeof disabled == "string"
    ? disabled
    : tooltip ?? (shortCutInfo && label ? label + "\n\n" + $t`Shortcut: ${shortCutInfo}` : null);

  const closeMenu = getContext<() => void>("onMenuClose");

  async function onClicked(event: Event) {
    if (disabled || !onClick) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    if (!keepOpen) {
      closeMenu?.();
    }
    try {
      await onClick(event);
    } catch (ex) {
      errorCallback(ex);
    }
  }
</script>

<style>
  .lo-menuitem {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex: 0 0 auto;
    width: 100%;
    min-height: 30px;
    margin: 0;
    padding: 0 10px 0 0;
    box-sizing: border-box;
    border: none;
    border-radius: var(--lo-radius-small);
    background-color: transparent;
    color: var(--lo-fg);
    font-family: inherit;
    font-size: var(--lo-font-size);
    text-align: start;
    white-space: nowrap;
    cursor: default;
  }
  .lo-menuitem:hover:not(.disabled),
  .lo-menuitem:focus-visible {
    background-color: var(--lo-hover-bg);
    outline: none;
  }
  .lo-menuitem:active:not(.disabled) {
    background-color: var(--lo-pressed-bg);
  }
  .lo-menuitem.disabled {
    color: var(--lo-fg-disabled);
  }
  .lo-menuitem.danger:not(.disabled) {
    color: var(--lo-danger);
  }
  .icon-column {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 36px;
    height: 30px;
  }
  .icon,
  .check {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: var(--lo-radius-small);
    color: var(--lo-accent-text);
  }
  .lo-menuitem.accept .icon {
    color: var(--lo-success);
  }
  .lo-menuitem.decline .icon {
    color: var(--lo-danger);
  }
  .disabled .icon,
  .disabled .check {
    color: var(--lo-fg-disabled);
  }
  .checked .icon {
    background-color: var(--lo-selected-bg);
    box-shadow: inset 0 0 0 1px var(--lo-selected-hover-bg);
  }
  .check {
    color: var(--lo-fg);
  }
  .label {
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .shortcut {
    flex: 0 0 auto;
    margin-inline-start: 32px;
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
  .submenu-arrow {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    margin-inline-start: 24px;
    color: var(--lo-fg-secondary);
  }
</style>
