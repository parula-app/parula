<Popup bind:popupOpen={isOpen} popupAnchor={anchor} {placement} boundaryElSel="body">
  <hbox class="month-year-picker">
    <vbox class="years" on:wheel={event => firstYear += Math.sign(event.deltaY)}>
      <Button classes="year-arrow" label={$t`Earlier years`} icon={EarlierIcon} onClick={() => firstYear -= kYearCount} iconSize="16px" plain iconOnly />
      {#each years as year}
        <button class="year"
          class:selected={year.getFullYear() == month.getFullYear()}
          class:now={year.getFullYear() == now.getFullYear()}
          on:click={() => dispatch("change", year)}>
          {year.toLocaleDateString(getDateTimeLocale(), { year: "numeric" })}
        </button>
      {/each}
      <Button classes="year-arrow" label={$t`Later years`} icon={LaterIcon} onClick={() => firstYear += kYearCount} iconSize="16px" plain iconOnly />
    </vbox>
    <grid class="months">
      {#each months as shownMonth}
        <button class="month"
          class:selected={shownMonth.getMonth() == month.getMonth()}
          class:now={shownMonth.getMonth() == now.getMonth() && shownMonth.getFullYear() == now.getFullYear()}
          on:click={() => chooseMonth(shownMonth)}>
          {shownMonth.toLocaleDateString(getDateTimeLocale(), { month: "long" })}
        </button>
      {/each}
    </grid>
  </hbox>
</Popup>
<svelte:window on:keydown={onKeyDown} />

<script lang="ts">
  import Popup from "../Shared/Popup.svelte";
  import type { Placement } from "@popperjs/core";
  import Button from "../Shared/Button.svelte";
  import EarlierIcon from "lucide-svelte/icons/chevron-up";
  import LaterIcon from "lucide-svelte/icons/chevron-down";
  import { getDateTimeLocale, t } from "../../l10n/l10n";
  import { createEventDispatcher } from "svelte";
  /** The 1st of the chosen month. A year click keeps the month and the dropdown open. */
  const dispatch = createEventDispatcher<{ change: Date }>();

  /** in/out */
  export let isOpen = false;
  /** Under which element the dropdown appears. in */
  export let anchor: HTMLElement;
  export let placement: Placement = "bottom";
  /** A day in the shown month. in */
  export let month: Date;

  const kYearCount = 6;
  let now: Date;
  /** Stays when the user picks a year, so that the years don't move under the mouse */
  let firstYear: number;
  $: isOpen, centerYears();
  /** 2 years before the shown year, 3 after */
  function centerYears() {
    now = new Date();
    firstYear = month.getFullYear() - 2;
  }
  /** The shown month in each year */
  $: years = Array.from({ length: kYearCount }, (_, i) => new Date(firstYear + i, month.getMonth(), 1));
  /** The months of the shown year */
  $: months = Array.from({ length: 12 }, (_, i) => new Date(month.getFullYear(), i, 1));

  function chooseMonth(chosen: Date) {
    dispatch("change", chosen);
    isOpen = false;
  }

  function onKeyDown(event: KeyboardEvent) {
    if (isOpen && event.key == "Escape") {
      isOpen = false;
    }
  }
</script>

<style>
  .month-year-picker {
    background-color: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 5px; /* like the shadow of the popup */
    padding: 4px 8px;
    user-select: none;
  }
  .years {
    gap: 2px;
    padding-inline-end: 8px;
    margin-inline-end: 8px;
    border-inline-end: 1px solid var(--border);
  }
  .years :global(.year-arrow) {
    justify-content: center;
    height: 24px;
    opacity: 60%;
  }
  .years :global(.year-arrow:hover) {
    opacity: 100%;
  }
  /* Same rows as the years */
  .months {
    display: grid;
    grid-template-rows: repeat(6, 32px);
    grid-auto-flow: column;
    gap: 2px 4px;
    padding-block: 26px;
  }
  button.year,
  button.month {
    height: 32px;
    padding: 0 16px;
    border: 1px solid transparent;
    border-radius: 1000px;
    background: none;
    color: inherit;
    font: inherit;
    white-space: nowrap;
    cursor: pointer;
  }
  button.year:hover,
  button.month:hover {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  button.now {
    border-color: var(--selected-bg);
    font-weight: bold;
  }
  button.selected,
  button.selected:hover {
    background-color: var(--selected-bg);
    color: var(--selected-fg);
  }

  /* Like the date picker: Today is filled with the accent color, the shown month is light */
  :global(.lookout-window) .month-year-picker {
    border-color: var(--lo-border);
    border-radius: var(--lo-radius);
    box-shadow: var(--lo-shadow-popup);
    font-size: var(--lo-font-size);
  }
  :global(.lookout-window) button.year,
  :global(.lookout-window) button.month {
    border-radius: var(--lo-radius-small);
  }
  :global(.lookout-window) button.selected {
    background-color: var(--lo-selected-bg);
    border-color: var(--lo-accent);
    color: var(--lo-fg);
    font-weight: 600;
  }
  :global(.lookout-window) button.selected:hover {
    background-color: var(--lo-selected-hover-bg);
  }
  :global(.lookout-window) button.now {
    background-color: var(--lo-accent);
    border-color: var(--lo-accent);
    color: var(--lo-accent-fg);
    font-weight: 600;
  }
  :global(.lookout-window) button.now:hover {
    background-color: var(--lo-accent-hover);
  }
</style>
