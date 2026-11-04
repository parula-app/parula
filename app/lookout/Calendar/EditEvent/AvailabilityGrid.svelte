<vbox flex class="free-busy-grid" style="--hour-width: {hourWidth}px; --row-height: {kRowHeight}px">
  <hbox class="day-bar">
    <button class="nav" title={$t`Previous day`} aria-label={$t`Previous day`} on:click={() => stepDay(-1)}>
      <PreviousIcon size={16} />
    </button>
    <button class="nav" title={$t`Next day`} aria-label={$t`Next day`} on:click={() => stepDay(1)}>
      <NextIcon size={16} />
    </button>
    <span class="day-label">{dayLabel}</span>
    <hbox flex />
    {#if loading}
      <span class="status lo-secondary">{$t`Checking availability…`}</span>
    {:else if errorText}
      <span class="status error">{errorText}</span>
    {:else if freeBusy && !freeBusy.isSupported}
      <span class="status lo-secondary">{$t`This calendar doesn't provide the availability of other people`}</span>
    {/if}
  </hbox>
  <hbox flex class="grid-scroll">
    <vbox class="names">
      <hbox class="hours-spacer" />
      <hbox class="row all-attendees">{$t`All Attendees`}</hbox>
      {#each $shownParticipants as participant (participant)}
        <hbox class="row person">
          <ParticipantConfirmIcon {participant} />
          <vbox flex class="person-text">
            <span class="name" title={participant.emailAddress}>{participant.name || participant.emailAddress}</span>
            {#if freeBusy && !loading}
              <span class="availability status-{statusOf(freeBusy, participant, $event)}">{statusLabel(statusOf(freeBusy, participant, $event))}</span>
            {/if}
          </vbox>
          {#if !readOnly && participant.response != InvitationResponse.Organizer}
            <button class="remove" title={$t`Remove`} aria-label={$t`Remove`}
              on:click={() => event.participants.remove(participant)}>
              <RemoveIcon size={14} />
            </button>
          {/if}
        </hbox>
      {/each}
      {#if !readOnly}
        <hbox class="row add">
          <MailAutocomplete addresses={newAttendees} label={$t`Add required attendee`}
            placeholder={$t`Add required attendee`} askForName on:add={event => onAddAttendee(event.detail)} />
        </hbox>
      {/if}
    </vbox>
    <div class="timeline-scroll" bind:this={scrollEl}>
      <div class="timeline" style:width="{timeline.width}px">
        <div class="days">
          {#each timeline.days() as shownDay (shownDay.getTime())}
            <span class="day-name" style:left="{timeline.x(shownDay)}px" style:width="{24 * hourWidth}px">
              <span class="day-text">{dayName(shownDay)}</span>
            </span>
          {/each}
        </div>
        <div class="hours">
          {#each hours as hour}
            <span class="hour" style:left="{timeline.x(hour)}px">{hourLabel(hour)}</span>
          {/each}
        </div>
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
        <div class="rows" bind:this={rowsEl} on:click={onClickRows}>
          <div class="row all-attendees" class:no-info={freeBusy && !freeBusy.hasInformation}>
            {#each allBusy as busy}
              <div class="busy" style:left="{busy.left}px" style:width="{busy.width}px" />
            {/each}
          </div>
          {#each $participants.each as participant (participant)}
            <div class="row" class:no-info={freeBusy && !busyOf(freeBusy, participant)}>
              {#each appointmentSpans(freeBusy, participant, timeline) as appointment}
                <div class="busy status-{appointment.status}" style:left="{appointment.left}px" style:width="{appointment.width}px"
                  title={appointment.details}>{appointment.title}</div>
              {/each}
            </div>
          {/each}
          {#if !readOnly}
            <div class="row add" />
          {/if}
          {#if meeting}
            <div class="meeting" style:left="{meeting.left}px" style:width="{meeting.width}px">
              {#if !readOnly && !$event.allDay}
                <div class="edge start" title={$t`Drag to change the start time`}
                  on:pointerdown={pointerEvent => onEdgeDown(pointerEvent, "start")} />
                <div class="edge end" title={$t`Drag to change the end time`}
                  on:pointerdown={pointerEvent => onEdgeDown(pointerEvent, "end")} />
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </hbox>
  <hbox class="legend">
    <span class="legend-item"><span class="swatch swatch-busy" /> {$t`Busy`}</span>
    <span class="legend-item"><span class="swatch swatch-busy status-tentative" /> {freeBusyStatusLabels[FreeBusyStatus.Tentative]}</span>
    <span class="legend-item"><span class="swatch swatch-busy status-out-of-office" /> {freeBusyStatusLabels[FreeBusyStatus.OutOfOffice]}</span>
    <span class="legend-item"><span class="swatch swatch-busy status-elsewhere" /> {freeBusyStatusLabels[FreeBusyStatus.WorkingElsewhere]}</span>
    <span class="legend-item"><span class="swatch swatch-no-info" /> {$t`No information *=> Availability: unknown`}</span>
    <hbox flex />
    <button class="zoom" bind:this={zoomButton} class:open={isZoomMenuOpen}
      title={$t`Zoom *=> Change the zoom level of the availability grid`} aria-haspopup="menu" on:click|stopPropagation={() => isZoomMenuOpen = !isZoomMenuOpen}>
      <ZoomIcon size={14} />
      {zoomLabel(zoom)}
      <ChevronIcon size={12} />
    </button>
    <Menu bind:isMenuOpen={isZoomMenuOpen} anchor={zoomButton} placement="top-end">
      {#each kZoomLevels as level}
        <MenuItem label={zoomLabel(level)} checked={level == zoom} onClick={() => setZoom(level)} />
      {/each}
    </Menu>
  </hbox>
</vbox>

<script lang="ts" context="module">
  import type { Event } from "../../../logic/Calendar/Event";
  import { writable } from "svelte/store";

  export const refreshAvailabilityOf = writable<Event | null>(null);
</script>

<script lang="ts">
  import type { Participant } from "../../../logic/Calendar/Participant";
  import { InvitationResponse } from "../../../logic/Calendar/Invitation/InvitationStatus";
  import { FreeBusy, type AvailabilityStatus } from "../../../logic/Calendar/FreeBusy";
  import { appGlobal } from "../../../logic/app";
  import { FreeBusyStatus, freeBusyStatusLabels } from "../../../logic/Calendar/FreeBusyEvent";
  import { Timeline } from "./AvailabilityGrid";
  import { EventEditFlow } from "./EventEditFlow";
  import type { EventTimeEditor } from "./EventTimeEditor";
  import ParticipantConfirmIcon from "./ParticipantConfirmIcon.svelte";
  import Menu from "../../Shared/Menu/Menu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MailAutocomplete from "../../Mail/Composer/MailAutocomplete.svelte";
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import { ArrayColl } from "svelte-collections";
  import PreviousIcon from "lucide-svelte/icons/chevron-left";
  import NextIcon from "lucide-svelte/icons/chevron-right";
  import RemoveIcon from "lucide-svelte/icons/x";
  import ZoomIcon from "lucide-svelte/icons/zoom-in";
  import ChevronIcon from "lucide-svelte/icons/chevron-up";
  import { onMount, tick } from "svelte";
  import { derived } from "svelte/store";
  import { getTimeString, type TimeInterval } from "../../../logic/util/date";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";

  export let event: Event;
  export let timeEditor: EventTimeEditor;
  export let readOnly = false;

  const kHourWidth = 88;
  const kRowHeight = 44;
  const kZoomLevels = [0.5, 1, 2];
  const kDayCount = 7;

  let zoom = 1;
  let zoomButton: HTMLButtonElement;
  let isZoomMenuOpen = false;
  $: hourWidth = kHourWidth * zoom;

  let day = startOfDay(event.startTime);
  let freeBusy: FreeBusy | null = null;
  let loading = false;
  let errorText: string | null = null;
  let scrollEl: HTMLElement;
  let rowsEl: HTMLElement;
  let loadCount = 0;
  let lastStartTime = event.startTime.getTime();

  $: participants = event.participants;
  $: shownParticipants = derived($participants.contents, () => participants.contents);
  let newAttendees = new ArrayColl<PersonUID>();

  function onAddAttendee(person: PersonUID) {
    newAttendees.remove(person);
    if (!event.participants.some(participant => participant.emailAddress?.toLowerCase() == person.emailAddress?.toLowerCase())) {
      EventEditFlow.addParticipant(event, person);
    }
  }
  $: timeline = new Timeline(day, hourWidth, kDayCount);
  $: hours = timeline.hours();
  $: dayLabel = new Intl.DateTimeFormat(getDateTimeLocale(), { year: "numeric", month: "long", day: "numeric" })
    .formatRange(timeline.day, timeline.days()[kDayCount - 1]);
  $: meeting = $event && timeline.span(event.startTime, event.endTime);
  $: allBusy = freeBusy ? spans(freeBusy.allAttendeesBusy, timeline) : [];
  $: day, $participants, load();
  $: followEvent($event.startTime);

  onMount(() => {
    scrollToMeeting();
  });

  function startOfDay(time: Date): Date {
    let start = new Date(time);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  function followEvent(startTime: Date) {
    if (startTime.getTime() == lastStartTime) {
      return;
    }
    lastStartTime = startTime.getTime();
    if (startTime < day || startTime >= new Timeline(day, kHourWidth, kDayCount).dayEnd) {
      day = startOfDay(startTime);
    }
    scrollToMeeting();
  }

  async function load() {
    let count = ++loadCount;
    loading = true;
    errorText = null;
    try {
      let shownDays = new Timeline(day, kHourWidth, kDayCount);
      let result = await FreeBusy.load(event.calendar, event.participants.contents, shownDays.day, shownDays.dayEnd);
      if (count == loadCount) {
        freeBusy = result.withMyEvents(event, appGlobal.calendarEvents, shownDays.day, shownDays.dayEnd);
      }
    } catch (ex) {
      if (count == loadCount) {
        freeBusy = null;
        errorText = ex?.message ?? String(ex);
      }
    } finally {
      if (count == loadCount) {
        loading = false;
      }
    }
  }

  $: if ($refreshAvailabilityOf == event) {
    $refreshAvailabilityOf = null;
    load();
  }

  function stepDay(days: number) {
    let newDay = new Date(day);
    newDay.setDate(newDay.getDate() + days);
    day = newDay;
  }

  async function scrollToMeeting() {
    await tick();
    if (!scrollEl) {
      return;
    }
    let target = meeting && !event.allDay ? meeting.left - hourWidth : timeline.x(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 7));
    scrollEl.scrollLeft = Math.max(0, target);
  }

  function busyOf(freeBusy: FreeBusy | null, participant: Participant): TimeInterval[] | null {
    return freeBusy?.rowFor(participant)?.busy ?? null;
  }

  function spans(intervals: TimeInterval[] | null, timeline: Timeline): { left: number, width: number }[] {
    return (intervals ?? [])
      .map(interval => timeline.span(interval.startTime, interval.endTime))
      .filter(span => span && span.width > 0);
  }

  function appointmentSpans(freeBusy: FreeBusy | null, participant: Participant, timeline: Timeline) {
    return (freeBusy?.rowFor(participant)?.appointments ?? [])
      .map(appointment => ({ appointment, span: timeline.span(appointment.startTime, appointment.endTime) }))
      .filter(({ span }) => span && span.width > 0)
      .map(({ appointment, span }) => ({
        left: span.left,
        width: span.width,
        status: appointment.busyStatus,
        title: appointment.title ?? "",
        details: [
          `${getTimeString(appointment.startTime)} – ${getTimeString(appointment.endTime)}`,
          appointment.title || appointment.statusLabel,
          appointment.location,
        ].filter(line => line).join("\n"),
      }));
  }

  function statusOf(freeBusy: FreeBusy, participant: Participant, event: Event): AvailabilityStatus {
    return freeBusy.status(participant, event.startTime, event.endTime);
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

  function zoomLabel(level: number): string {
    return new Intl.NumberFormat(getDateTimeLocale(), { style: "percent" }).format(level);
  }

  function setZoom(level: number) {
    zoom = level;
    scrollToMeeting();
  }

  function dayName(shownDay: Date): string {
    return shownDay.toLocaleDateString(getDateTimeLocale(), { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }

  function hourLabel(hour: Date): string {
    return hour.toLocaleTimeString(getDateTimeLocale(), { hour: "numeric" });
  }

  function xOf(clientX: number): number {
    return clientX - rowsEl.getBoundingClientRect().left;
  }

  function onClickRows(mouseEvent: MouseEvent) {
    if (readOnly || (mouseEvent.target as HTMLElement).classList.contains("edge")) {
      return;
    }
    timeEditor.moveTo(timeline.slotAt(xOf(mouseEvent.clientX)));
  }

  function onEdgeDown(pointerEvent: PointerEvent, edge: "start" | "end") {
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
    let edgeEl = pointerEvent.currentTarget as HTMLElement;
    edgeEl.setPointerCapture(pointerEvent.pointerId);
    let onMove = (moveEvent: PointerEvent) => {
      const kSnapMinutes = 15;
      let time = timeline.timeAt(xOf(moveEvent.clientX), kSnapMinutes);
      if (edge == "start") {
        timeEditor.setStartKeepingEnd(time);
      } else if (time > event.startTime) {
        timeEditor.setEnd(time);
      }
    };
    let onUp = () => {
      edgeEl.removeEventListener("pointermove", onMove);
      edgeEl.removeEventListener("pointerup", onUp);
      edgeEl.removeEventListener("pointercancel", onUp);
    };
    edgeEl.addEventListener("pointermove", onMove);
    edgeEl.addEventListener("pointerup", onUp);
    edgeEl.addEventListener("pointercancel", onUp);
  }
</script>

<style>
  .free-busy-grid {
    min-height: 0;
    --busy-color: color-mix(in srgb, var(--lo-accent) 72%, black);
    --out-of-office-color: #7A3E9D;
    --no-info-pattern: repeating-linear-gradient(135deg,
      color-mix(in srgb, var(--lo-fg-secondary) 35%, transparent) 0 1px,
      transparent 1px 6px);
  }
  .day-bar {
    flex-shrink: 0;
    align-items: center;
    gap: 4px;
    padding: 4px 24px 8px 24px;
  }
  .nav {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg);
    cursor: pointer;
  }
  .nav:hover {
    background-color: var(--lo-hover-bg);
  }
  .day-label {
    margin-inline-start: 8px;
    font-weight: 600;
  }
  .status {
    font-size: var(--lo-font-size-small);
  }
  .status.error {
    color: var(--lo-danger);
  }
  .grid-scroll {
    min-height: 0;
    align-items: start;
    margin: 0 24px;
    overflow-y: auto;
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
  }
  .names {
    flex: none;
    width: 260px;
    border-inline-end: 1px solid var(--lo-border);
  }
  .hours-spacer {
    height: 52px;
    border-block-end: 1px solid var(--lo-border);
    background-color: var(--lo-pane-alt-bg);
  }
  .row {
    height: var(--row-height);
    border-block-end: 1px solid var(--lo-divider);
  }
  .names .row {
    align-items: center;
    gap: 8px;
    padding: 0 8px 0 12px;
  }
  .names .all-attendees {
    font-weight: 600;
    background-color: var(--lo-pane-alt-bg);
  }
  .person-text {
    min-width: 0;
  }
  .name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .availability {
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg-secondary);
  }
  .availability.status-free {
    color: var(--lo-success);
  }
  .availability.status-busy {
    color: var(--lo-danger);
  }
  .remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
    cursor: pointer;
    opacity: 0;
  }
  .person:hover .remove,
  .remove:focus-visible {
    opacity: 1;
  }
  .remove:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  .names .add :global(input) {
    width: 100%;
    border: none;
    background: none;
    color: var(--lo-fg);
    font: inherit;
  }
  .timeline-scroll {
    flex: 1 1 0;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .timeline {
    position: relative;
  }
  .days {
    position: relative;
    height: 24px;
    background-color: var(--lo-pane-alt-bg);
  }
  .day-name {
    position: absolute;
    top: 0;
    bottom: 0;
    box-sizing: border-box;
    border-inline-start: 2px solid var(--lo-border-strong);
  }
  .day-text {
    position: sticky;
    left: 0;
    display: inline-block;
    padding: 4px 6px 0 6px;
    font-size: var(--lo-font-size-small);
    font-weight: 600;
    white-space: nowrap;
  }
  .hours {
    position: relative;
    height: 28px;
    border-block-end: 1px solid var(--lo-border);
    background-color: var(--lo-pane-alt-bg);
  }
  .hour {
    position: absolute;
    top: 6px;
    padding-inline-start: 6px;
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg-secondary);
    white-space: nowrap;
  }
  .rows {
    position: relative;
    cursor: pointer;
    background-image:
      repeating-linear-gradient(90deg, var(--lo-border-strong) 0 2px, transparent 2px calc(var(--hour-width) * 24)),
      repeating-linear-gradient(90deg, var(--lo-border) 0 1px, transparent 1px var(--hour-width)),
      repeating-linear-gradient(90deg, transparent 0 calc(var(--hour-width) / 2), var(--lo-divider) calc(var(--hour-width) / 2) calc(var(--hour-width) / 2 + 1px), transparent calc(var(--hour-width) / 2 + 1px) var(--hour-width));
  }
  .rows .row {
    position: relative;
  }
  .rows .all-attendees {
    background-color: color-mix(in srgb, var(--lo-pane-alt-bg) 60%, transparent);
  }
  .rows .no-info {
    background-image: var(--no-info-pattern);
  }
  .busy {
    position: absolute;
    top: 6px;
    bottom: 6px;
    box-sizing: border-box;
    padding: 0 4px;
    overflow: hidden;
    border-radius: 2px;
    background-color: var(--busy-color);
    color: var(--lo-accent-fg);
    font-size: var(--lo-font-size-small);
    line-height: calc(var(--row-height) - 12px);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .busy.status-tentative,
  .swatch-busy.status-tentative {
    background-color: var(--lo-accent-tint);
    background-image: repeating-linear-gradient(-45deg, color-mix(in srgb, var(--busy-color) 45%, transparent) 0 2px, transparent 2px 6px);
    border: 1px solid var(--busy-color);
    color: var(--lo-fg);
  }
  .busy.status-out-of-office,
  .swatch-busy.status-out-of-office {
    background-color: var(--out-of-office-color);
  }
  .busy.status-elsewhere,
  .swatch-busy.status-elsewhere {
    background-color: var(--lo-accent-tint);
    background-image: radial-gradient(color-mix(in srgb, var(--busy-color) 60%, transparent) 1px, transparent 1.5px);
    background-size: 5px 5px;
    border: 1px solid var(--busy-color);
    color: var(--lo-fg);
  }
  .meeting {
    position: absolute;
    top: 0;
    bottom: 0;
    box-sizing: border-box;
    border-inline: 3px solid var(--lo-accent);
    background-color: color-mix(in srgb, var(--lo-accent) 12%, transparent);
    pointer-events: none;
  }
  .edge {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 11px;
    cursor: ew-resize;
    pointer-events: auto;
    touch-action: none;
  }
  .edge.start {
    left: -7px;
  }
  .edge.end {
    right: -7px;
  }
  .legend {
    flex-shrink: 0;
    gap: 20px;
    padding: 8px 24px 12px 24px;
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg-secondary);
  }
  .zoom {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    margin-block: -4px;
    padding: 0 6px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
    font: inherit;
    cursor: pointer;
  }
  .zoom:hover,
  .zoom.open {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .swatch {
    width: 14px;
    height: 12px;
    border: 1px solid var(--lo-border);
  }
  .swatch-busy {
    background-color: var(--busy-color);
  }
  .swatch-no-info {
    background-image: var(--no-info-pattern);
  }
</style>
