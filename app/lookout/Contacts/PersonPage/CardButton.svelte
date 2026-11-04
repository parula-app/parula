{#if href}
  <a class="card-button" {href} title={label}>
    <svelte:component this={icon} size={16} />
    <span>{label}</span>
  </a>
{:else}
  <button type="button" class="card-button" disabled={!!disabled}
    title={typeof disabled == "string" ? disabled : label}
    aria-haspopup={hasMenu ? "menu" : undefined}
    on:click={onClicked}>
    <svelte:component this={icon} size={16} />
    <span>{label}</span>
    {#if hasMenu}
      <span class="chevron"><ChevronDownIcon size={12} /></span>
    {/if}
  </button>
{/if}

<script lang="ts">
  import { catchErrors } from "../../../frontend/Util/error";
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";

  export let label: string;
  export let icon: ConstructorOfATypedSvelteComponent;
  export let onClick: (event: MouseEvent) => void | Promise<void> = null;
  export let href: string = null;
  export let disabled: boolean | string = false;
  export let hasMenu = false;

  function onClicked(event: MouseEvent) {
    if (hasMenu) {
      event.stopPropagation();
    }
    catchErrors(() => onClick(event));
  }
</script>

<style>
  .card-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    box-sizing: border-box;
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-pane-bg);
    color: var(--lo-fg);
    font: inherit;
    white-space: nowrap;
    text-decoration: none;
    cursor: pointer;
  }
  .card-button > :global(svg) {
    color: var(--lo-accent-text);
  }
  .chevron {
    display: flex;
    margin-inline-start: -2px;
    color: var(--lo-fg-secondary);
  }
  .card-button:hover:not(:disabled) {
    border-color: var(--lo-border-strong);
    background-color: var(--lo-hover-bg);
  }
  .card-button:disabled {
    color: var(--lo-fg-disabled);
    cursor: default;
  }
  .card-button:disabled > :global(svg) {
    color: var(--lo-fg-disabled);
  }
  .card-button:focus-visible {
    outline: 2px solid var(--lo-focus-ring);
    outline-offset: 1px;
  }
</style>
