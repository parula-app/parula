<Ribbon>
  <RibbonTab label={tabLabel}>
    {#if isIncoming}
      <RibbonGroup label={$t`Respond *=> Ribbon group with commands to answer the meeting invitation`}>
        {#if $event.isCancelled}
          <RibbonButton label={$t`Remove from Calendar`} icon={RemoveIcon}
            onClick={onDelete} />
        {:else}
          <RibbonMenuButton label={$t`Accept *=> Accept the invitation to the meeting`} icon={AcceptIcon} classes="accept">
            <ResponseMenuItems response={InvitationResponse.Accept} checked={$event.myParticipation == InvitationResponse.Accept}
              onRespond={sendReply => respond(InvitationResponse.Accept, sendReply)} />
          </RibbonMenuButton>
          <RibbonMenuButton label={$t`Tentative *=> Not sure to join this business meeting`} icon={TentativeIcon} classes="tentative">
            <ResponseMenuItems response={InvitationResponse.Tentative} checked={$event.myParticipation == InvitationResponse.Tentative}
              onRespond={sendReply => respond(InvitationResponse.Tentative, sendReply)} />
          </RibbonMenuButton>
          <RibbonMenuButton label={$t`Decline *=> Decline the invitation to the meeting`} icon={DeclineIcon} classes="decline">
            <ResponseMenuItems response={InvitationResponse.Decline} checked={$event.myParticipation == InvitationResponse.Decline}
              onRespond={sendReply => respond(InvitationResponse.Decline, sendReply)} />
          </RibbonMenuButton>
        {/if}
      </RibbonGroup>
      <RibbonGroup label={$t`Actions`}>
        {#if isInstance}
          <RibbonMenuButton label={$t`Delete`} icon={DeleteIcon}>
            <MenuItem label={$t`Delete Occurrence`} icon={DeleteIcon} onClick={onDelete} />
            <MenuItem label={$t`Delete Series`} icon={DeleteIcon} onClick={deleteSeries} />
          </RibbonMenuButton>
        {:else}
          <RibbonButton label={$t`Delete`} icon={DeleteIcon}
            disabled={$event.isCancelled && $t`Use Remove from Calendar`}
            tooltip={$t`Delete the meeting and decline it`}
            onClick={onDelete} />
        {/if}
        <RibbonButton label={$t`Reply`} icon={ReplyIcon}
          onClick={() => openComposer(IncomingInvitation.replyToEventByMail(event, false))} />
        <RibbonButton label={$t`Reply All`} icon={ReplyAllIcon}
          onClick={() => openComposer(IncomingInvitation.replyToEventByMail(event, true))} />
        <RibbonButton label={$t`Forward`} icon={ForwardIcon} shortCutInfo={$t`Ctrl+F *=> Keyboard shortcut`}
          onClick={async () => openComposer(await IncomingInvitation.forwardEventByMail(event))} />
      </RibbonGroup>
      <RibbonGroup label={$t`Calendar`}>
        <RibbonButton label={$t`Calendar… *=> Show this day in the calendar`} icon={CalendarIcon}
          tooltip={$t`Show this day in the calendar`}
          onClick={showInCalendar} />
      </RibbonGroup>
      {#if $event.isOnline}
        <RibbonGroup label={$t`Online Meeting`}>
          <RibbonButton label={$t`Join Online Meeting`} icon={JoinIcon}
            disabled={!$event.onlineMeetingURL && $t`This meeting has no link to an online meeting`}
            onClick={() => openExternalURL(event.onlineMeetingURL)} />
        </RibbonGroup>
      {/if}
    {:else}
      <RibbonGroup label={$t`Actions`}>
        {#if !isMeeting}
          <RibbonButton label={$t`Save & Close`} icon={SaveIcon} shortCutInfo={$t`Alt+S *=> Keyboard shortcut`}
            disabled={saveDisabled}
            onClick={onSave} />
        {/if}
        {#if isInstance}
          <RibbonMenuButton label={isSent ? $t`Cancel Meeting` : $t`Delete`} icon={isSent ? CancelIcon : DeleteIcon}>
            <MenuItem label={isSent ? $t`Cancel Occurrence *=> Call off this occurrence of the recurring meeting` : $t`Delete Occurrence`} icon={isSent ? CancelIcon : DeleteIcon}
              onClick={onDelete} />
            {#if $event.seriesStatus == "middle" && !isSent}
              <MenuItem label={$t`Delete This and Following`} icon={DeleteIcon}
                onClick={() => flow.deleteRemainder()} />
            {/if}
            <MenuItem label={isSent ? $t`Cancel Series *=> Call off all occurrences of the recurring meeting` : $t`Delete Series`} icon={isSent ? CancelIcon : DeleteIcon}
              onClick={deleteSeries} />
          </RibbonMenuButton>
        {:else if isSent}
          <RibbonButton label={$t`Cancel Meeting`} icon={CancelIcon}
            tooltip={$t`Send a cancellation to all attendees and delete the meeting`}
            onClick={onDelete} />
        {:else}
          <RibbonButton label={$t`Delete`} icon={DeleteIcon} shortCutInfo={$t`Ctrl+D *=> Keyboard shortcut`}
            onClick={onDelete} />
        {/if}
        <RibbonButton label={$t`Forward`} icon={ForwardIcon} shortCutInfo={$t`Ctrl+F *=> Keyboard shortcut`}
          disabled={!flow.isSaved && (isMeeting ? $t`Send the meeting first` : $t`Save the appointment first`)}
          onClick={async () => openComposer(await IncomingInvitation.forwardEventByMail(event))} />
      </RibbonGroup>
      <RibbonGroup label={$t`Online Meeting`}>
        {#if $event.isOnline}
          <RibbonButton label={$t`Join Online Meeting`} icon={JoinIcon}
            disabled={!$event.onlineMeetingURL && $t`The link is created when you send the invitation`}
            onClick={() => openExternalURL(event.onlineMeetingURL)} />
          <RibbonButton label={$t`Don't Host Online`} icon={OfflineIcon}
            tooltip={$t`Remove the online meeting`}
            onClick={onOffline} />
        {:else}
          <RibbonMenuButton label={$t`Online Meeting`} shortLabel={$t`Online *=> Online meeting`} icon={OnlineMeetingIcon}
            tooltip={$t`Add a link to an online meeting`}>
            {#each $meetAccounts.each as account}
              <MenuItem label={account.name} icon={OnlineMeetingIcon}
                onClick={() => onOnline(account)} />
            {/each}
            {#if $meetAccounts.hasItems}
              <MenuDivider />
            {/if}
            <MenuItem label={$t`Paste a Meeting Link`} icon={LinkIcon}
              onClick={() => onOnline(null)} />
          </RibbonMenuButton>
        {/if}
      </RibbonGroup>
      <RibbonGroup label={$t`Attendees *=> Ribbon group with commands for the attendees of the meeting`}>
        {#if isMeeting}
          <RibbonButton label={$t`Address Book`} icon={AddressBookIcon}
            tooltip={$t`Select attendees from the address book`}
            onClick={() => { $openSelectAttendees = event; }} />
          <RibbonButton label={$t`Check Names`} icon={CheckNamesIcon}
            tooltip={$t`Check the names you typed against your address books`}
            onClick={() => { $checkNamesOf = event; }} />
        {:else}
          <RibbonButton label={$t`Invite Attendees`} icon={InviteIcon}
            tooltip={$t`Turn this appointment into a meeting`}
            onClick={() => flow.inviteAttendees()} />
        {/if}
      </RibbonGroup>
      <RibbonGroup label={$t`Options *=> Ribbon group with the reminder and recurrence of the event`}>
        <RibbonMenuButton label={$t`Reminder: ${reminderLabel.replaceAll(" ", "\u00A0")}`} shortLabel={reminderMinutes == null ? $t`Reminder` : reminderLabel} icon={ReminderIcon}
          tooltip={$t`Reminder: ${reminderLabel}`}>
          {#each reminderChoices as minutes}
            <MenuItem label={reminderMinutesLabel(minutes)} checked={minutes == reminderMinutes}
              onClick={() => setReminderMinutesBefore(event, minutes)} />
          {/each}
        </RibbonMenuButton>
        <RibbonButton label={$t`Recurrence *=> Repetition of the event`} icon={RecurrenceIcon} shortCutInfo={$t`Ctrl+G *=> Keyboard shortcut`}
          onClick={() => { $openRecurrence = event; }} />
      </RibbonGroup>
    {/if}
  </RibbonTab>

  {#if !isIncoming}
    <RibbonTab label={schedulingLabel} bind:isSelected={isSchedulingSelected}>
      <RibbonGroup label={$t`Scheduling *=> Ribbon group to find a time when all attendees are available`}>
        <RibbonButton label={$t`Refresh Availability`} icon={RefreshIcon}
          onClick={() => { $refreshAvailabilityOf = event; }} />
      </RibbonGroup>
      <RibbonGroup label={$t`Attendees *=> Ribbon group with commands for the attendees of the meeting`}>
        <RibbonButton label={$t`Add Attendees`} icon={AddAttendeesIcon}
          tooltip={$t`Select attendees from the address book`}
          onClick={() => { $openSelectAttendees = event; }} />
      </RibbonGroup>
    </RibbonTab>
  {/if}
  {#if isSent}
    <RibbonTab label={trackingLabel} bind:isSelected={isTrackingSelected}>
      <RibbonGroup label={$t`Tracking *=> Ribbon group with the responses of the attendees`}>
        <RibbonButton label={$t`Copy Status to Clipboard`} icon={CopyIcon}
          onClick={copyTrackingStatus} />
      </RibbonGroup>
    </RibbonTab>
  {/if}
  {#if !isIncoming}
    <InsertTab {editor} bind:openedTool onAttachFile={onAddAttachment} bind:showEmojis>
      <svelte:fragment slot="include">
        <RibbonMenuButton label={$t`Signature`} icon={SignatureIcon}>
          <SignatureMenuItems identity={null} {editor} on:editSignatures={() => { $openSignatures = event; }} />
        </RibbonMenuButton>
      </svelte:fragment>
    </InsertTab>
    <FormatTextTab {editor} bind:openedTool />
    <ReviewTab {editor} bind:openedTool />
  {/if}
</Ribbon>
<FileSelector bind:this={fileSelector} />

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { InvitationResponse } from "../../../logic/Calendar/Invitation/InvitationStatus";
  import { addFilesAsAttachments } from "../../../logic/Abstract/Attachment";
  import { eventTabLabel, attendanceLabel, responseLabel } from "./EventFormInfo";
  import { reminderMinutesBefore, setReminderMinutesBefore, reminderChoicesWith, reminderMinutesLabel } from "./Reminder";
  import Ribbon from "../../Shared/Ribbon/Ribbon.svelte";
  import RibbonTab from "../../Shared/Ribbon/RibbonTab.svelte";
  import RibbonGroup from "../../Shared/Ribbon/RibbonGroup.svelte";
  import RibbonButton from "../../Shared/Ribbon/RibbonButton.svelte";
  import RibbonMenuButton from "../../Shared/Ribbon/RibbonMenuButton.svelte";
  import InsertTab from "../../Shared/Editor/InsertTab.svelte";
  import FormatTextTab from "../../Shared/Editor/FormatTextTab.svelte";
  import ReviewTab from "../../Shared/Editor/ReviewTab.svelte";
  import type { EditorTool } from "../../Shared/Editor/EditorTool";
  import type { Editor } from "@tiptap/core";
  import SignatureMenuItems from "../../Mail/Composer/SignatureMenuItems.svelte";
  import { openSignatures } from "../../Mail/Composer/SignaturesDialog.svelte";
  import FileSelector from "../../../frontend/Mail/Composer/Attachments/FileSelector.svelte";
  import { openSelectAttendees } from "./EditEvent.svelte";
  import { openRecurrence } from "./RecurrenceDialog.svelte";
  import { checkNamesOf } from "./ParticipantsBox.svelte";
  import { refreshAvailabilityOf } from "./AvailabilityGrid.svelte";
  import type { MeetAccount } from "../../../logic/Meet/MeetAccount";
  import type { EventEditFlow } from "./EventEditFlow";
  import type { InvitationResponseInMessage } from "../../../logic/Calendar/Invitation/InvitationStatus";
  import { IncomingInvitation } from "../../../logic/Calendar/Invitation/IncomingInvitation";
  import { openExternalURL } from "../../../logic/util/os-integration";
  import { appGlobal } from "../../../logic/app";
  import { openComposer } from "../../../frontend/Mail/open";
  import { selectedDate, selectedEvent, startDate } from "../../../frontend/Calendar/selected";
  import { askYesNo } from "../../Shared/Dialog/MessageBox";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import ResponseMenuItems from "../Invitation/ResponseMenuItems.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import SaveIcon from "lucide-svelte/icons/save";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import CancelIcon from "lucide-svelte/icons/calendar-x-2";
  import RemoveIcon from "lucide-svelte/icons/calendar-minus-2";
  import ForwardIcon from "lucide-svelte/icons/forward";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import ReplyAllIcon from "lucide-svelte/icons/reply-all";
  import AcceptIcon from "lucide-svelte/icons/check";
  import TentativeIcon from "lucide-svelte/icons/circle-help";
  import DeclineIcon from "lucide-svelte/icons/x";
  import OnlineMeetingIcon from "lucide-svelte/icons/video";
  import JoinIcon from "lucide-svelte/icons/log-in";
  import OfflineIcon from "lucide-svelte/icons/video-off";
  import LinkIcon from "lucide-svelte/icons/link";
  import CalendarIcon from "lucide-svelte/icons/calendar-days";
  import CheckNamesIcon from "lucide-svelte/icons/user-check";
  import AddressBookIcon from "lucide-svelte/icons/book-user";
  import InviteIcon from "lucide-svelte/icons/users-round";
  import AddAttendeesIcon from "lucide-svelte/icons/user-round-plus";
  import ReminderIcon from "lucide-svelte/icons/bell";
  import RecurrenceIcon from "lucide-svelte/icons/repeat-2";
  import RefreshIcon from "lucide-svelte/icons/refresh-cw";
  import SignatureIcon from "lucide-svelte/icons/pen-line";
  import CopyIcon from "lucide-svelte/icons/clipboard-copy";
  import { t } from "../../../l10n/l10n";

  export let event: Event;
  export let flow: EventEditFlow;
  export let editor: Editor;
  export let openedTool: EditorTool | null = null;
  export let showEmojis = false;
  export let schedulingLabel: string;
  export let trackingLabel: string;
  export let isSchedulingSelected = false;
  export let isTrackingSelected = false;
  export let onSave: () => Promise<void>;
  export let onDelete: () => Promise<void>;

  $: participants = event.participants;
  $: isMeeting = $participants.hasItems;
  $: isIncoming = $event.isIncomingMeeting;
  $: isInstance = !!$event.parentEvent;
  $: isSent = $event.isOutgoingMeeting && $event && flow.isSaved;
  $: tabLabel = $event && eventTabLabel(event);
  $: reminderMinutes = $event && reminderMinutesBefore(event);
  $: reminderLabel = reminderMinutesLabel(reminderMinutes);
  $: reminderChoices = reminderChoicesWith(reminderMinutes);
  $: saveDisabled = ($event && flow.missingPropsReason) ?? false;
  const meetAccounts = appGlobal.meetAccounts.filterObservable(account => account.canCreateURL);

  function onOnline(account: MeetAccount | null) {
    event.createOnlineMeetingWithAccount = account;
    // <copied from="../../../frontend/Calendar/EditEvent/EditEvent.svelte" expandOnlineMeeting()>
    event.isOnline = true;
    flow.inviteAttendees();
    // </copied>
    event.notifyObservers();
  }

  async function onOffline() {
    // <copied from="../../../frontend/Calendar/EditEvent/OnlineMeetingBox.svelte">
    if (event.participants.hasItems && !event.isNew && !await askYesNo($t`Online Meeting`,
        $t`Attendees who already have the meeting link might miss the meeting. Do you want to remove the online meeting?`)) {
      return;
    }
    event.isOnline = false;
    event.onlineMeetingURL = null;
    event.createOnlineMeetingWithAccount = null;
    // </copied>
    event.notifyObservers();
  }

  async function deleteSeries() {
    if (event.isOutgoingMeeting && flow.isSaved) {
      await flow.cancelMeetingSeries();
    } else {
      await flow.deleteAll();
    }
  }

  // <copied from="../../../frontend/Calendar/EditEvent/EditEvent.svelte" expandAttachments()>
  let fileSelector: FileSelector;
  async function onAddAttachment() {
    let files = await fileSelector.selectFiles();
    if (!files?.length) {
      return;
    }
    addFilesAsAttachments(event, files);
  }
  // </copied>

  async function copyTrackingStatus() {
    let lines = event.participants.contents.map(participant => [
      participant.name || participant.emailAddress,
      attendanceLabel(participant),
      responseLabel(participant),
    ].join("\t"));
    await navigator.clipboard.writeText(lines.join("\n"));
  }

  async function respond(response: InvitationResponseInMessage, sendReply: boolean) {
    await event.respondToInvitation(response, sendReply);
    flow.close();
  }

  // <copied to="../Invitation/InvitationInCalendar.svelte">
  function showInCalendar() {
    let day = new Date(event.startTime);
    flow.close();
    $selectedEvent = event;
    $selectedDate = day;
    $startDate = day;
  }
  // </copied>
</script>

<style>
  :global(.event-form-page .ribbon button.accept svg) {
    color: var(--lo-success);
  }
  :global(.event-form-page .ribbon button.decline svg) {
    color: var(--lo-danger);
  }
</style>
