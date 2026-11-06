<vbox class="participants-day-view" flex>
  <hbox class="day-header">
    <Button classes="previous-button" label={$t`Previous day`} icon={ChevronLeftIcon} onClick={() => stepDay(-1)} iconSize="16px" plain iconOnly />
    <hbox class="day">{getFormattedDateString(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</hbox>
    <Button classes="next-button" label={$t`Next day`} icon={ChevronRightIcon} onClick={() => stepDay(1)} iconSize="16px" plain iconOnly />
  </hbox>
  <AvailabilityLoader {event} from={day} to={dayEnd} bind:freeBusy>
    {#if freeBusy.isSupported}
      <vbox class="grid-container" flex bind:offsetHeight={visibleHeight}>
        <Scroll bind:this={scrollE}>
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <grid flex class="participants-grid"
            style="--columns: {$participants.length}; --rows: {24 * kRowsPerHour}; --row-height: {pxPerHour / kRowsPerHour}px; --selected-calendar-color: {$event.calendar?.color ?? "black"}"
            on:click={onClick}
            >
            <grid class="headers">
              <hbox class="top-left header" />
              {#each $participants.each as participant, i}
                {@const status = freeBusy.status(participant, $event.startTime, $event.endTime)}
                <vbox class="participant-header header" style="grid-column: {i + 2}" title={participant.emailAddress}>
                  <hbox class="name">{participant.name || participant.emailAddress}</hbox>
                  <hbox class="status status-{status}">{statusLabel(status)}</hbox>
                </vbox>
              {/each}
            </grid>
            {#each startTimes as time, i}
              <hbox class="time-label" style="grid-row: {i * kRowsPerHour + 3} / span {kRowsPerHour}">
                <TimeLabel {time} />
              </hbox>
            {/each}
            {#each $participants.each as participant, i}
              <DayColumn {day} column={i + 2} events={noEvents} overlayEvents={appointmentEvents.get(participant) ?? noEvents}>
                <svelte:fragment slot="event-overlay" let:event>
                  {@const appointment = event as FreeBusyEvent}
                  <vbox class="appointment font-small status-{appointment.busyStatus}" title={appointmentDetails(appointment)}>
                    <hbox class="title">{appointment.title || appointment.statusLabel}</hbox>
                    {#if appointment.location}
                      <hbox class="location">{appointment.location}</hbox>
                    {/if}
                  </vbox>
                </svelte:fragment>
              </DayColumn>
              {#if !freeBusy.rowFor(participant)?.appointments}
                <vbox class="no-info" style="grid-column: {i + 2}">
                  <hbox class="no-info-label">{$t`No information *=> Availability: unknown`}</hbox>
                </vbox>
              {/if}
            {/each}
            {#if meeting}
              <hbox class="meeting" style="grid-row: {meeting.startRow + 3} / {meeting.endRow + 3}" />
            {/if}
          </grid>
        </Scroll>
      </vbox>
    {:else}
      <hbox class="no-info-message">{$t`This calendar doesn't provide the availability of other people`}</hbox>
    {/if}
  </AvailabilityLoader>
</vbox>

<script lang="ts">
  import type { Event } from "../../../../logic/Calendar/Event";
  import type { Participant } from "../../../../logic/Calendar/Participant";
  import type { AvailabilityStatus, FreeBusy } from "../../../../logic/Calendar/FreeBusy";
  import type { FreeBusyEvent } from "../../../../logic/Calendar/FreeBusyEvent";
  import AvailabilityLoader from "./AvailabilityLoader.svelte";
  import DayColumn from "../../DayView/DayColumn.svelte";
  import TimeLabel from "../../DayView/TimeLabel.svelte";
  import { kRowsPerHour, layoutTimeColumn } from "../../DayView/DayColumn";
  import Scroll from "../../../Shared/Scroll.svelte";
  import Button from "../../../Shared/Button.svelte";
  import ChevronLeftIcon from "lucide-svelte/icons/chevron-left";
  import ChevronRightIcon from "lucide-svelte/icons/chevron-right";
  import { getDayStart, getFormattedDateString, getTimeString } from "../../../../logic/util/date";
  import { ArrayColl } from "svelte-collections";
  import { tick } from "svelte";
  import { t } from "../../../../l10n/l10n";

  /** The meeting. Clicking a time moves it there.
   * in/out */
  export let event: Event;
  /** How many hours fit into the visible height */
  export let showHours = 5;

  /** The meeting's day, or the day that the user went to */
  $: meetingDayStartTime = getDayStart($event.startTime).getTime();
  $: day = new Date(meetingDayStartTime);
  $: dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  $: participants = event.participants;
  $: meeting = layoutTimeColumn([$event], day)[0];

  function stepDay(days: number) {
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + days);
  }

  let startTimes: Date[] = [];
  $: day, setStartTimes();
  function setStartTimes() {
    startTimes = [];
    for (let hour = 0; hour < 24; hour++) {
      let startTime = new Date(day);
      startTime.setHours(hour);
      startTimes.push(startTime);
    }
  }

  /** The appointments of the participants are in no calendar,
   * so they are shown as overlay and not as events, which the user could open. */
  let noEvents = new ArrayColl<Event>();
  let appointmentEvents = new Map<Participant, ArrayColl<Event>>();
  let freeBusy: FreeBusy | null = null;
  $: freeBusy, setAppointments();
  function setAppointments() {
    appointmentEvents = new Map((freeBusy?.rows ?? []).map(row =>
      [row.participant, new ArrayColl<Event>(row.appointments ?? [])]));
  }

  function statusLabel(status: AvailabilityStatus): string {
    switch (status) {
    case "free":
      return $t`Available`;
    case "busy":
      return $t`Busy`;
    default:
      return $t`No information *=> Availability: unknown`;
    }
  }

  function appointmentDetails(appointment: FreeBusyEvent): string {
    return [
      `${getTimeString(appointment.startTime)} – ${getTimeString(appointment.endTime)}`,
      appointment.title || appointment.statusLabel,
      appointment.location,
    ].filter(line => line).join("\n");
  }

  function onClick(mouseEvent: MouseEvent) {
    let column = (mouseEvent.target as HTMLElement).closest(".day-column");
    if (!column) {
      return;
    }
    const kSnapMinutes = 30;
    let rect = column.getBoundingClientRect();
    let minutes = (mouseEvent.clientY - rect.top) / rect.height * 24 * 60;
    let start = new Date(day);
    start.setMinutes(Math.floor(minutes / kSnapMinutes) * kSnapMinutes);
    moveMeetingTo(start);
  }

  // <copied from="../TimeBox.svelte" onStartTimeChanged()>
  function moveMeetingTo(start: Date) {
    let duration = event.duration;
    event.startTime = new Date(start);
    event.duration = duration;
  }
  // </copied>

  // <copied from="../../DayView/DayViewGrid.svelte"> Pages by day, so scrolls on each new day, too. Focuses the meeting, also when it moves.
  let scrollE: Scroll;
  let visibleHeight = 0;
  $: pxPerHour = visibleHeight / showHours;
  $: focusHour = Math.max($event.startTime.getHours() - 1, 0);
  $: day, focusHour, pxPerHour, scrollToFocusHour();
  async function scrollToFocusHour() {
    await tick(); // The new grid height reaches the DOM only after the update
    scrollE?.scrollTo((focusHour - 0.5) * pxPerHour);
  }
  // </copied>
</script>

<style>
  .participants-day-view {
    min-height: 0;
  }
  .day-header {
    justify-content: center;
    align-items: center;
  }
  .day {
    margin-inline: 8px;
  }
  .grid-container {
    min-height: 0;
  }
  .participants-grid {
    display: grid;
    grid-template-rows: max-content max-content repeat(var(--rows), var(--row-height));
    grid-template-columns: max-content repeat(var(--columns), minmax(7em, 1fr));
  }
  /* <copied from="../../DayView/DayViewGrid.svelte"> The columns are participants, not days */
  .headers {
    grid-column: 1 / -1;
    grid-row: 1 / span 2;
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: subgrid;
    position: sticky;
    top: 0;
    z-index: 2;
  }
  .header {
    background-color: var(--bg);
  }
  .top-left {
    grid-column: 1;
    grid-row: 1 / span 2;
    height: calc(100% - 10px);
  }
  .participant-header {
    grid-row: 1;
    border-top: 1px dotted var(--border);
    border-left: 1px dotted var(--border);
    min-width: 0px; /* Long titles must not widen the column */
  }
  .time-label {
    grid-column: 1;
  }
  /* </copied> */
  .participant-header {
    padding: 4px 8px;
  }
  .name {
    display: block;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-weight: 600;
  }
  .status {
    font-size: 80%;
    opacity: 70%;
  }
  .status.status-free {
    color: green;
    opacity: 100%;
  }
  .status.status-busy {
    color: red;
    opacity: 100%;
  }
  .appointment {
    flex: 1 1 0;
    min-width: 0;
    height: calc(100% - 1px);
    margin-inline-end: 1.5px;
    padding: 1px 6px;
    box-sizing: border-box;
    overflow: hidden;
    --appointment-border: color-mix(in srgb, var(--appointment-color) 65%, black);
    border: 1px solid color-mix(in srgb, var(--appointment-border) 50%, transparent);
    border-radius: calc(var(--border-radius) / 2);
    background-color: var(--appointment-color);
    color: black;
    --stripe-color: color-mix(in srgb, var(--appointment-color) 70%, transparent);
  }
  .appointment.status-busy {
    --appointment-color: #9DB7EC;
  }
  .appointment.status-tentative {
    --appointment-color: #9DB7EC;
    background-color: color-mix(in srgb, var(--appointment-color) 40%, var(--bg));
    background-image: repeating-linear-gradient(-45deg, transparent 0 6px, var(--stripe-color) 6px 8px);
  }
  .appointment.status-out-of-office {
    --appointment-color: #C7A6E6;
  }
  .appointment.status-elsewhere {
    --appointment-color: #A9DCC4;
    border-style: dashed;
  }
  @media (prefers-color-scheme: dark) {
    .appointment {
      --appointment-border: color-mix(in srgb, var(--appointment-color) 60%, var(--bg));
      background-color: color-mix(in srgb, var(--appointment-color) 35%, var(--bg));
      color: var(--fg);
      --stripe-color: color-mix(in srgb, var(--appointment-color) 25%, transparent);
    }
  }
  .title,
  .location {
    display: block;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .location {
    opacity: 70%;
  }
  .no-info {
    grid-row: 3 / -1;
    z-index: 1;
    pointer-events: none;
    align-items: center;
    background-image: repeating-linear-gradient(135deg,
      color-mix(in srgb, var(--fg) 25%, transparent) 0 1px,
      transparent 1px 6px);
  }
  .no-info-label {
    position: sticky;
    top: 4em;
    margin-block-start: 4em;
    padding: 2px 6px;
    border-radius: var(--border-radius);
    background-color: var(--bg);
    font-size: 80%;
    opacity: 80%;
  }
  .meeting {
    grid-column: 2 / -1;
    z-index: 1;
    pointer-events: none;
    border-block: 2px solid var(--selected-calendar-color);
    background-color: color-mix(in srgb, var(--selected-calendar-color) 15%, transparent);
  }
  .no-info-message {
    margin: 12px;
    opacity: 70%;
  }
</style>
