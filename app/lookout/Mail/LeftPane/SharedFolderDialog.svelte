<Dialog title={$t`Open Other User's Folder`} okLabel={$t`OK`} onOK={onOK} width="460px" bind:this={dialog}
  okDisabled={!$recipients.hasItems && $t`Enter the name of your colleague first`}
  on:close>
  <FormGrid columns="max-content minmax(0, 1fr)">
    <DialogButton label={$t`Name… *=> Choose the colleague from the address book`} onClick={() => { isPicking = true; }} />
    <hbox class="name-field">
      <MailAutocomplete addresses={recipients} label={$t`Name`} />
    </hbox>
    <span class="lo-form-label">{$t`Folder type`}</span>
    <ComboBox label={$t`Folder type`} options={typeOptions} bind:value={type} width="100%" />
  </FormGrid>
  {#if $availableAccounts.hasItems}
    <vbox class="available">
      <span>{$t`Shared with you`}</span>
      <ListView items={$availableAccounts.contents} on:select={event => recipients.replaceAll([event.detail])}
        on:open={event => { recipients.replaceAll([event.detail]); catchErrors(() => dialog.submit()); }}
        label={$t`Shared with you`} height="120px" let:item>
        <span title={item.emailAddress}>{item.nameOrEMail}</span>
      </ListView>
    </vbox>
  {/if}
</Dialog>
{#if isPicking}
  <SelectNamesDialog title={$t`Select Name`} persons={picked} label={$t`Name`} single
    on:ok={onPicked} on:close={() => { isPicking = false; }} />
{/if}

<script lang="ts" context="module">
  import { MailAccount } from "../../../logic/Mail/MailAccount";
  import { writable } from "svelte/store";

  export const openSharedFolder = writable<MailAccount | null>(null);
</script>

<script lang="ts">
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import SelectNamesDialog from "../Composer/SelectNamesDialog.svelte";
  import MailAutocomplete from "../Composer/MailAutocomplete.svelte";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import FormGrid from "../../Shared/Form/FormGrid.svelte";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import ListView from "../../Shared/Form/ListView.svelte";
  import type { ComboOption } from "../../Shared/Form/ComboOption";
  import { catchErrors } from "../../../frontend/Util/error";
  import { assert } from "../../../logic/util/util";
  import { ArrayColl } from "svelte-collections";
  import { onMount } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let account: MailAccount;

  enum SharedFolderType {
    Inbox = "inbox",
    Calendar = "calendar",
    Contacts = "contacts",
  }

  const typeOptions: ComboOption<SharedFolderType>[] = [SharedFolderType.Inbox, SharedFolderType.Calendar, SharedFolderType.Contacts]
    .map(folderType => ({ value: folderType, label: typeLabel(folderType) }));
  let dialog: Dialog;
  let recipients = new ArrayColl<PersonUID>();
  let type = SharedFolderType.Inbox;
  let isPicking = false;
  let picked = new ArrayColl<PersonUID>();
  let availableAccounts = new ArrayColl<PersonUID>();

  onMount(() => catchErrors(async () => {
    availableAccounts = await account.availableSharedAccounts();
  }));

  function onPicked() {
    recipients.replaceAll(picked.contents.slice(0, 1));
    picked = new ArrayColl<PersonUID>();
  }

  async function onOK() {
    let person = recipients.first;
    assert(person, $t`Enter the name of your colleague first`);
    await addSharedFolder(person, type);
  }

  async function addSharedFolder(person: PersonUID, type: SharedFolderType) {
    let name = person.name || person.emailAddress;
    if (type == SharedFolderType.Inbox) {
      assert(!hasMailAccountOf(person), $t`You have already opened the mail of ${name}`);
    }
    let shared = await account.findSharedFolders(person, distinguishedIDs(type));
    assert(shared.length, $t`You have no access to the ${typeLabel(type)} of ${name}`);
    if (type == SharedFolderType.Calendar) {
      await account.addSharedCalendar(person);
    } else if (type == SharedFolderType.Contacts) {
      await account.addSharedAddressbook(person);
    } else {
      await account.addSharedFolders(person, shared.includes("msgfolderroot") ? "msgfolderroot" : "inbox");
    }
  }

  function hasMailAccountOf(person: PersonUID): boolean {
    // <copied from="../../../frontend/Settings/Mail/SharingIncoming.svelte" notYetAdded()>
    return !!account.dependentAccounts().find(dependent =>
      dependent.protocol == account.protocol && dependent instanceof MailAccount &&
      dependent.isMyEMailAddress(person.emailAddress));
    // </copied>
  }

  function typeLabel(type: SharedFolderType): string {
    switch (type) {
      case SharedFolderType.Calendar:
        return $t`Calendar`;
      case SharedFolderType.Contacts:
        return $t`Contacts`;
      default:
        return $t`Inbox`;
    }
  }

  function distinguishedIDs(type: SharedFolderType): string[] {
    switch (type) {
      case SharedFolderType.Calendar:
        return ["calendar"];
      case SharedFolderType.Contacts:
        return ["contacts"];
      default:
        return ["msgfolderroot", "inbox"];
    }
  }
</script>

<style>
  .name-field {
    min-height: 32px;
    padding: 0 6px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
  }
  .available {
    gap: 4px;
    margin-top: 12px;
  }
</style>
