<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="day-column"
  class:today={isToday}
  style="grid-column: {column}; --click-margin: 8px"
  data-day-index={dayIndex}
  data-group={group}
  on:pointerdown={onPointerDown}
  on:pointermove={onPointerMove}
  on:pointerup={onPointerUp}
  on:pointercancel={onPointerUp}
  on:dblclick={onDoubleClick}
  on:contextmenu={onContextMenu}
  bind:this={columnEl}>
  <div class="hidden-badge-anchor top">
    {#if hiddenAbove.length}
      <button class="hidden-badge" title={$t`${hiddenAbove.length} more items above`}
        on:pointerdown|stopPropagation on:dblclick|stopPropagation
        on:click|stopPropagation={() => dispatch("scrolltominute", Math.max(...hiddenAbove.map(item => item.startMinute)))}>
        +{hiddenAbove.length} <UpIcon size="12" />
      </button>
    {/if}
  </div>
  <div class="hidden-badge-anchor bottom">
    {#if hiddenBelow.length}
      <button class="hidden-badge" title={$t`${hiddenBelow.length} more items below`}
        on:pointerdown|stopPropagation on:dblclick|stopPropagation
        on:click|stopPropagation={() => dispatch("scrolltominute", Math.min(...hiddenBelow.map(item => item.startMinute)))}>
        +{hiddenBelow.length} <DownIcon size="12" />
      </button>
    {/if}
  </div>
  <!-- {#each offWork as offWorkRange}
    <div class="off-hours" style="top: {offWorkRange.from * pxPerMinute}px; height: {(offWorkRange.to - offWorkRange.from) * pxPerMinute}px" />
  {/each} -->
  {#if selectionHere}
    <div class="slot-selection"
      style="top: {selectionStart * pxPerMinute}px; height: {(selectionEnd - selectionStart) * pxPerMinute}px">
      <InlineEventTitle />
    </div>
  {/if}
  {#each $layout as item (item.event)}
    <EventContainer {item} {pxPerMinute} snapMinutes={Math.min(timeScale, 15)} />
  {/each}
  {#if isToday || showsPastTimeLine}
    <div class="current-time" class:past={!isToday}
      style="top: {($now.getHours() * 60 + $now.getMinutes()) * pxPerMinute}px" />
  {/if}
</div>
<NewEventCalendarMenu {calendar} bind:this={newEventMenu} />

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import type { Calendar } from "../../../logic/Calendar/Calendar";
  import { TimeColumnLayout } from "./DayColumn";
  import { CalendarActions } from "../CalendarActions";
  import { now, selectedSlots, eventPeek, type SlotSelection } from "../selected";
  import { selectedEvent } from "../../../frontend/Calendar/selected";
  import { catchErrors } from "../../../frontend/Util/error";
  import EventContainer from "./EventContainer.svelte";
  import InlineEventTitle from "../InlineEventTitle.svelte";
  import NewEventCalendarMenu from "../NewEventCalendarMenu.svelte";
  import UpIcon from "lucide-svelte/icons/chevron-up";
  import DownIcon from "lucide-svelte/icons/chevron-down";
  import { t } from "../../../l10n/l10n";
  import type { Collection } from "svelte-collections";
  import { derived } from "svelte/store";
  import { createEventDispatcher } from "svelte";

  export let day: Date;
  export let column: number;
  export let dayIndex: number;
  export let group: number;
  export let events: Collection<Event>;
  export let calendar: Calendar | null;
  // export let workingHours: WorkingHours | null = null;
  export let pxPerMinute: number;
  export let timeScale: number;
  export let isToday = false;
  export let showsPastTimeLine = false;
  export let visibleFromMinute = 0;
  export let visibleToMinute = TimeColumnLayout.kMinutesPerDay;

  const dispatch = createEventDispatcher<{ slotmenu: { slots: SlotSelection, mouseEvent: MouseEvent }, scrolltominute: number }>();

  let columnEl: HTMLDivElement;
  let newEventMenu: NewEventCalendarMenu;

  let dayStart: Date;
  let dayEnd: Date;
  let dayEvents: Collection<Event>;
  let dayEventsFrom: Collection<Event>;
  $: filterEvents(events);
  function filterEvents(source: Collection<Event>) {
    if (source != dayEventsFrom) {
      dayEventsFrom = source;
      dayEvents = source.filterObservable(isInDay);
    }
  }
  $: day, filterDay();
  function filterDay() {
    dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    dayEvents.replaceAll(events.contents.filter(isInDay));
  }

  function isInDay(event: Event): boolean {
    return event.startTime < dayEnd && event.endTime > dayStart;
  }
  // $: offWork = workingHours?.offWorkMinutes(day) ?? [];
  $: layout = derived([...$dayEvents.contents], eventsInDay =>
    new TimeColumnLayout(eventsInDay, day, timeScale).items);

  $: hiddenAbove = $layout.filter(item => item.endMinute <= visibleFromMinute);
  $: hiddenBelow = $layout.filter(item => item.startMinute >= visibleToMinute);

  $: selectionHere = !!$selectedSlots && !$selectedSlots.allDay &&
    $selectedSlots.calendar == calendar &&
    $selectedSlots.start.toDateString() == day.toDateString();
  $: selectionStart = selectionHere ? minuteOfDay($selectedSlots.start) : 0;
  $: selectionEnd = selectionHere ? minuteOfDay($selectedSlots.end, true) : 0;

  function minuteOfDay(time: Date, isEnd = false): number {
    if (isEnd && time.toDateString() != day.toDateString()) {
      return TimeColumnLayout.kMinutesPerDay;
    }
    return time.getHours() * 60 + time.getMinutes();
  }

  function slotAt(clientY: number): number {
    let rect = columnEl.getBoundingClientRect();
    let minute = Math.min(Math.max((clientY - rect.top) / pxPerMinute, 0), TimeColumnLayout.kMinutesPerDay - 1);
    return Math.floor(minute / timeScale) * timeScale;
  }

  function timeAt(minute: number): Date {
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minute);
  }

  function select(fromMinute: number, toMinute: number) {
    CalendarActions.commitInlineTitle();
    $selectedSlots = { start: timeAt(fromMinute), end: timeAt(toMinute), allDay: false, calendar };
  }

  let dragAnchor: number | null = null;
  function onPointerDown(pointerEvent: PointerEvent) {
    if (pointerEvent.button != 0) {
      return;
    }
    $selectedEvent = null;
    $eventPeek = null;
    dragAnchor = slotAt(pointerEvent.clientY);
    select(dragAnchor, dragAnchor + timeScale);
    columnEl.setPointerCapture(pointerEvent.pointerId);
  }

  function onPointerMove(pointerEvent: PointerEvent) {
    if (dragAnchor == null) {
      return;
    }
    let slot = slotAt(pointerEvent.clientY);
    if (slot >= dragAnchor) {
      select(dragAnchor, slot + timeScale);
    } else {
      select(slot, dragAnchor + timeScale);
    }
  }

  function onPointerUp() {
    dragAnchor = null;
  }

  function isInSelection(minute: number): boolean {
    return selectionHere && selectionStart <= minute && minute < selectionEnd;
  }

  function onDoubleClick(mouseEvent: MouseEvent) {
    let slot = slotAt(mouseEvent.clientY);
    if (!isInSelection(slot)) {
      select(slot, slot + timeScale);
    }
    let isRange = selectionEnd - selectionStart > timeScale;
    let start = timeAt(isRange ? selectionStart : slot);
    let end = isRange ? timeAt(selectionEnd) : null;
    catchErrors(() => newEventMenu.openMenu(mouseEvent, chosen => CalendarActions.newEvent(chosen, start, end)));
  }

  function onContextMenu(mouseEvent: MouseEvent) {
    mouseEvent.preventDefault();
    let slot = slotAt(mouseEvent.clientY);
    if (!isInSelection(slot)) {
      select(slot, slot + timeScale);
    }
    $selectedEvent = null;
    $eventPeek = null;
    dispatch("slotmenu", { slots: $selectedSlots, mouseEvent });
  }
</script>

<style>
  .day-column {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    grid-row: 1;
    border-inline-start: 1px solid var(--lo-divider);
    touch-action: none;
    outline: none;
  }
  .day-column.today::after {
    content: "";
    position: absolute;
    inset: 0;
    background-color: color-mix(in srgb, var(--lo-accent) 5%, transparent);
    pointer-events: none;
  }
  .hidden-badge-anchor {
    position: sticky;
    display: flex;
    justify-content: flex-end;
    padding-inline-end: 4px;
    height: 0;
    z-index: 5;
    pointer-events: none;
  }
  .hidden-badge-anchor.top {
    top: calc(var(--head-height) + 4px);
  }
  .hidden-badge-anchor.bottom {
    bottom: 22px;
  }
  .hidden-badge {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 18px;
    padding: 0 6px;
    border: 1px solid var(--lo-border-strong);
    border-radius: 9px;
    background-color: var(--lo-pane-bg);
    box-shadow: var(--lo-shadow-card);
    color: var(--lo-fg-secondary);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    pointer-events: auto;
  }
  .hidden-badge:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  /* .off-hours {
    position: absolute;
    inset-inline: 0;
    background-color: var(--lo-calendar-off-work-bg);
    pointer-events: none;
  } */
  .slot-selection {
    position: absolute;
    inset-inline: 0;
    background-color: color-mix(in srgb, var(--lo-accent) 22%, transparent);
    pointer-events: none;
  }
  .current-time {
    position: absolute;
    inset-inline: 0;
    height: 0;
    margin-block-start: -1px;
    border-top: 2px solid var(--lo-accent);
    z-index: 4;
    pointer-events: none;
  }
  .current-time:not(.past)::before {
    content: "";
    position: absolute;
    inset-inline-start: -5px;
    top: -6px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background-color: var(--lo-accent);
  }
  .current-time.past {
    border-top: 1px dashed color-mix(in srgb, var(--lo-accent) 70%, transparent);
    margin-block-start: 0;
  }
</style>
