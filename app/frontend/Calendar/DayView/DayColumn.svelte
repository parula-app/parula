<grid class="day-column" style="grid-column: {column}">
  {#each hourStarts as start, i}
    <HourSlot {start} row={i * kRowsPerHour + 1} empty={isEmpty($layout, i * kRowsPerHour)} on:celldblclick>
      <slot name="event-hover" slot="event-hover" let:start {start} let:end {end} let:empty {empty} />
    </HourSlot>
  {/each}
  {#each $layout as item (item.event)}
    <EventContainer {item}>
      {#if $dayOverlayEvents.contains(item.event)}
        <slot name="event-overlay" start={item.event.startTime} end={item.event.endTime} event={item.event} />
      {:else}
        <EventContent event={item.event} showTime={!item.continuesBefore} />
      {/if}
    </EventContainer>
  {/each}
  <CurrentTimeMarker {day} {startHour} {endHour} />
  <HiddenEventsBadges above={hiddenAbove.map(item => item.event)} below={hiddenBelow.map(item => item.event)}
    on:scrollup={() => dispatch("scrolltorow", hiddenAbove[0].startRow)}
    on:scrolldown={() => dispatch("scrolltorow", hiddenBelow.at(-1).startRow)} />
</grid>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { layoutTimeColumn, kRowsPerHour, type EventInTimeColumn } from "./DayColumn";
  import HourSlot from "./HourSlot.svelte";
  import EventContainer from "./EventContainer.svelte";
  import EventContent from "./EventContent.svelte";
  import CurrentTimeMarker from "../CurrentTimeMarker.svelte";
  import HiddenEventsBadges from "./HiddenEventsBadges.svelte";
  import { ArrayColl, type Collection } from "svelte-collections";
  import { derived } from "svelte/store";
  import { createEventDispatcher } from "svelte";

  export let day: Date;
  export let column: number;
  export let events: Collection<Event>;
  export let overlayEvents: Collection<Event> | null = null;
  export let startHour = 0;
  export let endHour = 24;
  /** The rows that are scrolled into view */
  export let visibleFromRow = 0;
  export let visibleToRow = (endHour - startHour) * kRowsPerHour;

  const dispatch = createEventDispatcher<{ scrolltorow: number }>();

  let hourStarts: Date[] = [];
  let dayEvents: Collection<Event>;
  let dayOverlayEvents: Collection<Event>;
  $: day, startHour, endHour, events, overlayEvents, setDay();
  function setDay() {
    hourStarts = [];
    for (let hour = startHour; hour < endHour; hour++) {
      let hourStart = new Date(day);
      hourStart.setHours(hour, 0, 0, 0);
      hourStarts.push(hourStart);
    }
    let dayStart = hourStarts[0];
    let dayEnd = new Date(day);
    dayEnd.setHours(endHour, 0, 0, 0);
    let isInDay = (ev: Event) => ev.startTime < dayEnd && ev.endTime > dayStart && !ev.allDay;
    dayEvents = events.filterObservable(isInDay);
    dayOverlayEvents = overlayEvents?.filterObservable(isInDay) ?? new ArrayColl<Event>();
  }

  $: layout = derived(
    [...$dayEvents.contents, ...$dayOverlayEvents.contents],
    eventsInDay => layoutTimeColumn(eventsInDay, day, startHour, endHour));

  // Sorted by start, like the layout
  $: hiddenAbove = $layout.filter(item => item.endRow <= visibleFromRow);
  $: hiddenBelow = $layout.filter(item => item.startRow >= visibleToRow);

  function isEmpty(layout: EventInTimeColumn[], row: number): boolean {
    return !layout.some(item => item.startRow < row + kRowsPerHour && item.endRow > row);
  }
</script>

<style>
  .day-column {
    grid-row: 3 / -1;
    display: grid;
    grid-template-rows: subgrid;
    grid-template-columns: minmax(0, 1fr);
    position: relative;
    border-left: 1px dotted var(--border);
  }
</style>
