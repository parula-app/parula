<vbox class="permissions">
  <h3 class="heading">{calendar.name}</h3>
  <div class="intro">{$t`Share this calendar with people in your organization. Choose how much access each person gets.`}</div>
  <hbox class="add-row">
    <hbox class="person-field">
      <MailAutocomplete addresses={newPersons} label={$t`Name or email address`} chips />
    </hbox>
    <ComboBox options={calendar.sharePermissionLevels.map(permission => ({ value: permission, label: levelLabel(permission) }))}
      bind:value={level} label={$t`Permission Level`} width="210px" />
    <DialogButton label={$t`Share *=> Give the entered people access to the calendar`} primary onClick={onShare}
      disabled={!$newPersons.hasItems && $t`Enter the person first`} />
  </hbox>
  <hbox class="divider" />
  <div class="list-heading">{$t`People with access`}</div>
  <vbox class="persons" role="list">
    {#if isLoading}
      <hbox class="message lo-secondary">{$t`Loading…`}</hbox>
    {:else}
      {#each sharedWith as person (person.emailAddress)}
        <hbox class="person" role="listitem">
          <PersonCircle name={person.name || person.emailAddress} colorKey={person.emailAddress} size={32} />
          <vbox flex class="person-text">
            <span class="person-name">{person.name || person.emailAddress}</span>
            {#if person.name}
              <span class="person-address">{person.emailAddress}</span>
            {/if}
          </vbox>
          <button type="button" class="remove" title={$t`Remove`} aria-label={$t`Remove ${person.name || person.emailAddress}`}
            on:click={() => catchErrors(() => onRemove(person))}>
            <RemoveIcon size="16" />
          </button>
        </hbox>
      {:else}
        <hbox class="message lo-secondary">{$t`You have not shared this calendar with anybody`}</hbox>
      {/each}
    {/if}
  </vbox>
</vbox>

<script lang="ts">
  import { CalendarShareCombinedPermissions, type Calendar } from "../../logic/Calendar/Calendar";
  import type { PersonUID } from "../../logic/Abstract/PersonUID";
  import type { MailAccount } from "../../logic/Mail/MailAccount";
  import { getBaseDomainFromHost, getDomainForEmailAddress } from "../../logic/util/netUtil";
  import { assert } from "../../logic/util/util";
  import { askYesNo } from "../Shared/Dialog/MessageBox";
  import { catchErrors } from "../../frontend/Util/error";
  import DialogButton from "../Shared/Dialog/DialogButton.svelte";
  import ComboBox from "../Shared/Form/ComboBox.svelte";
  import PersonCircle from "../Contacts/Person/PersonCircle.svelte";
  import MailAutocomplete from "../Mail/Composer/MailAutocomplete.svelte";
  import RemoveIcon from "lucide-svelte/icons/trash-2";
  import { ArrayColl } from "svelte-collections";
  import { onMount } from "svelte";
  import { t } from "../../l10n/l10n";

  export let calendar: Calendar;

  let newPersons = new ArrayColl<PersonUID>();
  let level = calendar.sharePermissionLevels[0];
  let sharedWith: PersonUID[] = [];
  let isLoading = true;

  onMount(() => catchErrors(load));
  async function load() {
    try {
      sharedWith = (await calendar.getSharedPersons()).contents;
    } finally {
      isLoading = false;
    }
  }

  async function onShare() {
    for (let person of newPersons.contents) {
      await shareWith(person);
      newPersons.remove(person);
    }
    await load();
  }

  async function shareWith(person: PersonUID) {
    let account = calendar.mainAccount as MailAccount;
    // <copied from="../../frontend/Settings/Mail/SharingOutgoing.svelte">
    assert(getBaseDomainFromHost(getDomainForEmailAddress(person.emailAddress)) ==
      getBaseDomainFromHost(getDomainForEmailAddress(account.emailAddress)),
      $t`You can only share with users in your company`);
    // </copied>
    await calendar.addSharedPerson(person, level);
  }

  function levelLabel(permission: CalendarShareCombinedPermissions): string {
    switch (permission) {
    case CalendarShareCombinedPermissions.ReadAvailability:
      return $t`Can view when I'm busy`;
    case CalendarShareCombinedPermissions.ReadTitle:
      return $t`Can view titles and locations`;
    case CalendarShareCombinedPermissions.ReadAll:
      return $t`Can view all details`;
    case CalendarShareCombinedPermissions.Modify:
      return $t`Can edit`;
    }
  }

  async function onRemove(person: PersonUID) {
    if (!await askYesNo($t`Permissions *=> Who can access this folder`, $t`Do you want to stop sharing the calendar "${calendar.name}" with ${person.name || person.emailAddress}?`)) {
      return;
    }
    await calendar.deleteSharedPerson(person);
    sharedWith = sharedWith.filter(listed => listed != person);
  }
</script>

<style>
  .permissions {
    gap: 12px;
  }
  .heading {
    margin: 0;
    color: var(--lo-accent-text);
    font-size: 16px;
    font-weight: 600;
  }
  .intro {
    color: var(--lo-fg-secondary);
  }
  .add-row {
    align-items: center;
    gap: 8px;
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
  .divider {
    height: 1px;
    background-color: var(--lo-divider);
  }
  .list-heading {
    font-weight: 600;
  }
  .persons {
    gap: 4px;
  }
  .person {
    align-items: center;
    gap: 12px;
    padding: 4px 0;
  }
  .person-text {
    min-width: 0;
  }
  .person-name,
  .person-address {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .person-address {
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
  .remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-accent-text);
    cursor: pointer;
  }
  .remove:hover {
    background-color: var(--lo-hover-bg);
  }
  .message {
    padding: 8px 0;
  }
</style>
