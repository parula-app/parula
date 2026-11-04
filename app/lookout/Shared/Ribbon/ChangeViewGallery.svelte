<div class="gallery" role="listbox" aria-label={$t`Change View`} style:grid-template-columns="repeat({views.length}, 80px)">
  {#each views as view (view.id)}
    <button class="tile" class:selected={view.id == currentView}
      role="option" aria-selected={view.id == currentView}
      title={view.tooltip}
      on:click={() => choose(view.id)}>
      <svelte:component this={view.icon} size="28" strokeWidth={1.5} />
      <span class="label">{view.label}</span>
    </button>
  {/each}
</div>

<script lang="ts">
  import { createEventDispatcher, getContext } from "svelte";
  import { t } from "../../../l10n/l10n";

  type T = $$Generic;
  const dispatch = createEventDispatcher<{ change: T }>();

  export let views: { id: T, label: string, icon: ConstructorOfATypedSvelteComponent, tooltip: string }[];
  export let currentView: T;

  const closeMenu = getContext<() => void>("onMenuClose");

  function choose(view: T) {
    closeMenu?.();
    dispatch("change", view);
  }
</script>

<style>
  .gallery {
    display: grid;
    gap: 4px;
    padding: 4px 8px;
  }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 72px;
    padding: 4px;
    border: 1px solid transparent;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-accent-text);
    font: inherit;
    cursor: pointer;
  }
  .tile:hover {
    background-color: var(--lo-hover-bg);
  }
  .tile.selected {
    border-color: var(--lo-accent);
    background-color: var(--lo-selected-bg);
  }
  .label {
    color: var(--lo-fg);
    font-size: var(--lo-font-size-small);
  }
</style>
