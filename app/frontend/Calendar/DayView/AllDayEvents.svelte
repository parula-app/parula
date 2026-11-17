<grid class="all-day-events header" style="max-height: {maxHeight}px">
  {#each days as day, i}
    <hbox class="day" style="grid-column: {i + 1}; grid-row: 1 / span {Math.max($layout.lanes, 1)}" />
  {/each}
  {#each $layout.events as item (item.event)}
    <AllDayEvent {item} />
  {/each}
</grid>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { layoutDayRow } from "../MonthView/WeekRow";
  import AllDayEvent from "./AllDayEvent.svelte";
  import type { Collection } from "svelte-collections";
  import { derived } from "svelte/store";

  export let days: Date[];
  export let events: Collection<Event>;
  export let maxHeight: number;

  $: layout = derived([...$events.contents], allDayEvents => layoutDayRow(allDayEvents, days));
</script>

<style>
  .all-day-events {
    grid-column: 2 / -1;
    grid-row: 2;
    display: grid;
    grid-template-columns: subgrid;
    align-content: start;
    overflow-y: auto;
    border-bottom: 1px dotted var(--border);
    background-color: var(--bg);
  }
  .day {
    border-left: 1px dotted var(--border);
  }
</style>
