<button class="nav-rail-button" class:selected class:small
  title={$title}
  aria-label={$title}
  aria-current={selected ? "page" : undefined}
  on:click>
  <hbox class="icon">
    <AppIcon icon={app.icon} size={small ? "16px" : "24px"} />
  </hbox>
  {#if !small}
    <hbox class="label">{app.name}</hbox>
  {/if}
</button>

<script lang="ts">
  import type { MustangApp } from "../../frontend/AppsBar/MustangApp";
  import AppIcon from "../../frontend/AppsBar/AppIcon.svelte";

  export let app: MustangApp;
  export let selected = false;
  export let small = false;

  $: title = app.title;
</script>

<style>
  .nav-rail-button {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: calc(var(--lo-nav-rail-width) - 8px);
    height: 55px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background-color: transparent;
    color: var(--lo-fg-secondary);
    font-family: inherit;
  }
  .nav-rail-button:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  .nav-rail-button.selected {
    background-color: var(--lo-pane-bg);
    color: var(--lo-accent-text);
    box-shadow: var(--lo-shadow-card);
  }
  .nav-rail-button.selected::before {
    content: "";
    position: absolute;
    inset-inline-start: -4px;
    top: 14px;
    bottom: 14px;
    width: 3px;
    border-radius: 2px;
    background-color: var(--lo-accent);
  }
  .nav-rail-button.small {
    width: 26px;
    height: 26px;
  }
  .nav-rail-button.small.selected::before {
    top: 7px;
    bottom: 7px;
  }
  .icon {
    align-items: center;
    justify-content: center;
  }
  .icon :global(.cls-1) {
    stroke: currentColor;
  }
  .icon :global(.date-calendar-icon) {
    fill: currentColor;
  }
  .label {
    max-width: 100%;
    margin-block-start: 5px;
    font-size: var(--lo-font-size-small);
    line-height: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .selected .label {
    font-weight: 600;
  }
</style>
