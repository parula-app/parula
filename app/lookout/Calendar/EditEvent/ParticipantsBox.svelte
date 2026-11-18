<hbox class="attendees-field" class:read-only={readOnly}>
  <MailAutocomplete addresses={recipients} label={$t`Required *=> Attendees who must attend the meeting`} chips={$ribbonLayout.value == "simplified"}
    disabled={readOnly} {autofocus} askForName bind:this={addressField} />
</hbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import type { RibbonLayout } from "../../Shared/Ribbon/RibbonGroup";
  import { InvitationResponse } from "../../../logic/Calendar/Invitation/InvitationStatus";
  import { EventEditFlow } from "./EventEditFlow";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import MailAutocomplete from "../../Mail/Composer/MailAutocomplete.svelte";
  import { ArrayColl } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  export let event: Event;
  export let flow: EventEditFlow;
  export let readOnly = false;
  export let autofocus = false;

  const ribbonLayout = getLocalStorage<RibbonLayout>("lookout.ribbon.layout", "classic");
  let addressField: MailAutocomplete;

  $: attendees = event.participants.filterObservable(participant => participant.response != InvitationResponse.Organizer);
  let recipients = new ArrayColl<PersonUID>([...new Set(flow.attendees)]);

  $: takeAttendees($attendees.contents);
  function takeAttendees(current: PersonUID[]) {
    let participants = [...new Set(current)];
    if (participants.length != recipients.length || participants.some(participant => !recipients.contains(participant))) {
      recipients.replaceAll(participants);
    }
  }

  $: giveRecipients($recipients.contents);
  function giveRecipients(current: PersonUID[]) {
    if (!EventEditFlow.sameAddresses(current, flow.attendees)) {
      flow.setAttendees(current);
    }
  }

  export async function checkNames() {
    await addressField?.checkNames();
  }
</script>

<style>
  .attendees-field {
    flex: 1 1 0;
    min-width: 0;
  }
</style>
