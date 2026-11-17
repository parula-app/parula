<hbox class="day">
  {startDay}
</hbox>
<hbox class="time">
  {#if !$event.allDay}
    {startTime}
  {/if}
</hbox>
<hbox class="event title"
  on:click
  on:click={onSelect}
  on:dblclick={onOpen}
  title={eventAsText}
  style="--color: {event.color ?? event.calendar?.color}"
  class:all-day={$event.allDay}
  class:selected={$selectedEvent == event}
  class:unanswered={$event.isUnanswered}
  class:cancelled={$event.isCancelled}
  >
  {$event.title}
</hbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { selectedEvent } from "../selected";
  import { openEvent } from "../open";
  import { getDurationString } from "../../../logic/util/date";
  import { getDateTimeLocale } from "../../../l10n/l10n";

  export let event: Event;

  $: startDay = event.startTime.toLocaleString(getDateTimeLocale(), { day: "2-digit", month: "short" });
  $: startTime = event.startTime.toLocaleString(getDateTimeLocale(), { hour: "2-digit", minute: "2-digit" });
  $: eventAsText = (event.allDay ? "" : `${startTime} – ${getDurationString(event.endTime.getTime() - event.startTime.getTime())}\n`) +
     event.title +
     (event.participants.isEmpty ? "" : "\n" + event.participants.getIndexRange(0, 4).map(person => person.name).join(", "));

  function onSelect() {
    $selectedEvent = event;
  }

  function onOpen() {
    openEvent(event);
  }
</script>

<style>
  .event {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;

    background-color: var(--color);
    --stripe-color: rgb(from var(--color) r g b / 50%);
  }
  @media (prefers-color-scheme: dark) {
    .event {
      background-image:
        linear-gradient(var(--color), var(--color)),
        linear-gradient(#000000AA, #000000AA);
      background-blend-mode: overlay;
      background-color: unset;
      --stripe-color: rgb(from var(--color) r g b / 25%);
    }
  }
  /* <copied from="../DayView/EventContent.svelte"> */
  .event.unanswered {
    background-image: repeating-linear-gradient(-45deg, transparent 0 4px, var(--stripe-color) 4px 8px);
    background-blend-mode: normal;
    background-color: transparent;
  }
  .event.cancelled {
    --cancelled-stripe-color: rgb(from var(--stripe-color) r g b / calc(alpha / 6));
    background-image:
      repeating-linear-gradient(45deg, transparent 0 6px, var(--cancelled-stripe-color) 6px 10px),
      repeating-linear-gradient(-45deg, transparent 0 6px, var(--cancelled-stripe-color) 6px 10px);
    background-blend-mode: normal;
    background-color: transparent;
    text-decoration: line-through;
  }
  .event.cancelled.unanswered {
    opacity: 10%;
  }
  /* </copied> */
  .event:hover {
    background-color: #20AF9E70;
  }
  .event.all-day {
    opacity: 85%;
  }
  .time {
    font-weight: 600;
  }
</style>
