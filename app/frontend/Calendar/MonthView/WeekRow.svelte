<grid class="week-row">
  {#each days as day, i}
    <DayLabel {day} column={i + 1} />
  {/each}
  <grid class="lanes font-small"
    style="--rows: {rows}; --rows-per-line: {WeekRowLayout.kRowsPerLine}"
    bind:this={lanesE}
    bind:clientHeight={lanesHeight}>
    {#each days as day, i}
      <DayCell start={day} column={i + 1} withMonthOnFirst={true} withMonthOnMonday={true} on:celldblclick />
    {/each}
    {#each $layout.events as item}
      <EventContainer {item} />
    {/each}
    {#each $layout.hiddenEvents as hiddenEvents, i}
      {#if hiddenEvents.length}
        <MoreEvents day={days[i]} events={hiddenEvents} column={i + 1}
          startRow={rows - WeekRowLayout.kRowsPerLine} endRow={rows} />
      {/if}
    {/each}
  </grid>
</grid>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { WeekRowLayout } from "./WeekRow";
  import DayLabel from "./DayLabel.svelte";
  import DayCell from "./DayCell.svelte";
  import EventContainer from "./EventContainer.svelte";
  import MoreEvents from "./MoreEvents.svelte";
  import type { Collection } from "svelte-collections";
  import { derived } from "svelte/store";

  export let days: Date[];
  export let events: Collection<Event>;

  let weekStart: Date;
  let weekEnd: Date;
  $: weekEvents = events.filterObservable(isInWeek);
  $: days, setWeek();
  function setWeek() {
    weekStart = days[0];
    weekEnd = new Date(days[days.length - 1]);
    weekEnd.setDate(weekEnd.getDate() + 1);
    weekEvents.replaceAll(events.contents.filter(isInWeek));
  }

  function isInWeek(ev: Event): boolean {
    return ev.startTime && ev.startTime < weekEnd && ev.endTime > weekStart;
  }

  let lanesE: HTMLElement;
  let lanesHeight = 0;
  let rows = WeekRowLayout.kRowsPerLine;
  $: lanesE, lanesHeight, setRows();
  function setRows() {
    if (!lanesE) {
      return;
    }
    let rowHeight = parseFloat(getComputedStyle(lanesE).gridTemplateRows);
    rows = Math.max(WeekRowLayout.kRowsPerLine, Math.floor(lanesHeight / rowHeight));
  }

  $: layout = derived([...$weekEvents.contents], eventsInWeek => new WeekRowLayout(eventsInWeek, days, rows));
</script>

<style>
  .week-row {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: max-content minmax(0, 1fr);
    overflow: hidden;
  }
  .lanes {
    grid-column: 1 / -1;
    grid-row: 2;
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: repeat(var(--rows), var(--row-height)) minmax(0, 1fr);
    overflow: hidden;
    --row-height: calc((1.4em + 1px) / var(--rows-per-line));
  }
</style>
