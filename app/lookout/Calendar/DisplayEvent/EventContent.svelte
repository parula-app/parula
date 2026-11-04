<div class="event status-{status}"
  class:past={$event.endTime <= $now}
  class:selected={$selectedEvent == event}
  style="--event-color: {$event.color ?? $calendar?.color ?? "var(--lo-accent)"}">
  <div class="bar" />
  <slot />
</div>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { EventLook } from "./EventLook";
  import { now } from "../selected";
  import { selectedEvent } from "../../../frontend/Calendar/selected";

  export let event: Event;

  $: calendar = $event.calendar;
  $: status = new EventLook($event).status;
</script>

<style>
  .event {
    flex: 1 1 auto;
    position: relative;
  }
  /* <copied to="EventInDayView.svelte"> */
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
  .event.selected {
    --lo-event-fill: 40%;
    outline: 2px solid var(--event-color);
    outline-offset: -1px;
  }
  :global(:focus-visible) > .event {
    outline: 2px solid var(--lo-focus-ring);
    outline-offset: 1px;
  }
  .event.past {
    --lo-event-fill: 11%;
    color: var(--lo-fg-secondary);
  }
  .event.past:hover {
    --lo-event-fill: 18%;
  }
  .event.past.selected {
    --lo-event-fill: 26%;
  }
  .past > .bar {
    opacity: 55%;
  }
</style>
