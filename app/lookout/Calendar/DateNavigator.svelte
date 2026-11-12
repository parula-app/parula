<vbox class="date-navigator" class:week-numbers={showWeekNumbers}>
  {#each months as shownMonth, i (shownMonth.month.getTime())}
    <hbox class="title-row">
      {#if i == 0}
        <button class="arrow" title={$t`Previous month`} on:click={() => month = month.next(-1)}>
          <PreviousIcon size="16" />
        </button>
      {/if}
      <hbox flex class="title-box">
        <button class="title" title={$t`Choose a month`}
          on:click={event => openMonthList(event, shownMonth)}>{shownMonth.title(getDateTimeLocale())}</button>
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
<Menu bind:isMenuOpen={isMonthListOpen} anchor={monthListAnchor} placement="bottom">
  {#each monthChoices as choice (choice.month.getTime())}
    <MenuItem label={choice.title(getDateTimeLocale())} checked={choice.month.getTime() == monthListCenter?.month.getTime()}
      onClick={() => chooseMonth(choice)} />
  {/each}
</Menu>
<AppWindowEvents on:mouseup={onDragEnd} />

<script lang="ts">
  import type { Event } from "../../logic/Calendar/Event";
  import type { CalendarRange } from "./CalendarRange";
  import { DateNavigatorMonth } from "./DateNavigatorMonth";
  import { now } from "./selected";
  import { getWeekNumber } from "../Util/date";
  import { shownCalendarEvents } from "../../frontend/Calendar/selected";
  import Menu from "../Shared/Menu/Menu.svelte";
  import MenuItem from "../Shared/Menu/MenuItem.svelte";
  import AppWindowEvents from "../../frontend/MainWindow/AppWindowEvents.svelte";
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
  $: followDate(date);
  function followDate(date: Date) {
    if (!months?.some(shownMonth => shownMonth.isInMonth(date))) {
      month = new DateNavigatorMonth(date);
    }
  }

  $: months = Array.from({ length: Math.max(monthCount, 1) }, (_, i) => month.next(i));
  $: monthsEvents = shownCalendarEvents.filterObservable(isInMonths);
  $: months, filterMonths();
  function filterMonths() {
    monthsEvents.replaceAll(shownCalendarEvents.contents.filter(isInMonths));
  }

  function isInMonths(event: Event): boolean {
    return event.startTime < months[months.length - 1].end && event.endTime > months[0].start;
  }

  $: daysWithEvents = new Set(months.flatMap(shownMonth => [...shownMonth.daysWithEvents($monthsEvents.contents)]));

  let isMonthListOpen = false;
  let monthListAnchor: HTMLElement = null;
  let monthListCenter: DateNavigatorMonth = null;
  $: monthChoices = monthListCenter ? [-3, -2, -1, 0, 1, 2, 3].map(offset => monthListCenter.next(offset)) : [];

  function openMonthList(event: MouseEvent, shownMonth: DateNavigatorMonth) {
    monthListAnchor = event.currentTarget as HTMLElement;
    monthListCenter = shownMonth;
    isMonthListOpen = true;
  }

  function chooseMonth(choice: DateNavigatorMonth) {
    let index = months.findIndex(shownMonth => shownMonth.month.getTime() == monthListCenter.month.getTime());
    month = choice.next(-Math.max(index, 0));
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
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .title:hover {
    background-color: var(--lo-hover-bg);
  }
  .arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
    cursor: pointer;
  }
  .arrow:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
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
    color: var(--lo-fg-secondary);
  }
  .week-number {
    min-width: 20px;
    padding: 0 4px 0 0;
    border: none;
    border-inline-end: 1px solid var(--lo-divider);
    background: none;
    font: inherit;
    font-size: 11px;
    line-height: 28px;
    text-align: center;
    color: var(--lo-fg-secondary);
  }
  button.week-number {
    cursor: pointer;
  }
  button.week-number:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  .day.dragged {
    background-color: var(--lo-selected-hover-bg);
  }
  .day:global(.drop-target) {
    outline: 2px solid var(--lo-accent);
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
    color: var(--lo-fg);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .day.in-range {
    background-color: var(--lo-selected-bg);
  }
  .day.range-start {
    border-start-start-radius: var(--lo-radius-small);
    border-end-start-radius: var(--lo-radius-small);
  }
  .day.range-end {
    border-start-end-radius: var(--lo-radius-small);
    border-end-end-radius: var(--lo-radius-small);
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
    background-color: var(--lo-hover-bg);
  }
  .day.in-range:hover .number {
    background-color: var(--lo-selected-hover-bg);
  }
  .day.other-month {
    color: var(--lo-fg-secondary);
  }
  .day.has-events {
    font-weight: 700;
  }
  .day.today .number,
  .day.today:hover .number {
    background-color: var(--lo-accent);
    color: var(--lo-accent-fg);
    font-weight: 700;
  }
</style>
