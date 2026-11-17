<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="clickable" on:click={myOnClick} on:dblclick={myOnDoubleClick}
  disabled={!!disabled} class:disabled title={typeof(disabled) == "string" ? disabled : tooltip}>
  <slot />
</div>

<script lang="ts">
  import { showError } from '../Util/error';

  export let onClick: (event: Event) => void = null;
  export let onDoubleClick: (event: Event) => void = null;
  export let errorCallback = showError;
  /** If true or a string, refuse input and make it grey.
   * If a string, this string will be shown as tooltip. This allows you to inform the user
   * about the reason why the button is disabled */
  export let disabled: boolean | string = false;
  export let tooltip: string | null = null;

  async function myOnClick(event: Event) {
    if (!(onClick && typeof(onClick) == "function")) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    if (disabled) {
      return;
    }
    try {
      await onClick(event);
    } catch (ex) {
      errorCallback(ex);
    }
  }

  async function myOnDoubleClick(event: Event) {
    if (!(onDoubleClick && typeof(onDoubleClick) == "function")) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    if (disabled) {
      return;
    }
    try {
      await onDoubleClick(event);
    } catch (ex) {
      errorCallback(ex);
    }
  }
</script>

<style>
  div {
    display: contents; /* Use child container CSS rules */
  }
  .disabled > :global(*) {
    opacity: 50%;
  }
</style>
