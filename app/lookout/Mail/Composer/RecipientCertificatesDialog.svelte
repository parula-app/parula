<Dialog title={$t`Recipient Certificates`} cancelLabel={$t`Close`} width="520px" on:close>
  <vbox class="certificates">
    <span>{$t`These recipients have no certificate for encryption. Import their certificate, or remove them from the message.`}</span>
    <ListView items={$recipientsWithoutKeys.contents} bind:selected
      columns={[{ label: $t`Name` }, { label: $t`E-mail Address` }]}
      label={$t`Recipients *=> Recipients of the email`} height="160px" let:item>
      <span>{item.name ?? ""}</span>
      <span>{item.emailAddress}</span>
      <span slot="empty">{$t`All recipients have a certificate now`}</span>
    </ListView>
    <hbox class="buttons">
      <DialogButton label={$t`Import…`} disabled={!selected && $t`Select a recipient first`} onClick={onImport} />
      {#if hasKeyServers}
        <DialogButton label={$t`Query Key Server`} disabled={!selected && $t`Select a recipient first`} onClick={onQuery} />
      {/if}
      <DialogButton label={$t`Remove Recipient`} disabled={!selected && $t`Select a recipient first`} onClick={onRemove} />
    </hbox>
  </vbox>
</Dialog>
<FileSelector bind:this={fileSelector} {acceptFileTypes} />

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import { queryKeyServers } from "./RecipientKeys";
  import { importPublicKey } from "../../../logic/Mail/Encryption/KeyUtils";
  import { appGlobal } from "../../../logic/app";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import ListView from "../../Shared/Form/ListView.svelte";
  import FileSelector from "../../../frontend/Mail/Composer/Attachments/FileSelector.svelte";
  import { ArrayColl, type Collection } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  export let mail: EMail;
  export let recipientsWithoutKeys: Collection<PersonUID>;
  export let hasKeyServers = false;

  // <copied from="../../../frontend/Contacts/PersonPage/EncryptionImport.svelte">
  const acceptFileTypes = [ "application/pgp-keys", ".asc", "application/pkix-cert", "application/pkcs7-certificates", "application/x-x509-user-cert", "application/x-x509-ca-cert", "application/x-pem-file", ".pem", "text/plain" ];
  // </copied>
  let fileSelector: FileSelector;
  let selected: PersonUID = null;

  async function onImport() {
    let file = await fileSelector.selectFile();
    if (!file) {
      return;
    }
    // <copied from="../../../frontend/Contacts/PersonPage/EncryptionImport.svelte" onImportFile()>
    let person = selected.createPerson(appGlobal.collectedAddressbook);
    let fileContent = await file.text();
    let key = await importPublicKey(fileContent);
    person.addEncryptionPublicKey(key);
    await person.save();
    // </copied>
  }

  async function onQuery() {
    await queryKeyServers(new ArrayColl([selected]));
  }

  function onRemove() {
    removeRecipients([selected]);
    selected = null;
  }

  /* <copied from="EncryptionDetails.svelte"> */
  function removeRecipients(recipients: PersonUID[]) {
    mail.to.removeAll(recipients);
    mail.cc.removeAll(recipients);
    mail.bcc.removeAll(recipients);
  }
  /* </copied> */
</script>

<style>
  .certificates {
    gap: 8px;
  }
  .buttons {
    gap: 8px;
  }
</style>
