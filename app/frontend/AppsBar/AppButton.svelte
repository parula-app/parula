<vbox class="app-button {classes}" class:selected class:padding on:click>
  <hbox class="icon">
    <slot name="icon" />
  </hbox>
  <hbox class="label font-smallest">
    <slot name="label" />
  </hbox>
</vbox>

<script lang="ts">
  export let selected = false;
  export let classes: string = "";
  export let padding = true;
</script>

<style>
  .app-button {
    align-items: center;
  }
  .app-button.padding {
    padding: 10px 0px 6px 0px;
  }
  .label :global(.label){
    color: var(--appbar-fg);
  }
  .icon :global(.cls-1) {
    stroke: var(--appbar-fg);
  }
  .app-button:hover {
    background-color: rgba(255, 255, 255, 25%);
  }
  .app-button:hover .label {
    color: black;
  }
  .app-button.selected {
    background-color: rgba(255, 255, 255, 95%);
  }
  .app-button.selected .label :global(> .label) {
    color: black;
  }
  .icon {
    color: rgba(255, 255, 255, 80%);
  }
  .app-button.selected .icon {
    color: var(--appbar-bg);
  }
  .app-button.selected .icon :global(.cls-1) {
    stroke: var(--appbar-bg);
  }
  .app-button.selected .icon :global(.date-calendar-icon) {
    fill: var(--appbar-bg);
  }
  .label {
    color: #999999;
    overflow: hidden;
    overflow-wrap: anywhere;
    text-overflow: clip;
    white-space: nowrap;
    max-width: 100%;
    margin-block-start: 4px;
    margin-inline-start: 4px;
    margin-inline-end: 4px;
  }
  .selected .label {
    color: black;
  }
</style>
