<NotificationBar {notifications} />
<hbox class="persons-toolbar">
  <PersonAutocomplete
    bind:typedText={searchText}
    placeholder={$t`Add or search a participant`}
    onAddPerson={person => catchErrors(() => addPerson(person), showError)}
    autofocus={false}
    />
  <hbox class="buttons">
    <!--
    <RoundButton
      label={$t`Invite person to the meeting`}
      onClick={addPerson}
      icon={AddIcon}
      iconSize="16px"
      />
    -->
    <RoundButton
      label={$t`Copy invitation link`}
      classes="invite-participant"
      onClick={copyInvitationLink}
      disabled={!meeting.account.canCreateURL}
      icon={InviteUserIcon}
      iconSize="16px"
      padding="6px"
      />
  </hbox>
</hbox>

<script lang="ts">
  import type { VideoConfMeeting } from "../../../logic/Meet/VideoConfMeeting";
  import { MeetingParticipant } from "../../../logic/Meet/Participant";
  import { invitePerson } from "../../../logic/Meet/Invite";
  import type { Notification } from "../../../logic/util/Notification";
  import { showNotificationError, showNotificationToast } from "../../MainWindow/Notification";
  import PersonAutocomplete from "../../Contacts/PersonAutocomplete/PersonAutocomplete.svelte";
  import NotificationBar from "../../MainWindow/NotificationBar.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import AddIcon from "lucide-svelte/icons/plus";
  import InviteUserIcon from "lucide-svelte/icons/link";
  import { assert } from "../../../logic/util/util";
  import { gt, t } from "../../../l10n/l10n";
  import { catchErrors } from "../../Util/error";
  import { PersonUID } from "../../../logic/Abstract/PersonUID";
  import { ArrayColl } from "svelte-collections";

  export let meeting: VideoConfMeeting;
  export let selected: MeetingParticipant;

  $: participants = meeting.participants;
  let searchText: string;

  $: searchParticipant(searchText)
  function searchParticipant(searchText: string) {
    if (!searchText || searchText.length < 2) {
      return;
    }
    let searchLower = searchText.toLowerCase()
    let match = participants.find(p => p.name?.toLowerCase().startsWith(searchLower));
    if (!match) {
      match = participants.find(p => p.name?.toLowerCase().includes(searchLower));
    }
    if (!match) {
      return;
    }
    selected = match;
  }

  async function addPerson(person: PersonUID) {
    let participant = new MeetingParticipant();
    participant.name = person.name;
    meeting.invited.add(participant);

    await invitePerson(person, meeting);

    showNotificationToast(gt`We've sent an invitation to ${person.name}`, notifications);
  }

  async function copyInvitationLink() {
    assert(meeting.account.canCreateURL, gt`I cannot invite using a link to this kind of meeting`);
    let invitationURL = await meeting.createInvitationURL();
    await navigator.clipboard.writeText(invitationURL);
  }

  $: $participants, removeJoinedParticipant()
  function removeJoinedParticipant() {
    for (let invited of meeting.invited.contents) { // copy: remove alters invited
      if (participants.find(p => p.name == invited.name)) {
        meeting.invited.remove(invited);
      }
    }
  }

  let notifications = new ArrayColl<Notification>();

  function showError(ex: Error) {
    showNotificationError(ex, notifications);
  }
</script>

<style>
  .persons-toolbar {
    margin: 16px;
    align-items: center;
    color-scheme: dark;
  }
  .persons-toolbar :global(.person-autocomplete) {
    height: 30px;
  }
  .persons-toolbar :global(input) {
    padding: 0px 16px !important;
    border: 1px solid #8D8995;
    border-radius: 16px;
    background-color: #5C5768;
    color: white;
  }
  .persons-toolbar :global(input::placeholder) {
    color: white;
  }
  .persons-toolbar :global(.autocomplete-list) {
    color-scheme: dark;
  }
  .buttons {
    margin-inline-start: 12px;
  }
  .buttons :global(button) {
    margin-inline-end: 4px;
  }
  .buttons :global(button.invite-participant) {
    background-color: transparent;
    color: white;
  }
</style>
