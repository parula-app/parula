<button type="button" class="dialog-button {classes}" class:primary class:pressed class:running
  aria-pressed={pressed}
  disabled={!!disabled || running}
  title={typeof disabled == "string" ? disabled : tooltip}
  on:click={onClicked}
  bind:this={buttonEl}>
  {#if icon}
    <svelte:component this={icon} size={16} />
  {/if}
  {#if label}
    <span>{label}</span>
  {/if}
  {#if hasMenu}
    <ChevronDownIcon size={14} />
  {/if}
</button>

<script lang="ts">
  import { showError } from "../../../frontend/Util/error";
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";

  export let label: string;
  export let icon: ConstructorOfATypedSvelteComponent = null;
  export let onClick: (event: Event) => void | Promise<void> = null;
  export let primary = false;
  export let pressed: boolean = null;
  export let disabled: boolean | string = false;
  export let tooltip: string = null;
  export let classes = "";
  export let hasMenu = false;
  export let errorCallback = showError;
  export let buttonEl: HTMLButtonElement = null;

  let running = false;
  async function onClicked(event: Event) {
    if (hasMenu) {
      event.stopPropagation();
    }
    if (!onClick || running) {
      return;
    }
    running = true;
    try {
      await onClick(event);
    } catch (ex) {
      errorCallback(ex);
    } finally {
      running = false;
    }
  }
</script>

<style>
  .dialog-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 88px;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-pane-bg);
    color: var(--lo-fg);
    font-size: var(--lo-font-size);
    white-space: nowrap;
  }
  .dialog-button:hover:not(:disabled) {
    background-color: var(--lo-hover-bg);
    border-color: var(--lo-border-strong);
  }
  .dialog-button:active:not(:disabled) {
    background-color: var(--lo-pressed-bg);
  }
  .dialog-button.primary {
    background-color: var(--lo-accent);
    border-color: var(--lo-accent);
    color: var(--lo-accent-fg);
    font-weight: 600;
  }
  .dialog-button.primary:hover:not(:disabled) {
    background-color: var(--lo-accent-hover);
    border-color: var(--lo-accent-hover);
  }
  .dialog-button.primary:active:not(:disabled) {
    background-color: var(--lo-accent-pressed);
  }
  .dialog-button.plain {
    min-width: 0;
    border-color: transparent;
    background-color: transparent;
  }
  .dialog-button.plain:disabled {
    background-color: transparent;
    border-color: transparent;
  }
  .dialog-button.pressed {
    background-color: var(--lo-selected-bg);
    border-color: var(--lo-selected-hover-bg);
  }
  .dialog-button.pressed:hover:not(:disabled) {
    background-color: var(--lo-selected-hover-bg);
  }
  .dialog-button:disabled {
    color: var(--lo-fg-disabled);
    background-color: var(--lo-pane-alt-bg);
    border-color: var(--lo-border);
  }
  .dialog-button.running {
    cursor: progress;
  }
  .dialog-button :global(svg) {
    flex-shrink: 0;
  }
</style>
