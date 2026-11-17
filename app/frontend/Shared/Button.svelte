<button on:click on:dblclick on:click={myOnClick} bind:this={buttonEl}
  title={tooltipCalc} class="button {classes}" class:plain
  disabled={isDisabled} class:disabled={isDisabled} class:selected
  {tabindex}
  >
  <hbox class="icon">
    {#if loading}
      <Spinner size={iconSize} />
    {:else if typeof(icon) == "string"}
      {#if icon.startsWith("data:")}
        <img src={icon} width={iconSize} height={iconSize} alt={label} />
      {:else if icon.includes("<svg")}
        <Icon data={icon} size={iconSize} />
      {:else}
        <!-- Unknown icon file -->No
      {/if}
    {:else if icon}
      <svelte:component this={icon} size={iconSize} />
    {:else}
      <slot name="icon" />
    {/if}
  </hbox>
  {#if hasIcon && hasLabel}
    <hbox class="gap" />
  {/if}
  {#if !iconOnly}
    {#if label}
      <hbox class="label">{label}</hbox>
    {:else}
      <slot name="label" />
    {/if}
  {/if}
</button>

<script lang="ts">
  import { showError } from '../Util/error';
  import Icon from 'svelte-icon/Icon.svelte';
  import Spinner from './Spinner.svelte';
  import type { ConstructorOfATypedSvelteComponent } from 'svelte';
  import { t } from '../../l10n/l10n';

  /** Show this label below the icon (unless `iconOnly` or label slot).
   * If iconOnly and no explicit `tooltip`: Show it as tooltip. */
  export let label: string = null;
  export let icon: ConstructorOfATypedSvelteComponent | string = null;
  export let classes = "";
  export let plain = false;
  export let iconSize = "16px";
  export let iconOnly = false;
  /** For toggle buttons: pressed/active state */
  export let selected = false;
  /** If true or a string, refuse input and make it grey.
   * If a string, this string will be shown as tooltip. This allows you to inform the user
   * about the reason why the button is disabled */
  export let disabled: boolean | string = false;
  export let shortCutInfo: string = null;
  /** What to show when the user hovers with the mouse over the
   * button for ca. 2+ seconds.
   * Defaults to `label` and `shortCutInfo`. */
  export let tooltip: string | null = null;
  export let tabindex = null;
  export let onClick: (event: Event) => void = null;
  export let errorCallback = showError;
  /** e.g. to `.focus()`
   * out */
  export let buttonEl: HTMLButtonElement = null;
  export let loadDelayMS = 500; // ms before showing the spinner

  $: hasIcon = !!icon || $$slots.icon || loading;
  $: hasLabel = (!!label || $$slots.label) && !iconOnly;
  $: tooltipCalc = typeof(disabled) == "string"
    ? disabled
    : tooltip
      ? tooltip
      : label
        ? label +
          (shortCutInfo
            ? "\n\n" + $t`Shortcut: ${shortCutInfo}`
            : "")
        : null;

  let loading = false;
  let running = false;
  $: isDisabled = !!disabled || running;
  async function myOnClick(event: Event) {
    if (!(onClick && typeof(onClick) == "function")) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    running = true;
    let loadTimeout = setTimeout(() => {
      loading = true;
    }, loadDelayMS);
    try {
      await onClick(event);
    } catch (ex) {
      errorCallback(ex);
    } finally {
      clearTimeout(loadTimeout);
      loading = false;
      running = false;
    }
  }
</script>

<style>
  button {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
  }
  button:not(.plain) {
    background-color: var(--button-bg);
    color: var(--button-fg);
    border: 1px solid var(--button-border);
    border-radius: var(--button-radius);
    padding: var(--button-padding);
    min-height: var(--button-min-height);
  }
  .plain {
    background-color: transparent;
    border-radius: 3px;
    border: none;
    min-width: 20px;
  }
  .disabled {
    opacity: 50%;
  }
  button:hover:not(.disabled) {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  button.filled:hover:not(.disabled) {
    background-color: var(--button-filled-hover-bg);
    color: var(--button-filled-hover-fg);
  }
  button.button.selected:not(.disabled) {
    background-color: var(--selected-bg);
    color: var(--selected-fg);
    border: none;
  }
  button.selected:hover:not(.disabled) {
    background-color: var(--selected-hover-bg);
    color: var(--selected-hover-fg);
  }
  :global(.selected) button:hover:not(.disabled) {
    background-color: var(--selected-hover-bg);
    color: var(--selected-hover-fg);
  }
  button.secondary {
    border-color: var(--button-secondary-line);
  }
  button.filled {
    background-color: var(--inverted-bg);
    color: var(--inverted-fg);
    border-color: var(--button-filled-border);
  }
  button {
    font-size: 14px;
  }
  button.large {
    padding: 8px 24px;
    font-size: 16px;
    font-weight: bold;
  }
  :global(.mobile) button {
    font-size: 16px;
  }
  button:not(.plain) > .label {
    padding-inline: var(--button-label-padding);
  }
  .gap {
    width: 8px;
  }
  .plain .icon {
    margin-inline-end: 0;
  }
</style>
