<hbox class="invitation" bind:offsetWidth={width}>
  <vbox class="appointment">
    {#if $message.event}
      <InvitationDisplay event={$message.event} />
    <!-- Can be removed. Only for old messages that didn't save email.event to DB as JSON. -->
    {:else if $message.invitationMessage}
      {#await message.loadEvent()}
        {$t`Loading event...`}
      {:then}
        {#if !$message.event}
          {$t`No event found`}
        {/if}
      {:catch ex}
        {ex?.message ?? ex}
      {/await}
    {/if}
    {#if $message.invitationMessage == InvitationMessage.Invitation}
      <IncomingInvitationInMail {message} />
    {:else if $message.invitationMessage == InvitationMessage.CancelledEvent }
      <InvitationCancellationInMail />
    {:else if message.invitationMessage == InvitationMessage.ParticipantReply}
      <InvitationResponseInMail {message} />
    {/if}
  </vbox>
  {#if calEvent && width > 600}
    <EventInDayView event={calEvent} />
  {/if}
</hbox>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { Event } from "../../../logic/Calendar/Event";
  import { InvitationMessage } from "../../../logic/Calendar/Invitation/InvitationStatus";
  import InvitationDisplay from "./InvitationDisplay.svelte";
  import IncomingInvitationInMail from "./IncomingInvitationInMail.svelte";
  import InvitationResponseInMail from "./InvitationResponseInMail.svelte";
  import InvitationCancellationInMail from "./InvitationCancellationInMail.svelte";
  import EventInDayView from "../DisplayEvent/EventInDayView.svelte";
  import { t } from "../../../l10n/l10n";

  export let message: EMail;
  let width: number;
  let calEvent: Event;

  $: tryCalEvent($message.event);
  function tryCalEvent(event) {
    calEvent = event;
    if (!calEvent) {
      return;
    }
    for (let calendar of message.folder.account.calendarsAvailable) {
      if (calendar.hasMatchingEvent(calEvent)) {
        selectCalendar(calendar);
        return;
      }
    }
  }
  function selectCalendar(calendar) {
    let recurrenceStartTime = calEvent.recurrenceStartTime;
    calEvent = calendar.events.find(event => event.calUID == calEvent.calUID && !event.recurrenceStartTime);
    if (recurrenceStartTime) {
      calEvent = calEvent.getOccurrenceByDate(recurrencestartTime);
    }
  }
</script>

<style>
  .appointment {
    padding: 20px 32px 24px 32px;
    flex: 2 0 0;
  }
  :global(.message-display):has(.invitation) :global(.recipients),
  :global(.message-display):has(.invitation) :global(.subject-line) {
    display: none;
  }
  :global(.message-display):has(.invitation) :global(.message-header) {
    min-height: unset;
  }
</style>
