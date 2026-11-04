<span class="lo-spinbox {classes}" class:disabled={!!disabled} style:width
  title={typeof disabled == "string" ? disabled : tooltip}>
  <input type="text" inputmode="numeric"
    value={value ?? ""}
    disabled={!!disabled}
    aria-label={label}
    role="spinbutton"
    aria-valuenow={value}
    aria-valuemin={min}
    aria-valuemax={max}
    bind:this={inputEl}
    on:change={onTyped}
    on:keydown={onKeyDown} />
  {#if suffix}
    <span class="suffix">{suffix}</span>
  {/if}
  <span class="arrows">
    <button type="button" tabindex="-1" disabled={!!disabled || value >= max} aria-label="+"
      on:click={() => step(1)}><ChevronUpIcon size="10" /></button>
    <button type="button" tabindex="-1" disabled={!!disabled || value <= min} aria-label="-"
      on:click={() => step(-1)}><ChevronDownIcon size="10" /></button>
  </span>
</span>

<script lang="ts">
  import ChevronUpIcon from "lucide-svelte/icons/chevron-up";
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
  import { createEventDispatcher } from "svelte";
  const dispatch = createEventDispatcher<{ change: number }>();

  export let value: number = 0;
  export let min = -Infinity;
  export let max = Infinity;
  export let stepSize = 1;
  export let suffix: string = null;
  export let label: string = null;
  export let disabled: boolean | string = false;
  export let tooltip: string = null;
  export let width = "80px";
  export let classes = "";
  export let inputEl: HTMLInputElement = null;

  function setValue(newValue: number) {
    newValue = Math.min(max, Math.max(min, newValue));
    if (newValue == value) {
      inputEl.value = String(value ?? "");
      return;
    }
    value = newValue;
    dispatch("change", value);
  }

  function step(direction: number) {
    setValue((value ?? 0) + direction * stepSize);
  }

  function onTyped() {
    let typed = parseFloat(inputEl.value.replace(",", "."));
    setValue(isNaN(typed) ? value : typed);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key == "ArrowUp" || event.key == "ArrowDown") {
      event.preventDefault();
      step(event.key == "ArrowUp" ? 1 : -1);
    }
  }
</script>

<style>
  .lo-spinbox {
    display: inline-flex;
    align-items: stretch;
    box-sizing: border-box;
    height: 32px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
    color: var(--lo-fg);
  }
  .lo-spinbox:hover:not(.disabled) {
    border-color: var(--lo-border-strong);
  }
  .lo-spinbox:focus-within {
    border-color: var(--lo-accent);
    box-shadow: inset 0 -1px 0 var(--lo-accent);
  }
  .lo-spinbox.disabled {
    background-color: var(--lo-pane-alt-bg);
    color: var(--lo-fg-disabled);
  }
  input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0 0 0 8px;
    border: none;
    outline: none;
    background: transparent;
    color: inherit;
    font: inherit;
  }
  .suffix {
    display: flex;
    align-items: center;
    padding: 0 4px;
    color: var(--lo-fg-secondary);
  }
  .arrows {
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    width: 18px;
    border-inline-start: 1px solid var(--lo-divider);
  }
  .arrows button {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1 1 0;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--lo-fg-secondary);
  }
  .arrows button:hover:not(:disabled) {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  .arrows button:disabled {
    color: var(--lo-fg-disabled);
  }
</style>
