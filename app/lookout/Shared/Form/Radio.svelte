<label class="lo-radio {classes}" class:disabled={!!disabled} title={typeof disabled == "string" ? disabled : tooltip}>
  <input type="radio" bind:group {value} {name} disabled={!!disabled} on:change={() => dispatch("change", value)} />
  <span class="dot" aria-hidden="true"></span>
  {#if label || $$slots.default}
    <span class="label">
      {#if label}{label}{:else}<slot />{/if}
    </span>
  {/if}
</label>

<script lang="ts">
  import { createEventDispatcher } from "svelte";
  const dispatch = createEventDispatcher<{ change: any }>();

  export let group: any;
  export let value: any;
  export let label: string = null;
  export let name: string = null;
  export let disabled: boolean | string = false;
  export let tooltip: string = null;
  export let classes = "";
</script>

<style>
  .lo-radio {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 24px;
    color: var(--lo-fg);
    cursor: default;
    user-select: none;
  }
  .lo-radio.disabled {
    color: var(--lo-fg-disabled);
  }
  input {
    position: absolute;
    opacity: 0;
    width: 16px;
    height: 16px;
    margin: 0;
    pointer-events: none;
  }
  .dot {
    flex: 0 0 auto;
    box-sizing: border-box;
    width: 16px;
    height: 16px;
    border: 1px solid var(--lo-fg-secondary);
    border-radius: 50%;
    background-color: var(--lo-input-bg);
  }
  .lo-radio:hover:not(.disabled) .dot {
    border-color: var(--lo-fg);
  }
  input:checked + .dot {
    border: 5px solid var(--lo-accent);
    background-color: var(--lo-accent-fg);
  }
  input:focus-visible + .dot {
    outline: 2px solid var(--lo-focus-ring);
    outline-offset: 1px;
  }
  .disabled .dot,
  .disabled input:checked + .dot {
    border-color: var(--lo-fg-disabled);
  }
  .label {
    min-width: 0;
  }
</style>
