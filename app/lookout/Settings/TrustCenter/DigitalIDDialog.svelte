<Dialog title={$t`Import/Export Digital ID`} okLabel={$t`OK`} onOK={onOK} okDisabled={okDisabled} width="600px" on:close>
  <vbox class="digital-id">
    <FormGrid columns="150px minmax(0, 1fr)">
      <span>{$t`E-mail address`}</span>
      <ComboBox options={identityOptions} bind:value={identity} label={$t`E-mail address`} />
    </FormGrid>
    <GroupBox>
      <vbox class="mode">
        <Radio label={$t`Import existing Digital ID from a file`} name="digital-id-mode" value="import" bind:group={mode} />
        <vbox class="mode-content">
          <span class="hint">{$t`Import the Digital ID from the file to your computer. You must use the password you entered while exporting the certificate to this file.`}</span>
          <FormGrid columns="150px minmax(0, 1fr) 104px">
            <span>{$t`Import File *=> File that contains the Digital ID to import`}</span>
            <TextField value={file?.name ?? ""} readonly label={$t`Import File *=> File that contains the Digital ID to import`} disabled={mode != "import"} />
            <DialogButton label={$t`Browse… *=> Choose a file on the computer`} onClick={onBrowse} disabled={mode != "import"} />
            <span>{$t`Password`}</span>
            <TextField type="password" bind:value={passphrase} label={$t`Password`} disabled={mode != "import"} />
            <span />
            <span>{$t`Digital ID Name`}</span>
            <TextField bind:value={name} label={$t`Digital ID Name`} disabled={mode != "import"} />
            <span />
          </FormGrid>
        </vbox>
      </vbox>
    </GroupBox>
    <GroupBox>
      <vbox class="mode">
        <Radio label={$t`Export your Digital ID to a file`} name="digital-id-mode" value="export" bind:group={mode}
          disabled={!keys.length && $t`There is no Digital ID for ${identity.emailAddress} yet`} />
        <vbox class="mode-content">
          <span class="hint">{$t`Export the Digital ID information into a file. You will need the password below to import the file again.`}</span>
          <FormGrid columns="150px minmax(0, 1fr) 104px">
            <span>{$t`Digital ID`}</span>
            <ComboBox options={keyOptions} bind:value={exportKey} label={$t`Digital ID`} disabled={mode != "export"} />
            <span />
            <span>{$t`Password`}</span>
            <TextField value={mode == "export" && withPrivateKey ? exportKey?.passphrase ?? "" : ""} readonly
              label={$t`Password`} disabled={mode != "export" || !withPrivateKey} classes="code" />
            <span />
          </FormGrid>
          <Checkbox label={$t`Include the private key`} bind:checked={withPrivateKey} disabled={mode != "export"} />
          <Checkbox label={$t`Delete Digital ID from System`} bind:checked={deleteAfterExport}
            disabled={mode != "export" || !withPrivateKey} />
        </vbox>
      </vbox>
    </GroupBox>
  </vbox>
</Dialog>

<FileSelector bind:this={fileSelector} {acceptFileTypes} />

<script lang="ts">
  import type { MailIdentity } from "../../../logic/Mail/MailIdentity";
  import { allDigitalIDs, keyName, digitalIDLabel, identityLabel, importDigitalID, exportDigitalID, removeDigitalID, type DigitalID } from "./DigitalIDs";
  import { showMessageBox } from "../../Shared/Dialog/MessageBox";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import FormGrid from "../../Shared/Form/FormGrid.svelte";
  import GroupBox from "../../Shared/Form/GroupBox.svelte";
  import TextField from "../../Shared/Form/TextField.svelte";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import Radio from "../../Shared/Form/Radio.svelte";
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import FileSelector from "../../../frontend/Mail/Composer/Attachments/FileSelector.svelte";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let identity: MailIdentity;
  export let identities: MailIdentity[];
  const dispatch = createEventDispatcher<{ change: MailIdentity }>();

  let mode: "import" | "export" = "import";
  let fileSelector: FileSelector;
  // <copied from="../../../frontend/Settings/Mail/Account/EncryptionImport.svelte">
  const acceptFileTypes = [ "application/pgp-secret-keys", ".asc", "application/pkcs8", "application/x-pem-file", ".key", "application/x-pkcs12", ".p12", ".pfx", "text/plain" ];
  // </copied>
  let file: File | null = null;
  let passphrase = "";
  let name = "";
  let exportKey: DigitalID | null = null;
  let withPrivateKey = true;
  let deleteAfterExport = false;

  $: identityOptions = identities.map(listed => ({ value: listed, label: identityLabel(listed) }));
  $: keys = allDigitalIDs(identity);
  $: keyOptions = keys.map(key => ({ value: key, label: digitalIDLabel(key) }));
  $: if (!keys.includes(exportKey)) {
    exportKey = keys[0] ?? null;
  }
  $: if (!keys.length) {
    mode = "import";
  }
  $: okDisabled = mode == "import"
    ? !file && $t`Choose the file to import`
    : !exportKey && $t`Choose the Digital ID to export`;

  async function onBrowse() {
    let selected = await fileSelector.selectFile();
    if (selected) {
      file = selected;
    }
  }

  async function onOK() {
    if (mode == "import") {
      await importDigitalID(identity, file, passphrase, name);
      dispatch("change", identity);
      return;
    }
    await exportDigitalID(identity, exportKey, withPrivateKey);
    if (withPrivateKey && deleteAfterExport &&
        await showMessageBox($t`Delete Digital ID`, $t`You will no longer be able to read messages that are encrypted with this Digital ID, neither old nor new ones, unless you import the exported file again. Do you want to delete the Digital ID ${keyName(exportKey)} from this computer?`)) {
      await removeDigitalID(identity, exportKey);
    }
    dispatch("change", identity);
  }
</script>

<style>
  .digital-id {
    gap: 12px;
  }
  .mode {
    gap: 6px;
  }
  .mode-content {
    gap: 8px;
    padding-inline-start: 26px;
  }
  .hint {
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
  .mode-content :global(input.code) {
    font-family: "Cascadia Mono", Consolas, monospace;
  }
</style>
