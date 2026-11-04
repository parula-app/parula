<div class="ribbon-item fixed-width ribbon-textbox look-{look}" class:disabled={!!disabled} data-size="small"
  style:width
  title={typeof disabled == "string" ? disabled : tooltip ?? label}
  bind:this={wrapperEl}>
  {#if icon}
    <span class="icon"><svelte:component this={icon} size="14" /></span>
  {/if}
  <input type="text"
    bind:value
    bind:this={inputEl}
    {placeholder}
    aria-label={label}
    disabled={!!disabled}
    on:keydown={onKeyDown}
    on:input={() => dispatch("input", value)} />
  {#if $$slots.list}
    <button class="dropdown menu-trigger" tabindex="-1" aria-label={label} disabled={!!disabled}
      on:click|stopPropagation={onToggleList}>
      <ChevronDownIcon size="12" />
    </button>
    <Menu bind:isMenuOpen={isListOpen} anchor={wrapperEl} placement="bottom-start" autoFocus={false}
      on:close={() => inputEl?.focus()}
      bind:this={menu}>
      <slot name="list" />
    </Menu>
  {/if}
</div>

<script lang="ts">
  import Menu from "../Menu/Menu.svelte";
  import { itemLook, type RibbonGroupLook, type RibbonItemLook } from "./RibbonGroup";
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
  import { createEventDispatcher, getContext } from "svelte";
  import { readable, type Readable } from "svelte/store";
  const dispatch = createEventDispatcher<{ input: string, enter: string }>();

  export let label: string;
  export let value = "";
  export let placeholder: string = null;
  export let icon: ConstructorOfATypedSvelteComponent = null;
  export let width = "var(--lo-ribbon-small-width)";
  export let disabled: boolean | string = false;
  export let tooltip: string = null;
  export let isListOpen = false;
  export let inputEl: HTMLInputElement = null;

  const groupLook = getContext<Readable<RibbonGroupLook>>("ribbonGroupLook") ?? readable<RibbonGroupLook>({ layout: "classic", stage: 0, collapsed: false });
  let look: RibbonItemLook;
  $: look = itemLook($groupLook.layout, $groupLook.stage, $groupLook.collapsed, "small");

  let wrapperEl: HTMLElement;
  let menu: Menu;

  function onToggleList() {
    isListOpen = !isListOpen;
    inputEl?.focus();
  }

  async function onKeyDown(event: KeyboardEvent) {
    if (event.key == "ArrowDown" && $$slots.list) {
      event.preventDefault();
      isListOpen = true;
      await menu?.focusFirstItem();
    } else if (event.key == "Escape" && isListOpen) {
      event.stopPropagation();
      isListOpen = false;
    } else if (event.key == "Enter" && !event.isComposing) {
      event.preventDefault();
      isListOpen = false;
      dispatch("enter", value);
    }
  }
</script>

<style>
  .ribbon-textbox {
    display: flex;
    align-items: center;
    box-sizing: border-box;
    height: calc(var(--lo-ribbon-row-height) - 1px);
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
    color: var(--lo-fg);
    font-size: var(--lo-font-size-small);
  }
  .ribbon-textbox:hover:not(.disabled) {
    border-color: var(--lo-border-strong);
  }
  .ribbon-textbox:focus-within {
    border-color: var(--lo-accent);
  }
  .ribbon-textbox.disabled {
    background-color: var(--lo-pane-alt-bg);
    color: var(--lo-fg-disabled);
  }
  .look-simplified,
  .look-simplified-icon,
  .look-list {
    height: calc(var(--lo-ribbon-button-height) - 4px);
    font-size: 13px;
  }
  .icon {
    display: flex;
    flex: 0 0 auto;
    padding-inline-start: 5px;
    color: var(--lo-fg-secondary);
  }
  input {
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
    box-sizing: border-box;
    padding: 0 5px;
    border: none;
    outline: none;
    background: transparent;
    color: inherit;
    font: inherit;
  }
  input::placeholder {
    color: var(--lo-fg-secondary);
  }
  .dropdown {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 18px;
    height: 100%;
    padding: 0;
    border: none;
    border-inline-start: 1px solid var(--lo-divider);
    background: transparent;
    color: var(--lo-fg-secondary);
  }
  .dropdown:hover:not(:disabled) {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
</style>
