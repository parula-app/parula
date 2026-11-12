<ResponseButton label={$t`Yes *=> Accept the invitation to the meeting`} icon={AcceptIcon} classes="accept"
  tooltip={$t`Accept the invitation to the meeting`}
  pressed={response == InvitationResponse.Accept}
  onClick={() => onRespond(InvitationResponse.Accept, true)} />
<ResponseButton label={$t`No *=> Decline the invitation to the meeting`} icon={DeclineIcon} classes="decline"
  tooltip={$t`Decline the invitation to the meeting`}
  pressed={response == InvitationResponse.Decline}
  onClick={() => onRespond(InvitationResponse.Decline, true)} />
<ResponseButton label={$t`More options *=> More ways to respond to the meeting invitation`} icon={MoreIcon} iconOnly
  pressed={response == InvitationResponse.Tentative}>
  <MenuItem label={$t`Accept silently *=> Add the meeting invitation to my calendar without sending a reply to the organizer`}
    icon={AcceptIcon} classes="accept"
    onClick={() => onRespond(InvitationResponse.Accept, false)} />
  <MenuItem label={$t`Decline silently *=> Decline the meeting invitation without sending a reply to the organizer`}
    icon={DeclineIcon} classes="decline"
    onClick={() => onRespond(InvitationResponse.Decline, false)} />
  <MenuItem label={$t`Tentative *=> Not sure to join this business meeting`} icon={TentativeIcon}
    checked={response == InvitationResponse.Tentative}
    onClick={() => onRespond(InvitationResponse.Tentative, true)} />
  <MenuDivider />
  <MenuItem label={$t`Reply to organizer`} icon={ReplyIcon} onClick={onReplyToOrganizer} />
  <MenuItem label={$t`Reply to all attendees`} icon={ReplyAllIcon} onClick={onReplyToAll} />
  <MenuItem label={$t`Forward meeting`} icon={ForwardIcon} onClick={onForward} />
</ResponseButton>

<script lang="ts">
  import { InvitationResponse, type InvitationResponseInMessage } from "../../../logic/Calendar/Invitation/InvitationStatus";
  import ResponseButton from "./ResponseButton.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import AcceptIcon from "lucide-svelte/icons/check";
  import TentativeIcon from "lucide-svelte/icons/circle-help";
  import DeclineIcon from "lucide-svelte/icons/x";
  import MoreIcon from "lucide-svelte/icons/ellipsis";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import ReplyAllIcon from "lucide-svelte/icons/reply-all";
  import ForwardIcon from "lucide-svelte/icons/forward";
  import { t } from "../../../l10n/l10n";

  export let response: InvitationResponse;
  export let onRespond: (response: InvitationResponseInMessage, sendReply: boolean) => Promise<void> | void;
  export let onReplyToOrganizer: () => Promise<void> | void;
  export let onReplyToAll: () => Promise<void> | void;
  export let onForward: (event: Event) => Promise<void> | void;
</script>
