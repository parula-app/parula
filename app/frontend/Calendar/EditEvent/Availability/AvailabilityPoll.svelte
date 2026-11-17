<vbox class="availability-poll" flex>
  <hbox class="option">
    <Checkbox
      label={$t`Only ask people with unknown availability`}
      checked={onlyUnknown}
      disabled={allKnown}
      tooltip={allKnown ? $t`The availability of all participants is known` : null}
      allowIndetermined={false}
      on:change={ev => onlyUnknownSetting.value = ev.detail}
      />
    {#if sml}
      <Button
        label={$t`Compose mail`}
        icon={ComposeIcon}
        classes="send"
        onClick={onSend}
        disabled={$recipients.isEmpty ? $t`Nobody is invited yet` : false}
        />
    {/if}
  </hbox>
  <hbox class="recipients">
    <hbox class="label">{$t`To *=> email to a person`}</hbox>
    <AvailabilityLoader {event} from={weekStart} to={weekEnd} bind:freeBusy>
      <hbox class="names" class:none={$recipients.isEmpty}>
        {$recipients.hasItems
          ? $recipients.contents.map(participant => participant.name || participant.emailAddress).join(", ")
          : $t`Nobody is invited yet`}
      </hbox>
    </AvailabilityLoader>
  </hbox>
  {#if sml}
    <slot name="editor" {sml}>
      <EditPollTimes {event} {sml} />
    </slot>
  {:else}
    <hbox class="error">{$t`No suitable email identity to organise this meeting`}</hbox>
  {/if}
</vbox>

<script lang="ts">
  import type { Event } from "../../../../logic/Calendar/Event";
  import type { Participant } from "../../../../logic/Calendar/Participant";
  import { InvitationResponse } from "../../../../logic/Calendar/Invitation/InvitationStatus";
  import type { FreeBusy } from "../../../../logic/Calendar/FreeBusy";
  import type { SMLData } from "../../../../logic/Mail/SML/SMLData";
  import type { TSMLMeetingTimePoll } from "../../../../logic/Mail/SML/TSML";
  import { createMeetingTimePoll } from "../../../../logic/Mail/SML/SMLCreateKind";
  import AvailabilityLoader from "./AvailabilityLoader.svelte";
  import EditPollTimes from "./EditPollTimes.svelte";
  import Checkbox from "../../../Shared/Checkbox.svelte";
  import Button from "../../../Shared/Button.svelte";
  import ComposeIcon from "lucide-svelte/icons/pencil";
  import { openComposer } from "../../../Mail/open";
  import { getLocalStorage } from "../../../Util/LocalStorage";
  import { getWeekStart } from "../../../../logic/util/date";
  import { UserError } from "../../../../logic/util/util";
  import type { Collection } from "svelte-collections";
  import { t } from "../../../../l10n/l10n";

  /** The meeting for which to find a time */
  export let event: Event;
  /** The poll, kept while the user switches to other views
   * in/out */
  export let sml: SMLData | null = null;

  const onlyUnknownSetting = getLocalStorage("calendar.availability.pollOnlyUnknown", true);

  const weekStart = getWeekStart(event.startTime);
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7);

  let identity = event.calendar?.inviteAs;
  if (!sml && identity) {
    sml = createMeetingTimePoll(identity);
    let timePoll = sml.sml as TSMLMeetingTimePoll;
    timePoll.duration = event.durationMinutes;
    timePoll.options.push(new Date(event.startTime));
  }

  let freeBusy: FreeBusy | null = null;
  $: participants = event.participants;
  $: allKnown = isAllKnown($participants, freeBusy);
  $: onlyUnknown = $onlyUnknownSetting.value && !allKnown;
  $: recipients = pollRecipients($participants, freeBusy, onlyUnknown);
  function isAllKnown(participants: Collection<Participant>, freeBusy: FreeBusy | null): boolean {
    let invitees = participants.filterOnce(participant => participant.response != InvitationResponse.Organizer);
    return !!freeBusy && invitees.hasItems && !invitees.find(participant => !freeBusy.rowFor(participant)?.busy);
  }
  function pollRecipients(participants: Collection<Participant>, freeBusy: FreeBusy | null, onlyUnknown: boolean): Collection<Participant> {
    return participants.filterOnce(participant =>
      participant.response != InvitationResponse.Organizer &&
      (!onlyUnknown || !freeBusy?.rowFor(participant)?.busy));
  }

  function onSend() {
    if (!(sml.sml as TSMLMeetingTimePoll).options.length) {
      throw new UserError($t`Add the times that you propose`);
    }
    openComposer(event.outgoingInvitation.meetingTimePollMail(recipients, sml));
  }
</script>

<style>
  .availability-poll {
    min-height: 0;
    overflow-y: auto;
    container-type: inline-size;
    container-name: availability-poll;
  }
  .option,
  .recipients {
    align-items: center;
    margin-block-end: 6px;
  }
  .option {
    flex-wrap: wrap;
    gap: 6px 12px;
  }
  .option :global(button.send) {
    margin-inline-start: auto;
    white-space: nowrap;
  }
  .recipients .label {
    margin-inline-end: 12px;
    opacity: 70%;
  }
  .names.none {
    opacity: 70%;
  }
  .recipients :global(.checking) {
    margin: 0;
  }
  .error {
    margin: 12px;
  }
</style>
