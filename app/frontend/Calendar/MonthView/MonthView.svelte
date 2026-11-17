<vbox class="month-view" flex
  on:mousewheel={event => catchErrors(() => onScrollWheel(event))}>
  <hbox class="range-header window-drag">
    <slot name="top-left" />
    <hbox flex />
    <DateRange bind:date={start} {range} />
    <hbox flex />
    <slot name="top-right" />
  </hbox>
  <grid flex class="month"
    style="--selected-calendar-color: {$selectedCalendar?.color ?? "black"}"
    on:swipeleft={() => page(1)}
    on:swiperight={() => page(-1)}
    on:swipeup={() => page(1)}
    on:swipedown={() => page(-1)}
    >
    {#each range.weeks[0] as day}
      <hbox class="weekday">
        {day.toLocaleDateString(getDateTimeLocale(), { weekday: "short" })}
      </hbox>
    {/each}
    {#each range.weeks as week}
      <WeekRow days={week} events={filteredEvents}
        on:celldblclick={(param) => newEventMenu.openMenu(param.detail.mouseEvent, param.detail.start)} />
    {/each}
  </grid>
</vbox>

<NewEventMenu bind:this={newEventMenu} />

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import WeekRow from "./WeekRow.svelte";
  import DateRange from "../DateRange.svelte";
  import NewEventMenu from "../NewEventMenu.svelte";
  import { selectedCalendar } from "../selected";
  import type { CalendarRange } from "../CalendarRange";
  import { catchErrors } from "../../Util/error";
  import { getDateTimeLocale } from "../../../l10n/l10n";
  import type { Collection } from "svelte-collections";

  export let start: Date;
  /** Month or 4 weeks */
  export let range: CalendarRange;
  export let events: Collection<Event>;

  let newEventMenu: NewEventMenu;
  let filteredEvents: Collection<Event>;
  $: events, range, filterEvents();
  function filterEvents() {
    let rangeStart = range.start;
    let rangeEnd = range.end;
    filteredEvents = events.filterObservable(ev => ev.startTime && ev.startTime < rangeEnd && rangeStart < ev.endTime);
  }

  function onScrollWheel(event: WheelEvent) {
    page(event.deltaY > 0 ? 1 : -1);
  }

  function page(direction: number) {
    start = range.step(start, direction);
  }
</script>

<style>
  grid.month {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr 1fr 1fr 1fr;
    grid-template-rows: max-content;
    grid-auto-rows: minmax(0, 1fr);
    border-right: 1px dotted var(--border);
    container-type: size;
  }
  .weekday {
    border-top: 1px dotted var(--border);
    border-left: 1px dotted var(--border);
    border-bottom: 1px dotted var(--border);
    padding: 4px 8px;
    color: #8B8B8B;
    opacity: 70%;
    letter-spacing: 0.378px;
    text-transform: uppercase;
    font-weight: 300;
  }
  .month-view :global(.date-range) {
    font-weight: bold;
  }
  .month-view :global(.date-range .year) {
    font-weight: normal;
  }
</style>
