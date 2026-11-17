<hbox class="invitation buttons">
  {#if myParticipation == InvitationResponse.Organizer}
    {$t`You sent this invitation`}
  {:else if myParticipation == InvitationResponse.Accept}
    <Button
      label={$t`Confirmed *=> A meeting request has been confirmed by you`}
      icon={AcceptIcon}
      selected={true}
      onClick={onOpenInCalendar}
      classes="accept done font-normal" />
    <ButtonMenu buttonIcon={ChevronDownIcon}>
      <MenuItem
        label={$t`Change to Reject *=> not attend the meeting`}
        onClick={onDecline}
        icon={DeclineIcon}
        classes="decline font-normal" />
      <MenuItem
        label={$t`Change to Reject silently *=> not attend the meeting, without sending a reply to the organizer`}
        onClick={onDeclineWithoutReply}
        icon={DeclineIcon}
        classes="decline font-normal" />
      <MenuItem
        label={$t`Change to Maybe *=> Maybe attend the meeting`}
        onClick={onTentative}
        icon={MaybeIcon}
        classes="maybe font-normal" />
      <MenuItem
        label={$t`Reply to organizer`}
        onClick={onReplyToOrganizer}
        icon={ReplyIcon}
        classes="reply font-normal" />
      <MenuItem
        label={$t`Reply to all attendees`}
        onClick={onReplyToAll}
        icon={ReplyAllIcon}
        classes="reply-all font-normal" />
      <MenuItem
        label={$t`Invite other people`}
        onClick={onForward}
        icon={ForwardIcon}
        classes="forward font-normal" />
    </ButtonMenu>
  {:else if myParticipation == InvitationResponse.Decline}
    <Button
      label={$t`Rejected *=> A meeting request has been declined by you`}
      icon={DeclineIcon}
      selected={true}
      onClick={onOpenInCalendar}
      classes="decline done font-normal" />
    <ButtonMenu buttonIcon={ChevronDownIcon}>
      <MenuItem
        label={$t`Change to Accept *=> attend the meeting`}
        onClick={onAccept}
        icon={AcceptIcon}
        classes="accept font-normal" />
      <MenuItem
        label={$t`Change to Accept silently *=> attend the meeting, without sending a reply to the organizer`}
        onClick={onAcceptWithoutReply}
        icon={AcceptIcon}
        classes="accept font-normal" />
      <MenuItem
        label={$t`Change to Maybe *=> Maybe attend the meeting`}
        onClick={onTentative}
        icon={MaybeIcon}
        classes="maybe font-normal" />
      <MenuItem
        label={$t`Reply to organizer`}
        onClick={onReplyToOrganizer}
        icon={ReplyIcon}
        classes="reply font-normal" />
      <MenuItem
        label={$t`Reply to all attendees`}
        onClick={onReplyToAll}
        icon={ReplyAllIcon}
        classes="reply-all font-normal" />
      <MenuItem
        label={$t`Invite other people`}
        onClick={onForward}
        icon={ForwardIcon}
        classes="forward font-normal" />
    </ButtonMenu>
  {:else}
    <Button
      label={$t`Confirm *=> Confirm to attend the meeting`}
      onClick={onAccept}
      icon={AcceptIcon}
      classes="accept font-normal" />
    <Button
      label={$t`Reject *=> Decline to attend the meeting`}
      onClick={onDecline}
      icon={DeclineIcon}
      classes="decline secondary font-normal" />
    <ButtonMenu buttonIcon={ChevronDownIcon}>
      <MenuItem
        label={$t`Confirm silently *=> Add the meeting invitation to my calendar without sending a reply to the organizer`}
        onClick={onAcceptWithoutReply}
        icon={AcceptIcon}
        classes="accept font-normal" />
      <MenuItem
        label={$t`Reject silently *=> Decline the meeting invitation without sending a reply to the organizer`}
        onClick={onDeclineWithoutReply}
        icon={DeclineIcon}
        classes="decline font-normal" />
      <MenuItem
        label={$t`Maybe *=> Maybe attend the meeting`}
        onClick={onTentative}
        icon={MaybeIcon}
        classes="maybe font-normal" />
      <MenuItem
        label={$t`Reply to organizer`}
        onClick={onReplyToOrganizer}
        icon={ReplyIcon}
        classes="reply font-normal" />
      <MenuItem
        label={$t`Reply to all attendees`}
        onClick={onReplyToAll}
        icon={ReplyAllIcon}
        classes="reply-all font-normal" />
      <MenuItem
        label={$t`Invite other people`}
        onClick={onForward}
        icon={ForwardIcon}
        classes="forward font-normal" />
    </ButtonMenu>
  {/if}
</hbox>

<script lang="ts">
  import { Event } from "../../../logic/Calendar/Event";
  import { IncomingInvitation } from "../../../logic/Calendar/Invitation/IncomingInvitation";
  import { InvitationResponse, type InvitationResponseInMessage } from "../../../logic/Calendar/Invitation/InvitationStatus";
  import type { EMail } from "../../../logic/Mail/EMail";
  import { openEvent } from "../open";
  import { openComposer } from "../../Mail/open";
  import ButtonMenu from "../../Shared/Menu/ButtonMenu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import Button from "../../Shared/Button.svelte";
  import AcceptIcon from "lucide-svelte/icons/check-check";
  import DeclineIcon from "lucide-svelte/icons/x";
  import MaybeIcon from "lucide-svelte/icons/circle-help";
  import ForwardIcon from "lucide-svelte/icons/forward";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import ReplyAllIcon from "lucide-svelte/icons/reply-all";
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
  import { NotReached } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";

  export let myParticipation: InvitationResponse = InvitationResponse.NoResponseReceived;
  export let invitation: IncomingInvitation | Event;

  async function respond(response: InvitationResponseInMessage, sendReply = true) {
    //console.log("respond", invitation)
    myParticipation = response;
    if (invitation instanceof Event) {
      await invitation.respondToInvitation(response, sendReply);
      // Exchange responds and then drops the declined occurrence, so don't save it back
    } else if (invitation instanceof IncomingInvitation) {
      await invitation.respondToInvitationFromMail(response, sendReply);
    } else {
      throw new NotReached();
    }
  }

  async function onAccept() {
    await respond(InvitationResponse.Accept);
  }
  async function onTentative() {
    await respond(InvitationResponse.Tentative);
  }
  async function onDecline() {
    await respond(InvitationResponse.Decline);
  }
  async function onAcceptWithoutReply() {
    await respond(InvitationResponse.Accept, false);
  }
  async function onDeclineWithoutReply() {
    await respond(InvitationResponse.Decline, false);
  }

  async function onOpenInCalendar() {
    //console.log("open in cal", invitation);
    let calEvent: Event
    if (invitation instanceof IncomingInvitation) {
      calEvent = invitation.calEvent();
      if (!calEvent) {
        return;
      }
    } else if (invitation instanceof Event) {
      calEvent = invitation;
    } else {
      throw new NotReached();
    }
    openEvent(calEvent);
  }

  function onReplyToOrganizer() {
    let mail: EMail;
    if (invitation instanceof IncomingInvitation) {
      mail = invitation.message.compose.replyToAuthor();
    } else if (invitation instanceof Event) {
      mail = IncomingInvitation.replyToEventByMail(invitation, false);
    }
    openComposer(mail);
  }

  function onReplyToAll() {
    let mail: EMail;
    if (invitation instanceof IncomingInvitation) {
      mail = invitation.message.compose.replyAll();
    } else if (invitation instanceof Event) {
      mail = IncomingInvitation.replyToEventByMail(invitation, true);
    }
    openComposer(mail);
  }

  async function onForward() {
    let mail: EMail;
    if (invitation instanceof IncomingInvitation) {
      mail = await invitation.message.compose.forward();
    } else if (invitation instanceof Event) {
      mail = await IncomingInvitation.forwardEventByMail(invitation);
    }
    openComposer(mail);
  }
</script>

<style>
  .buttons {
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
  }
  .buttons > :global(button) {
    margin-inline-start: 12px;
    margin-block-start: 16px;
  }
  .buttons :global(button.menu-button) {
    margin-inline-start: 4px;
    position: absolute;
  }
  .buttons :global(button .label) {
    margin-inline-end: 6px;
  }
  .buttons > :global(button.accept) {
    color: #1B8022;
    background-color: #AAE3D2;
  }
  .buttons :global(button.accept:not(.menuitem)),
  .buttons :global(button.menuitem.accept .icon) {
    color: #1B8022;
  }
  .buttons :global(button.decline:not(.menuitem)) {
    color: #FE1B1B;
    border-color: #F69FA1;
  }
  .buttons :global(button.menuitem.decline .icon) {
    color: #FE1B1B;
  }
  .buttons :global(button.accept.done) {
    color: white;
    background-color: #36957A;
    opacity: 100%;
  }
  .buttons :global(button.decline.done) {
    color: white;
    background-color: #A86F69;
    opacity: 100%;
  }
</style>
