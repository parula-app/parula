<vbox class="date-picker lo-card" role="dialog" aria-label={label}>
  <hbox class="title-row">
    <span class="title">{month.title(getDateTimeLocale())}</span>
    <hbox flex />
    <button class="arrow" title={$t`Previous month`} on:click={() => month = month.next(-1)}>
      <PreviousIcon size="16" />
    </button>
    <button class="arrow" title={$t`Next month`} on:click={() => month = month.next(1)}>
      <NextIcon size="16" />
    </button>
  </hbox>
  <div class="grid" role="grid" aria-label={month.title(getDateTimeLocale())}>
    {#each month.weekdayLabels(getDateTimeLocale()) as weekday}
      <span class="weekday">{weekday}</span>
    {/each}
    {#each month.weeks as week}
      {#each week as day}
        <button class="day"
          class:other-month={!month.isInMonth(day)}
          class:today={day.toDateString() == $now.toDateString()}
          class:selected={isSameDay(day, date)}
          disabled={isBefore(day, min)}
          title={day.toLocaleDateString(getDateTimeLocale(), { dateStyle: "full" })}
          on:click={() => dispatch("pick", day)}>
          <span class="number">{day.getDate()}</span>
        </button>
      {/each}
    {/each}
  </div>
  <hbox class="buttons">
    <button class="today-button" disabled={isBefore($now, min)} on:click={() => dispatch("pick", new Date($now))}>{$t`Today`}</button>
  </hbox>
</vbox>

<script lang="ts">
  import { DateNavigatorMonth } from "../../Calendar/DateNavigatorMonth";
  import { now } from "../../Calendar/selected";
  import PreviousIcon from "lucide-svelte/icons/chevron-up";
  import NextIcon from "lucide-svelte/icons/chevron-down";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";
  import { createEventDispatcher } from "svelte";
  const dispatch = createEventDispatcher<{ pick: Date }>();

  export let date: Date;
  export let min: Date = null;
  export let label: string;

  let month = new DateNavigatorMonth(date ?? new Date());

  function isSameDay(day: Date, selected: Date): boolean {
    return !!selected && day.toDateString() == selected.toDateString();
  }

  function isBefore(day: Date, limit: Date): boolean {
    return !!limit && new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1) <= limit;
  }
</script>

<style>
  .date-picker {
    width: 252px;
    padding: 8px 10px 6px;
    box-shadow: var(--lo-shadow-popup);
    user-select: none;
  }
  .title-row {
    align-items: center;
    height: 30px;
    padding-inline-start: 4px;
  }
  .title {
    font-weight: 600;
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
  .weekday {
    height: 24px;
    line-height: 24px;
    text-align: center;
    font-size: 11px;
    color: var(--lo-fg-secondary);
  }
  .day {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 30px;
    padding: 0;
    border: none;
    background: none;
    color: var(--lo-fg);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .day:disabled {
    color: var(--lo-fg-disabled);
    cursor: default;
  }
  .number {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 1px solid transparent;
    border-radius: 50%;
  }
  .day:hover:not(:disabled) .number {
    background-color: var(--lo-hover-bg);
  }
  .day.other-month {
    color: var(--lo-fg-secondary);
  }
  .day.selected .number,
  .day.selected:hover .number {
    background-color: var(--lo-selected-bg);
    border-color: var(--lo-accent);
    font-weight: 600;
  }
  .day.today .number,
  .day.today:hover .number {
    background-color: var(--lo-accent);
    color: var(--lo-accent-fg);
    font-weight: 700;
  }
  .buttons {
    justify-content: center;
    margin-block-start: 4px;
    padding-block-start: 4px;
    border-block-start: 1px solid var(--lo-divider);
  }
  .today-button {
    padding: 4px 12px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-accent-text);
    font: inherit;
    cursor: pointer;
  }
  .today-button:hover:not(:disabled) {
    background-color: var(--lo-hover-bg);
  }
  .today-button:disabled {
    color: var(--lo-fg-disabled);
    cursor: default;
  }
</style>
