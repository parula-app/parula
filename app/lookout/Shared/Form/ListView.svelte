<div class="lo-listview {classes}" style:height style="--lo-listview-columns: {columnTemplate}">
  {#if columns.length}
    <div class="header" role="row">
      {#each columns as column}
        <div class="header-cell" role="columnheader">{column.label}</div>
      {/each}
    </div>
  {/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="rows" role="listbox" tabindex="0" aria-label={label}
    on:keydown={onKeyDown}
    bind:this={rowsEl}>
    {#each items as item, index (item)}
      <div class="row" role="option"
        class:selected={item === selected}
        aria-selected={item === selected}
        on:click={() => select(item)}
        on:dblclick={() => dispatch("open", item)}>
        <slot {item} {index} />
      </div>
    {/each}
    {#if !items.length && $$slots.empty}
      <div class="empty"><slot name="empty" /></div>
    {/if}
  </div>
</div>

<script lang="ts">
  import type { ListViewColumn } from "./ListViewColumn";
  import { createEventDispatcher, tick } from "svelte";

  type T = $$Generic;
  const dispatch = createEventDispatcher<{ select: T, open: T }>();
  export let items: T[] = [];
  export let columns: ListViewColumn[] = [];
  export let selected: T = null;
  export let label: string = null;
  export let height = "200px";
  export let classes = "";

  let rowsEl: HTMLElement;
  $: columnTemplate = columns.length
    ? columns.map(column => column.width ?? "minmax(0, 1fr)").join(" ")
    : "minmax(0, 1fr)";

  async function select(item: T) {
    selected = item;
    dispatch("select", item);
    await tick();
    rowsEl?.querySelector(".row.selected")?.scrollIntoView({ block: "nearest" });
  }

  async function onKeyDown(event: KeyboardEvent) {
    if (event.key == "Enter" && selected) {
      event.preventDefault();
      event.stopPropagation();
      dispatch("open", selected);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !items.length) {
      return;
    }
    event.preventDefault();
    let pos = items.indexOf(selected);
    let next = event.key == "Home" ? 0
      : event.key == "End" ? items.length - 1
      : event.key == "ArrowDown" ? Math.min(items.length - 1, pos + 1)
      : Math.max(0, pos - 1);
    await select(items[next]);
  }
</script>

<style>
  .lo-listview {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    min-width: 0;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
    overflow: hidden;
  }
  .header,
  .row {
    display: grid;
    grid-template-columns: var(--lo-listview-columns);
    align-items: center;
  }
  .header {
    flex: 0 0 auto;
    min-height: 28px;
    border-bottom: 1px solid var(--lo-divider);
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
  .header-cell {
    padding: 0 8px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .header-cell:not(:last-child) {
    border-inline-end: 1px solid var(--lo-divider);
  }
  .rows {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    outline: none;
  }
  .row {
    min-height: 28px;
    color: var(--lo-fg);
    cursor: default;
  }
  .row > :global(*) {
    min-width: 0;
    padding: 0 8px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .row:hover {
    background-color: var(--lo-hover-bg);
  }
  .row.selected {
    background-color: var(--lo-selected-bg);
    color: var(--lo-selected-fg);
  }
  .rows:focus-visible .row.selected {
    box-shadow: inset 2px 0 0 var(--lo-accent);
  }
  .empty {
    padding: 8px;
    color: var(--lo-fg-secondary);
  }
</style>
