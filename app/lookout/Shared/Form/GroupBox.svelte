<fieldset class="lo-groupbox {classes}" disabled={disabled}>
  {#if label}
    <legend>{label}</legend>
  {/if}
  <slot />
</fieldset>

<script lang="ts">
  export let label: string = null;
  export let disabled = false;
  export let classes = "";
</script>

<style>
  .lo-groupbox {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    margin: 0;
    padding: 4px 12px 10px 12px;
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
  }
  legend {
    padding: 0 4px;
    margin-inline-start: -4px;
    color: var(--lo-fg);
    font-weight: 600;
  }
</style>
