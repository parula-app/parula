<div class="ribbon-item ribbon-split-button look-{look}" class:disabled={!!disabled} data-size={size}
  bind:this={wrapperEl}>
  <RibbonButtonBase {label} {shortLabel} {icon} {tooltip} {shortCutInfo} {disabled} {size} {errorCallback}
    part="main" isItem={false} classes={classes}
    {onClick}
    bind:buttonEl
    />
  <RibbonButtonBase {label} {shortLabel} {size}
    part="arrow" isItem={false} classes="menu-trigger"
    tooltip={menuTooltip ?? label}
    ariaLabel={menuTooltip ?? label}
    disabled={menuDisabled ?? disabled}
    hasMenu pressed={isMenuOpen}
    onClick={onToggleMenu}
    />
  <Menu bind:isMenuOpen anchor={wrapperEl} placement="bottom-start">
    <slot />
  </Menu>
</div>

<script lang="ts">
  import RibbonButtonBase from "./RibbonButtonBase.svelte";
  import Menu from "../Menu/Menu.svelte";
  import { itemLook, type RibbonGroupLook, type RibbonItemLook, type RibbonItemSize } from "./RibbonGroup";
  import { showError } from "../../../frontend/Util/error";
  import { getContext } from "svelte";
  import { readable, type Readable } from "svelte/store";

  export let label: string;
  export let shortLabel: string = null;
  export let icon: ConstructorOfATypedSvelteComponent = null;
  export let onClick: (event: Event) => void | Promise<void> = null;
  export let disabled: boolean | string = false;
  export let menuDisabled: boolean | string = null;
  export let size: RibbonItemSize = "large";
  export let tooltip: string = null;
  export let menuTooltip: string = null;
  export let shortCutInfo: string = null;
  export let isMenuOpen = false;
  export let classes = "";
  export let errorCallback = showError;
  export let buttonEl: HTMLButtonElement = null;

  const groupLook = getContext<Readable<RibbonGroupLook>>("ribbonGroupLook") ?? readable<RibbonGroupLook>({ layout: "classic", stage: 0, collapsed: false });
  let look: RibbonItemLook;
  $: look = itemLook($groupLook.layout, $groupLook.stage, $groupLook.collapsed, size);

  let wrapperEl: HTMLElement;

  function onToggleMenu() {
    isMenuOpen = !isMenuOpen;
  }
</script>

<style>
  .ribbon-split-button {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    box-sizing: border-box;
    border-radius: var(--lo-radius-small);
  }
  .ribbon-split-button:hover:not(.disabled) {
    box-shadow: inset 0 0 0 1px var(--lo-border);
  }
  .look-large {
    flex-direction: column;
    width: var(--lo-ribbon-large-width);
    height: var(--lo-ribbon-large-height);
  }
  .look-small {
    width: 100%;
    min-width: var(--lo-ribbon-small-width);
    height: var(--lo-ribbon-row-height);
  }
  .look-small-icon {
    width: var(--lo-ribbon-small-icon-width);
    height: var(--lo-ribbon-row-height);
  }
  .look-simplified {
    width: var(--lo-ribbon-simplified-width);
    height: var(--lo-ribbon-button-height);
  }
  .look-simplified-icon {
    width: var(--lo-ribbon-simplified-icon-width);
    height: var(--lo-ribbon-button-height);
  }
  .look-list {
    width: 100%;
    height: var(--lo-ribbon-button-height);
  }
</style>
