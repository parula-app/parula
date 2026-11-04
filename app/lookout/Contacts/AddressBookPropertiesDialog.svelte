<Dialog title={$t`${addressbook.name} Properties`}
  okLabel={$t`OK`}
  okDisabled={isWritable && !name.trim() && $t`Enter a name for the address book`}
  onOK={onOK}
  width="480px"
  on:close>
  <vbox class="properties">
    <DialogTabs tabs={[ { id: "general", label: $t`General` } ]} selected="general" />
    <hbox class="name-row">
      <span class="folder-icon"><AddressbookIcon size="24" /></span>
      <input type="text" class="lo-text-field name" bind:value={name} aria-label={$t`Name`}
        disabled={!isWritable} />
    </hbox>
    <hbox class="divider" />
    <div class="facts">
      <span class="label">{$t`Type *=> Type of the folder`}</span>
      <span>{isWritable ? $t`Folder containing Contact Items` : $t`Directory *=> Address book on the server with all people of the organization`}</span>
      <span class="label">{$t`Location *=> Where the calendar or address book is stored`}</span>
      <span>{addressbook.mainAccount?.name ?? addressbook.name}</span>
      <span class="label">{$t`Items *=> Number of contacts in the address book`}</span>
      <span>{$contacts.length}</span>
    </div>
  </vbox>
</Dialog>

<script lang="ts">
  import type { Addressbook } from "../../logic/Contacts/Addressbook";
  import { appGlobal } from "../../logic/app";
  import Dialog from "../Shared/Dialog/Dialog.svelte";
  import DialogTabs from "../Shared/Dialog/DialogTabs.svelte";
  import AddressbookIcon from "lucide-svelte/icons/book-user";
  import { t } from "../../l10n/l10n";

  export let addressbook: Addressbook;

  let name = addressbook.name;
  const contacts = addressbook.contacts;
  const isWritable = appGlobal.addressbooks.contains(addressbook);

  async function onOK() {
    let trimmed = name.trim();
    if (!isWritable || trimmed == addressbook.name) {
      return;
    }
    addressbook.name = trimmed;
    await addressbook.save();
  }
</script>

<style>
  .properties {
    gap: 16px;
  }
  .name-row {
    align-items: center;
    gap: 12px;
  }
  .folder-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-selected-bg);
    color: var(--lo-accent-text);
  }
  .name {
    flex: 1 1 auto;
    min-width: 0;
  }
  .divider {
    height: 1px;
    background-color: var(--lo-divider);
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 8px 16px;
  }
  .label {
    color: var(--lo-fg-secondary);
  }
</style>
