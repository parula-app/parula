<hbox class="attendee-list">
  {#each attendees as participant, index (participant)}
    <span class="attendee" title={tooltip(participant)}>
      <ParticipantConfirmIcon {participant} size={14} />
      <span><span class="name">{participant.name || participant.emailAddress}</span>{index < attendees.length - 1 ? ";" : ""}</span>
    </span>
  {/each}
</hbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import type { Participant } from "../../../logic/Calendar/Participant";
  import { InvitationResponse } from "../../../logic/Calendar/Invitation/InvitationStatus";
  import { responseLabel } from "../EditEvent/EventFormInfo";
  import ParticipantConfirmIcon from "../EditEvent/ParticipantConfirmIcon.svelte";
  import { derived } from "svelte/store";

  export let event: Event;

  $: eventParticipants = event.participants;
  $: participants = derived($eventParticipants.contents, () => eventParticipants.contents);
  $: attendees = $participants.filter(participant => participant.response != InvitationResponse.Organizer);

  function tooltip(participant: Participant): string {
    return [participant.name, participant.emailAddress, responseLabel(participant)]
      .filter(text => text)
      .join("\n");
  }
</script>

<style>
  .attendee-list {
    flex-wrap: wrap;
    align-items: center;
    column-gap: 8px;
    row-gap: 4px;
    min-width: 0;
  }
  .attendee {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }
  .name {
    text-decoration: underline;
    text-decoration-color: var(--lo-border-strong);
    text-underline-offset: 2px;
  }
</style>
