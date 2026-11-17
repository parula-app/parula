{#if calendars}
  <hbox class="calendar-selector">
    <AccountDropDown
      accounts={calendars}
      bind:selectedAccount={selectedCalendar}
      filterByWorkspace={false}
      disabled={calendars.length <= 1 || !!eventInCalendar}
      icon={AccountIcon}
      />
    {#if selectedCalendar != currentCalendar}
      {blockMoves(), ""}
      <Button
        label={$t`Move`}
        onClick={() => moveToCalendar(selectedCalendar)}
        />
    {/if}
  </hbox>
{/if}
<hbox class="buttons">
  {#if incomingInvitation}
    <InvitationButtons invitation={incomingInvitation} myParticipation={incomingInvitation.myParticipation} />
  {/if}
</hbox>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { Event } from "../../../logic/Calendar/Event";
  import type { Calendar } from "../../../logic/Calendar/Calendar";
  import type { IncomingInvitation } from "../../../logic/Calendar/Invitation/IncomingInvitation";
  import InvitationButtons from "./InvitationButtons.svelte";
  import AccountDropDown from "../../Shared/AccountDropDown.svelte";
  import Button from "../../Shared/Button.svelte";
  import AccountIcon from "lucide-svelte/icons/book-user";
  import { t } from "../../../l10n/l10n";
  import { assert } from "../../../logic/util/util";

  export let message: EMail;

  $: calendars = message.folder.account.calendarsAvailable;
  let selectedCalendar: Calendar | undefined; // undefined, because `null` means "All accounts" for `<AccountDropDown>`
  let incomingInvitation: IncomingInvitation;
  let eventInCalendar: Event | undefined;

  $: $message, initCalendar(message);
  function initCalendar(message: EMail) {
    incomingInvitation = null;
    eventInCalendar = null;
    if (!message.event) {
      return; // Old messages load the event async
    }
    for (let calendar of calendars) {
      if (calendar.hasMatchingEvent(message.event)) {
        selectCalendar(calendar);
        return;
      }
    }
    selectCalendar(message.folder.account.calendar);
  }
  let currentCalendar: Calendar;
  function selectCalendar(calendar: Calendar) {
    //console.log("message", message, "default cal", message.folder.account.calendar, "available cals", message.folder.account.calendarsAvailable.contents.map(cal => cal.name))
    assert(calendar, "Need calendar");
    selectedCalendar = calendar;
    currentCalendar = calendar;
    incomingInvitation = selectedCalendar.getIncomingInvitationForEMail(message);
    eventInCalendar = incomingInvitation?.calEvent();
    //console.log("select calendar", calendar.name, "incoming invitation", incomingInvitation)
  }
  async function moveToCalendar(calendar: Calendar) {
    if (eventInCalendar && !selectedCalendar.events.some(event => event.calUID == message.event.calUID)) {
      await eventInCalendar.moveToCalendar(selectedCalendar);
    }
    selectCalendar(calendar);
  }
  /** Very HACKy workaround to prevent the user to move an event to another calendar #1280
   * Unfortunately, the [Confirm] happens in `<InvitationButtons>`, which calls `IncomingInvitation`,
   * which is not observable, and our `eventInCalendar` doesn't update, so check it now. */
  function blockMoves() {
    eventInCalendar ??= incomingInvitation?.calEvent();
    if (eventInCalendar) {
      selectedCalendar = currentCalendar;
    }
  }
</script>

<style>
  .buttons {
    align-items: center;
    justify-content: center;
    margin-block-start: 16px;
  }
  .calendar-selector {
    margin-inline-start: 12px;
  }
  .calendar-selector :global(select) {
    margin-inline-start: 8px;
  }
</style>
