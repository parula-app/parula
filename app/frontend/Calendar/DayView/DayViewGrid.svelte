<vbox class="day-view-grid" flex bind:offsetHeight={visibleHeight}>
  <Scroll bind:this={scrollE}>
    <grid flex class="week"
      columns={showDays}
      style="--rows: {(endHour - startHour) * kRowsPerHour}; --row-height: {pxPerHour / kRowsPerHour}px; --selected-calendar-color: {$selectedCalendar?.color ?? "black"}; {columnWidths}"
      class:enlargeSelectedDay
      class:compact={scrollHeight <= 1000}
      on:swipeleft={onNextDay}
      on:swiperight={onPreviousDay}
      >
      <grid class="headers">
        <hbox class="top-left header" /><!-- needed for grid -->
        {#each days as day, i}
          <vbox class="day-header header" style="grid-column: {i + 2}">
            <slot name="day-header" {day}>
              <vbox class="date-day">
                <hbox class="date">{day.toLocaleDateString(getDateTimeLocale(), { day: "numeric" })}</hbox>
                <hbox class="weekday">{day.toLocaleDateString(getDateTimeLocale(), { weekday: appGlobal.isSmall ? "short" : "long" })}</hbox>
              </vbox>
            </slot>
          </vbox>
        {/each}
        <AllDayEvents {days} events={allDayEvents} maxHeight={visibleHeight / 3} />
      </grid>
      {#each startTimes as time, i}
        <hbox class="time-label" style="grid-row: {i * kRowsPerHour + 3} / span {kRowsPerHour}">
          <slot name="time-label" {time}>
            <TimeLabel {time} />
          </slot>
        </hbox>
      {/each}
      {#each days as day, i}
        <DayColumn {day} column={i + 2} {startHour} {endHour} events={visibleEvents} {overlayEvents} on:celldblclick>
          <slot name="event-overlay" slot="event-overlay" let:start {start} let:end {end} let:event {event} />
          <slot name="event-hover" slot="event-hover" let:start {start} let:end {end} let:empty {empty} />
        </DayColumn>
      {/each}
    </grid>
  </Scroll>
</vbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { selectedCalendar, type DateInterval } from "../selected";
  import { kRowsPerHour } from "./DayColumn";
  import { appGlobal } from "../../../logic/app";
  import TimeLabel from "./TimeLabel.svelte";
  import DayColumn from "./DayColumn.svelte";
  import AllDayEvents from "./AllDayEvents.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import { getToday, getWeekStart } from "../../../logic/util/date";
  import { getDateTimeLocale } from "../../../l10n/l10n";
  import type { Collection } from "svelte-collections";
  import { tick } from "svelte";

  export let start: Date;
  export let events: Collection<Event>;
  /** UI elements that appear in the event slots. Optional */
  export let overlayEvents: Collection<Event> | null = null;
  export let showDays: DateInterval; // If you add new options, adapt styles below
  /* Number of hours visible at the same time. Larger range reduces size per hour.
   * Other hours are available on scroll. */
  export let showHours = 10;
  export let defaultFocusHour: number | null = null;
  export let enlargeSelectedDay = false;

  let startHour = 0;
  let endHour = 24;
  let intervalHour = 1;

  // <copied to="../EditEvent/Availability/ParticipantsDayView.svelte">
  let scrollE: Scroll;
  let visibleHeight = 0;
  $: pxPerHour =  visibleHeight / showHours;
  $: scrollHeight = pxPerHour * (endHour - startHour);
  $: focusHour = defaultFocusHour ?? (start.toDateString() == new Date().toDateString()
    ? new Date().getHours()
    : 8);
  $: focusHour, pxPerHour, scrollToFocusHour();
  async function scrollToFocusHour() {
    await tick(); // The new grid height reaches the DOM only after the update
    scrollE?.scrollTo((focusHour - 0.5) * pxPerHour);
  }
  // </copied>

  let startTimes: Date[] = [];
  $: start, setStartTimes();
  function setStartTimes() {
    let startTime = new Date(start);
    startTime.setMinutes(0, 0, 0);
    startTimes = [];
    for (let i = startHour; i < endHour; i += intervalHour) {
      startTime.setHours(i);
      startTimes.push(new Date(startTime));
    }
  }

  let days: Date[] = [];
  let filterStart: Date;
  let filterEnd: Date;
  $: filtered = events.filterObservable(isShown);
  $: visibleEvents = filtered.filterObservable(ev => !ev.allDay);
  $: allDayEvents = filtered.filterObservable(ev => ev.allDay);
  $: start, showDays, setDays();
  function setDays() {
    let startTime = showDays > 3 ? getWeekStart(start) : new Date(start);
    startTime.setHours(startHour, 0, 0, 0);
    filterStart = new Date(startTime);
    days = [];
    for (let i = 0; i < showDays; i++) {
      days.push(new Date(startTime));
      startTime.setDate(startTime.getDate() + 1);
    }
    filterEnd = startTime;
    filtered.replaceAll(events.contents.filter(isShown));
  }

  function isShown(ev: Event): boolean {
    return ev.startTime && ev.startTime < filterEnd && filterStart < ev.endTime;
  }

  let today = getToday();
  // Update today at midnight
  $: setTimeout(() => today = getToday(), new Date(today).setDate(today.getDate() + 1) - Date.now());

  // Shows today wider. Sets e.g. `grid-template-columns: max-content 1fr 1fr 1.5fr 1fr 1fr` on the `<grid>`
  $: columnWidths = showDays > 3 && days.some(day => day.getTime() == today.getTime())
    ? "grid-template-columns: max-content " + days.map(day => day.getTime() == today.getTime() ? "1.5fr" : "1fr").join(" ")
    : "";

  function onNextDay() {
    // Week views snap to Monday, so page whole weeks
    let pageDays = showDays > 3 ? 7 : 1;
    start.setDate(start.getDate() + pageDays);
    start = start;
  }

  function onPreviousDay() {
    let pageDays = showDays > 3 ? 7 : 1;
    start.setDate(start.getDate() - pageDays);
    start = start;
  }
</script>

<style>
  .week {
    display: grid;
    grid-template-rows: max-content max-content repeat(var(--rows), var(--row-height));
  }
  .week[columns="1"] {
    grid-template-columns: max-content auto;
  }
  .week[columns="2"] {
    grid-template-columns: max-content 1fr 1fr;
  }
  .week.enlargeSelectedDay[columns="2"] {
    grid-template-columns: max-content 3fr 1fr;
  }
  .week[columns="5"] {
    grid-template-columns: max-content 1fr 1fr 1fr 1fr 1fr;
    /* overridden by $: above */
  }
  .week[columns="7"] {
    grid-template-columns: max-content 1fr 1fr 1fr 1fr 1fr 1fr 1fr;
    /* overridden by $: above */
  }
  /* <copied to="../EditEvent/Availability/ParticipantsDayView.svelte"> */
  .headers {
    grid-column: 1 / -1;
    grid-row: 1 / span 2;
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: subgrid;
    position: sticky;
    top: 0;
    z-index: 2;
  }
  .header {
    background-color: var(--bg);
  }
  .top-left {
    grid-column: 1;
    grid-row: 1 / span 2;
    height: calc(100% - 10px);
  }
  .day-header {
    grid-row: 1;
    border-top: 1px dotted var(--border);
    border-left: 1px dotted var(--border);
    min-width: 0px; /* Long titles must not widen the column */
  }
  .time-label {
    grid-column: 1;
  }
  /* </copied> */
  .date-day {
    padding: 8px 16px;
  }
  .day-header .date {
    font-size: 180%;
    overflow-wrap: break-word;
  }
  .weekday {
    margin-block-start: -4px;
    margin-block-end: 4px;
    max-height: 1.3em;
    overflow: hidden;
  }
  :where(.compact) .day-header .date-day {
    flex-direction: row;
    padding: 4px 8px;
  }
  :where(.compact) .day-header .date {
    font-size: 120%;
  }
  :where(.compact) .day-header .weekday {
    font-size: 90%;
    align-items: center;
    flex: 1 0 0;
    margin-block-start: 1px;
    margin-inline-start: 8px;
  }
</style>
