<vbox class="key-import">
  <hbox class="import">
    <hbox class="label">{$t`Import from`}</hbox>
    <hbox class="buttons">
      <Button
        label={$t`Key server`}
        icon={CloudIcon}
        onClick={onQueryKeyserver}
        classes="keyserver"
        />
      <Button
        label={$t`File`}
        icon={FileIcon}
        onClick={onImportFile}
        classes="import-file"
        />
      <hbox class="spacer" />
      <RoundButton
        label={$t`Close`}
        icon={CloseIcon}
        onClick={() => isOpen = false}
        border={false}
        classes="plain close"
        padding="4px"
        />
    </hbox>
  </hbox>
  <ErrorMessageInline {ex} />
</vbox>

<FileSelector {acceptFileTypes} bind:this={fileSelector} />

<script lang="ts">
  import { PublicKey } from "../../../logic/Mail/Encryption/PublicKey";
  import { PGPPublicKey } from "../../../logic/Mail/Encryption/PGP/PGPPublicKey";
  import { SMIMEPublicKey } from "../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
  import { TrustLevel } from "../../../logic/Mail/Encryption/enums";
  import { queryPGPKeyServersForPerson } from "../../../logic/Mail/Encryption/PGP/KeyServer";
  import { importPublicKey, readPublicKeyFile } from "../../../logic/Mail/Encryption/KeyUtils";
  import type { Person } from "../../../logic/Abstract/Person";
  import FileSelector from "../../Mail/Composer/Attachments/FileSelector.svelte";
  import ErrorMessageInline from "../../Shared/ErrorMessageInline.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import Button from "../../Shared/Button.svelte";
  import CloudIcon from "lucide-svelte/icons/cloud-download";
  import FileIcon from "lucide-svelte/icons/file-lock";
  import CloseIcon from "lucide-svelte/icons/x";
  import { gt, t } from "../../../l10n/l10n";

  export let person: Person;
  /** in/out */
  export let isOpen: boolean;

  let fileSelector: FileSelector;
  const acceptFileTypes = [ "application/pgp-keys", ".asc", "application/pkix-cert", "application/pkcs7-certificates", ".p7b", ".p7c", "application/x-x509-user-cert", "application/x-x509-ca-cert", "application/x-pem-file", ".pem", "text/plain" ];
  async function onImportFile() {
    let file = await fileSelector.selectFile();
    if (!file) {
      return;
    }
    let fileContent = await readPublicKeyFile(file);
    let key = await importPublicKey(fileContent);
    person.addEncryptionPublicKey(key);
    isOpen = false;
    await person.save();
  }

  let ex: Error | null = null;

  async function onQueryKeyserver() {
    isOpen = !await queryPGPKeyServersForPerson(person);

    if (isOpen) {
      ex = new Error(gt`Not found`);
      setTimeout(() => ex = null, 2000);
    }
  }

  function makeFakeKey(): PublicKey {
    let key = Math.random() > 0.5 ? new PGPPublicKey() : new SMIMEPublicKey();
    key.obsolete = Math.random() > 0.2;
    key.encryptByDefault = Math.random() > 0.5;
    if (Math.random() < 0.2) {
      key.trustLevel = TrustLevel.Personal;
    }
    console.log("mails", person.emailAddresses.contents)
    for (let contact of person.emailAddresses) {
      key.userIDs.add(contact.value);
    }
    person.encryptionPublicKeys.add(key);
    return key;
  }
</script>

<style>
  .key-import {
    align-items: stretch;
    background-color: var(--offset-bg);
    color: var(--offset-fg);
    border-radius: 2px;
    box-shadow: 1px 1px 1px 0px rgba(0, 0, 0, 15%);
    margin: 4px 0px;
    padding: 12px 16px;
  }
  .import {
    align-items: center;
  }
  .label {
    margin-inline-end: 12px;
  }
  .buttons {
    gap: 8px;
    flex-wrap: wrap;
    justify-content: end;
    flex: 1 1 0;
  }
  .spacer {
    flex: 1 1 0;
  }
  .buttons :global(.close) {
    align-self: start;
    margin-inline-end: -8px;
    margin-block-start: -4px;
  }
</style>
