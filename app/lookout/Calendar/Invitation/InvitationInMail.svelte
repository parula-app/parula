<vbox class="invitation-bar">
  {#if !$message.event}
    {#await loadEvent()}
      <hbox class="info-bar">
        <InfoIcon size={16} />
        <span>{$t`Loading the meeting…`}</span>
      </hbox>
    {:then}
      {#if !$message.event}
        <hbox class="info-bar">
          <InfoIcon size={16} />
          <span>{$t`The meeting of this invitation was not found`}</span>
        </hbox>
      {/if}
    {:catch ex}
      <hbox class="info-bar warning">
        <WarningIcon size={16} />
        <span>{ex?.message ?? ex}</span>
      </hbox>
    {/await}
  {:else}
    <hbox class="info-bar" class:cancelled={isCancelled}>
      {#if isCancelled}
        <CancelledIcon size={16} />
      {:else}
        <InfoIcon size={16} />
      {/if}
      <span>{statusText}</span>
    </hbox>
    {#if conflict == "conflict"}
      <hbox class="info-bar warning">
        <WarningIcon size={16} />
        <span>{$t`This appointment conflicts with another one on your calendar`}</span>
      </hbox>
    {:else if conflict == "adjacent"}
      <hbox class="info-bar">
        <InfoIcon size={16} />
        <span>{$t`Adjacent to another appointment on your calendar`}</span>
      </hbox>
    {/if}
    {#if isCancelled && hasCalEvent}
      <hbox class="respond">
        <ResponseButton label={$t`Remove from Calendar`} icon={RemoveIcon}
          onClick={onRemove} />
      </hbox>
    {:else if canRespond}
      <hbox class="respond" role="group" aria-label={$t`Respond *=> Buttons to answer the meeting invitation`}>
        <RespondButtons {response} onRespond={onRespond}
          onReplyToOrganizer={() => MessageActions.respond(message, message.compose.replyToAuthor())}
          onReplyToAll={() => MessageActions.respond(message, message.compose.replyAll())}
          onForward={clickEvent => MessageActions.forward(message, clickEvent as MouseEvent)} />
      </hbox>
    {/if}
    <grid class="details">
      {#if when}
        <ClockIcon size={16} />
        <span class:cancelled={isCancelled}>{when}</span>
      {/if}
      {#if $event.location}
        <LocationIcon size={16} />
        <span>{$event.location}</span>
      {/if}
      {#if $event.isOnline && $event.onlineMeetingURL}
        <OnlineIcon size={16} />
        <hbox>
          <button class="link" on:click={() => catchErrors(onJoin)} title={$event.onlineMeetingURL}>
            {$t`Join the online meeting`}
          </button>
        </hbox>
      {/if}
    </grid>
    {#if kind != "reply" && $event.startTime}
      <EventInDayView event={$event} onShowInCalendar={showInCalendar} />
    {/if}
  {/if}
</vbox>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { Event } from "../../../logic/Calendar/Event";
  import type { Calendar } from "../../../logic/Calendar/Calendar";
  import type { IncomingInvitation } from "../../../logic/Calendar/Invitation/IncomingInvitation";
  import { InvitationMessage, InvitationResponse, type InvitationResponseInMessage } from "../../../logic/Calendar/Invitation/InvitationStatus";
  import { openExternalURL } from "../../../logic/util/os-integration";
  import { appGlobal } from "../../../logic/app";
  import { CalendarActions } from "../CalendarActions";
  import { calendarMustangApp } from "../../../frontend/Calendar/CalendarMustangApp";
  import { selectedDate, selectedEvent, startDate } from "../../../frontend/Calendar/selected";
  import { openApp } from "../../../frontend/AppsBar/selectedApp";
  import { eventWhenText, eventConflict, myResponseText } from "../EditEvent/EventFormInfo";
  import EventInDayView from "../DisplayEvent/EventInDayView.svelte";
  import ResponseButton from "./ResponseButton.svelte";
  import RespondButtons from "./RespondButtons.svelte";
  import { MessageActions } from "../../Mail/MessageActions";
  import { catchErrors } from "../../../frontend/Util/error";
  import InfoIcon from "lucide-svelte/icons/info";
  import WarningIcon from "lucide-svelte/icons/triangle-alert";
  import CancelledIcon from "lucide-svelte/icons/calendar-x-2";
  import RemoveIcon from "lucide-svelte/icons/calendar-minus-2";
  import ClockIcon from "lucide-svelte/icons/clock-3";
  import LocationIcon from "lucide-svelte/icons/map-pin";
  import OnlineIcon from "lucide-svelte/icons/video";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";

  export let message: EMail;

  const calendarEvents = appGlobal.calendarEvents;

  $: calendar = $message && message.event ? findCalendar(message) : null;
  $: incoming = calendar?.getIncomingInvitationForEMail(message) ?? null;
  $: kind = $message && kindOf(message);
  $: event = $message && message.event;
  let response: InvitationResponse;
  $: response = incoming?.myParticipation ?? InvitationResponse.NoResponseReceived;
  $: canRespond = kind == "invitation" && !!incoming && response != InvitationResponse.Organizer;
  $: calEvent = $calendarEvents && (incoming?.calEvent() ?? null);
  $: hasCalEvent = !!calEvent;
  $: isCancelled = kind == "cancellation" || !!calEvent?.isCancelled;
  $: statusText = response && invitationStatusText(message, incoming, response, calEvent);
  $: when = $event?.startTime ? eventWhenText($event, getDateTimeLocale()) : "";
  $: conflict = kind == "invitation" && !isCancelled && $event && response != InvitationResponse.Decline
    ? eventConflict(calEvent ?? $event, $calendarEvents.filter(dayEvent => !dayEvent.isSameUID($event)))
    : null;

  // <copied from="../../../frontend/Calendar/Invitation/IncomingInvitationInMail.svelte" initCalendar()>
  function findCalendar(message: EMail): Calendar | null {
    let account = message.folder?.account;
    if (!account) {
      return null;
    }
    for (let calendar of account.calendarsAvailable) {
      if (calendar.hasMatchingEvent(message.event)) {
        return calendar;
      }
    }
    return account.calendar;
  }
  // </copied>

  type InvitationKind = "invitation" | "cancellation" | "reply";

  function kindOf(message: EMail): InvitationKind {
    switch (message.invitationMessage) {
    case InvitationMessage.CancelledEvent:
      return "cancellation";
    case InvitationMessage.ParticipantReply:
      return "reply";
    }
    return "invitation";
  }

  function invitationStatusText(message: EMail, incoming: IncomingInvitation | null, myResponse: InvitationResponse, calEvent: Event | null): string {
    let kind = kindOf(message);
    if (kind == "cancellation") {
      return $t`This meeting has been cancelled by the organizer`;
    }
    if (kind == "reply") {
      return replyText(message);
    }
    if (myResponse == InvitationResponse.Organizer) {
      return $t`You are the organizer of this meeting`;
    }
    if (!incoming) {
      return $t`There is no calendar for this meeting in this account`;
    }
    if (calEvent?.isCancelled) {
      return $t`This meeting has been cancelled by the organizer`;
    }
    if (calEvent?.isMoved) {
      return $t`The organizer changed the time or place of this meeting. Please respond again.`;
    }
    return myResponseText(myResponse);
  }

  function replyText(message: EMail): string {
    let participant = message.event?.participants.find(participant => participant.matches(message.from)) ?? null;
    let name = participant?.name || participant?.emailAddress || message.from?.name || message.from?.emailAddress || "";
    if (message.outgoing) {
      return myResponseText(participant?.response);
    }
    switch (participant?.response) {
    case InvitationResponse.Accept:
      return $t`${name} has accepted this meeting`;
    case InvitationResponse.Tentative:
      return $t`${name} has tentatively accepted this meeting`;
    case InvitationResponse.Decline:
      return $t`${name} has declined this meeting`;
    }
    return $t`${name} has responded to this meeting`;
  }

  // <copied from="../../../frontend/Calendar/Invitation/InvitationInMail.svelte"> Only for old messages that didn't save the event
  async function loadEvent() {
    if (message.invitationMessage) {
      await message.loadEvent();
    }
  }
  // </copied>

  async function onRespond(newResponse: InvitationResponseInMessage, sendReply: boolean) {
    await incoming.respondToInvitationFromMail(newResponse, sendReply);
    response = newResponse;
  }

  async function onRemove() {
    let eventInCalendar = incoming?.calEvent();
    if (eventInCalendar) {
      await CalendarActions.deleteOccurrence(eventInCalendar);
    }
    incoming = incoming;
  }

  function showInCalendar() {
    let eventInCalendar = incoming?.calEvent() ?? null;
    let day = new Date((eventInCalendar ?? event).startTime);
    $selectedEvent = eventInCalendar;
    $selectedDate = day;
    $startDate = day;
    openApp(calendarMustangApp, {});
  }

  async function onJoin() {
    await openExternalURL($event.onlineMeetingURL);
  }
</script>

<style>
  .invitation-bar {
    flex-shrink: 0;
    gap: 8px;
    margin: 0 20px 8px 20px;
  }
  /* <copied from="../../Mail/Message/InfoBars.svelte"> */
  .info-bar {
    align-items: center;
    flex-shrink: 0;
    gap: 8px;
    padding: 6px 12px;
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-pane-alt-bg);
    border: 1px solid var(--lo-divider);
    color: var(--lo-fg);
    font-size: 13px;
  }
  .info-bar :global(svg) {
    flex-shrink: 0;
    color: var(--lo-fg-secondary);
  }
  .info-bar.warning :global(svg) {
    color: var(--lo-warning);
  }
  .link {
    flex-shrink: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--lo-accent-text);
    font: inherit;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  /* </copied> */
  .info-bar.cancelled :global(svg) {
    color: var(--lo-danger);
  }
  .info-bar.cancelled span {
    font-weight: 600;
  }
  .respond {
    gap: 8px;
  }
  .details {
    grid-template-columns: max-content 1fr;
    align-items: center;
    column-gap: 10px;
    row-gap: 4px;
    padding: 0 2px;
  }
  .details :global(svg) {
    color: var(--lo-fg-secondary);
  }
  .details .cancelled {
    text-decoration: line-through;
  }
</style>
