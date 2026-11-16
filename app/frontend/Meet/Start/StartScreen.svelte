<hbox class="top">
  <hbox class="buttons">
    <RoundButton
      label={$t`Start a new meeting`}
      onClick={startAdHocMeeting}
      errorCallback={showError}
      icon={PlusIcon}
      iconSize="24px"
      border={false}
      classes="plain primary create" />
    <RoundButton
      label={$t`Plan a meeting`}
      onClick={addToCalendar}
      errorCallback={showError}
      icon={AddToCalendarIcon}
      iconSize="24px"
      border={false}
      classes="plain primary" />
    {#if havePhoneAccount}
      <RoundButton
        label={isPhoneDial ? $t`Video conference` : $t`Make a phone call`}
        onClick={() => isPhoneDial = !isPhoneDial}
        errorCallback={showError}
        icon={isPhoneDial ? VideoConfIcon : PhoneCallIcon}
        iconSize="24px"
        border={false}
        classes="plain primary" />
    {/if}
  </hbox>
  <hbox flex />
  <vbox class="payment-bar-container">
    <vbox class="payment-bar">
      <PaymentBar account={selectedAccount} showWhenNoAccount={true}
      neverLicensedText={$t`If you want to test our video conferences, you can buy a license from us`} />
    </vbox>
  </vbox>
  <hbox flex />
  <AccountDropDown
    accounts={appGlobal.meetAccounts.filterObservable(acc => !(acc instanceof PhoneAccount))}
    bind:selectedAccount
    filterByWorkspace={true} />
</hbox>
<hbox flex class="main">
  <vbox flex class="actions-container background-pattern">
    <vbox class="actions">
      {#if $selectedPerson}
        <Button label={$t`Call ${$selectedPerson.name}`} onClick={() => callSelected($selectedPerson)} errorCallback={showError} classes="call-person secondary">
          <PersonPicture slot="icon" person={$selectedPerson} size={24} />
        </Button>
      {/if}
      <Button
        label={$t`Start a new meeting`}
        icon={PlusIcon}
        onClick={startAdHocMeeting}
        errorCallback={showError}
        classes="primary filled" />
      <!--
      <Button
        label={$t`Plan a meeting`}
        icon={AddToCalendarIcon}
        onClick={addToCalendar}
        classes="secondary" iconSize="14px" />
      -->
      <hbox>
        <input class="meeting-link" type="url" bind:value={conferenceURL}
          placeholder={$t`Enter meeting link to join`}
          on:input={() => errorMsg = null}
          on:paste={() => catchErrors(joinURLPasted, showError)}
          on:keydown={event => onKeyEnter(event, () => catchErrors(() => joinByURL(conferenceURL), showError))} />
        <Button label={$t`Join`} classes="secondary"
          disabled={!conferenceURL}
          onClick={() => joinByURL(conferenceURL)}
          errorCallback={showError} />
      </hbox>
    </vbox>
    <vbox class="error">
      {#if errorMsg}
        <ErrorMessage bind:errorMessage={errorMsg} errorGravity={ErrorGravity.Error} />
      {/if}
    </vbox>
  </vbox>
  <vbox flex class="meetings">
    <vbox flex />
    <vbox flex class="upcoming">
      <hbox class="title font-small">{$t`Today's next meetings`}</hbox>
      <MeetingList meetings={upcomingMeetings}
        onClick={joinMeetingEvent}>
        <div slot="emptyMsg" class="emptyMsg font-small">{$t`No meetings`}</div>
      </MeetingList>
    </vbox>
    {#if !appGlobal.isMobile}
      <vbox flex class="previous">
        <hbox class="title font-small">{$t`Previous meetings`}</hbox>
        <MeetingList meetings={previousMeetings}
          onClick={openEvent}>
          <div slot="emptyMsg" class="emptyMsg font-small">{$t`No meetings`}</div>
        </MeetingList>
      </vbox>
    {/if}
    <vbox flex />
    <hbox class="test">
      <ExpandSection>
        <vbox class="buttons">
          {#if $selectedPerson}
            <Button label={$t`Test incoming call`} icon={VideoIcon} onClick={() => testIncoming($selectedPerson)} errorCallback={showError} classes="secondary" />
          {/if}
          <Button label={$t`Start a fake meeting`} icon={VideoIcon} onClick={startFakeMeeting} errorCallback={showError} classes="secondary" />
        </vbox>
      </ExpandSection>
    </hbox>
  </vbox>
</hbox>
{#if $appGlobal.isMobile}
  <StartBarM {selectedAccount} />
{/if}
<WorkspaceSearchBar compact />

<script lang="ts">
  import WorkspaceSearchBar from "../../MainWindow/WorkspaceSearchBar.svelte";
  import { startAdHocMeeting, callSelected, joinByURL, startFakeMeeting, testIncoming, createMustangMeetAccountIfPossible } from "./start";
  import { PhoneAccount } from "../../../logic/Meet/PhoneAccount";
  import { selectedPerson } from "../../Contacts/Person/Selected";
  import { meetMustangApp } from "../MeetMustangApp";
  import { selectedApp } from "../../AppsBar/selectedApp";
  import { Event } from "../../../logic/Calendar/Event";
  import { Calendar } from "../../../logic/Calendar/Calendar";
  import { openEvent } from "../../Calendar/open";
  import { setNewEventTime } from "../../Calendar/event";
  import { appGlobal } from "../../../logic/app";
  import MeetingList from "./MeetingList.svelte";
  import StartBarM from "./StartBarM.svelte";
  import PersonPicture from "../../Contacts/Person/PersonPicture.svelte";
  import ExpandSection from "../../Shared/ExpandSection.svelte";
  import ErrorMessage, { ErrorGravity } from "../../Shared/ErrorMessage.svelte";
  import PaymentBar from "../../Settings/License/Banner/PaymentBar.svelte";
  import AccountDropDown from "../../Shared/AccountDropDown.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import Button from "../../Shared/Button.svelte";
  import VideoIcon from 'lucide-svelte/icons/video';
  import PlusIcon from 'lucide-svelte/icons/plus';
  import AddToCalendarIcon from "lucide-svelte/icons/calendar-plus";
  import PhoneCallIcon from "lucide-svelte/icons/phone";
  import VideoConfIcon from "lucide-svelte/icons/video";
  import { catchErrors, logErrorToServer } from "../../Util/error";
  import { onKeyEnter } from "../../Util/util";
  import { assert, sleep } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";
  import { onMount } from "svelte";

  export let isPhoneDial = false;

  const now = new Date();
  const maxUpcoming = new Date();
  maxUpcoming.setHours(23); // today
  maxUpcoming.setMinutes(59);
  const maxPrevious = new Date();
  maxPrevious.setDate(maxPrevious.getDate() - 14); // last 14 days
  const upcomingMeetings = appGlobal.calendarEvents.filterObservable(event => event.startTime > now && event.startTime < maxUpcoming);
  const previousMeetings = appGlobal.calendarEvents.filterObservable(event => event.startTime < now && event.startTime > maxPrevious).reverse();

  let selectedAccount = appGlobal.meetAccounts.first;
  let conferenceURL: string;

  async function joinURLPasted() {
    await sleep(0.1); // paste event fires before the input event, which clears the error
    await joinByURL(conferenceURL);
  }

  async function joinMeetingEvent(meeting: Event) {
    assert(meeting?.onlineMeetingURL, $t`Not an online meeting, or no join URL known`);
    await joinByURL(meeting.onlineMeetingURL);
  }

  function addToCalendar() {
    let calendar = selectedAccount?.mainAccount?.dependentAccounts().find(acc => acc instanceof Calendar) as Calendar
      ?? appGlobal.calendars.first;
    assert(calendar, $t`Please set up a calendar first`);
    let event = calendar.newEvent();
    setNewEventTime(event, false, new Date());
    openEvent(event);
  }

  let errorMsg: string | null = null;

  function showError(ex: Error) {
    errorMsg = ex.message ?? ex + "";
    logErrorToServer(ex);
  }

  $selectedApp = meetMustangApp;
  let meetAccounts = appGlobal.meetAccounts;
  $: havePhoneAccount = $meetAccounts.some(acc => acc instanceof PhoneAccount);

  onMount(() => catchErrors(createMustangMeetAccountIfPossible));
</script>

<style>
  .top {
    margin: 12px;
  }
  .buttons {
    column-gap: 12px;
    margin-inline-start: 8px;
    margin-block-start: 4px;
  }
  .actions-container {
    align-items: center;
    justify-content: center;
    flex: 2 0 0;
  }
  .actions :global(> *) {
    margin-block-start: 12px;
  }
  .actions :global(.call-person .avatar) {
    margin: -4px 0px;
  }
  .actions-container .error {
    position: absolute;
    bottom: 100px;
  }
  .test {
    align-self: end;
  }
  .test:not(:hover) :global(.buttons.top-right) {
    visibility: hidden;
  }
  .test .buttons {
    margin-block-end: 12px;
    margin-inline-end: 12px;
    row-gap: 8px;
  }
  .meeting-link {
    margin-inline-end: 4px;
  }
  .meetings {
    justify-content: center;
  }
  .upcoming,
  .previous {
    justify-content: center;
  }
  .title {
    font-weight: bold;
    margin-block-end: 12px;
  }
  .emptyMsg {
    color: grey;
  }
  @media (max-width: 800px) {
    .main {
      flex-direction: column;
    }
    .meetings {
      order: 1;
      align-items: center;
    }
  .emptyMsg {
    text-align: center;
  }
    .actions-container {
      order: 2;
    }
  }
  .payment-bar-container {
    justify-content: end;
  }
  .payment-bar {
    border-radius: 24px;
    border: 1px solid var(--border);
  }
</style>
