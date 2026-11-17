<div class="event-block"
  class:selected={$selectedEvent == event}
  class:dragging={isDragging}
  class:continues-before={item.continuesBefore}
  class:continues-after={item.continuesAfter}
  style="top: {top}px; height: {height}px; --lane: {item.lane}; --lanes: {item.lanes}"
  title={tooltip}
  role="button"
  tabindex="0"
  aria-label={tooltip}
  on:click={onClick}
  on:dblclick={onDoubleClick}
  on:contextmenu={onContextMenu}
  on:keydown={onKeyDown}
  on:focus={select}
  on:pointerdown={onPointerDown}
  on:pointermove={onPointerMove}
  on:pointerup={onPointerUp}
  on:pointercancel={endDrag}
  bind:this={element}>
  <EventContent {event}>
    {#if $event.isEditable}
      <div class="resize-handle" data-mode="resize-start" class:hidden={item.continuesBefore} />
      <div class="resize-handle end" data-mode="resize-end" class:hidden={item.continuesAfter} />
    {/if}
    <div class="content">
      <div class="title-line">
        <span class="title">{look.title}</span>
        {#if canJoin}
          <a class="join" href={$event.onlineMeetingURL} target="_blank"
            on:click|stopPropagation on:dblclick|stopPropagation>
            {$t`Join`}
          </a>
        {/if}
        <EventIcons {event} />
      </div>
      {#if lines >= 2 && $event.location}
        <div class="line">{$event.location}</div>
      {/if}
      {#if lines >= 3 && look.organizerName}
        <div class="line">{look.organizerName}</div>
      {/if}
      {#if isPreview && notesLines > 0 && $event.hasDescription}
        <div class="notes" style:-webkit-line-clamp={notesLines}>{$event.descriptionText}</div>
      {/if}
    </div>
  </EventContent>
</div>

<ContextMenu bind:this={contextMenu}>
  <EventMenu {event} />
</ContextMenu>

<script lang="ts">
  import type { TimedEventItem } from "./DayColumn";
  import { EventLook } from "../DisplayEvent/EventLook";
  import { CalendarActions } from "../CalendarActions";
  import { openEvent } from "../../../frontend/Calendar/open";
  import { catchErrors } from "../../../frontend/Util/error";
  import { EventDrag, type EventDragMode } from "../EventDrag";
  import { now, CalendarCurrentView, eventPeek, selectedSlots } from "../selected";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import { k1MinuteMS } from "../../../logic/util/date";
  import { selectedEvent } from "../../../frontend/Calendar/selected";
  import EventContent from "../DisplayEvent/EventContent.svelte";
  import EventIcons from "../DisplayEvent/EventIcons.svelte";
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import EventMenu from "../DisplayEvent/EventMenu.svelte";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";

  export let item: TimedEventItem;
  export let pxPerMinute: number;
  export let snapMinutes: number;

  let contextMenu: ContextMenu;
  let element: HTMLElement;
  let drag: EventDrag | null = null;
  let wasDragged = false;
  let isDragging = false;
  const currentView = getLocalStorage<CalendarCurrentView>("lookout.calendar.currentView", CalendarCurrentView.Calendar);

  $: event = item.event;
  $: look = new EventLook($event);
  $: tooltip = look.tooltip(getDateTimeLocale());
  $: top = item.startMinute * pxPerMinute;
  $: height = Math.max((item.endMinute - item.startMinute) * pxPerMinute - 1, 6);
  $: lines = Math.floor((height - 4) / 15);
  $: isPreview = $currentView.value == CalendarCurrentView.Preview;
  $: notesLines = lines - 1 - ($event.location ? 1 : 0) - (look.organizerName ? 1 : 0);

  // <copied from="../DisplayEvent/EventIcons.svelte">
  const kJoinableBeforeStartMS = 15 * k1MinuteMS;
  $: isOnlineMeeting = $event.isOnline && !!$event.onlineMeetingURL;
  $: canJoin = isOnlineMeeting && $event.startTime.getTime() - kJoinableBeforeStartMS <= $now.getTime() && $now < $event.endTime;
  // </copied>

  function startDrag(pointerEvent: PointerEvent): EventDrag | null {
    if (!event.isEditable) {
      return null;
    }
    let handle = (pointerEvent.target as HTMLElement).closest(".resize-handle") as HTMLElement;
    let mode = (handle?.dataset.mode ?? "move") as EventDragMode;
    if (mode == "move" && (item.continuesBefore || item.continuesAfter)) {
      return null;
    }
    return new EventDrag(event, mode, pointerEvent, pxPerMinute, snapMinutes);
  }

  // <copied to="../MonthView/EventContainer.svelte, ../ScheduleView/ScheduleEvent.svelte">
  function select() {
    $selectedEvent = event;
    $selectedSlots = null;
  }

  function onClick(mouseEvent: MouseEvent) {
    mouseEvent.stopPropagation();
    if (wasDragged) {
      wasDragged = false;
      return;
    }
    select();
    $eventPeek = { event, anchor: element };
  }

  function onDoubleClick(mouseEvent: MouseEvent) {
    mouseEvent.stopPropagation();
    $eventPeek = null;
    catchErrors(() => openEvent(event, true));
  }

  function onContextMenu(mouseEvent: MouseEvent) {
    mouseEvent.preventDefault();
    mouseEvent.stopPropagation();
    select();
    $eventPeek = null;
    contextMenu.onContextMenu(mouseEvent);
  }

  function onKeyDown(keyEvent: KeyboardEvent) {
    if (keyEvent.key == "Enter") {
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      $eventPeek = null;
      catchErrors(() => openEvent(event, true));
    } else if (keyEvent.key == " ") {
      keyEvent.preventDefault();
      select();
      $eventPeek = { event, anchor: element };
    }
  }

  function onPointerDown(pointerEvent: PointerEvent) {
    pointerEvent.stopPropagation();
    CalendarActions.commitInlineTitle();
    wasDragged = false;
    if (pointerEvent.button != 0) {
      return;
    }
    drag = startDrag(pointerEvent);
    if (drag) {
      element.setPointerCapture(pointerEvent.pointerId);
    }
  }

  function onPointerMove(pointerEvent: PointerEvent) {
    if (!drag) {
      return;
    }
    drag.move(pointerEvent);
    if (drag.hasMoved) {
      isDragging = true;
      $eventPeek = null;
      drag.preview(element);
    }
  }

  function endDrag(): EventDrag | null {
    let finishedDrag = drag;
    drag = null;
    finishedDrag?.endPreview(element);
    isDragging = false;
    return finishedDrag;
  }

  function onPointerUp() {
    let finishedDrag = endDrag();
    if (!finishedDrag?.hasMoved) {
      return;
    }
    wasDragged = true;
    if (finishedDrag.changesTime) {
      let { start, end } = finishedDrag.newTimes();
      catchErrors(() => CalendarActions.changeTime(event, start, end));
    }
  }
  // </copied>
</script>

<style>
  .event-block {
    display: flex;
    position: absolute;
    left: calc((100% - var(--click-margin)) * var(--lane) / var(--lanes));
    width: calc((100% - var(--click-margin)) / var(--lanes) - 1px);
    line-height: 15px;
    z-index: 2;
    cursor: default;
  }
  .event-block.selected,
  .event-block:focus-visible {
    z-index: 3;
  }
  .event-block.continues-before > :global(.event) {
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }
  .event-block.continues-after > :global(.event) {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }
  .event-block:global(.dragging) {
    z-index: 5;
    opacity: 85%;
    cursor: grabbing;
  }
  .event-block:global(.dragging) > :global(.event) {
    box-shadow: var(--lo-shadow-popup);
  }
  .resize-handle {
    position: absolute;
    top: -1px;
    inset-inline: 0;
    height: 5px;
    cursor: ns-resize;
    z-index: 1;
  }
  .resize-handle.end {
    top: auto;
    bottom: -1px;
  }
  .resize-handle.hidden {
    display: none;
  }
  .content {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-width: 0;
    padding: 1px 4px 1px 5px;
  }
  .title-line {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  /* <copied to="../MonthView/EventContainer.svelte, ../ScheduleView/ScheduleEvent.svelte"> */
  .title {
    flex: 1 1 auto;
    min-width: 0;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* </copied> */
  .line {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .notes {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: var(--lo-fg-secondary);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .join {
    flex: none;
    padding: 0 6px;
    border: 1px solid var(--lo-border-strong);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-pane-bg);
    color: var(--lo-fg);
    font-weight: 600;
    text-decoration: none;
    line-height: 16px;
  }
  .join:hover {
    background-color: var(--lo-hover-bg);
  }
</style>
