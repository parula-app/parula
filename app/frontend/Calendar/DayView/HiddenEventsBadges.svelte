<vbox class="hidden-events"> <!-- Covers the day column. The badges stick below the header (`--head-height`) and to the bottom of the view. -->
  <hbox class="anchor top">
    {#if above}
      <button class="badge" title={$t`${above} more items above`}
        on:pointerdown|stopPropagation on:dblclick|stopPropagation
        on:click|stopPropagation={() => dispatch("scrollup")}>
        +{above} <UpIcon size="12" />
      </button>
    {/if}
  </hbox>
  <hbox class="anchor bottom">
    {#if below}
      <button class="badge" title={$t`${below} more items below`}
        on:pointerdown|stopPropagation on:dblclick|stopPropagation
        on:click|stopPropagation={() => dispatch("scrolldown")}>
        +{below} <DownIcon size="12" />
      </button>
    {/if}
  </hbox>
</vbox>

<script lang="ts">
  import UpIcon from "lucide-svelte/icons/chevron-up";
  import DownIcon from "lucide-svelte/icons/chevron-down";
  import { t } from "../../../l10n/l10n";
  import { createEventDispatcher } from "svelte";

  /** Number of events that are scrolled out of view, above */
  export let above: number;
  /** Number of events that are scrolled out of view, below */
  export let below: number;

  const dispatch = createEventDispatcher<{ scrollup: void, scrolldown: void }>();
</script>

<style>
  .hidden-events {
    --badge-border: var(--border);
    --secondary-fg: color-mix(in srgb, var(--fg) 60%, transparent);
    --shadow: 0 1px 2px color-mix(in srgb, var(--fg) 20%, transparent);
    position: absolute;
    inset: 0;
    justify-content: space-between;
    z-index: 1;
    pointer-events: none;
  }
  .anchor {
    position: sticky;
    justify-content: flex-end;
    padding-inline-end: 4px;
    height: 0;
  }
  .anchor.top {
    top: calc(var(--head-height, 0px) + 4px);
  }
  .anchor.bottom {
    bottom: 4px;
    align-items: flex-end; /* The badge hangs upwards */
  }
  .badge {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 18px;
    padding: 0 6px;
    border: 1px solid var(--badge-border);
    border-radius: 9px;
    background-color: var(--bg);
    box-shadow: var(--shadow);
    color: var(--secondary-fg);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    pointer-events: auto;
  }
  .badge:hover {
    background-color: var(--hover-bg);
    color: var(--fg);
  }
  :global(.lookout-window) .hidden-events {
    --badge-border: var(--lo-border-strong);
    --secondary-fg: var(--lo-fg-secondary);
    --shadow: var(--lo-shadow-card);
    z-index: 5;
  }
</style>
