<hbox class="title">
  <SectionTitle label={$t`Invite`}>
    <!--
    <hbox flex />
    <hbox class="buttons">
      <RoundButton
          label={$t`Expand dialog size to full window`}
          icon={OptionalParticipantsIcon}
          onClick={onOptionalParticipants}
          classes="plain"
          border={false}
          iconSize="16px"
          />
    </hbox>
    -->
  </SectionTitle>
</hbox>
<vbox class="participants">
  <PersonsAutocomplete persons={event.participants} placeholder={$t`Add participants`} {onAddPerson} bind:this={personsAutocomplete}>
    <hbox slot="person-pill-before-avatar" let:person={participant}>
      <ParticipantConfirmIcon {participant} />
    </hbox>
    <hbox slot="person-popup-bottom" let:person={participant}>
      <ParticipantConfirmText {participant} />
    </hbox>
    <hbox slot="result-bottom-row" let:person>
      <PersonAvailability {person} />
    </hbox>
  </PersonsAutocomplete>
</vbox>

<vbox class="availability" class:expanded={isAvailabilityExpanded} class:enlarged={isAvailabilityEnlarged}>
  <Availability {event} bind:expanded={isAvailabilityExpanded} bind:enlarged={isAvailabilityEnlarged} />
</vbox>

<script lang="ts">
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import type { Event } from "../../../logic/Calendar/Event";
  import { Participant } from "../../../logic/Calendar/Participant";
  import { InvitationResponse } from "../../../logic/Calendar/Invitation/InvitationStatus";
  import PersonsAutocomplete from "../../Contacts/PersonAutocomplete/PersonsAutocomplete.svelte";
  import PersonAvailability from "./PersonAvailability.svelte";
  import ParticipantConfirmIcon from "./ParticipantConfirmIcon.svelte";
  import ParticipantConfirmText from "./ParticipantConfirmText.svelte";
  import Availability from "./Availability/Availability.svelte";
  import SectionTitle from "./SectionTitle.svelte";
  import { showError } from "../../Util/error";
  // import OptionalParticipantsIcon from "lucide-svelte/icons/circle-dashed";
  import { t } from "../../../l10n/l10n";

  export let event: Event;
  /** Whether the availability is shown
   * out */
  export let isAvailabilityExpanded = false;
  /** Whether the availability fills the dialog
   * in/out */
  export let isAvailabilityEnlarged = false;

  let personsAutocomplete: PersonsAutocomplete;
  export function focus() {
    personsAutocomplete.focus();
  }

  function onAddPerson(person: PersonUID) {
    let participant = new Participant(person.emailAddress, person.name, InvitationResponse.Unknown);
    participant.person = person.findPerson(); // GAL entry is in no cached address book
    event.participants.add(participant);
    participant.person?.fetchEncryptionKeys()
      .catch(showError);
  }
</script>

<style>
  /*.buttons {
    align-items: center;
    padding: 8px;
  }*/
  .participants :global(.participant-status-icon) {
    margin-inline-start: -4px;
    margin-inline-end: 6px;
  }
  .participants :global(.person:has(.declined) .name) {
    text-decoration: line-through;
  }
  .availability {
    margin-block-start: 18px;
  }
  .availability.expanded {
    flex: 1 0 auto;
  }
  .availability.enlarged {
    flex: 1 1 0;
    min-height: 0;
  }
</style>
