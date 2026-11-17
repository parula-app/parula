<hbox class="top">
  <hbox class="buttons">
    <RoundButton
      label={$t`Video conference`}
      onClick={() => isPhoneDial = false}
      errorCallback={showError}
      icon={VideoConfIcon}
      iconSize="24px"
      border={false}
      classes="plain primary" />
  </hbox>
  <hbox flex />
  <AccountDropDown
    accounts={appGlobal.meetAccounts.filterObservable(acc => acc instanceof PhoneAccount)}
    bind:selectedAccount
    filterByWorkspace={true} />
</hbox>
<hbox flex class="main">
  <vbox flex class="actions-container">
    <vbox class="actions">
      <hbox>
        <input class="phone-number" type="url" bind:value={phoneNumber}
          placeholder={$t`Enter phone number`}
          autofocus={!appGlobal.isMobile}
          on:input={() => errorMsg = null}
          on:paste={() => catchErrors(callPhoneNumberPasted, showError)}
          on:keydown={event => onKeyEnter(event, () => catchErrors(() => callPhoneNumber(phoneNumber), showError))} />
      </hbox>
      <hbox flex />
      <vbox class="dialpad">
        <DialPad on:digit={ev => catchErrors(() => onDigitPressed(ev.detail), showError)} />
        <hbox class="dial buttons">
          <RoundButton
            label={$t`Remove last digit`}
            icon={BackspaceIcon}
            iconSize="22px"
            padding="12px"
            onClick={() => phoneNumber = phoneNumber.substring(0, phoneNumber.length -1)}
            errorCallback={showError}
            classes="backspace" />
          <hbox flex />
          <RoundButton
            label={$t`Call`}
            icon={CallIcon}
            iconSize="22px"
            padding="12px"
            onClick={() => callPhoneNumber(phoneNumber)}
            errorCallback={showError}
            disabled={!isPhoneNumberValid}
            classes="call secondary" />
        </hbox>
      </vbox>
      <hbox flex />
      <hbox class="contact-search">
        <PersonAutocomplete
          placeholder={$t`Enter contact name`}
          onAddPerson={personUID => callPerson(personUID.findPerson())}
          skipPersonFunc={personUID => !personUID.findPerson()?.phoneNumbers.hasItems}
          />
      </hbox>
      <hbox flex />
      <vbox>
        {#if $selectedPerson?.phoneNumbers.hasItems}
          <Button label={$t`Call ${$selectedPerson.name}`} onClick={() => callPerson($selectedPerson)} errorCallback={showError} classes="call-person">
            <PersonPicture slot="icon" person={$selectedPerson} size={24} />
          </Button>
        {/if}
      </vbox>
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
      <Scroll>
        {#each $upcomingMeetings.each as meeting}
          {#each meeting.participants.getIndexRange(0, 10) as personUID}
            {@const person = personUID.findPerson()}
            {#if person}
              <Clickable onClick={() => callPerson(person)}>
                <hbox class="person">
                  {person.name}
                </hbox>
                <hbox class="time">
                  {getTimeString(meeting.startTime)}
                </hbox>
                <hbox class="title">
                  {meeting.title.substring(0, 20) + "…"}
                </hbox>
              </Clickable>
            {/if}
          {/each}
        {/each}
      </Scroll>
    </vbox>
    {#if previousCalls.hasItems}
      <vbox class="previous">
        <hbox class="title font-small">{$t`Previous calls`}</hbox>
        <Scroll>
          {#each previousCalls as personUID}
            <Clickable onClick={() => callPhoneNumber(personUID.emailAddress)}>
              <hbox class="person">
                {personUID.name}
              </hbox>
            </Clickable>
          {/each}
        </Scroll>
      </vbox>
    {/if}
    <vbox flex />
  </vbox>
</hbox>
{#if $appGlobal.isMobile}
  <StartBarM {selectedAccount} />
{/if}

<script lang="ts">
  import { joinByURL } from "../start";
  import { PhoneAccount } from "../../../../logic/Meet/PhoneAccount";
  import { PhoneCall } from "../../../../logic/Meet/PhoneCall";
  import type { Person } from "../../../../logic/Abstract/Person";
  import type { PersonUID } from "../../../../logic/Abstract/PersonUID";
  import { selectedPerson } from "../../../Contacts/Person/Selected";
  import { appGlobal } from "../../../../logic/app";
  import DialPad from "../../View/Phone/DialPad.svelte";
  import StartBarM from "../StartBarM.svelte";
  import PersonAutocomplete from "../../../Contacts/PersonAutocomplete/PersonAutocomplete.svelte";
  import PersonPicture from "../../../Contacts/Person/PersonPicture.svelte";
  import ErrorMessage, { ErrorGravity } from "../../../Shared/ErrorMessage.svelte";
  import AccountDropDown from "../../../Shared/AccountDropDown.svelte";
  import Scroll from "../../../Shared/Scroll.svelte";
  import RoundButton from "../../../Shared/RoundButton.svelte";
  import Button from "../../../Shared/Button.svelte";
  import Clickable from "../../../Shared/Clickable.svelte";
  import CallIcon from "lucide-svelte/icons/phone";
  import VideoConfIcon from "lucide-svelte/icons/video";
  import BackspaceIcon from "lucide-svelte/icons/delete";
  import { onKeyEnter } from "../../../Util/util";
  import { getTimeString } from "../../../../logic/util/date";
  import { catchErrors, logErrorToServer } from "../../../Util/error";
  import { assert, sleep } from "../../../../logic/util/util";
  import { t } from "../../../../l10n/l10n";
  import { ArrayColl } from "svelte-collections";

  export let isPhoneDial = false;

  const now = new Date();
  const maxUpcoming = new Date();
  maxUpcoming.setHours(23); // today
  maxUpcoming.setMinutes(59);
  const maxPrevious = new Date();
  maxPrevious.setDate(maxPrevious.getDate() - 14); // last 14 days
  const upcomingMeetings = appGlobal.calendarEvents.filterObservable(event => event.startTime > now && event.startTime < maxUpcoming);
  const previousCalls = new ArrayColl<PersonUID>(); // appGlobal.calendarEvents.filterObservable(event => event.startTime < now && event.startTime > maxPrevious).reverse();

  let phoneNumber = "";
  let selectedAccount = appGlobal.meetAccounts.filterOnce(acc => acc instanceof PhoneAccount).first as PhoneAccount;

  const minLength = 8;
  $: isPhoneNumberValid = phoneNumber.replace(/[^0-9+]/g, "").length >= minLength;

  async function callPhoneNumber(number: string) {
    await joinByURL("tel:" + number);
  }

  async function callPhoneNumberPasted(number: string) {
    await sleep(0.1); // paste event fires before the input event, which clears the error
    await callPhoneNumber(phoneNumber);
  }

  function onDigitPressed(digit: string) {
    assert(/^[0-9#*,]$/.test(digit), `Invalid phone digit: ${digit}`);
    phoneNumber += digit;
  }

  async function callPerson(person: Person) {
    assert(person, $t`No contact found`);
    assert(person.phoneNumbers.hasItems, $t`Have no phone number for ${person.name}`);
    let contact = person.phoneNumbers.sortBy(c => c.preference).first;
    assert(contact.value, `Phone number in ContactEntry is empty`);
    await callPhoneNumber(contact.value);
  }

  let errorMsg: string | null = null;

  function showError(ex: Error) {
    errorMsg = ex.message ?? ex + "";
    logErrorToServer(ex);
  }

  function findMatchingContact(phoneNumber: string): Person | null {
    if (phoneNumber?.length <= minLength) {
      return null;
    }
    let country = selectedAccount.countryCode;
    let entered = PhoneCall.getInternationalPhoneNumber(phoneNumber, country);
    return appGlobal.persons.find(person => !!person.phoneNumbers.find(ce =>
      PhoneCall.matchPhoneNumber(ce.value, entered, country)));
  }
  $: personMatching = findMatchingContact(phoneNumber);
  $: if (personMatching) {
    $selectedPerson = personMatching;
  }
</script>

<style>
  .top {
    margin: 12px;
  }
  .buttons {
    column-gap: 12px;
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
  .phone-number {
    margin-inline-end: 4px;
    font-size: 24px;
    width: 10em;
  }
  .actions :global(button.call) {
    background-color: #20AF9E;
  }
  .dialpad {
    align-items: center;
    align-self: center;
  }
  .dial.buttons {
    margin-block-start: 16px;
    align-self: stretch;
  }
  .dial.buttons :global(button.backspace .icon) {
    opacity: 60%;
  }
  .dial.buttons :global(button.backspace svg) {
    stroke-width: 1.5px;
  }
  .contact-search {
    margin-block-start: 48px;
  }
  .contact-search :global(button) {
    border: none !important;
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
  @media (max-width: 800px) {
    .main {
      flex-direction: column;
    }
    .meetings {
      order: 1;
      align-items: center;
    }
    .actions-container {
      order: 2;
    }
  }
</style>
