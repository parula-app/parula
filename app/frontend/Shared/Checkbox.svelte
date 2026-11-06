<hbox
  title={tooltip}
  on:click={onToggle}
  class:on={checked === true}
  class:off={checked === false}
  class:indetermined={checked === undefined || checked === null}
  class:allowIndetermined
  class:toggle
  class:disabled
  class="checkbox {classes}">
  {#if toggle}
    <hbox class="knob-wrapper" {id}>
      <hbox class="knob" />
    </hbox>
  {:else}
    {#if checked === true}
      <input type="checkbox"
        checked
        {id}
        {disabled}
        />
    {:else if checked == false && allowIndetermined}
      <input type="checkbox"
        indeterminate
        {id}
        {disabled}
        class="indetermined"
        />
    {:else}
      <input type="checkbox"
        {id}
        {disabled}
        />
    {/if}
  {/if}

  {#if !toggle || allowIndetermined}
    <hbox class="state-icon-wrapper">
      {#if checked === true}
        <CheckIcon strokeWidth={5} size={12} />
      {:else if checked == false && allowIndetermined}
        <MinusIcon strokeWidth={5} size={12} />
      {/if}
    </hbox>
  {/if}

  <label for={id}>
    <slot name="icon" />
    {label}
  </label>
</hbox>

<script lang="ts">
  import CheckIcon from "lucide-svelte/icons/check";
  import MinusIcon from "lucide-svelte/icons/minus";
  import { appGlobal } from "../../logic/app";
  import { randomID } from "../../logic/util/util";
  import { createEventDispatcher } from "svelte";
  const dispatch = createEventDispatcher<{ change: boolean }>();

  /** in/out */
  export let checked: boolean | null | undefined;
  /** in only */
  export let label = "";
  export let tooltip: string | null = null;
  export let allowIndetermined = checked === undefined || checked === null;
  export let allowFalse = true;
  export let disabled = false;
  export let classes = "";
  /** true: Show as toggle button, like on mobile
   * false: Show as checkbox */
  export let toggle = appGlobal.isMobile;

  let id: string = randomID();

  function onToggle() {
    if (disabled) {
      return;
    }
    if (checked === true && allowFalse) {
      checked = false;
    } else if (checked === true) {
      checked = null;
    } else if (checked === false && allowIndetermined) {
      checked = null;
    } else if (checked === false) {
      checked = true;
    } else if (checked === undefined || checked === null) {
      checked = true;
    } else {
      checked = true;
    }
    dispatch("change", checked);
  }
</script>

<style>
  .checkbox {
    align-items: center;
  }
  .checkbox.disabled {
    opacity: 50%;
  }
  .checkbox.disabled input {
    cursor: default;
  }
  label {
    display: flex;
    align-items: center;
    margin-inline-start: 8px;
  }
  label :global(svg) {
    margin-inline-end: 4px;
  }
  hbox.indetermined label {
    opacity: 60%;
  }
  input {
    cursor: pointer;
    appearance: none;
    background: #fff;
    border: 1px solid var(--button-border);
    width: 20px;
    height: 20px;
    min-width: 20px;
    border-radius: 4px;
    padding: 0px;
    display: block;
    margin: 0px;
    transition: border-color 100ms, background-color 100ms;
  }
  input:checked {
    border: none;
    background-color: var(--selected-bg);
    color: #fff;
  }
  input.indetermined {
    border: none;
    background-color: red;
  }

  .knob-wrapper {
    position: relative;
    height: 16px;
    width: 24px;
    min-width: 24px;
    border-radius: 100px;
    background-color: lightgray;
  }
  .knob {
    position: absolute;
    top: 0px;
    height: 16px;
    width: 16px;
    border-radius: 100px;
    border: none;
    cursor: pointer;
  }
  .on .knob {
    right: 0px;
    background-color: var(--selected-bg);
    color: var(--selected-fg);
    box-shadow:
      0 0 8px 2px rgba(32, 174, 158, 0.6),
      0 0 20px 6px rgba(32, 174, 158, 0.25),
      inset 0 1px 2px rgba(255, 255, 255, 0.2);
  }
  .off:not(.allowIndetermined) .knob {
    left: 0px;
    background-color: var(--bg);
    color: var(--fg);
    box-shadow:
      0 0 8px 2px rgba(135, 135, 135, 0.3);
  }
  .indetermined .knob {
    left: 4px;
    background-color: rgba(135, 135, 135, 0.3);
    color: white;
    box-shadow:
      0 0 8px 2px rgba(135, 135, 135, 0.15);
  }
  .off.allowIndetermined .knob {
    left: 0px;
    background-color: red;
    color: white;
    box-shadow:
      0 0 8px 2px rgba(255, 0, 0, 0.3),
      0 0 20px 6px rgba(255, 0, 0, 0.25),
      inset 0 1px 2px rgba(255, 255, 255, 0.2);
  }
  :global(.mobile) .checkbox {
    min-height: 32px;
  }
  :global(.mobile) .knob {
    height: 32px;
    width: 32px;
  }
  :global(.mobile) .knob-wrapper {
    height: 32px;
    width: 64px;
    min-width: 64px;
  }
  :global(.mobile) .indetermined .knob {
    left: 16px;
  }

  .state-icon-wrapper {
    position: absolute;
    width: 20px;
    height: 20px;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    color: #fff;
  }
  .toggle.on .state-icon-wrapper {
    left: 10px;
    top: 11px;
  }
  .toggle.off .state-icon-wrapper {
    left: 18px;
    top: 11px;
  }
</style>
