<Clickable onClick={onSelect} onDoubleClick={onOpen}>
  <hbox class="event font-small" flex
    class:unanswered={$event.isUnanswered}
    class:cancelled={$event.isCancelled}
    title={eventAsText}>
    {#if showTime}
      <!--{event.startTime.toLocaleTimeString(getDateTimeLocale(), { hour: "numeric", minute: "numeric" })}-->
      <hbox class="time">
        <span class="with-ampm">{startTime}</span>
        <span class="without-ampm">{getTimeStringWithoutAMPM($event.startTime)}</span>
      </hbox>
    {/if}
    <hbox class="title">{$event.title}</hbox>
  </hbox>
</Clickable>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { openEvent } from "../open";
  import { selectedEvent } from "../selected";
  import Clickable from "../../Shared/Clickable.svelte";
  import { getDurationString, getTimeStringWithoutAMPM } from "../../../logic/util/date";
  import { getDateTimeLocale } from "../../../l10n/l10n";

  export let event: Event;
  export let showTime = true;

  $: startTime = $event.startTime.toLocaleString(getDateTimeLocale(), { hour: "numeric", minute: "2-digit" });
  $: eventAsText = ($event.allDay ? "" : `${startTime} – ${getDurationString(event.endTime.getTime() - event.startTime.getTime())}\n`) +
     event.title +
     (event.participants.isEmpty ? "" : "\n" + event.participants.getIndexRange(0, 4).map(person => person.name).join(", "));

  function onSelect(ev: MouseEvent) {
    $selectedEvent = event;
  }

  function onOpen(ev: MouseEvent) {
    openEvent(event, true);
  }
</script>

<style>
  .event {
    min-width: 0;
    overflow: hidden;
    background-color: var(--color);
    color: lch(from var(--color) calc((49.44 - l) * infinity) 0 0);
    margin-block-end: 2px;
    margin-inline-end: 3px;
    border-radius: 3px;
    container-type: size;
    --stripe-color: rgb(from var(--color) r g b / 50%);
  }
  @media (prefers-color-scheme: dark) {
    .event {
      background-image:
        linear-gradient(var(--color), var(--color)),
        linear-gradient(#000000BB, #000000BB);
      background-blend-mode: overlay;
      background-color: unset;
      color: unset;
      --stripe-color: rgb(from var(--color) r g b / 25%);
    }
  }
  /* <copied to="../MonthView/EventContent.svelte, AllDayEvent.svelte, ../ListView/ListViewLine.svelte"> */
  .event.unanswered {
    background-image: repeating-linear-gradient(-45deg, transparent 0 4px, var(--stripe-color) 4px 8px);
    background-blend-mode: normal;
    background-color: transparent;
    color: unset;
  }
  .event.cancelled {
    --cancelled-stripe-color: rgb(from var(--stripe-color) r g b / calc(alpha / 6));
    background-image:
      repeating-linear-gradient(45deg, transparent 0 6px, var(--cancelled-stripe-color) 6px 10px),
      repeating-linear-gradient(-45deg, transparent 0 6px, var(--cancelled-stripe-color) 6px 10px);
    background-blend-mode: normal;
    background-color: transparent;
    color: unset;
  }
  .event.cancelled.unanswered {
    opacity: 10%;
  }
  .cancelled .time,
  .cancelled .title {
    text-decoration: line-through;
  }
  /* </copied> */
  .event:hover {
    background-color: #20AF9E70;
  }
  .time {
    font-weight: 600;
  }
  .time,
  .title {
    margin-inline-start: 6px;
    margin-block-start: 5px;
  }
  .title {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .without-ampm {
    display: none;
  }
  @container (width < 8.5ch) {
    .with-ampm {
      display: none;
    }
    .without-ampm {
      display: inline;
    }
  }
  @container (height < 1.9em) {
    .time,
    .title {
      margin-block: auto;
      white-space: nowrap;
      font-size: clamp(8px, (100cqh - 2px) / 1.2, 1em);
      line-height: 1.2;
    }
  }
  @container (width < 5.3ch) {
    .time,
    .title {
      margin-inline-start: 2px;
      font-size: clamp(8px, (100cqh - 2px) / 1.2, 10px);
      line-height: 1.2;
    }
  }
  @container (width < 3ch) {
    .time {
      display: none;
    }
    .title {
      writing-mode: sideways-lr;
      margin-block: auto;
      line-height: 1;
      text-align: end;
      padding-inline-start: 2px;
      padding-inline-end: 8px;
    }
  }
</style>
