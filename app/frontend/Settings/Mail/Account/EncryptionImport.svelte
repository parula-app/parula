<vbox class="key-import">
  {#if showPassword}
    <hbox flex>
      <hbox class="password">
        <vbox>
          <hbox class="label">
            {$t`Passphrase for secret key file`}
          </hbox>
          <input type="password" bind:value={passphrase} />
        </vbox>
        <hbox class="buttons">
          <Button
            label={$t`Import`}
            onClick={onFilePassword}
            classes="password-ok"
            />
        </hbox>
      </hbox>
      <hbox flex />
      <hbox class="buttons">
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
  {:else}
    <hbox class="import">
      <hbox class="label">{$t`Import from`}</hbox>
      <hbox class="buttons">
        <hbox bind:this={appsButton}>
          <!--
          <Button
            label={$t`App`}
            icon={AppIcon}
            onClick={onImportFromApps}
            />
          -->
        </hbox>
        <Button
          label={$t`File`}
          icon={FileIcon}
          onClick={() => showPassword = true}
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
    <hbox class="create buttons">
      <Button
        label={$t`Create new PGP key`}
        icon={PlusIcon}
        onClick={onCreateNewPGP}
        />
      <Button
        label={$t`Create new S/MIME key`}
        icon={PlusIcon}
        onClick={onCreateNewSMIME}
        />
    </hbox>
  {/if}
</vbox>

<FileSelector {acceptFileTypes} bind:this={fileSelector} />

<Menu bind:isMenuOpen={isAppsMenuOpen} anchor={appsButton}>
  <MenuItem label="Thunderbird" onClick={onImportFromThunderbird} />
  <MenuItem label="Outlook" onClick={onImportFromOutlook} />
  <MenuItem label="Apple Mail" onClick={onImportFromAppleMail} />
  <MenuItem label="GnuPG" onClick={onImportFromGnuPG} />
</Menu>

<script lang="ts">
  import { PublicKey } from "../../../../logic/Mail/Encryption/PublicKey";
  import { PGPPrivateKey } from "../../../../logic/Mail/Encryption/PGP/PGPPrivateKey";
  import { SMIMEPrivateKey } from "../../../../logic/Mail/Encryption/SMIME/SMIMEPrivateKey";
  import { TrustLevel } from "../../../../logic/Mail/Encryption/enums";
  import { MailIdentity } from "../../../../logic/Mail/MailIdentity";
  import { importPrivateKey, readPrivateKeyFile } from "../../../../logic/Mail/Encryption/KeyUtils";
  import FileSelector from "../../../Mail/Composer/Attachments/FileSelector.svelte";
  import Menu from "../../../Shared/Menu/Menu.svelte";
  import MenuItem from "../../../Shared/Menu/MenuItem.svelte";
  import RoundButton from "../../../Shared/RoundButton.svelte";
  import Button from "../../../Shared/Button.svelte";
  import PlusIcon from "lucide-svelte/icons/plus";
  import FileIcon from "lucide-svelte/icons/file-lock";
  import AppIcon from "lucide-svelte/icons/app-window";
  import CloseIcon from "lucide-svelte/icons/x";
  import { assert } from "../../../../logic/util/util";
  import { gt, t } from "../../../../l10n/l10n";

  export let identity: MailIdentity;
  /** in/out */
  export let isOpen: boolean;
  export let showObsolete: boolean;

  let showPassword = false;
  let passphrase = "";
  async function onFilePassword() {
    await onImportFile(passphrase);
    showPassword = false;
  }

  let fileSelector: FileSelector;
  const acceptFileTypes = [ "application/pgp-secret-keys", ".asc", "application/pkcs8", "application/x-pem-file", ".key", "application/x-pkcs12", ".p12", ".pfx", "text/plain" ];
  async function onImportFile(passphrase: string) {
    let file = await fileSelector.selectFile();
    if (!file) {
      return;
    }
    let fileContent = await readPrivateKeyFile(file, passphrase);
    let key = await importPrivateKey(fileContent, passphrase);
    let existing = identity.encryptionPrivateKeys.find(existing => existing.id == key.id);
    if (!existing) {
      identity.encryptionPrivateKeys.add(key);
    } else if (existing instanceof SMIMEPrivateKey) {
      // Re-import of the same key, possibly with new certificates in the file
      await existing.addCertificates(fileContent);
    }
    if (key.obsolete) {
      showObsolete = true;
    }
    isOpen = false;
    await identity.account.save();
  }

  let isAppsMenuOpen = false;
  let appsButton: HTMLElement;
  async function onImportFromApps() {
    isAppsMenuOpen = true;
  }
  async function onImportFromThunderbird() {
    isOpen = false;
  }
  async function onImportFromGnuPG() {
    isOpen = false;
  }
  async function onImportFromOutlook() {
    isOpen = false;
  }
  async function onImportFromAppleMail() {
    isOpen = false;
  }

  async function onCreateNewPGP() {
    assert(!identity.isCatchAll, gt`Cannot create keys for catch-all email addresses. Please create an identity with a specific email address.`);
    let key = await PGPPrivateKey.createNewPrivateKey({
      realname: identity.realname,
      emailAddress: identity.emailAddress,
    });
    identity.encryptionPrivateKeys.add(key);
    isOpen = false;
    await identity.account.save();
  }

  async function onCreateNewSMIME() {
    assert(!identity.isCatchAll, gt`Cannot create keys for catch-all email addresses. Please create an identity with a specific email address.`);
    let key = await SMIMEPrivateKey.createNewPrivateKey(identity.emailAddress);
    identity.encryptionPrivateKeys.add(key);
    showObsolete = true;
    isOpen = false;
    await identity.account.save();
  }

  function makeKey(): PublicKey {
    let key = Math.random() > 0.5 ? new PGPPrivateKey() : new SMIMEPrivateKey();
    if (Math.random() < 0.2) {
      key.trustLevel = TrustLevel.Personal;
    }
    key.userIDs.add(identity.emailAddress);
    identity.encryptionPrivateKeys.add(key);
    key.justCreated = true;
    return key;
  }
  </script>

<style>
  .key-import {
    background-color: var(--offset-bg);
    color: var(--offset-fg);
    border-radius: 2px;
    box-shadow: 1px 1px 1px 0px rgba(0, 0, 0, 15%);
    margin: 4px 0px;
    padding: 12px 16px;
  }
  .import {
    align-items: center;
    margin-block-start: 8px;
    margin-block-end: 8px;
  }
  .create {
    justify-content: end;
    margin-block-end: 4px;
  }
  .label {
    margin-inline-end: 12px;
  }
  .password {
    align-items: baseline;
  }
  .password .buttons {
    align-self: end;
    min-width: max-content;
    margin-inline-start: 24px;
  }
  .buttons {
    gap: 8px;
    flex-wrap: wrap;
  }
  .import .buttons {
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
