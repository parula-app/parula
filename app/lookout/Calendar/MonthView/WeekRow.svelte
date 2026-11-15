<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="month-week" style="--rows: {rows}; --rows-per-line: {WeekRowLayout.kRowsPerLine}" bind:clientHeight={height} bind:this={weekEl}
  on:click={onClick} on:dblclick={onDoubleClick} on:contextmenu={onContextMenu}>
  {#each days as day, i}
    <div class="cell drop-day" style="grid-column: {i + 1}" data-day-index={weekIndex * 7 + i}
      class:other-month={!range.isInMonth(day)}
      class:today={day.toDateString() == $now.toDateString()}
      class:selected={isSelected(day, $selectedSlots)}>
      <button class="add-button" title={$t`New appointment on this day`}
        on:click|stopPropagation={event => onAdd(event.currentTarget, day)} on:dblclick|stopPropagation>
        <AddIcon size="14" />
      </button>
      {#if day.getDate() == 1 || day.getDay() == 1}
        <div class="month-name">
          {day.toLocaleDateString(getDateTimeLocale(), { month: "long" })}
        </div>
      {/if}
      {#if isSelected(day, $selectedSlots) && day.getTime() == $selectedSlots.start.getTime()}
        <div class="inline-title-area">
          <InlineEventTitle />
        </div>
      {/if}
    </div>
    <button class="day-number" style="grid-column: {i + 1}"
      class:other-month={!range.isInMonth(day)}
      class:today={day.toDateString() == $now.toDateString()}
      class:first-of-month={day.getDate() == 1}
      title={day.toLocaleDateString(getDateTimeLocale(), { dateStyle: "full" })}
      on:click|stopPropagation={() => dispatch("openday", day)}
      on:dblclick|stopPropagation>
      {day.getDate() == 1
        ? day.toLocaleDateString(getDateTimeLocale(), { month: "short", day: "numeric" })
        : day.toLocaleDateString(getDateTimeLocale(), { day: "numeric" })}
    </button>
  {/each}
  {#each days as _, i}
    {#each $layout.events.filter(item => item.startDay == i) as item (item.event)} <!-- An event over midnight has an item on each day -->
      <div class="item"
        style="grid-column: {item.startDay + 1} / {item.endDay + 1}; grid-row: {item.startRow + 2} / {item.endRow + 2}; --lane: {item.lane}; --lanes: {item.lanes}">
        <EventContainer event={item.event} variant="month"
          continuesBefore={item.continuesBefore} continuesAfter={item.continuesAfter} />
      </div>
    {/each}
  {/each}
  {#each $layout.hiddenEvents as hiddenEvents, i}
    {#if hiddenEvents.length}
      <button class="more" style="grid-column: {i + 1}; grid-row: {rows - WeekRowLayout.kRowsPerLine + 2} / {rows + 2}"
        on:click|stopPropagation={() => dispatch("openday", days[i])}
        on:dblclick|stopPropagation>
        {$t`+${hiddenEvents.length} more`}
      </button>
    {/if}
  {/each}
</div>
<NewEventCalendarMenu bind:this={newEventMenu} />

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import type { CalendarRange } from "../../../frontend/Calendar/CalendarRange";
  import { WeekRowLayout } from "../../../frontend/Calendar/MonthView/WeekRow";
  import { CalendarActions } from "../CalendarActions";
  import { now, selectedSlots, eventPeek, type SlotSelection } from "../selected";
  import { selectedEvent, selectedDate } from "../../../frontend/Calendar/selected";
  import { catchErrors } from "../../../frontend/Util/error";
  import EventContainer from "./EventContainer.svelte";
  import InlineEventTitle from "../InlineEventTitle.svelte";
  import NewEventCalendarMenu from "../NewEventCalendarMenu.svelte";
  import AddIcon from "lucide-svelte/icons/circle-plus";
  import type { Collection } from "svelte-collections";
  import { derived } from "svelte/store";
  import { createEventDispatcher } from "svelte";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";

  export let days: Date[];
  export let weekIndex: number;
  export let range: CalendarRange;
  export let events: Collection<Event>;

  const dispatch = createEventDispatcher<{ slotmenu: { slots: SlotSelection, mouseEvent: MouseEvent }, openday: Date }>();
  const kHeaderHeight = 24;
  const kLineHeight = 22;

  let weekEl: HTMLDivElement;
  let newEventMenu: NewEventCalendarMenu;
  let height = 0;
  $: rows = Math.max(Math.floor((height - kHeaderHeight - 2) / kLineHeight * WeekRowLayout.kRowsPerLine), WeekRowLayout.kRowsPerLine);

  $: weekStart = days[0];
  $: weekEnd = new Date(days[days.length - 1].getFullYear(), days[days.length - 1].getMonth(), days[days.length - 1].getDate() + 1);
  $: weekEvents = events.filterObservable(isInWeek);
  $: weekStart, weekEnd, filterWeek();
  function filterWeek() {
    weekEvents.replaceAll(events.contents.filter(isInWeek));
  }

  function isInWeek(event: Event): boolean {
    return event.startTime.getTime() < weekEnd.getTime() && event.endTime.getTime() > weekStart.getTime();
  }
  $: layout = derived([...$weekEvents.contents], eventsInWeek => new WeekRowLayout(eventsInWeek, days, rows));

  // <copied from="../DayView/AllDayEvents.svelte">
  function dayAt(clientX: number): Date {
    let cells = Array.from(weekEl.querySelectorAll<HTMLElement>(":scope > [data-day-index]"));
    let index = cells.findIndex(cell => {
      let rect = cell.getBoundingClientRect();
      return rect.left <= clientX && clientX < rect.right;
    });
    if (index < 0) {
      let rect = weekEl.getBoundingClientRect();
      index = Math.floor((clientX - rect.left) / rect.width * days.length);
      if (getComputedStyle(weekEl).direction == "rtl") {
        index = days.length - 1 - index;
      }
    }
    return days[Math.min(Math.max(index, 0), days.length - 1)];
  }
  // </copied>

  function selectDay(day: Date) {
    CalendarActions.commitInlineTitle();
    $selectedEvent = null;
    $eventPeek = null;
    $selectedDate = day;
    $selectedSlots = {
      start: day,
      end: new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1),
      allDay: true,
      calendar: null,
    };
  }

  function isSelected(day: Date, selection: SlotSelection | null): boolean {
    return !!selection && selection.allDay && selection.start.getTime() <= day.getTime() && day.getTime() < selection.end.getTime();
  }

  function onClick(mouseEvent: MouseEvent) {
    selectDay(dayAt(mouseEvent.clientX));
  }

  function onDoubleClick(mouseEvent: MouseEvent) {
    let day = dayAt(mouseEvent.clientX);
    selectDay(day);
    catchErrors(() => newEventMenu.openMenu(mouseEvent, calendar => CalendarActions.newEvent(calendar, day, null, "all-day")));
  }

  function onAdd(button: HTMLElement, day: Date) {
    let start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 8);
    // let start = WorkingHours.workStartOf($selectedCalendar, day);
    catchErrors(() => newEventMenu.openMenu(button, calendar => CalendarActions.newEvent(calendar, start, null)));
  }

  function onContextMenu(mouseEvent: MouseEvent) {
    mouseEvent.preventDefault();
    let day = dayAt(mouseEvent.clientX);
    if (!isSelected(day, $selectedSlots)) {
      selectDay(day);
    }
    dispatch("slotmenu", { slots: $selectedSlots, mouseEvent });
  }
</script>

<style>
  .month-week {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    grid-template-rows: 24px repeat(var(--rows), calc(22px / var(--rows-per-line))) minmax(0, 1fr);
    flex: 1 1 0;
    min-height: 0;
    overflow: hidden;
    border-block-start: 1px solid var(--lo-divider);
  }
  .cell {
    grid-row: 1 / -1;
    position: relative;
    border-inline-start: 1px solid var(--lo-divider);
  }
  .add-button {
    position: absolute;
    top: 1px;
    inset-inline-end: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--lo-accent-text);
    cursor: pointer;
    opacity: 0;
    z-index: 2;
  }
  .cell:hover .add-button,
  .cell:has(+ .day-number:hover) .add-button,
  .add-button:focus-visible {
    opacity: 1;
  }
  .add-button:hover {
    background-color: var(--lo-hover-bg);
  }
  .month-name {
    position: absolute;
    /* No inset-inline-start: With the vertical writing mode, it would mean top.
     * The static position already puts it at the start side, also in RTL. */
    top: 24px; /* below the day number */
    bottom: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    color: #8B8B8B;
    opacity: 50%;
    font-size: var(--lo-font-size);
    font-weight: 300;
    letter-spacing: 0.378px;
    text-transform: uppercase;
  }
  @container (max-height: 400px) {
    .month-name {
      display: none;
    }
  }
  .inline-title-area {
    position: absolute;
    top: 24px;
    inset-inline: 0;
  }
  .cell:global(.drop-target) {
    outline: 2px dashed var(--lo-accent);
    outline-offset: -2px;
  }
  .cell.other-month {
    background-color: var(--lo-pane-alt-bg);
  }
  .cell.today {
    background-color: color-mix(in srgb, var(--lo-accent) 6%, var(--lo-pane-bg));
  }
  .cell.today::before {
    content: "";
    position: absolute;
    top: 0;
    inset-inline: 0;
    height: 3px;
    background-color: var(--lo-accent);
  }
  .cell.selected {
    background-color: color-mix(in srgb, var(--lo-accent) 16%, var(--lo-pane-bg));
  }
  .day-number {
    grid-row: 1;
    justify-self: start;
    align-self: center;
    margin-inline-start: 4px;
    padding: 0 4px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    z-index: 1;
  }
  .day-number:hover {
    background-color: var(--lo-hover-bg);
    text-decoration: underline;
  }
  .day-number.other-month {
    color: var(--lo-fg-secondary);
  }
  .day-number.first-of-month {
    font-weight: 600;
  }
  .day-number.today {
    color: var(--lo-accent-text);
    font-weight: 700;
  }
  .item {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: calc(100% / var(--lanes));
    min-width: 0;
    margin-inline-start: calc(100% * var(--lane) / var(--lanes));
    padding: 1px 3px 1px 2px;
    z-index: 1;
  }
  .more {
    justify-self: start;
    margin-inline-start: 4px;
    padding: 0 4px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-accent-text);
    font: inherit;
    font-size: var(--lo-font-size-small);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    z-index: 1;
  }
  .more:hover {
    background-color: var(--lo-hover-bg);
    text-decoration: underline;
  }
</style>
