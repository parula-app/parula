<Dialog title={title} width="520px" on:close>
  <vbox class="new-folder-account" class:wizard={!localOnly}>
    {#if step == "type"}
      <span class="heading">{isCalendar ? $t`Where do you want to keep the calendar?` : $t`Where do you want to keep the address book?`}</span>
      <vbox class="types">
        <hbox class="type">
          <Radio label={$t`On this computer`} name="folder-account-type" value={true}
            bind:group={isLocal} />
          <span class="lo-secondary">{isCalendar
            ? $t`A new calendar that only this computer has`
            : $t`A new address book that only this computer has`}</span>
        </hbox>
        <hbox class="type">
          <Radio label={isCalendar ? $t`CalDAV server` : $t`CardDAV server`} name="folder-account-type" value={false}
            bind:group={isLocal} />
          <span class="lo-secondary">{isCalendar
            ? $t`An existing calendar on the server of your provider or company`
            : $t`An existing address book on the server of your provider or company`}</span>
        </hbox>
      </vbox>
    {:else if step == "settings" && isLocal}
      <FormGrid columns="140px minmax(0, 1fr)">
        <span>{$t`Name`}</span>
        <TextField bind:value={config.name} label={$t`Name`} />
        <span>{$t`Folder contains`}</span>
        <ComboBox options={contentOptions} value={kind} label={$t`Folder contains`} disabled />
        <span>{$t`Location *=> Where the calendar or address book is stored`}</span>
        <span class="value">{$t`On this computer`}</span>
      </FormGrid>
    {:else if step == "settings"}
      <span class="heading">{isCalendar ? $t`CalDAV Calendar Settings` : $t`CardDAV Address Book Settings`}</span>
      <FormGrid columns="140px minmax(0, 1fr)">
        <span class="section">{$t`Folder Information`}</span>
        <span>{$t`Name`}</span>
        <TextField bind:value={config.name} label={$t`Name`} />
        <span class="section">{$t`Server Information`}</span>
        <span>{$t`Server URL`}</span>
        <TextField type="url" bind:value={config.url} label={$t`Server URL`}
          placeholder={isCalendar ? "https://dav.example.com/calendar/" : "https://dav.example.com/contacts/"} />
        <span class="section">{$t`Logon Information`}</span>
        <span>{$t`User Name`}</span>
        <TextField bind:value={config.username} label={$t`User Name`} />
        <span>{$t`Password`}</span>
        <TextField type="password" bind:value={config.password} label={$t`Password`} />
      </FormGrid>
    {:else if step == "choose"}
      <span class="heading">{isCalendar ? $t`Select the calendars to add` : $t`Select the address books to add`}</span>
      <vbox class="folders">
        {#each available as folder (folder.url)}
          <hbox class="folder">
            <Checkbox label={String(folder.displayName || folder.url)} checked={chosen.includes(folder)}
              on:change={event => toggle(folder, event.detail)} />
          </hbox>
        {/each}
      </vbox>
    {/if}
  </vbox>
  <svelte:fragment slot="footer">
    <hbox flex />
    {#if !localOnly}
      <DialogButton label={$t`< Back`} disabled={step == "type"} onClick={back} />
    {/if}
    {#if isLastStep}
      <DialogButton label={localOnly ? $t`OK` : $t`Finish *=> Complete the wizard`} primary disabled={!canContinue} onClick={next} />
    {:else}
      <DialogButton label={$t`Next >`} primary disabled={!canContinue} onClick={next} />
    {/if}
    <DialogButton label={$t`Cancel`} onClick={close} />
  </svelte:fragment>
</Dialog>

<script lang="ts">
  import type { Calendar } from "../../logic/Calendar/Calendar";
  import type { Addressbook } from "../../logic/Contacts/Addressbook";
  import { newCalendarForProtocol } from "../../logic/Calendar/AccountsList/Calendars";
  import { newAddressbookForProtocol } from "../../logic/Contacts/AccountsList/Addressbooks";
  import { saveLocalFolderAccount, findServerFolders, saveServerFolders, type FolderAccountKind, type ServerFolder } from "./NewFolderAccountFlow";
  import { assert } from "../../logic/util/util";
  import Dialog from "../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../Shared/Dialog/DialogButton.svelte";
  import FormGrid from "../Shared/Form/FormGrid.svelte";
  import TextField from "../Shared/Form/TextField.svelte";
  import ComboBox from "../Shared/Form/ComboBox.svelte";
  import Checkbox from "../Shared/Form/Checkbox.svelte";
  import Radio from "../Shared/Form/Radio.svelte";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../l10n/l10n";

  export let kind: FolderAccountKind;
  export let localOnly = false;

  const dispatch = createEventDispatcher<{ close: void }>();

  let step: "type" | "settings" | "choose" = "type";
  let isLocal = true;
  let config: Calendar | Addressbook | null = null;
  let available: ServerFolder[] = [];
  let chosen: ServerFolder[] = [];
  if (localOnly) {
    chooseType(true);
  }

  $: isCalendar = kind == "calendar";
  $: title = localOnly
    ? $t`Create New Folder`
    : isCalendar ? $t`Add Calendar` : $t`Add Address Book`;
  $: contentOptions = [
    { value: "calendar", label: $t`Calendar Items` },
    { value: "addressbook", label: $t`Contact Items` },
  ];
  $: isLastStep = step == "choose" || step == "settings" && isLocal;
  $: canContinue = step == "type" ||
    (step == "choose"
      ? chosen.length > 0
      : !!config?.name?.trim() && (isLocal || !!config.url?.trim() && !!config.username?.trim()));

  function chooseType(local: boolean) {
    isLocal = local;
    let protocol = kind == "calendar"
      ? (isLocal ? "calendar-local" : "caldav")
      : (isLocal ? "addressbook-local" : "carddav");
    config = kind == "calendar"
      ? newCalendarForProtocol(protocol)
      : newAddressbookForProtocol(protocol);
    step = "settings";
  }

  function toggle(folder: ServerFolder, isChosen: boolean) {
    chosen = isChosen
      ? [...chosen.filter(existing => existing != folder), folder]
      : chosen.filter(existing => existing != folder);
  }

  async function next() {
    assert(canContinue, $t`Please fill in the fields first`);
    if (step == "type") {
      chooseType(isLocal);
      return;
    }
    if (step == "settings" && isLocal) {
      await saveLocalFolderAccount(config);
      close();
      return;
    }
    if (step == "settings") {
      try {
        available = await findServerFolders(config, kind);
      } finally {
        config = config;
      }
      chosen = [available[0]];
      if (available.length > 1) {
        step = "choose";
        return;
      }
    }
    await saveServerFolders(config, available, chosen);
    close();
  }

  function back() {
    step = step == "choose" ? "settings" : "type";
  }

  function close() {
    dispatch("close");
  }
</script>

<style>
  .new-folder-account {
    gap: 12px;
  }
  .new-folder-account.wizard {
    min-height: 240px;
  }
  .heading {
    font-weight: 600;
  }
  .types {
    gap: 12px;
  }
  .type {
    flex-direction: column;
    gap: 2px;
  }
  .type .lo-secondary {
    padding-inline-start: 28px;
  }
  .section {
    grid-column: 1 / -1;
    margin-block-start: 6px;
    font-weight: 600;
  }
  .value {
    color: var(--lo-fg-secondary);
  }
  .folders {
    max-height: 240px;
    overflow-y: auto;
    padding: 4px 8px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
  }
  .folder {
    min-height: 28px;
    align-items: center;
  }
</style>
