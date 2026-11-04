<button type="button" class="lo-combobox {classes}"
  class:open={isOpen}
  disabled={!!disabled}
  title={typeof disabled == "string" ? disabled : tooltip ?? selectedOption?.label}
  aria-label={label}
  aria-haspopup="listbox"
  aria-expanded={isOpen}
  style:width
  bind:this={buttonEl}
  on:click|stopPropagation={onToggle}
  on:keydown={onKeyDown}>
  {#if selectedOption?.color}
    <span class="swatch" style:background-color={selectedOption.color}></span>
  {:else if selectedOption?.icon}
    <span class="icon"><svelte:component this={selectedOption.icon} size="16" /></span>
  {/if}
  <span class="value" class:placeholder={!selectedOption}>{selectedOption?.label ?? placeholder ?? ""}</span>
  <span class="chevron"><ChevronDownIcon size="14" /></span>
</button>
<Menu bind:isMenuOpen={isOpen} anchor={buttonEl} placement="bottom-start" autoFocus={false}
  on:close={() => buttonEl?.focus()}
  bind:this={menu}>
  {#if swatchColumns}
    <ColorPalette colors={options.map(option => ({ name: option.label, color: option.color }))}
      selected={selectedOption?.color} {label} columns={swatchColumns}
      on:select={event => select(options.find(option => option.color == event.detail))} />
  {:else}
  <div class="lo-combobox-list" style:min-width={listMinWidth}>
    {#each options as option}
      {#if option.color}
        <MenuItem label={option.label} checked={option.value === value}
          disabled={option.disabled}
          onClick={() => select(option)}>
          <span slot="icon" class="swatch" style:background-color={option.color}></span>
        </MenuItem>
      {:else}
        <MenuItem label={option.label} icon={option.icon} checked={option.value === value}
          disabled={option.disabled}
          onClick={() => select(option)} />
      {/if}
    {/each}
  </div>
  {/if}
</Menu>

<script lang="ts">
  import type { ComboOption } from "./ComboOption";
  import Menu from "../Menu/Menu.svelte";
  import MenuItem from "../Menu/MenuItem.svelte";
  import ColorPalette from "../ColorPalette.svelte";
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
  import { createEventDispatcher } from "svelte";

  type T = $$Generic;
  const dispatch = createEventDispatcher<{ change: T }>();

  export let options: ComboOption<T>[] = [];
  export let value: T = null;
  export let label: string = null;
  export let placeholder: string = null;
  export let disabled: boolean | string = false;
  export let tooltip: string = null;
  export let width: string = null;
  export let classes = "";
  export let buttonEl: HTMLButtonElement = null;
  export let swatchColumns = 0;

  let isOpen = false;
  let menu: Menu;
  let listMinWidth: string = null;
  $: selectedOption = options.find(option => option.value === value);

  function select(option: ComboOption<T>) {
    if (!option || option.disabled || option.value === value) {
      return;
    }
    value = option.value;
    dispatch("change", value);
  }

  async function onToggle() {
    if (isOpen) {
      isOpen = false;
      return;
    }
    listMinWidth = buttonEl ? `${buttonEl.offsetWidth - 10}px` : null;
    isOpen = true;
    await menu?.focusCheckedItem();
  }

  async function onKeyDown(event: KeyboardEvent) {
    if (event.key == "ArrowDown" && event.altKey || event.key == "F4") {
      event.preventDefault();
      await onToggle();
      return;
    }
    if (event.key != "ArrowDown" && event.key != "ArrowUp" && event.key != "Home" && event.key != "End") {
      return;
    }
    event.preventDefault();
    let enabled = options.filter(option => !option.disabled);
    if (!enabled.length) {
      return;
    }
    let pos = enabled.indexOf(selectedOption);
    let next = event.key == "Home" ? 0
      : event.key == "End" ? enabled.length - 1
      : event.key == "ArrowDown" ? Math.min(enabled.length - 1, pos + 1)
      : Math.max(0, pos - 1);
    select(enabled[next]);
  }
</script>

<style>
  .lo-combobox {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    box-sizing: border-box;
    min-width: 0;
    height: 32px;
    margin: 0;
    padding: 0 6px 0 8px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
    color: var(--lo-fg);
    font: inherit;
    text-align: start;
    cursor: default;
  }
  .lo-combobox:hover:not(:disabled),
  .lo-combobox.open {
    border-color: var(--lo-border-strong);
  }
  .lo-combobox:focus-visible {
    outline: none;
    border-color: var(--lo-accent);
    box-shadow: inset 0 -1px 0 var(--lo-accent);
  }
  .lo-combobox:disabled {
    background-color: var(--lo-pane-alt-bg);
    color: var(--lo-fg-disabled);
  }
  .value {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .placeholder {
    color: var(--lo-fg-secondary);
  }
  .icon {
    display: flex;
    color: var(--lo-accent-text);
  }
  .chevron {
    display: flex;
    flex: 0 0 auto;
    color: var(--lo-fg-secondary);
  }
  .swatch {
    flex: 0 0 auto;
    box-sizing: border-box;
    width: 16px;
    height: 16px;
    border: 1px solid rgba(0, 0, 0, 0.2);
    border-radius: 3px;
  }
  .lo-combobox-list {
    display: flex;
    flex-direction: column;
  }
</style>
