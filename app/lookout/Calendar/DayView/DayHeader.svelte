<div class="day-header" class:today={isToday} style="grid-column: {column}" bind:clientWidth={width}>
  <button class="day-button"
    title={day.toLocaleDateString(getDateTimeLocale(), { dateStyle: "full" })}
    on:click={() => dispatch("openday", day)}>
    <span class="number">{day.toLocaleDateString(getDateTimeLocale(), { day: "numeric" })}</span>
    <span class="weekday">{day.toLocaleDateString(getDateTimeLocale(), { weekday: width >= 90 ? "long" : "short" })}</span>
  </button>
  <button class="add-button" title={$t`New appointment on this day`} on:click|stopPropagation={onAdd} bind:this={addButton}>
    <AddIcon size="14" />
  </button>
</div>
<NewEventCalendarMenu {calendar} bind:this={newEventMenu} />

<script lang="ts">
  import type { Calendar } from "../../../logic/Calendar/Calendar";
  import { CalendarActions } from "../CalendarActions";
  import NewEventCalendarMenu from "../NewEventCalendarMenu.svelte";
  // import { selectedCalendar } from "../../../frontend/Calendar/selected";
  import { catchErrors } from "../../../frontend/Util/error";
  import { createEventDispatcher } from "svelte";
  import AddIcon from "lucide-svelte/icons/circle-plus";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";

  export let day: Date;
  export let column: number;
  export let calendar: Calendar | null = null;
  export let isToday = false;

  const dispatch = createEventDispatcher<{ openday: Date }>();

  let width = 100;
  let addButton: HTMLButtonElement;
  let newEventMenu: NewEventCalendarMenu;

  function onAdd() {
    let start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 8);
    // let start = WorkingHours.workStartOf(calendar ?? $selectedCalendar, day);
    catchErrors(() => newEventMenu.openMenu(addButton, chosen => CalendarActions.newEvent(chosen, start, null)));
  }
</script>

<style>
  .day-header {
    position: relative;
    display: flex;
    min-width: 0;
    border-inline-start: 1px solid var(--lo-divider);
  }
  .day-button {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
    padding: 6px 8px 4px 8px;
    border: none;
    background: none;
    color: var(--lo-fg);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .day-button:hover {
    background-color: var(--lo-hover-bg);
  }
  .number {
    font-size: 22px;
    font-weight: 300;
    line-height: 28px;
  }
  .weekday {
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg-secondary);
  }
  .today .number {
    font-weight: 600;
  }
  .today .number,
  .today .weekday {
    color: var(--lo-accent-text);
  }
  .today::before {
    content: "";
    position: absolute;
    top: 0;
    inset-inline: 0;
    height: 3px;
    background-color: var(--lo-accent);
    z-index: 1;
  }
  .add-button {
    position: absolute;
    top: 12px;
    inset-inline-end: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--lo-accent-text);
    cursor: pointer;
    opacity: 0;
  }
  .day-header:hover .add-button,
  .add-button:focus-visible {
    opacity: 1;
  }
  .add-button:hover {
    background-color: var(--lo-hover-bg);
  }
</style>
