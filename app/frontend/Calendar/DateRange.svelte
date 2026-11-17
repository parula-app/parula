<hbox class="date-range-header">
  <button class="date-range" title={$t`Choose month and year`} bind:this={dateRangeEl}
    on:click|stopPropagation={() => isPickerOpen = !isPickerOpen}>
    {@html htmlMonthYear(range)}
  </button>
  <Button classes="previous-button" label={previousLabel} icon={ChevronLeftIcon} onClick={() => page(-1)} iconSize="16px" plain iconOnly />
  <Button classes="next-button" label={nextLabel} icon={ChevronRightIcon} onClick={() => page(1)} iconSize="16px" plain iconOnly />
</hbox>
<MonthYearPicker bind:isOpen={isPickerOpen} anchor={dateRangeEl} month={range.middle}
  on:change={event => goToMonth(event.detail)} />

<script lang="ts">
  import { CalendarRange } from "./CalendarRange";
  import MonthYearPicker from "./MonthYearPicker.svelte";
  import Button from "../Shared/Button.svelte";
  import ChevronLeftIcon from "lucide-svelte/icons/chevron-left";
  import ChevronRightIcon from "lucide-svelte/icons/chevron-right";
  import { changeMonth } from "../../logic/util/date";
  import { getDateTimeLocale, t } from "../../l10n/l10n";

  export let date = new Date(); /* in/out */
  /** The days that the view shows, from `date`. in */
  export let range: CalendarRange;

  // <copied from="../../lookout/Calendar/DateRange.svelte">
  $: isMonth = range.view == "month";
  $: stepsByDay = (range.view == "day" || range.view == "schedule") && range.days.length == 1 || range.view == "dual";
  $: previousLabel = isMonth ? $t`Previous month` : stepsByDay ? $t`Previous day` : $t`Previous *=> Show the previous week or days in the calendar`;
  $: nextLabel = isMonth ? $t`Next month` : stepsByDay ? $t`Next day` : $t`Next *=> Show the next week or days in the calendar`;
  // </copied>

  function page(direction: number) {
    date = range.step(date, direction);
  }

  let dateRangeEl: HTMLButtonElement;
  let isPickerOpen = false;

  /** Shows the chosen month, at the same place in the month as now, e.g. the 3rd week */
  function goToMonth(month: Date) {
    if (range.days.length >= 28) { // Month and 4 weeks
      date = month;
      return;
    }
    let newDate = changeMonth(date, month);
    // The header shows the month of the middle day, which may be in the month before or after
    let newRange = new CalendarRange(range.view, newDate, range.days.length);
    if (newRange.middle.getMonth() != month.getMonth()) {
      newDate = newRange.step(newDate, newRange.middle < newDate ? 1 : -1);
    }
    date = newDate;
  }

  function monthYear(date: Date): string {
    return date.toLocaleDateString(getDateTimeLocale(), {
      year: "numeric",
      month: "long",
      // day: dateInterval < 28 ? "numeric" : undefined,
    });
  }

  function htmlMonthYear(range: CalendarRange): string {
    let str = monthYear(range.middle);
    let year = range.middle.getFullYear();
    return str.replace(String(year), `&nbsp;<span class="year">${year}</span>&nbsp;`);
  }
</script>

<style>
  .date-range-header {
    align-items: center;
    align-self: end;
    margin-block-end: 4px;
  }
  .date-range {
    font-size: 18px;
    margin-inline-start: 8px;
    margin-inline-end: 8px;
    min-width: 9em;
    padding: 0 8px;
    border: none;
    border-radius: 1000px;
    background: none;
    color: inherit;
    font-family: inherit;
    cursor: pointer;
  }
  .date-range:hover {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
</style>
