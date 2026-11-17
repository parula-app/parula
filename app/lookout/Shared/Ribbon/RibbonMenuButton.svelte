<div class="ribbon-menu-button">
  <RibbonButtonBase {label} {shortLabel} {icon} {tooltip} {shortCutInfo} {disabled} {size}
    classes="menu-trigger {classes}"
    hasMenu pressed={isMenuOpen}
    onClick={onToggleMenu}
    bind:buttonEl
    />
  <Menu bind:isMenuOpen anchor={buttonEl} placement="bottom-start">
    <slot />
  </Menu>
</div>

<script lang="ts">
  import RibbonButtonBase from "./RibbonButtonBase.svelte";
  import Menu from "../Menu/Menu.svelte";
  import type { RibbonItemSize } from "./RibbonGroup";

  export let label: string;
  export let shortLabel: string = null;
  export let icon: ConstructorOfATypedSvelteComponent = null;
  export let isMenuOpen = false;
  export let disabled: boolean | string = false;
  export let size: RibbonItemSize = "large";
  export let tooltip: string = null;
  export let shortCutInfo: string = null;
  export let classes = "";
  export let buttonEl: HTMLButtonElement = null;

  function onToggleMenu() {
    isMenuOpen = !isMenuOpen;
  }
</script>

<style>
  .ribbon-menu-button {
    display: contents;
  }
</style>
