<vbox class="date-navigator" class:week-numbers={showWeekNumbers} class:several-weeks={range.days.length > 7}>
  {#each months as shownMonth, i} <!-- Not keyed, so that the title stays where the month picker is anchored -->
    <hbox class="title-row">
      {#if i == 0}
        <button class="arrow" title={$t`Previous month`} on:click={() => month = month.next(-1)}>
          <PreviousIcon size="16" />
        </button>
      {/if}
      <hbox flex class="title-box">
        <button class="title" title={$t`Choose month and year`}
          on:click|stopPropagation={event => openMonthPicker(event, i)}>{shownMonth.title(getDateTimeLocale())}</button>
      </hbox>
      {#if i == 0}
        <button class="arrow" title={$t`Next month`} on:click={() => month = month.next(1)}>
          <NextIcon size="16" />
        </button>
      {/if}
    </hbox>
    <div class="grid" role="grid" aria-label={shownMonth.title(getDateTimeLocale())}>
      {#if showWeekNumbers}
        <span class="weekday week-number">#</span>
      {/if}
      {#each shownMonth.weekdayLabels(getDateTimeLocale()) as label}
        <span class="weekday">{label}</span>
      {/each}
      {#each shownMonth.shownWeeks(i == 0, i == months.length - 1) as week}
        {#if showWeekNumbers}
          <button class="week-number" title={$t`Show this week`}
            on:click={() => dispatch("selectweek", firstDay(week))}>{getWeekNumber(firstDay(week))}</button>
        {/if}
        {#each week as day}
          {#if day}
            {@const inRange = range.contains(day)}
            <button class="day"
              class:other-month={!shownMonth.isInMonth(day)}
              class:today={day.toDateString() == $now.toDateString()}
              class:in-range={inRange}
              class:range-start={inRange && !range.contains(dayBefore(day))}
              class:range-end={inRange && !range.contains(dayAfter(day))}
              class:has-events={daysWithEvents.has(DateNavigatorMonth.dayKey(day))}
              class:dragged={isDragged(day, dragStart, dragEnd)}
              title={day.toLocaleDateString(getDateTimeLocale(), { dateStyle: "full" })}
              data-nav-day={day.getTime()}
              on:mousedown={event => onDragStart(event, day)}
              on:mouseenter={() => onDragOver(day)}
              on:click={() => dispatch("selectday", day)}>
              <span class="number">{day.getDate()}</span>
            </button>
          {:else}
            <span class="day empty" />
          {/if}
        {/each}
      {/each}
    </div>
  {/each}
</vbox>
<MonthYearPicker bind:isOpen={isMonthPickerOpen} anchor={monthPickerAnchor} month={(months[monthPickerIndex] ?? month).month}
  on:change={event => chooseMonth(event.detail)} />
<AppWindowEvents on:mouseup={onDragEnd} />

<script lang="ts">
  import type { Event } from "../../logic/Calendar/Event";
  import type { CalendarRange } from "./CalendarRange";
  import { DateNavigatorMonth } from "./DateNavigatorMonth";
  import { shownCalendarEvents } from "./selected";
  import { now } from "./CurrentTimeMarker.svelte";
  import { changeMonth, getWeekNumber } from "../../logic/util/date";
  import MonthYearPicker from "./MonthYearPicker.svelte";
  import AppWindowEvents from "../MainWindow/AppWindowEvents.svelte";
  import PreviousIcon from "lucide-svelte/icons/chevron-left";
  import NextIcon from "lucide-svelte/icons/chevron-right";
  import { createEventDispatcher } from "svelte";
  import { getDateTimeLocale, t } from "../../l10n/l10n";

  export let range: CalendarRange;
  export let date: Date;
  export let showWeekNumbers = false;
  export let monthCount = 1;

  const dispatch = createEventDispatcher<{ selectday: Date, selectweek: Date, selectdays: { first: Date, last: Date } }>();

  let month = new DateNavigatorMonth(date);
  $: months = Array.from({ length: Math.max(monthCount, 1) }, (_, i) => month.next(i));
  // After `months`, so that it sees the month chosen in the month picker, e.g. as 2nd month
  $: followDate(date);
  function followDate(date: Date) {
    if (!months.some(shownMonth => shownMonth.isInMonth(date))) {
      month = new DateNavigatorMonth(date);
    }
  }

  $: monthsEvents = shownCalendarEvents.filterObservable(isInMonths);
  $: months, filterMonths();
  function filterMonths() {
    monthsEvents.replaceAll(shownCalendarEvents.contents.filter(isInMonths));
  }

  function isInMonths(event: Event): boolean {
    return event.startTime < months[months.length - 1].end && event.endTime > months[0].start;
  }

  $: daysWithEvents = new Set(months.flatMap(shownMonth => [...shownMonth.daysWithEvents($monthsEvents.contents)]));

  let isMonthPickerOpen = false;
  let monthPickerAnchor: HTMLElement = null;
  /** Which of the shown months the picker changes */
  let monthPickerIndex = 0;

  function openMonthPicker(event: MouseEvent, index: number) {
    monthPickerAnchor = event.currentTarget as HTMLElement;
    isMonthPickerOpen = !(isMonthPickerOpen && monthPickerIndex == index);
    monthPickerIndex = index;
  }

  /** Shows the chosen month where the user clicked, e.g. as 2nd month,
   * and the same day in the chosen month in the calendar */
  function chooseMonth(chosen: Date) {
    month = new DateNavigatorMonth(chosen).next(-monthPickerIndex);
    dispatch("selectday", changeMonth(date, chosen));
  }

  let dragStart: Date = null;
  let dragEnd: Date = null;

  function onDragStart(event: MouseEvent, day: Date) {
    if (event.button != 0) {
      return;
    }
    dragStart = day;
    dragEnd = day;
  }

  function onDragOver(day: Date) {
    const kMaxDays = 14;
    if (dragStart) {
      dragEnd = DateNavigatorMonth.limitRange(dragStart, day, kMaxDays);
    }
  }

  function onDragEnd() {
    if (dragStart && dragEnd && dragStart.getTime() != dragEnd.getTime()) {
      let first = dragStart < dragEnd ? dragStart : dragEnd;
      let last = dragStart < dragEnd ? dragEnd : dragStart;
      dispatch("selectdays", { first, last });
    }
    dragStart = null;
    dragEnd = null;
  }

  function isDragged(day: Date, start: Date, end: Date): boolean {
    if (!start || !end || start.getTime() == end.getTime()) {
      return false;
    }
    let first = start < end ? start : end;
    let last = start < end ? end : start;
    return day >= first && day <= last;
  }

  function firstDay(week: (Date | null)[]): Date {
    return week.find(day => !!day);
  }

  function dayBefore(day: Date): Date {
    return new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1);
  }

  function dayAfter(day: Date): Date {
    return new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  }
</script>

<style>
  .date-navigator {
    --radius: 1000px;
    --range-radius: var(--radius);
    --secondary-fg: color-mix(in srgb, var(--fg) 60%, transparent);
    --range-bg: color-mix(in srgb, var(--selected-bg) 30%, transparent);
    --range-hover-bg: var(--selected-bg);
    padding: 4px 8px 8px 8px;
    user-select: none;
  }
  .title-row {
    align-items: center;
    height: 32px;
  }
  .grid + .title-row {
    margin-block-start: 8px;
  }
  .title-box {
    justify-content: center;
  }
  .title {
    padding: 2px 8px;
    border: none;
    border-radius: var(--radius);
    background: none;
    color: var(--fg);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .title:hover {
    background-color: var(--hover-bg);
  }
  .arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: var(--radius);
    background: none;
    color: var(--secondary-fg);
    cursor: pointer;
  }
  .arrow:hover {
    background-color: var(--hover-bg);
    color: var(--fg);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    row-gap: 2px;
  }
  .week-numbers .grid {
    grid-template-columns: auto repeat(7, 1fr);
  }
  .weekday {
    height: 24px;
    line-height: 24px;
    text-align: center;
    font-size: 11px;
    color: var(--secondary-fg);
  }
  .week-number {
    min-width: 20px;
    padding: 0 4px 0 0;
    border: none;
    border-inline-end: 1px solid var(--border);
    background: none;
    font: inherit;
    font-size: 11px;
    line-height: 28px;
    text-align: center;
    color: var(--secondary-fg);
  }
  button.week-number {
    cursor: pointer;
  }
  button.week-number:hover {
    background-color: var(--hover-bg);
    color: var(--fg);
  }
  .day.dragged {
    background-color: var(--range-hover-bg);
  }
  .day:global(.drop-target) {
    outline: 2px solid var(--inverted-bg);
    outline-offset: -2px;
  }
  .day {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 28px;
    padding: 0;
    border: none;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .day.in-range {
    background-color: var(--range-bg);
  }
  /* More than a week: Several rows, with small corners instead of round ends */
  .date-navigator.several-weeks {
    --range-radius: 0px;
  }
  .day.range-start {
    border-start-start-radius: var(--range-radius);
    border-end-start-radius: var(--range-radius);
  }
  .day.range-end {
    border-start-end-radius: var(--range-radius);
    border-end-end-radius: var(--range-radius);
  }
  .number {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
  }
  .day:hover .number {
    background-color: var(--hover-bg);
  }
  .day.in-range:hover .number {
    background-color: var(--range-hover-bg);
  }
  .day.other-month {
    color: var(--secondary-fg);
  }
  .day.has-events {
    font-weight: 700;
  }
  .day.today .number,
  .day.today:hover .number {
    background-color: var(--inverted-bg);
    color: var(--inverted-fg);
    font-weight: 700;
  }

  :global(.lookout-window) .date-navigator {
    --radius: var(--lo-radius-small);
    --range-radius: var(--lo-radius-small);
    --secondary-fg: var(--lo-fg-secondary);
    --range-bg: var(--lo-selected-bg);
    --range-hover-bg: var(--lo-selected-hover-bg);
  }
  :global(.lookout-window) .week-number {
    border-inline-end-color: var(--lo-divider);
  }
</style>
