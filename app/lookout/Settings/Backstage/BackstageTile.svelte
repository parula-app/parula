<hbox class="backstage-tile">
  <button class="tile-button" bind:this={buttonEl}
    disabled={!!disabled}
    title={typeof disabled == "string" ? disabled : label}
    aria-haspopup={$$slots.default ? "menu" : null}
    aria-expanded={$$slots.default ? isMenuOpen : null}
    on:click={onClicked}>
    <svelte:component this={icon} size={32} strokeWidth={1.25} />
    <span class="tile-label">{label}</span>
    {#if $$slots.default}
      <ChevronDownIcon size={12} />
    {/if}
  </button>
  <vbox class="tile-text">
    <h2>{title}</h2>
    <hbox class="description">{description}</hbox>
    <slot name="details" />
  </vbox>
  {#if $$slots.default}
    <Menu bind:isMenuOpen anchor={buttonEl} placement="bottom-start">
      <slot />
    </Menu>
  {/if}
</hbox>

<script lang="ts">
  import Menu from "../../Shared/Menu/Menu.svelte";
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
  import { showError } from "../../../frontend/Util/error";

  export let icon: ConstructorOfATypedSvelteComponent;
  export let label: string;
  export let title: string;
  export let description: string;
  export let disabled: boolean | string = false;
  export let onClick: () => void | Promise<void> = null;

  let buttonEl: HTMLButtonElement;
  let isMenuOpen = false;

  async function onClicked(event: MouseEvent) {
    if ($$slots.default) {
      event.stopPropagation();
      isMenuOpen = !isMenuOpen;
      return;
    }
    try {
      await onClick?.();
    } catch (ex) {
      showError(ex);
    }
  }
</script>

<style>
  .backstage-tile {
    align-items: start;
    gap: 20px;
    padding-block: 12px;
    border-block-end: 1px solid var(--lo-divider);
  }
  .tile-button {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 104px;
    height: 96px;
    padding: 8px 4px;
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-pane-bg);
    color: var(--lo-accent-text);
    font: inherit;
    cursor: pointer;
  }
  .tile-button:hover:not(:disabled) {
    border-color: var(--lo-border-strong);
    background-color: var(--lo-hover-bg);
  }
  .tile-button:active:not(:disabled),
  .tile-button[aria-expanded="true"] {
    background-color: var(--lo-pressed-bg);
  }
  .tile-button:disabled {
    color: var(--lo-fg-disabled);
    cursor: default;
  }
  .tile-label {
    color: var(--lo-fg);
    font-size: var(--lo-font-size-small);
    line-height: 1.25;
    text-align: center;
  }
  .tile-button:disabled .tile-label {
    color: var(--lo-fg-disabled);
  }
  .tile-text {
    min-width: 0;
    max-width: 480px;
    gap: 4px;
  }
  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  .description {
    color: var(--lo-fg-secondary);
  }
</style>
