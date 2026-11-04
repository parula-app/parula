<vbox class="day-preview">
  <hbox class="header">
    <span class="day">{dayLabel}</span>
    <hbox flex />
    {#if onShowInCalendar}
      <button class="open" on:click={onShowInCalendar} title={$t`Show this day in the calendar`}>
        <CalendarIcon size={14} />
        {$t`Calendar… *=> Show this day in the calendar`}
      </button>
    {/if}
  </hbox>
  {#if allDayItems.length}
    <vbox class="all-day">
      {#each allDayItems as item}
        <hbox class="event status-{item.look.status}" class:current={item.isCurrent}
          style:--event-color={item.event.color ?? item.event.calendar?.color ?? "var(--lo-accent)"} title={item.look.tooltip(locale)}>
          <hbox class="bar" />
          <span class="title">{item.look.title}</span>
        </hbox>
      {/each}
    </vbox>
  {/if}
  {#if hours.length}
    <hbox class="grid" style:height="{hours.length * kHourHeight}px">
      <vbox class="hours">
        {#each hours as hour}
          <span class="hour" style:height="{kHourHeight}px">{hourLabel.label(hour)}</span>
        {/each}
      </vbox>
      <vbox flex class="column">
        {#each hours as hour}
          <hbox class="slot" style:height="{kHourHeight}px" />
        {/each}
        {#each timedItems as item}
          <hbox class="event status-{item.look.status}" class:current={item.isCurrent}
            style:--event-color={item.event.color ?? item.event.calendar?.color ?? "var(--lo-accent)"}
            style:top="{item.top}px" style:height="{Math.max(item.height - 1, 14)}px"
            style:left="calc({item.lane} * 100% / {item.lanes})" style:width="calc(100% / {item.lanes} - 2px)"
            title={item.look.tooltip(locale)}>
            <hbox class="bar" />
            <span class="title"><b>{item.look.title}</b>{item.event.location ? "; " + item.event.location : ""}</span>
          </hbox>
        {/each}
      </vbox>
    </hbox>
  {/if}
</vbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { appGlobal } from "../../../logic/app";
  import { DayPreviewLayout } from "./EventInDayView";
  import { HourLabel } from "../DayView/HourLabel";
  import CalendarIcon from "lucide-svelte/icons/calendar-days";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";

  export let event: Event;
  export let onShowInCalendar: () => void = null;

  const kHourHeight = 36;
  const locale = getDateTimeLocale();
  const hourLabel = new HourLabel(locale);
  const calendarEvents = appGlobal.calendarEvents;

  $: layout = new DayPreviewLayout($event, $calendarEvents, kHourHeight);
  $: dayLabel = layout.day.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  $: hours = layout.hours;
  $: timedItems = layout.timedItems;
  $: allDayItems = layout.allDayItems;
</script>

<style>
  .day-preview {
    flex-shrink: 0;
    border: 1px solid var(--lo-divider);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-pane-bg);
    font-size: var(--lo-font-size-small);
  }
  .header {
    align-items: center;
    min-height: 28px;
    padding: 0 4px 0 8px;
    border-block-end: 1px solid var(--lo-divider);
    background-color: var(--lo-pane-alt-bg);
  }
  .day {
    font-weight: 600;
  }
  .open {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 6px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-accent-text);
    font: inherit;
    cursor: pointer;
  }
  .open:hover {
    background-color: var(--lo-hover-bg);
  }
  /* <copied from="EventContent.svelte"> */
  .event {
    display: flex;
    flex-direction: row;
    box-sizing: border-box;
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--lo-event-border);
    border-radius: 4px;
    background-color: color-mix(in srgb, var(--event-color) calc(var(--lo-event-fill) * var(--lo-event-fill-boost)), var(--lo-pane-bg));
    color: var(--lo-fg);
    font-size: var(--lo-font-size-small);
    --lo-event-fill: 22%;
    --lo-event-fill-boost: 1;
    --lo-event-border: color-mix(in srgb, var(--event-color) 45%, transparent);
    --lo-event-bar: var(--event-color);
  }
  @media (prefers-color-scheme: dark) {
    .event {
      --lo-event-fill-boost: 1.6;
    }
  }
  .event:hover {
    --lo-event-fill: 30%;
  }
  .bar {
    flex: none;
    width: 6px;
    margin-block: -1px;
    margin-inline-start: -1px;
    background: var(--lo-event-bar);
  }
  .event.status-tentative,
  .event.status-unanswered {
    --lo-event-bar: repeating-linear-gradient(-45deg, var(--event-color) 0 2px, var(--lo-pane-bg) 2px 4px);
  }
  .event.status-unanswered {
    background-color: var(--lo-pane-bg);
    background-image: repeating-linear-gradient(-45deg,
      transparent 0 6px,
      color-mix(in srgb, var(--event-color) calc(var(--lo-event-fill) * var(--lo-event-fill-boost)), transparent) 6px 9px);
    --lo-event-border: var(--event-color);
  }
  .event.status-declined,
  .event.status-cancelled {
    background-color: var(--lo-pane-bg);
    background-image: none;
    color: var(--lo-fg-secondary);
    --lo-event-border: var(--lo-border-strong);
    --lo-event-bar: transparent;
  }
  /* </copied> */
  .event {
    cursor: default;
  }
  .all-day {
    gap: 2px;
    padding: 2px 4px 2px 56px;
    border-block-end: 1px solid var(--lo-divider);
  }
  .all-day .event {
    height: 20px;
    align-items: center;
  }
  .grid {
    position: relative;
    overflow: hidden;
  }
  .hours {
    flex-shrink: 0;
    width: 52px;
    border-inline-end: 1px solid var(--lo-divider);
  }
  .hour {
    box-sizing: border-box;
    padding: 2px 6px 0 0;
    border-block-end: 1px solid var(--lo-divider);
    color: var(--lo-fg-secondary);
    text-align: end;
    white-space: nowrap;
  }
  .column {
    position: relative;
  }
  .slot {
    box-sizing: border-box;
    flex-shrink: 0;
    border-block-end: 1px solid var(--lo-divider);
  }
  .column .event {
    position: absolute;
    margin-inline-start: 2px;
  }
  .event.current {
    outline: 2px solid var(--lo-fg);
    outline-offset: -1px;
    z-index: 1;
  }
  .title {
    min-width: 0;
    padding: 1px 6px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
