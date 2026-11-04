{#if isRangeEmpty}
  {#if previousEvent}
    <button class="adjacent-tab previous" style="inset-inline-start: {startOffset}px"
      title={tooltip(previousEvent)} on:click={() => goTo(previousEvent)}>
      <PreviousIcon size="14" />
      <span class="label">{$t`Previous Appointment`}</span>
    </button>
  {/if}
  {#if nextEvent}
    <button class="adjacent-tab next" title={tooltip(nextEvent)} on:click={() => goTo(nextEvent)}>
      <NextIcon size="14" />
      <span class="label">{$t`Next Appointment`}</span>
    </button>
  {/if}
{/if}

<script lang="ts">
  import type { Event } from "../../logic/Calendar/Event";
  import type { CalendarRange } from "./CalendarRange";
  import { EventLook } from "./DisplayEvent/EventLook";
  import { selectedDate, selectedEvent, startDate } from "../../frontend/Calendar/selected";
  import PreviousIcon from "lucide-svelte/icons/chevron-left";
  import NextIcon from "lucide-svelte/icons/chevron-right";
  import type { Collection } from "svelte-collections";
  import { getDateTimeLocale, t } from "../../l10n/l10n";

  export let range: CalendarRange;
  export let events: Collection<Event>;
  export let isRangeEmpty: boolean;
  export let startOffset = 0;

  $: previousEvent = isRangeEmpty ? $events.contents.findLast(event => event.endTime <= range.start) ?? null : null;
  $: nextEvent = isRangeEmpty ? $events.contents.find(event => event.startTime >= range.end) ?? null : null;

  function goTo(event: Event) {
    $startDate = event.startTime;
    $selectedDate = event.startTime;
    $selectedEvent = event;
  }

  function tooltip(event: Event): string {
    let date = event.startTime.toLocaleDateString(getDateTimeLocale(), { dateStyle: "full" });
    return date + "\n" + new EventLook(event).tooltip(getDateTimeLocale());
  }
</script>

<style>
  .adjacent-tab {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px 3px;
    border: 1px solid var(--lo-border-strong);
    background-color: var(--lo-accent-tint);
    color: var(--lo-fg);
    font: inherit;
    font-size: var(--lo-font-size-small);
    cursor: pointer;
    z-index: 7;
  }
  .adjacent-tab:hover {
    background-color: var(--lo-selected-bg);
  }
  .adjacent-tab.previous {
    border-radius: 0 8px 8px 0;
  }
  .adjacent-tab.next {
    inset-inline-end: 16px;
    border-radius: 8px 0 0 8px;
  }
  .label {
    writing-mode: vertical-rl;
    white-space: nowrap;
  }
  .previous .label {
    transform: rotate(180deg);
  }
</style>
