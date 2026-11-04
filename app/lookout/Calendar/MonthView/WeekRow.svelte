<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="month-week" style="--lines: {maxLines}" bind:clientHeight={height} bind:this={weekEl}
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
  {#each $layout.shown as item (item.event)}
    <div class="item" style="grid-column: {item.startDay + 1} / {item.endDay + 1}; grid-row: {item.lane + 2}">
      <EventContainer event={item.event} variant="month"
        continuesBefore={item.continuesBefore} continuesAfter={item.continuesAfter} />
    </div>
  {/each}
  {#each $layout.hiddenCounts as hiddenCount, i}
    {#if hiddenCount}
      <button class="more" style="grid-column: {i + 1}; grid-row: {maxLines + 1}"
        on:click|stopPropagation={() => dispatch("openday", days[i])}
        on:dblclick|stopPropagation>
        {$t`+${hiddenCount} more`}
      </button>
    {/if}
  {/each}
</div>
<NewEventCalendarMenu bind:this={newEventMenu} />

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import type { CalendarRange } from "../CalendarRange";
  import { WeekRowLayout } from "./WeekRow";
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
  $: maxLines = Math.max(Math.floor((height - kHeaderHeight - 2) / kLineHeight), 1);

  let weekStart: Date;
  let weekEnd: Date;
  $: weekEvents = events.filterObservable(isInWeek);
  $: days, filterWeek();
  function filterWeek() {
    weekStart = days[0];
    let lastDay = days[days.length - 1];
    weekEnd = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1);
    weekEvents.replaceAll(events.contents.filter(isInWeek));
  }

  function isInWeek(event: Event): boolean {
    return event.startTime < weekEnd && event.endTime > weekStart;
  }
  $: layout = derived([...$weekEvents.contents], eventsInWeek => new WeekRowLayout(eventsInWeek, days, maxLines));

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
    return !!selection && selection.allDay && selection.start <= day && day < selection.end;
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
    grid-template-rows: 24px repeat(var(--lines), 22px) minmax(0, 1fr);
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
    min-width: 0;
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
    cursor: pointer;
    z-index: 1;
  }
  .more:hover {
    background-color: var(--lo-hover-bg);
    text-decoration: underline;
  }
</style>
