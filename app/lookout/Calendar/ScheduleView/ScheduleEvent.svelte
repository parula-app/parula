<div class="schedule-event"
  class:selected={$selectedEvent == event}
  class:continues-before={item.continuesBefore}
  class:continues-after={item.continuesAfter}
  style="left: {item.startMinute * pxPerMinute}px; width: {Math.max((item.endMinute - item.startMinute) * pxPerMinute - 2, 6)}px; top: {top}px; height: {height}px"
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
  bind:this={element}>
  <EventContent {event}>
    <div class="content">
      <span class="title">{look.title}</span>
      {#if $event.location}
        <span class="location">{$event.location}</span>
      {/if}
      <EventIcons {event} />
    </div>
  </EventContent>
</div>

<ContextMenu bind:this={contextMenu}>
  <EventMenu {event} />
</ContextMenu>

<script lang="ts">
  import type { ScheduleItem } from "./ScheduleLayout";
  import { EventLook } from "../DisplayEvent/EventLook";
  import { CalendarActions } from "../CalendarActions";
  import { openEvent } from "../../../frontend/Calendar/open";
  import { catchErrors } from "../../../frontend/Util/error";
  import { eventPeek, selectedSlots } from "../selected";
  import { selectedEvent } from "../../../frontend/Calendar/selected";
  import EventContent from "../DisplayEvent/EventContent.svelte";
  import EventIcons from "../DisplayEvent/EventIcons.svelte";
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import EventMenu from "../DisplayEvent/EventMenu.svelte";
  import { getDateTimeLocale } from "../../../l10n/l10n";

  export let item: ScheduleItem;
  export let pxPerMinute: number;
  export let top: number;
  export let height: number;

  let contextMenu: ContextMenu;
  let element: HTMLElement;

  $: event = item.event;
  $: look = new EventLook($event);
  $: tooltip = look.tooltip(getDateTimeLocale());

  // <copied from="../DayView/EventContainer.svelte">, without dragging
  function select() {
    $selectedEvent = event;
    $selectedSlots = null;
  }

  function onClick(mouseEvent: MouseEvent) {
    mouseEvent.stopPropagation();
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
  }
  // </copied>
</script>

<style>
  .schedule-event {
    display: flex;
    position: absolute;
    z-index: 2;
    align-items: stretch;
    cursor: default;
  }
  .schedule-event > :global(.event) {
    /* "hidden" would make the event the scroll container of the sticky title */
    overflow: clip;
  }
  .schedule-event.selected,
  .schedule-event:focus-visible {
    z-index: 4;
  }
  .schedule-event.continues-before > :global(.event) {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .schedule-event.continues-after > :global(.event) {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .content {
    position: sticky;
    left: var(--name-width);
    display: flex;
    align-items: center;
    flex: 0 1 auto;
    gap: 6px;
    min-width: 0;
    padding: 0 4px 0 5px;
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
  .content .title {
    flex: 0 1 auto;
  }
  .location {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--lo-fg-secondary);
  }
</style>
