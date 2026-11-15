<hbox class="date-range-header">
  <button class="date-range" title={$t`Choose month and year`} bind:this={dateRangeEl}
    on:click|stopPropagation={() => isPickerOpen = !isPickerOpen}>
    {@html htmlMonthYear(date, showDays)}
  </button>
  <Button classes="previous-button" label={$t`Previous ${dateInterval} days`} icon={ChevronLeftIcon} onClick={pagePrevious} iconSize="16px" plain iconOnly />
  <Button classes="next-button" label={$t`Next ${dateInterval} days`} icon={ChevronRightIcon} onClick={pageNext} iconSize="16px" plain iconOnly />
</hbox>
<MonthYearPicker bind:isOpen={isPickerOpen} anchor={dateRangeEl} month={middleOfRange(date)}
  on:change={event => goToMonth(event.detail)} />

<script lang="ts">
  import MonthYearPicker from "./MonthYearPicker.svelte";
  import Button from "../Shared/Button.svelte";
  import ChevronLeftIcon from "lucide-svelte/icons/chevron-left";
  import ChevronRightIcon from "lucide-svelte/icons/chevron-right";
  import { changeMonth, getWeekStart } from "../../logic/util/date";
  import { getDateTimeLocale, t } from "../../l10n/l10n";

  export let date = new Date(); /* in/out */
  /** Days to page forward and back */
  export let dateInterval: number; /* in */
  /** Days visible in the view. Week views start on Monday, not on `date`. */
  export let showDays = dateInterval; /* in */

  // <copied to="MonthView.svelte">
  function pageNext() {
    // Advance months by 42 days just to be sure, e.g. for March 2025
    // MonthView.setDays will then rewind as necessary.
    date.setDate(date.getDate() + (dateInterval == 35 ? 42 : dateInterval));
    date = date;
  }
  function pagePrevious() {
    // Rewind by 28 days at most, e.g. for February 2025
    // MonthView.setDays will rewind further if necessary.
    date.setDate(date.getDate() - (dateInterval == 35 ? 28 : dateInterval));
    date = date;
  }
  // </copied>

  let dateRangeEl: HTMLButtonElement;
  let isPickerOpen = false;

  /** Shows the chosen month, at the same place in the month as now, e.g. the 3rd week */
  function goToMonth(month: Date) {
    if (dateInterval >= 28) { // Month view
      date = new Date(month); // Copy, because the views change `date` in place
      return;
    }
    let newDate = changeMonth(date, month);
    // The header shows the month of the middle day, which may be in the month before or after
    let middle = middleOfRange(newDate);
    if (middle.getMonth() != month.getMonth()) {
      newDate.setDate(newDate.getDate() + (middle < newDate ? dateInterval : -dateInterval));
    }
    date = newDate;
  }

  /** @returns The middle of the visible days, i.e. the month
   * that covers most of the current date range. */
  function middleOfRange(date: Date): Date {
    // Week views start on the Monday of the week, not on `date`
    let middle = showDays > 3 ? getWeekStart(date) : new Date(date);
    middle.setDate(middle.getDate() + (showDays >> 1));
    return middle;
  }

  function monthYear(date: Date): string {
    return date.toLocaleDateString(getDateTimeLocale(), {
      year: "numeric",
      month: "long",
      // day: dateInterval < 28 ? "numeric" : undefined,
    });
  }

  function htmlMonthYear(date: Date, _showDays: number): string {
    let middle = middleOfRange(date);
    let str = monthYear(middle);
    let year = middle.getFullYear();
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
