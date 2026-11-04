<span class="response-icon {kind}" title={label}>
  <svelte:component this={icon} {size} />
</span>

<script lang="ts">
  import type { Participant } from "../../../logic/Calendar/Participant";
  import { InvitationResponse } from "../../../logic/Calendar/Invitation/InvitationStatus";
  import { responseText } from "./EventFormInfo";
  import AcceptedIcon from "lucide-svelte/icons/circle-check";
  import TentativeIcon from "lucide-svelte/icons/circle-help";
  import DeclinedIcon from "lucide-svelte/icons/circle-x";
  import NoResponseIcon from "lucide-svelte/icons/clock-3";
  import OrganizerIcon from "lucide-svelte/icons/user-round";
  import { t } from "../../../l10n/l10n";

  export let participant: Participant;
  export let size = 16;

  $: response = $participant.response;
  $: kind = kindOf(response);
  $: icon = iconOf(response);
  $: label = response == InvitationResponse.Organizer
    ? $t`Meeting Organizer`
    : responseText(response);

  function kindOf(response: InvitationResponse): string {
    switch (response) {
    case InvitationResponse.Organizer:
      return "organizer";
    case InvitationResponse.Accept:
      return "accepted";
    case InvitationResponse.Tentative:
      return "tentative";
    case InvitationResponse.Decline:
      return "declined";
    }
    return "none";
  }

  function iconOf(response: InvitationResponse): ConstructorOfATypedSvelteComponent {
    switch (response) {
    case InvitationResponse.Organizer:
      return OrganizerIcon;
    case InvitationResponse.Accept:
      return AcceptedIcon;
    case InvitationResponse.Tentative:
      return TentativeIcon;
    case InvitationResponse.Decline:
      return DeclinedIcon;
    }
    return NoResponseIcon;
  }
</script>

<style>
  .response-icon {
    display: inline-flex;
    flex-shrink: 0;
    color: var(--lo-fg-secondary);
  }
  .organizer {
    color: var(--lo-accent-text);
  }
  .accepted {
    color: var(--lo-success);
  }
  .tentative,
  .none {
    color: var(--lo-warning);
  }
  .declined {
    color: var(--lo-danger);
  }
</style>
