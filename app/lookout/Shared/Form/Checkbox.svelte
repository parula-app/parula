<label class="lo-checkbox {classes}" class:disabled={!!disabled} title={typeof disabled == "string" ? disabled : tooltip}>
  <input type="checkbox"
    bind:checked
    bind:indeterminate
    bind:this={inputEl}
    disabled={!!disabled}
    on:change={() => dispatch("change", checked)} />
  <span class="box" aria-hidden="true">
    {#if indeterminate}
      <MinusIcon size="12" />
    {:else if checked}
      <CheckIcon size="12" />
    {/if}
  </span>
  {#if label || $$slots.default}
    <span class="label">
      {#if label}{label}{:else}<slot />{/if}
    </span>
  {/if}
</label>

<script lang="ts">
  import CheckIcon from "lucide-svelte/icons/check";
  import MinusIcon from "lucide-svelte/icons/minus";
  import { createEventDispatcher } from "svelte";
  const dispatch = createEventDispatcher<{ change: boolean }>();

  export let checked = false;
  export let indeterminate = false;
  export let label: string = null;
  export let disabled: boolean | string = false;
  export let tooltip: string = null;
  export let classes = "";
  export let inputEl: HTMLInputElement = null;
</script>

<style>
  .lo-checkbox {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 24px;
    color: var(--lo-fg);
    cursor: default;
    user-select: none;
  }
  .lo-checkbox.disabled {
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
  .box {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    box-sizing: border-box;
    width: 16px;
    height: 16px;
    border: 1px solid var(--lo-fg-secondary);
    border-radius: 3px;
    background-color: var(--lo-input-bg);
    color: var(--lo-accent-fg);
  }
  .box :global(svg) {
    stroke-width: 3;
  }
  .lo-checkbox:hover:not(.disabled) .box {
    border-color: var(--lo-fg);
  }
  input:checked + .box,
  input:indeterminate + .box {
    border-color: var(--lo-accent);
    background-color: var(--lo-accent);
  }
  .lo-checkbox:hover:not(.disabled) input:checked + .box {
    background-color: var(--lo-accent-hover);
    border-color: var(--lo-accent-hover);
  }
  input:focus-visible + .box {
    outline: 2px solid var(--lo-focus-ring);
    outline-offset: 1px;
  }
  .disabled .box {
    border-color: var(--lo-fg-disabled);
  }
  .disabled input:checked + .box {
    border-color: var(--lo-fg-disabled);
    background-color: var(--lo-fg-disabled);
  }
  .label {
    min-width: 0;
  }
</style>
