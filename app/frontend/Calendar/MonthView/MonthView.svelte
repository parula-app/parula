<vbox class="month-view" flex
  on:mousewheel={event => catchErrors(() => onScrollWheel(event))}>
  <hbox class="range-header">
    <slot name="top-left" />
    <hbox flex />
    <DateRange bind:date={start} dateInterval={showDays} />
    <hbox flex />
    <slot name="top-right" />
  </hbox>
  <grid flex class="month"
    style="--selected-calendar-color: {$selectedCalendar?.color ?? "black"}"
    on:swipeleft={onNextMonth}
    on:swiperight={onPreviousMonth}
    on:swipeup={onNextMonth}
    on:swipedown={onPreviousMonth}
    >
    {#each weekDays as day}
      <hbox class="weekday">
        {day.toLocaleDateString(getDateTimeLocale(), { weekday: "short" })}
      </hbox>
    {/each}
    {#each weeks as week}
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
  import { getWeekDays } from "../../../logic/util/date";
  import { catchErrors } from "../../Util/error";
  import { getDateTimeLocale } from "../../../l10n/l10n";
  import type { Collection } from "svelte-collections";

  export let start: Date;
  export let events: Collection<Event>;
  export let showDays = 35;

  let weeks: Date[][] = [];
  let weekDays: Date[] = [];
  let filterStart: Date;
  let filterEnd: Date;
  let newEventMenu: NewEventMenu;
  $: filteredEvents = events.filterObservable(isShown);
  $: start, showDays, setDays();
  function setDays() {
    weekDays = getWeekDays(start);
    if (showDays == 35) {
      while (weekDays[6].getDate() > 7) {
        start.setDate(start.getDate() - 7);
        weekDays = getWeekDays(start);
      }
    }
    let startTime = weekDays[0]; // Always start with Monday
    filterStart = new Date(startTime);
    weeks = [];
    for (let i = 0; i < showDays; i++) {
      if (i % 7 == 0) {
        weeks.push([]);
      }
      weeks[weeks.length - 1].push(new Date(startTime));
      startTime.setDate(startTime.getDate() + 1)
    }
    filterEnd = startTime;
    filteredEvents.replaceAll(events.contents.filter(isShown));
  }

  function isShown(ev: Event): boolean {
    return ev.startTime && ev.startTime < filterEnd && filterStart < ev.endTime;
  }

  function onScrollWheel(event: WheelEvent) {
    const upDown = event.deltaY > 0 ? 1 : -1;
    start.setDate(start.getDate() + showDays * upDown);
    start = start;
  }

  // <copied from="DateRange.svelte">
  function onNextMonth() {
    start.setDate(start.getDate() + (showDays == 35 ? 42 : showDays));
    start = start;
  }
  function onPreviousMonth() {
    start.setDate(start.getDate() - (showDays == 35 ? 28 : showDays));
    start = start;
  }
  // </copied>
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
