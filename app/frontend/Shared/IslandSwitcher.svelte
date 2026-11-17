<hbox class="island specific" class:large class:border class:faint>
  <slot />
</hbox>

<script lang="ts">
  /**
   * Shows a number of buttons, which switch between multiple different views or modes.
   * Displays a rounded border around them, and each button is round as well.
   * Technically, these are radio buttons, because only 1 of them is active at any time.
   */

  export let large = false;
  export let border = true;
  /** Show the selected button not in a strong color */
  export let faint = true;
</script>

<style>
  .island.border {
    border: 1px solid var(--border);
    border-radius: var(--island-radius);
  }
  .island :global(button) {
    border-radius: var(--island-radius);
  }
  .island :global(button:not(:last-of-type)) {
    margin-inline-end: var(--island-overlap);
  }
  .island.faint :global(button.selected:not(.hover)) {
    background-color: var(--offset-bg);
    color: var(--offset-fg);
    border: none;
  }
  .island.specific :global(button:not(.selected)) {
    background-color: transparent;
    border: none;
  }
  .island :global(button:hover) {
    z-index: 1;
  }
  .island :global(button .label) {
    margin-inline-end: 4px;
  }
  .island :global(svg) {
    fill: transparent;
    stroke-width: 1.2px;
  }
  @media (max-width: 800px)  {
    .island.large {
      flex-direction: column;
      align-items: start;
      justify-content: stretch;
    }
  }
  </style>
