<div class="color-palette" role="listbox" aria-label={label} style:grid-template-columns="repeat({columns}, auto)">
  {#each colors as swatch (swatch.color)}
    <button type="button" class="swatch" class:selected={isSelected(swatch.color, selected)}
      role="option" aria-selected={isSelected(swatch.color, selected)}
      title={swatch.name} aria-label={swatch.name}
      style:--swatch-color={swatch.color}
      on:click={() => choose(swatch.color)}>
      {#if isSelected(swatch.color, selected)}
        <CheckIcon size="14" strokeWidth={3} />
      {/if}
    </button>
  {/each}
</div>

<script lang="ts">
  import CheckIcon from "lucide-svelte/icons/check";
  import { createEventDispatcher, getContext } from "svelte";

  export let colors: { name: string, color: string }[];
  export let selected: string | null = null;
  export let label: string;
  export let columns = 5;

  const dispatch = createEventDispatcher<{ select: string }>();
  const closeMenu = getContext<() => void>("onMenuClose");

  function isSelected(color: string, selected: string | null): boolean {
    return color.toLowerCase() == selected?.toLowerCase();
  }

  function choose(color: string) {
    selected = color;
    closeMenu?.();
    dispatch("select", color);
  }
</script>

<style>
  .color-palette {
    display: grid;
    gap: 6px;
    padding: 8px;
  }
  .swatch {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--swatch-color) 70%, var(--lo-fg));
    border-radius: var(--lo-radius-small);
    background-color: var(--swatch-color);
    color: lch(from var(--swatch-color) calc((60 - l) * infinity) 0 0);
    cursor: pointer;
  }
  .swatch:hover {
    outline: 2px solid var(--lo-border-strong);
    outline-offset: 1px;
  }
  .swatch.selected {
    outline: 2px solid var(--lo-accent);
    outline-offset: 1px;
  }
  .swatch:focus-visible {
    outline: 2px solid var(--lo-focus-ring);
    outline-offset: 1px;
  }
</style>
