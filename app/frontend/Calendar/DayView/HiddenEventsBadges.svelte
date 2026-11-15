<vbox class="hidden-events"> <!-- Covers the day column. The badges stick below the header (`--head-height`) and to the bottom of the view. -->
  <hbox class="anchor top">
    {#if firstAbove}
      <button class="badge" title={$t`${above.length} more items above`}
        on:pointerdown|stopPropagation on:dblclick|stopPropagation
        on:click|stopPropagation={() => dispatch("scrollup")}>
        <span class="count">+{above.length}</span>
        <UpIcon size="12" />
        <span class="time">{startTime(firstAbove)}</span>
        <span class="title">{firstAbove.title}</span>
      </button>
    {/if}
  </hbox>
  <hbox class="anchor bottom">
    {#if lastBelow}
      <button class="badge" title={$t`${below.length} more items below`}
        on:pointerdown|stopPropagation on:dblclick|stopPropagation
        on:click|stopPropagation={() => dispatch("scrolldown")}>
        <span class="count">+{below.length}</span>
        <DownIcon size="12" />
        <span class="time">{startTime(lastBelow)}</span>
        <span class="title">{lastBelow.title}</span>
      </button>
    {/if}
  </hbox>
</vbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import UpIcon from "lucide-svelte/icons/chevron-up";
  import DownIcon from "lucide-svelte/icons/chevron-down";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";
  import { createEventDispatcher } from "svelte";

  /** The events that are scrolled out of view, above, sorted by start time */
  export let above: Event[];
  /** The events that are scrolled out of view, below, sorted by start time */
  export let below: Event[];

  /** What the badges show, and where a click on them should scroll to */
  $: firstAbove = above[0];
  $: lastBelow = below.at(-1);

  const dispatch = createEventDispatcher<{ scrollup: void, scrolldown: void }>();

  function startTime(event: Event): string {
    return event.startTime.toLocaleTimeString(getDateTimeLocale(), { hour: "numeric", minute: "2-digit" });
  }
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
    padding-inline: 4px;
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
    min-width: 0;
    height: 18px;
    padding: 0 6px;
    overflow: hidden;
    border: 1px solid var(--badge-border);
    border-radius: 9px;
    background-color: var(--bg);
    box-shadow: var(--shadow);
    color: var(--secondary-fg);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
    pointer-events: auto;
  }
  .badge:hover {
    background-color: var(--hover-bg);
    color: var(--fg);
  }
  .count,
  .time,
  .badge :global(svg) {
    flex: none; /* Only the title shrinks in narrow columns */
  }
  .count {
    font-weight: 600;
  }
  .time {
    margin-inline-start: 2px;
  }
  .title {
    max-width: 10em;
    margin-inline-start: 2px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  :global(.lookout-window) .hidden-events {
    --badge-border: var(--lo-border-strong);
    --secondary-fg: var(--lo-fg-secondary);
    --shadow: var(--lo-shadow-card);
    z-index: 5;
  }
</style>
