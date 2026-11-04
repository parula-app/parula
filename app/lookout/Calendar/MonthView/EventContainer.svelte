<div class="event-bar {variant}"
  class:dragging={isDragging}
  class:continues-before={continuesBefore}
  class:continues-after={continuesAfter}
  class:timed={showStartTime}
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
    <div class="content">
      {#if continuesBefore}
        <ContinuesBeforeIcon size="12" class="continues" />
      {/if}
      {#if showStartTime}
        <span class="time">{$event.startTime.toLocaleTimeString(getDateTimeLocale(), { hour: "numeric", minute: "2-digit" })}</span>
      {/if}
      <span class="title">{look.title}</span>
      <EventIcons {event} />
      {#if continuesAfter}
        <ContinuesAfterIcon size="12" class="continues" />
      {/if}
    </div>
  </EventContent>
</div>

<ContextMenu bind:this={contextMenu}>
  <EventMenu {event} />
</ContextMenu>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { EventLook } from "../DisplayEvent/EventLook";
  import { CalendarActions } from "../CalendarActions";
  import { openEvent } from "../../../frontend/Calendar/open";
  import { catchErrors } from "../../../frontend/Util/error";
  import { EventDrag } from "../EventDrag";
  import { eventPeek, selectedSlots } from "../selected";
  import { selectedEvent } from "../../../frontend/Calendar/selected";
  import EventContent from "../DisplayEvent/EventContent.svelte";
  import EventIcons from "../DisplayEvent/EventIcons.svelte";
  import ContinuesBeforeIcon from "lucide-svelte/icons/chevron-left";
  import ContinuesAfterIcon from "lucide-svelte/icons/chevron-right";
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import EventMenu from "../DisplayEvent/EventMenu.svelte";
  import { getDateTimeLocale } from "../../../l10n/l10n";

  export let event: Event;
  export let variant: "all-day" | "month";
  export let continuesBefore = false;
  export let continuesAfter = false;

  let contextMenu: ContextMenu;
  let element: HTMLElement;
  let drag: EventDrag | null = null;
  let wasDragged = false;
  let isDragging = false;

  $: look = new EventLook($event);
  $: tooltip = look.tooltip(getDateTimeLocale());
  $: showStartTime = !$event.allDay && !continuesBefore;

  function startDrag(pointerEvent: PointerEvent): EventDrag | null {
    return event.isEditable ? new EventDrag(event, "move-days", pointerEvent) : null;
  }

  // <copied from="../DayView/EventContainer.svelte">
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
  .event-bar {
    display: flex;
    height: 20px;
    line-height: 18px;
    cursor: default;
  }
  .event-bar.continues-before > :global(.event) {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .event-bar.continues-after > :global(.event) {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .continues-before > :global(.event > .bar) {
    display: none;
  }
  .content {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 4px;
    flex: 1 1 0;
    min-width: 0;
    padding: 0 4px 0 5px;
  }
  .all-day:not(.timed) .content {
    justify-content: center;
  }
  /* <copied from="../DayView/EventContainer.svelte"> */
  .title {
    flex: 1 1 auto;
    min-width: 0;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* </copied> */
  .all-day:not(.timed) .content .title {
    flex: 0 1 auto;
  }
  .time {
    flex: none;
    color: var(--lo-fg-secondary);
  }
  .content :global(.continues) {
    flex: none;
    color: var(--lo-fg-secondary);
  }
</style>
