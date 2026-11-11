<hbox class="sub-app-button" class:selected on:click title={$title}>
  <hbox class="icon">
    <slot name="icon" />
  </hbox>
</hbox>

<script lang="ts">
  import type { MustangApp } from "./MustangApp";

  export let selected = false;
  export let app: MustangApp;

  $: title = app.title;
</script>

<style>
  .sub-app-button {
    align-items: center;
    padding: 0px;
    border-radius: 4px;
  }
  .icon {
    padding: 2px;
  }
  .icon :global(.cls-1) {
    stroke: var(--appbar-fg);
  }
  .sub-app-button:hover {
    background-color: rgba(255, 255, 255, 25%);
  }
  .sub-app-button.selected {
    background-color: rgba(255, 255, 255, 95%);
  }
  .icon {
    color: rgba(255, 255, 255, 80%);
  }
  .sub-app-button.selected .icon {
    color: var(--appbar-bg);
  }
  .sub-app-button.selected .icon :global(.cls-1) {
    stroke: var(--appbar-bg);
  }
  .sub-app-button.selected .icon :global(.date-calendar-icon) {
    fill: var(--appbar-bg);
  }

  :global(.sub-app-bar[app="webapps"]) .icon {
    filter: grayscale(0.7);
  }
</style>
