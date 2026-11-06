<MenuItem label={$t`Open`} icon={OpenIcon} shortCutInfo={$t`Enter *=> RETURN key`}
  onClick={() => openEvent(event, true)} />
{#if event.isIncomingMeeting && !event.isCancelled}
  <MenuDivider />
  {#each responses as response}
    <SubMenu label={response.label} icon={response.icon} classes={response.classes}>
      <ResponseMenuItems response={response.value} checked={event.myParticipation == response.value}
        onRespond={sendReply => event.respondToInvitation(response.value, sendReply)} />
    </SubMenu>
  {/each}
{/if}
{#if !event.isCancelled}
  <MenuDivider />
  {#if event.isIncomingMeeting}
    <MenuItem label={$t`Reply`} icon={ReplyIcon}
      onClick={() => openComposer(IncomingInvitation.replyToEventByMail(event, false))} />
    <MenuItem label={$t`Reply All`} icon={ReplyAllIcon}
      onClick={() => openComposer(IncomingInvitation.replyToEventByMail(event, true))} />
  {/if}
  <MenuItem label={$t`Forward`} icon={ForwardIcon} shortCutInfo={$t`Ctrl+F *=> Keyboard shortcut`}
    onClick={async () => openComposer(await IncomingInvitation.forwardEventByMail(event))} />
{/if}
<MenuDivider />
{#if event.isCancelled}
  <MenuItem label={$t`Remove from Calendar`} icon={DeleteIcon}
    onClick={() => CalendarActions.deleteOccurrence(event)} />
{:else if isRecurring && event.isOutgoingMeeting}
  <SubMenu label={$t`Cancel Meeting`} icon={CancelIcon}>
    <MenuItem label={$t`Cancel Occurrence *=> Call off this occurrence of the recurring meeting`} icon={CancelIcon}
      onClick={() => CalendarActions.cancelMeeting(event)} />
    <MenuItem label={$t`Cancel Series *=> Call off all occurrences of the recurring meeting`} icon={CancelIcon}
      onClick={() => CalendarActions.deleteSeries(event)} />
  </SubMenu>
{:else if isRecurring}
  <SubMenu label={$t`Delete`} icon={DeleteIcon}>
    {#if !event.isIncomingMeeting}
      <MenuItem label={$t`Delete Occurrence`} icon={DeleteIcon} shortCutInfo={$t`Del *=> Delete key`}
        onClick={() => CalendarActions.deleteOccurrence(event)} />
      {#if event.seriesStatus == "middle"}
        <MenuItem label={$t`Delete This and Following`} icon={DeleteIcon}
          onClick={() => CalendarActions.deleteRemainder(event)} />
      {/if}
    {/if}
    <MenuItem label={$t`Delete Series`} icon={DeleteIcon}
      onClick={() => CalendarActions.deleteSeries(event)} />
  </SubMenu>
{:else if event.isOutgoingMeeting}
  <MenuItem label={$t`Cancel Meeting`} icon={CancelIcon}
    onClick={() => CalendarActions.cancelMeeting(event)} />
{:else}
  <MenuItem label={$t`Delete`} icon={DeleteIcon} shortCutInfo={$t`Del *=> Delete key`}
    onClick={() => CalendarActions.deleteOccurrence(event)} />
{/if}

<script lang="ts">
  import { RecurrenceCase, type Event } from "../../../logic/Calendar/Event";
  import { InvitationResponse, type InvitationResponseInMessage } from "../../../logic/Calendar/Invitation/InvitationStatus";
  import { CalendarActions } from "../CalendarActions";
  import { openEvent } from "../../../frontend/Calendar/open";
  import { openComposer } from "../../../frontend/Mail/open";
  import { IncomingInvitation } from "../../../logic/Calendar/Invitation/IncomingInvitation";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import SubMenu from "../../Shared/Menu/SubMenu.svelte";
  import ResponseMenuItems from "../Invitation/ResponseMenuItems.svelte";
  import OpenIcon from "lucide-svelte/icons/square-pen";
  import AcceptIcon from "lucide-svelte/icons/check";
  import TentativeIcon from "lucide-svelte/icons/circle-help";
  import DeclineIcon from "lucide-svelte/icons/x";
  import ForwardIcon from "lucide-svelte/icons/forward";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import ReplyAllIcon from "lucide-svelte/icons/reply-all";
  import CancelIcon from "lucide-svelte/icons/calendar-x-2";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import { t } from "../../../l10n/l10n";

  export let event: Event;

  $: responses = [
    { value: InvitationResponse.Accept, label: $t`Accept *=> Accept the invitation to the meeting`, icon: AcceptIcon, classes: "accept" },
    { value: InvitationResponse.Tentative, label: $t`Tentative *=> Not sure to join this business meeting`, icon: TentativeIcon, classes: "" },
    { value: InvitationResponse.Decline, label: $t`Decline *=> Decline the invitation to the meeting`, icon: DeclineIcon, classes: "decline" },
  ] as { value: InvitationResponseInMessage, label: string, icon: typeof AcceptIcon, classes: string }[];
  $: isRecurring = event.recurrenceCase == RecurrenceCase.Instance || event.recurrenceCase == RecurrenceCase.Exception;
</script>
