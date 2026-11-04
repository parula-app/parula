<div class="lo-menu-label" role="presentation" title={tooltip}>
  {#if label}
    {label}
  {:else}
    <slot />
  {/if}
</div>

<script lang="ts">
  export let label: string = null;
  export let tooltip: string = null;
</script>

<style>
  .lo-menu-label {
    flex: 0 0 auto;
    margin: 2px -4px;
    padding: 4px 12px 4px 12px;
    background-color: var(--lo-pane-alt-bg);
    color: var(--lo-fg);
    font-size: var(--lo-font-size-small);
    font-weight: 600;
    white-space: nowrap;
  }
  .lo-menu-label:first-child {
    margin-top: -4px;
    border-radius: var(--lo-radius) var(--lo-radius) 0 0;
  }
</style>
