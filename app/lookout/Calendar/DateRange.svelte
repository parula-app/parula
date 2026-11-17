<hbox class="calendar-header">
  {#if showToday}
    <button class="today-button" title={$t`Go to today`} on:click={goToToday}>
      {$t`Today`}
    </button>
  {/if}
  <button class="arrow-button" title={previousLabel} aria-label={previousLabel} on:click={() => page(-1)}>
    <PreviousIcon size="16" />
  </button>
  <button class="arrow-button" title={nextLabel} aria-label={nextLabel} on:click={() => page(1)}>
    <NextIcon size="16" />
  </button>
  <h1 class="title">
    <button class="title-button" title={$t`Choose month and year`} bind:this={titleButtonEl}
      on:click|stopPropagation={() => isPickerOpen = !isPickerOpen}>
      <span class="title-text">{range.title(getDateTimeLocale())}</span>
      <ChevronIcon size="16" />
    </button>
  </h1>
  <hbox flex />
  <slot />
</hbox>
<MonthYearPicker bind:isOpen={isPickerOpen} anchor={titleButtonEl} placement="bottom-start" month={range.month}
  on:change={event => goToMonth(event.detail)} />

<script lang="ts">
  import type { CalendarRange } from "../../frontend/Calendar/CalendarRange";
  import { eventPeek } from "./selected";
  import { selectedDate, startDate } from "../../frontend/Calendar/selected";
  import { changeMonth, getToday } from "../../logic/util/date";
  import MonthYearPicker from "../../frontend/Calendar/MonthYearPicker.svelte";
  import PreviousIcon from "lucide-svelte/icons/chevron-left";
  import NextIcon from "lucide-svelte/icons/chevron-right";
  import ChevronIcon from "lucide-svelte/icons/chevron-down";
  import { getDateTimeLocale, t } from "../../l10n/l10n";

  export let date: Date;
  export let range: CalendarRange;
  export let showToday = true;

  // <copied to="../../frontend/Calendar/DateRange.svelte">
  $: isMonth = range.view == "month";
  $: stepsByDay = (range.view == "day" || range.view == "schedule") && range.days.length == 1 || range.view == "dual";
  $: previousLabel = isMonth ? $t`Previous month` : stepsByDay ? $t`Previous day` : $t`Previous *=> Show the previous week or days in the calendar`;
  $: nextLabel = isMonth ? $t`Next month` : stepsByDay ? $t`Next day` : $t`Next *=> Show the next week or days in the calendar`;
  // </copied>

  function goToToday() {
    $eventPeek = null;
    date = getToday();
    $startDate = getToday();
    $selectedDate = getToday();
  }

  function page(direction: number) {
    $eventPeek = null;
    date = range.step(date, direction);
  }

  let titleButtonEl: HTMLButtonElement;
  let isPickerOpen = false;

  /** Shows the same day in the chosen month */
  function goToMonth(month: Date) {
    $eventPeek = null;
    date = changeMonth(date, month);
  }
</script>

<style>
  .calendar-header {
    align-items: center;
    gap: 4px;
    min-height: 52px;
    padding: 0 12px 0 16px;
  }
  .today-button,
  .arrow-button {
    display: flex;
    align-items: center;
    height: 32px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-pane-bg);
    color: var(--lo-fg);
    font: inherit;
    cursor: pointer;
  }
  .today-button {
    padding: 0 12px;
    margin-inline-end: 4px;
  }
  .arrow-button {
    justify-content: center;
    width: 32px;
    padding: 0;
  }
  .today-button:hover,
  .arrow-button:hover {
    background-color: var(--lo-hover-bg);
  }
  .today-button:active,
  .arrow-button:active {
    background-color: var(--lo-pressed-bg);
  }
  .title {
    margin: 0;
    margin-inline-start: 6px;
    font-size: var(--lo-font-size-large);
    font-weight: 600;
    overflow: hidden;
  }
  .title-button {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    padding: 0 6px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .title-button:hover {
    background-color: var(--lo-hover-bg);
  }
  .title-button:active {
    background-color: var(--lo-pressed-bg);
  }
  .title-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title-button :global(svg) {
    flex-shrink: 0;
    color: var(--lo-fg-secondary);
  }
</style>
