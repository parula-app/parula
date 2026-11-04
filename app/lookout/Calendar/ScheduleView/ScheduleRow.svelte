<div class="schedule-row" class:selected={isSelected} style="--calendar-color: {$calendar.color}; height: {rowHeight}px">
  <button class="name" title={$calendar.name} on:click={() => $selectedCalendar = calendar}>
    <span class="name-text">{$calendar.name}</span>
  </button>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="track"
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:pointercancel={onPointerUp}
    on:dblclick={onDoubleClick}
    on:contextmenu={onContextMenu}
    bind:this={trackEl}>
    {#each days as day, d}
      <!-- {#each $workingHours.offWorkMinutes(day) as offWorkRange}
        <div class="off-hours" style="left: {d * dayWidth + offWorkRange.from * pxPerMinute}px; width: {(offWorkRange.to - offWorkRange.from) * pxPerMinute}px" />
      {/each} -->
      <div class="day-line" style="left: {d * dayWidth}px" />
    {/each}
    {#if selection}
      <div class="slot-selection" style="left: {selection.from * pxPerMinute}px; width: {(selection.to - selection.from) * pxPerMinute}px" />
    {/if}
    {#each $layout.items as item (item.event)}
      <ScheduleEvent {item} {pxPerMinute} top={kRowPadding + item.lane * kLaneHeight} height={kLaneHeight - 2} />
    {/each}
    {#if nowMinute != null}
      <div class="current-time" style="left: {nowMinute * pxPerMinute}px" />
    {/if}
  </div>
</div>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import type { Calendar } from "../../../logic/Calendar/Calendar";
  import { ScheduleLayout } from "./ScheduleLayout";
  import { CalendarActions } from "../CalendarActions";
  import { selectedSlots, eventPeek, type SlotSelection } from "../selected";
  import { selectedCalendar, selectedEvent } from "../../../frontend/Calendar/selected";
  import { catchErrors } from "../../../frontend/Util/error";
  import ScheduleEvent from "./ScheduleEvent.svelte";
  import type { Collection } from "svelte-collections";
  import { derived } from "svelte/store";
  import { createEventDispatcher } from "svelte";

  export let calendar: Calendar;
  export let events: Collection<Event>;
  export let days: Date[];
  export let pxPerHour: number;
  export let timeScale: number;
  export let nowMinute: number | null = null;
  export let isSelected = false;

  const kLaneHeight = 26;
  const kRowPadding = 4;
  const dispatch = createEventDispatcher<{ slotmenu: { slots: SlotSelection, mouseEvent: MouseEvent } }>();

  let trackEl: HTMLDivElement;

  // $: workingHours = WorkingHours.of(calendar);
  $: pxPerMinute = pxPerHour / 60;
  $: dayWidth = pxPerHour * 24;
  $: rangeStart = days[0];
  $: rangeEnd = new Date(days[days.length - 1].getFullYear(), days[days.length - 1].getMonth(), days[days.length - 1].getDate() + 1);
  let inRange: Collection<Event>;
  let inRangeFrom: Collection<Event>;
  $: filterEvents(events);
  $: rangeStart, rangeEnd, filterRange();
  $: layout = derived([...$inRange.contents], eventsInRange => new ScheduleLayout(eventsInRange, days));
  $: rowHeight = Math.max($layout.laneCount, 2) * kLaneHeight + 2 * kRowPadding;

  $: selection = $selectedSlots && !$selectedSlots.allDay && $selectedSlots.calendar == calendar &&
    $selectedSlots.start < rangeEnd && $selectedSlots.end > rangeStart
    ? { from: $layout.minuteOf($selectedSlots.start), to: $layout.minuteOf($selectedSlots.end) }
    : null;

  function filterEvents(source: Collection<Event>) {
    if (source != inRangeFrom) {
      inRangeFrom = source;
      inRange = source.filterObservable(isInRange);
    }
  }

  function filterRange() {
    inRange.replaceAll(events.contents.filter(isInRange));
  }

  function isInRange(event: Event): boolean {
    return event.startTime < rangeEnd && event.endTime > rangeStart;
  }

  function slotAt(clientX: number): number {
    let rect = trackEl.getBoundingClientRect();
    let minute = Math.min(Math.max((clientX - rect.left) / pxPerMinute, 0), $layout.totalMinutes - 1);
    return Math.floor(minute / timeScale) * timeScale;
  }

  function select(fromMinute: number, toMinute: number) {
    CalendarActions.commitInlineTitle();
    $selectedCalendar = calendar;
    $selectedSlots = { start: $layout.timeAt(fromMinute), end: $layout.timeAt(toMinute), allDay: false, calendar };
  }

  function isInSelection(minute: number): boolean {
    return !!selection && selection.from <= minute && minute < selection.to;
  }

  let dragAnchor: number | null = null;
  function onPointerDown(pointerEvent: PointerEvent) {
    if (pointerEvent.button != 0) {
      return;
    }
    $selectedEvent = null;
    $eventPeek = null;
    dragAnchor = slotAt(pointerEvent.clientX);
    select(dragAnchor, dragAnchor + timeScale);
    trackEl.setPointerCapture(pointerEvent.pointerId);
  }

  function onPointerMove(pointerEvent: PointerEvent) {
    if (dragAnchor == null) {
      return;
    }
    let slot = slotAt(pointerEvent.clientX);
    if (slot >= dragAnchor) {
      select(dragAnchor, slot + timeScale);
    } else {
      select(slot, dragAnchor + timeScale);
    }
  }

  function onPointerUp() {
    dragAnchor = null;
  }

  function onDoubleClick(mouseEvent: MouseEvent) {
    let slot = slotAt(mouseEvent.clientX);
    if (!isInSelection(slot)) {
      select(slot, slot + timeScale);
    }
    let isRange = selection && selection.to - selection.from > timeScale;
    let start = $layout.timeAt(isRange ? selection.from : slot);
    let end = isRange ? $layout.timeAt(selection.to) : null;
    catchErrors(() => CalendarActions.newEvent(calendar, start, end));
  }

  function onContextMenu(mouseEvent: MouseEvent) {
    mouseEvent.preventDefault();
    let slot = slotAt(mouseEvent.clientX);
    if (!isInSelection(slot)) {
      select(slot, slot + timeScale);
    }
    $selectedEvent = null;
    $eventPeek = null;
    dispatch("slotmenu", { slots: $selectedSlots, mouseEvent });
  }
</script>

<style>
  .schedule-row {
    display: flex;
    width: calc(var(--name-width) + var(--track-width));
    box-sizing: border-box;
    border-block-end: 1px solid var(--lo-border);
  }
  .name {
    position: sticky;
    left: 0;
    z-index: 2;
    display: flex;
    align-items: flex-start;
    flex: none;
    width: var(--name-width);
    padding: 8px 10px;
    border: none;
    border-inline-end: 1px solid var(--lo-border);
    background-color: color-mix(in srgb, var(--calendar-color) 22%, var(--lo-pane-bg));
    color: var(--lo-fg);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .name:hover {
    background-color: color-mix(in srgb, var(--calendar-color) 30%, var(--lo-pane-bg));
  }
  .selected .name {
    font-weight: 600;
    box-shadow: inset 3px 0 0 var(--calendar-color);
  }
  .name-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .track {
    position: relative;
    z-index: 0;
    flex: none;
    width: var(--track-width);
    background-image:
      repeating-linear-gradient(to right, var(--lo-divider) 0 1px, transparent 1px var(--px-per-hour)),
      repeating-linear-gradient(to right, color-mix(in srgb, var(--lo-divider) 45%, transparent) 0 1px, transparent 1px var(--slot-width));
    touch-action: none;
  }
  /* .off-hours {
    position: absolute;
    top: 0;
    bottom: 0;
    background-color: var(--lo-calendar-off-work-bg);
    pointer-events: none;
  } */
  .day-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background-color: var(--lo-border);
    pointer-events: none;
  }
  .slot-selection {
    position: absolute;
    top: 0;
    bottom: 0;
    background-color: var(--lo-selected-bg);
    box-shadow: inset 0 0 0 1px var(--lo-accent);
    pointer-events: none;
  }
  .current-time {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 3;
    width: 2px;
    margin-inline-start: -1px;
    background-color: var(--lo-accent);
    pointer-events: none;
  }
</style>
