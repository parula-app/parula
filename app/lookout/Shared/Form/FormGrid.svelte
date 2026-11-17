<div class="lo-form-grid {classes}" style:grid-template-columns={columns}>
  <slot />
</div>

<script lang="ts">
  export let columns = "max-content minmax(0, 1fr)";
  export let classes = "";
</script>

<style>
  .lo-form-grid {
    display: grid;
    align-items: center;
    column-gap: 12px;
    row-gap: 8px;
  }
  .lo-form-grid > :global(label),
  .lo-form-grid > :global(.lo-form-label) {
    color: var(--lo-fg);
    white-space: nowrap;
  }
</style>
