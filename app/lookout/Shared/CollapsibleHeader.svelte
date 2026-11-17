<button class="collapsible-header"
  class:large
  on:click
  on:contextmenu
  aria-expanded={!collapsed}
  title={tooltip ?? label}>
  <ChevronIcon size={14} class="chevron {collapsed ? 'collapsed' : ''}" />
  <span class="label">{label}</span>
  <slot />
</button>

<script lang="ts">
  import ChevronIcon from "lucide-svelte/icons/chevron-down";

  export let label: string;
  export let tooltip: string = null;
  export let collapsed = false;
  export let large = false;
</script>

<style>
  .collapsible-header {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-shrink: 0;
    gap: 6px;
    margin-block-start: 8px;
    padding: 4px 8px 4px 4px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg);
    font: inherit;
    font-weight: 600;
    text-align: start;
    cursor: pointer;
  }
  .collapsible-header.large {
    margin-block-start: 12px;
    font-size: 15px;
  }
  .collapsible-header:hover {
    background-color: var(--lo-hover-bg);
  }
  .collapsible-header :global(.chevron) {
    flex-shrink: 0;
    color: var(--lo-fg-secondary);
    transition: transform 0.1s;
  }
  .collapsible-header :global(.chevron.collapsed) {
    transform: rotate(-90deg);
  }
  .label {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
