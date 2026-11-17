<div class="response-button-wrapper">
  <button class="response-button {classes}" class:pressed class:running class:icon-only={iconOnly} aria-pressed={pressed}
    aria-haspopup={hasMenu ? "menu" : undefined} aria-expanded={hasMenu ? isMenuOpen : undefined}
    aria-label={iconOnly ? label : undefined}
    disabled={!!disabled || running} title={typeof disabled == "string" ? disabled : tooltip ?? label}
    on:click={onClicked} bind:this={buttonEl}>
    <svelte:component this={icon} size={16} />
    {#if !iconOnly}
      <span class="label">{label}</span>
    {/if}
  </button>
  {#if hasMenu}
    <Menu bind:isMenuOpen anchor={buttonEl} placement="bottom-start">
      <slot />
    </Menu>
  {/if}
</div>

<script lang="ts">
  import Menu from "../../Shared/Menu/Menu.svelte";
  import { showError } from "../../../frontend/Util/error";

  export let label: string;
  export let icon: ConstructorOfATypedSvelteComponent;
  export let onClick: () => Promise<void> | void = null;
  export let pressed = false;
  export let iconOnly = false;
  export let tooltip: string = null;
  export let disabled: boolean | string = false;
  export let classes = "";

  const hasMenu = !!$$slots.default;
  let isMenuOpen = false;
  let buttonEl: HTMLButtonElement;

  let running = false;
  async function onClicked(event: MouseEvent) {
    if (hasMenu) {
      event.stopPropagation();
      isMenuOpen = !isMenuOpen;
      return;
    }
    if (running) {
      return;
    }
    running = true;
    try {
      await onClick();
    } catch (ex) {
      showError(ex);
    } finally {
      running = false;
    }
  }
</script>

<style>
  .response-button-wrapper {
    display: contents;
  }
  .response-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 112px;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-pane-bg);
    color: var(--lo-fg);
    font: inherit;
    cursor: pointer;
  }
  .response-button .label {
    text-box: trim-both cap alphabetic;
  }
  .response-button.icon-only {
    min-width: 0;
    padding: 0 10px;
  }
  .response-button:hover:not(:disabled) {
    background-color: var(--lo-hover-bg);
    border-color: var(--lo-border-strong);
  }
  .response-button:active:not(:disabled) {
    background-color: var(--lo-pressed-bg);
  }
  .response-button.pressed {
    background-color: var(--lo-selected-bg);
    border-color: var(--lo-accent);
    font-weight: 600;
  }
  .response-button:disabled {
    color: var(--lo-fg-disabled);
    cursor: default;
  }
  .response-button.running {
    cursor: progress;
  }
  .response-button :global(svg) {
    flex-shrink: 0;
    color: var(--lo-accent-text);
  }
  .response-button.accept :global(svg) {
    color: var(--lo-success);
  }
  .response-button.decline :global(svg) {
    color: var(--lo-danger);
  }
</style>
