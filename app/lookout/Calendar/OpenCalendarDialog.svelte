<Dialog title={$t`Open a Shared Calendar`}
  okLabel={$t`OK`}
  okDisabled={!$persons.hasItems && $t`Enter a name first`}
  onOK={onOK}
  width="480px"
  bind:this={dialog}
  on:close>
  <vbox class="fields">
    {#if accounts.length > 1}
      <hbox class="field">
        <span class="label">{$t`Account`}</span>
        <ComboBox options={accounts.map(listed => ({ value: listed, label: listed.name }))}
          bind:value={account} label={$t`Account`} />
      </hbox>
    {/if}
    <hbox class="field">
      <DialogButton label={$t`Name… *=> Choose the colleague from the address book`} tooltip={$t`Choose the person from the address book`}
        onClick={onPick} />
      <hbox class="person-field">
        <MailAutocomplete addresses={persons} label={$t`Name`} />
      </hbox>
    </hbox>
    <div class="hint lo-secondary">{$t`Type the name or email address of a colleague who shared their calendar with you`}</div>
  </vbox>
</Dialog>

{#if isPicking}
  <SelectNamesDialog title={$t`Select Name: Calendar`} persons={picks} label={$t`Calendar`} single
    on:ok={onPicked} on:close={onPickClosed} />
{/if}

<script lang="ts">
  import type { MailAccount } from "../../logic/Mail/MailAccount";
  import type { PersonUID } from "../../logic/Abstract/PersonUID";
  import type { Calendar } from "../../logic/Calendar/Calendar";
  import { selectedCalendar } from "../../frontend/Calendar/selected";
  import { appGlobal } from "../../logic/app";
  import { assert } from "../../logic/util/util";
  import Dialog from "../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../Shared/Dialog/DialogButton.svelte";
  import ComboBox from "../Shared/Form/ComboBox.svelte";
  import MailAutocomplete from "../Mail/Composer/MailAutocomplete.svelte";
  import SelectNamesDialog from "../Mail/Composer/SelectNamesDialog.svelte";
  import { ArrayColl } from "svelte-collections";
  import { createEventDispatcher, tick } from "svelte";
  import { t } from "../../l10n/l10n";

  export let fromAddressBook = false;

  const accounts = appGlobal.emailAccounts.contents.filter(account => !account.isDependentAccount && account.canShareWithPersons());
  let account: MailAccount | null = accounts[0];

  let persons = new ArrayColl<PersonUID>();
  let picks = new ArrayColl<PersonUID>();
  let isPickConfirmed = false;
  let isPicking = fromAddressBook;
  let dialog: Dialog;
  const dispatch = createEventDispatcher<{ close: void }>();

  function onPick() {
    isPicking = true;
  }

  async function onPicked() {
    isPickConfirmed = true;
    persons.replaceAll(picks.contents);
    picks.clear();
    if (fromAddressBook && persons.hasItems) {
      fromAddressBook = false;
      await tick();
      await dialog.submit();
    }
  }

  function onPickClosed() {
    isPicking = false;
    if (fromAddressBook && !isPickConfirmed) {
      dispatch("close");
    }
    isPickConfirmed = false;
  }

  async function openCalendarOf(person: PersonUID): Promise<Calendar> {
    let name = person.name || person.emailAddress;
    let address = person.emailAddress?.toLowerCase();
    assert(!appGlobal.calendars.contents.some(calendar => calendar.username?.toLowerCase() == address),
      $t`The calendar of ${name} is already in your calendar list`);
    let shared = await account.findSharedFolders(person, ["calendar"]);
    assert(shared.includes("calendar"),
      $t`The calendar of ${name} could not be opened. You don't have permission to see it. Ask ${name} to share the calendar with you.`);
    return await account.addSharedCalendar(person);
  }

  async function onOK() {
    for (let person of persons.contents) {
      let calendar = await openCalendarOf(person);
      persons.remove(person);
      $selectedCalendar = calendar;
    }
  }
</script>

<style>
  .fields {
    gap: 12px;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .label {
    flex: none;
    width: 72px;
  }
  .field :global(.lo-combobox) {
    flex: 1 1 auto;
  }
  .person-field {
    flex: 1 1 0;
    min-width: 0;
    min-height: 32px;
    box-sizing: border-box;
    padding: 0 8px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
  }
  .person-field:focus-within {
    border-color: var(--lo-accent);
    box-shadow: inset 0 -1px 0 var(--lo-accent);
  }
  .hint {
    font-size: var(--lo-font-size-small);
  }
</style>
