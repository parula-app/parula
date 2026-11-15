<hbox class="buttons">
  {#if $message.invitationMessage == InvitationMessage.ParticipantReply }
    <vbox class="participant-reply">
      {#if $message.outgoing}
        {$t`You responded to the invitation:`}
      {:else}
        {$t`${$message.from.name} has responded to your invitation:`}
      {/if}
      <hbox class="status font-large">
        {#if participant}
          <ParticipantConfirmIcon {participant} size={24} />
          <ParticipantConfirmText {participant} />
        {/if}
      </hbox>
    </vbox>
  {:else if $message.invitationMessage == InvitationMessage.CancelledEvent }
    <hbox class="cancelled-text">
      {$t`This meeting has been cancelled by the organizer`}
    </hbox>
  {/if}
</hbox>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { InvitationMessage } from "../../../logic/Calendar/Invitation/InvitationStatus";
  import ParticipantConfirmIcon from "../EditEvent/ParticipantConfirmIcon.svelte";
  import ParticipantConfirmText from "../EditEvent/ParticipantConfirmText.svelte";
  import { t } from "../../../l10n/l10n";

  export let message: EMail;

  $: participant = $message.event?.participants.find(p => p.matches($message.from));
</script>

<style>
  .buttons {
    align-items: center;
    justify-content: center;
    margin-block-start: 16px;
  }
  .participant-reply .status {
    align-items: center;
    margin-block-start: 4px;
  }
  .participant-reply .status :global(.participant-status-text) {
    padding: 0;
    padding-inline-start: 8px;
    font-size: inherit;
    font-weight: 500;
  }
  .participant-reply .status :global(.participant-status-icon) {
    font-size: inherit;
  }
</style>
