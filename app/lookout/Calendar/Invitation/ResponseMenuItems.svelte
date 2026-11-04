<MenuItem label={$t`Send the Response Now`} icon={SendIcon} {checked}
  onClick={() => onRespond(true)} />
<MenuItem label={silentLabel(response)} icon={NoResponseIcon}
  onClick={() => onRespond(false)} />

<script lang="ts">
  import { InvitationResponse, type InvitationResponseInMessage } from "../../../logic/Calendar/Invitation/InvitationStatus";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import SendIcon from "lucide-svelte/icons/send";
  import NoResponseIcon from "lucide-svelte/icons/mail-x";
  import { t } from "../../../l10n/l10n";

  export let response: InvitationResponseInMessage;
  export let checked = false;
  export let onRespond: (sendReply: boolean) => Promise<void> | void;

  function silentLabel(response: InvitationResponseInMessage): string {
    switch (response) {
    case InvitationResponse.Accept:
      return $t`Accept silently *=> Add the meeting invitation to my calendar without sending a reply to the organizer`;
    case InvitationResponse.Decline:
      return $t`Decline silently *=> Decline the meeting invitation without sending a reply to the organizer`;
    }
    return $t`Tentative silently *=> Answer "maybe" to the meeting invitation without sending a reply to the organizer`;
  }
</script>
