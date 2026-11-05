<vbox class="key" class:obsolete={$key.obsolete}>
  <Clickable onClick={() => isExpanded = !isExpanded}>
    <hbox class="main-row">
      <hbox class="usage"
        style:background-color={$key.obsolete ? "grey" : "green"}
        style:color={$key.obsolete ? "black" : "white"}>
        {#if $key.obsolete}
          <DistrustIcon title={$t`Obsolete`} size="16px" />
        {:else if $key.encryptByDefault}
          <EncryptIcon title={$t`Use for encryption and signing`} size="16px" />
        {:else if $key.useToSign}
          <SignIcon title={$t`Use only for signing messages`} size="16px" />
        {:else}
          <UnusedIcon title={$t`Used only on demand`} size="16px" />
        {/if}
      </hbox>
      <hbox class="name">{$key.name}</hbox>
      {#if isExpanded}
        <hbox class="keytype" flex>{$t`Secret key`}</hbox>
      {:else}
        <hbox flex />
      {/if}
      <hbox class="system font-small">
        {key.system}
      </hbox>
      <RoundButton
        label={isExpanded ? $t`Collapse` : $t`Expand`}
        icon={isExpanded ? ChevronUp : ChevronDown}
        border={false}
        classes="plain"
        />
    </hbox>
  </Clickable>
  {#if isExpanded}
    <vbox class="details">
      {#if $key.obsolete}
        <hbox class="obsolete-detail">
          <hbox class="label">{$t`Obsolete`}</hbox>
          <hbox>{$t`Do not use this key for new messages`}</hbox>
        </hbox>
      {:else}
        <hbox class="usage-detail">
          <hbox class="label">{$t`Usage`}</hbox>
          <vbox>
            <Checkbox toggle
              bind:checked={key.useToSign}
              disabled={$key.obsolete}
              label={$t`Sign emails that I send *=> I will sign outgoing emails`} />
            <Checkbox toggle
                bind:checked={key.encryptByDefault}
                disabled={$key.obsolete}
                label={$t`I want to receive encrypted emails`} />
            {#if $key.encryptByDefault}
              <div class="note">{$t`This is merely a request to your correspondents. The sender also needs to have encryption enabled for messages between you two to be encrypted.`}</div>
              {#if !$key.didBackup}
                <div class="warning note">{$t`To read encrypted emails, you need to use ${appName} (or another app that supports ${key.system}) on your other devices as well.`}</div>
                <div class="warning note">{$t`Please save your private key, on a different device. If you lose the key, you will not be able to read your own encrypted emails anymore.`}</div>
              {/if}
            {/if}
          </vbox>
        </hbox>
      {/if}
      <hbox class="verification-code" class:obsolete={$key.obsolete}>
        <hbox class="label">{$t`Verification code`}</hbox>
        <vbox class="value">
          <hbox>{$key.fingerprintDisplay.substring(0, 24)}</hbox>
          <hbox>{$key.fingerprintDisplay.substring(25)}</hbox>
        </vbox>
      </hbox>
      <hbox>
        <hbox class="label">{$t`Created`}</hbox>
        <hbox class="value">{getDateString($key.created)}</hbox>
        <hbox class="label-2-column">{$t`Expires *=> No longer valid after this date`}</hbox>
        <hbox class="value" title={$key.expires ? getDateTimeString(key.expires) : null}>{$key.expires ? getDateString(key.expires) : "-"}</hbox>
      </hbox>
      <hbox>
        <hbox class="label">{$t`ID`}</hbox>
        <hbox class="value">{key.id}</hbox>
      </hbox>
      {#if key.cipher}
        <hbox>
          <hbox class="label">{$t`Cipher`}</hbox>
          <hbox class="value">{key.cipher}</hbox>
          {#if key.keyLengthInBits}
            <hbox class="label-2-column">{$t`Length`}</hbox>
            <hbox>{key.keyLengthInBits} {$t`bits`}</hbox>
          {/if}
        </hbox>
      {/if}
      <hbox>
        <hbox class="label">{$t`Name`}</hbox>
        <input type="text" bind:value={key.name} spellcheck={false} />
      </hbox>
      <hbox class="valid-for">
        <hbox class="label">{$t`User IDs`}</hbox>
        <vbox>
          {#each key.userIDs.each as userID}
            <hbox class="userid">{userID}</hbox>
          {/each}
        </vbox>
      </hbox>
      {#if chain}
        <vbox>
          {#await keyStatusAsync then keyStatus}
            {#if keyStatus == KeyStatus.NoCertificate}
              <hbox>
                <Button
                  label={$t`Please add this private key's certificate.`}
                  onClick={onAddCertificateSMIME}
                  />
                {#if CSRParams}
                  <ButtonMenu buttonIcon={PlusIcon} label={$t`Toggle fields`}>
                    <MenuItem
                      label={$t`EMail address`}
                      disabled={true}
                      classes="font-normal" />
                    <MenuItem
                      label={$t`Common name`}
                      disabled={true}
                      classes="font-normal" />
                    <MenuItem
                      label={$t`Organizational unit`}
                      onClick={() => toggleCSRParam("OU")}
                      classes="font-normal" />
                    <MenuItem
                      label={$t`Organization`}
                      onClick={() => toggleCSRParam("O")}
                      classes="font-normal" />
                    <MenuItem
                      label={$t`City / Locality`}
                      onClick={() => toggleCSRParam("L")}
                      classes="font-normal" />
                    <MenuItem
                      label={$t`State / Region`}
                      onClick={() => toggleCSRParam("ST")}
                      classes="font-normal" />
                    <MenuItem
                      label={$t`Country`}
                      onClick={() => toggleCSRParam("C")}
                      classes="font-normal" />
                  </ButtonMenu>
                {:else}
                  <Button
                    label={$t`Make a certificate request for this private key.`}
                    onClick={newCSRParams}
                    />
                {/if}
              </hbox>
              {#if CSRParams}
                <form bind:this={CSRForm}>
                  <hbox>
                    <hbox class="label">{$t`EMail address`}</hbox>
                    <input type="email" bind:value={CSRParams.E} spellcheck={false} required />
                  </hbox>
                  <hbox>
                    <hbox class="label">{$t`Common name`}</hbox>
                    <input type="text" bind:value={CSRParams.CN} spellcheck={false} required />
                  </hbox>
                  {#if CSRParams.OU != undefined}
                    <hbox>
                      <hbox class="label">{$t`Organizational Unit`}</hbox>
                      <input type="text" bind:value={CSRParams.OU} spellcheck={false} />
                    </hbox>
                  {/if}
                  {#if CSRParams.O != undefined}
                    <hbox>
                      <hbox class="label">{$t`Organization`}</hbox>
                      <input type="text" bind:value={CSRParams.O} spellcheck={false} />
                    </hbox>
                  {/if}
                  {#if CSRParams.L != undefined}
                    <hbox>
                      <hbox class="label">{$t`City / Locality`}</hbox>
                      <input type="text" bind:value={CSRParams.L} spellcheck={false} />
                    </hbox>
                  {/if}
                  {#if CSRParams.ST != undefined}
                    <hbox>
                      <hbox class="label">{$t`State / Region`}</hbox>
                      <input type="text" bind:value={CSRParams.ST} spellcheck={false} />
                    </hbox>
                  {/if}
                  {#if CSRParams.C != undefined}
                    <hbox>
                      <hbox class="label">{$t`Country code`}</hbox>
                      <input type="text" bind:value={CSRParams.C} spellcheck={false} size=2 minlength=2 maxlength=2 pattern="[A-Za-z]+" />
                    </hbox>
                  {/if}
                  <hbox>
                    <Button
                      label={$t`Save certificate request to file...`}
                      icon={FileIcon}
                      onClick={onExportCSR}
                      />
                  </hbox>
                </form>
              {/if}
            {:else if keyStatus == KeyStatus.ChainInvalid}
              <hbox>{$t`The certificate chain could not be verified.`}</hbox>
            {:else if keyStatus == KeyStatus.ChainIncomplete}
              <hbox>
                <Button
                  label={$t`Please add the intermediate certificate(s).`}
                  onClick={onAddCertificateSMIME}
                  />
              </hbox>
            {:else if keyStatus == KeyStatus.SelfSignedRoot}
              <hbox>{$t`WARNING This private key uses a self-signed root certificate.`}</hbox>
            {:else if keyStatus == KeyStatus.Valid}
              <hbox>{$t`This private key has a valid certificate.`}</hbox>
            {:else if keyStatus == KeyStatus.Expired}
              <hbox>{$t`The certificate has expired or is not yet valid`}</hbox>
            {:else}
              <hbox>{$t`Unexpected private key status`}</hbox>
            {/if}
          {:catch error}
            <ErrorMessageInline ex={error} />
          {/await}
          <hbox class="label">{$t`Certificate chain *=> Any additional certificates that might be required to authenticate this key`}</hbox>
          {#each $chain.each as certificate}
            <hbox>
              <hbox class="label">{$t`Common Name`}</hbox>
              <hbox class="value" flex>{certificate.commonName}</hbox>
              <RoundButton
                label={$t`Delete`}
                icon={DeleteIcon}
                onClick={() => onRemoveFromChain(certificate)}
                />
            </hbox>
            <hbox class="fingerprint" class:obsolete={certificate.obsolete}>
              <hbox class="label">{$t`Fingerprint`}</hbox>
              <hbox class="value">{certificate.fingerprintDisplay}</hbox>
            </hbox>
          {/each}
        </vbox>
      {/if}
      <hbox>
        <hbox class="buttons">
          {#if !key.obsolete}
            <Button
              label={$t`Export public part… *=> Export the public key`}
              icon={ExportPublicIcon}
              onClick={onExportPublic}
              />
            <Button
              label={$t`Backup secret… *=> Export a backup file for the secret encryption key`}
              icon={ExportPrivateIcon}
              onClick={onExportPrivate}
              />
          {/if}
          <Button
            label={key.obsolete ? $t`Restore` : $t`Obsolete`}
            icon={ObsoleteIcon}
            onClick={() => key.obsolete = !key.obsolete}
            />
          {#if key.obsolete || key.justCreated}
            <RoundButton
              label={$t`Delete`}
              icon={DeleteIcon}
              onClick={onDelete}
              />
          {/if}
        </hbox>
      </hbox>
      {#if showSecretPassphrase}
        <vbox class="passphrase">
          <hbox>{$t`You will need the following password when using that secret key file:`}</hbox>
          <hbox class="value">{key.passphrase}</hbox>
          <hbox>{$t`Would you like to save this password as file as well?`}</hbox>
          <hbox class="buttons">
            <Button label={$t`Yes`} onClick={onExportPrivatePassphrase} />
            <Button label={$t`No`} onClick={onExportPrivateDone} />
          </hbox>
        </vbox>
      {/if}
    </vbox>
  {/if}
</vbox>

<FileSelector {acceptFileTypes} bind:this={fileSelector} />

<script lang="ts">
  import type { PublicKey } from "../../../../logic/Mail/Encryption/PublicKey";
  import type { PrivateKey } from "../../../../logic/Mail/Encryption/PrivateKey";
  import type { SMIMEPrivateKey } from "../../../../logic/Mail/Encryption/SMIME/SMIMEPrivateKey";
  import { SMIMEPublicKey, KeyStatus } from "../../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
  import { MailIdentity } from "../../../../logic/Mail/MailIdentity";
  import { saveBlobAsFile } from "../../../Util/util";
  import { appName } from "../../../../logic/build";
  import FileSelector from "../../../Mail/Composer/Attachments/FileSelector.svelte";
  import Checkbox from "../../../Shared/Checkbox.svelte";
  import ButtonMenu from "../../../Shared/Menu/ButtonMenu.svelte";
  import RoundButton from "../../../Shared/RoundButton.svelte";
  import Button from "../../../Shared/Button.svelte";
  import Clickable from "../../../Shared/Clickable.svelte";
  import ErrorMessageInline from "../../../Shared/ErrorMessageInline.svelte";
  import MenuItem from "../../../Shared/Menu/MenuItem.svelte";
  import PlusIcon from "lucide-svelte/icons/plus";
  import FileIcon from "lucide-svelte/icons/file-lock";
  import SignIcon from "lucide-svelte/icons/signature";
  import EncryptIcon from "lucide-svelte/icons/lock";
  import UnusedIcon from "lucide-svelte/icons/circle-dashed";
  import DistrustIcon from "lucide-svelte/icons/octagon-x";
  import ExportPublicIcon from "lucide-svelte/icons/share-2";
  import ExportPrivateIcon from "lucide-svelte/icons/key-round";
  import ObsoleteIcon from "lucide-svelte/icons/octagon-x";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import ChevronUp from "lucide-svelte/icons/chevron-up";
  import ChevronDown from "lucide-svelte/icons/chevron-down";
  import { getDateString, getDateTimeString } from "../../../../logic/util/date";
  import { assert } from "../../../../logic/util/util";
  import { gt, t } from "../../../../l10n/l10n";

  export let key: PublicKey & PrivateKey;
  export let identity: MailIdentity;

  $: chain = key instanceof SMIMEPublicKey ? key.chain : null;
  $: keyStatusAsync = key instanceof SMIMEPublicKey ? key.keyStatus() : null;

  let isExpanded = key.justCreated;
  let CSRParams: Record<string, string | undefined>;
  let CSRForm: HTMLFormElement;

  let showSecretPassphrase = false;
  async function onExportPrivate() {
    await saveBlobAsFile(key.privateKeyAsFile());
    if (key.passphrase) {
      showSecretPassphrase = true;
    } else {
      await onExportPrivateDone();
    }
  }
  async function onExportPrivatePassphrase() {
    let passwordFilename = key.keyFilename("SecretPassword", "txt");
    let passwordFile = new File([key.passphrase + "\n"], passwordFilename, { type: "text/plain" });
    await saveBlobAsFile(passwordFile);
    await onExportPrivateDone();
  }
  async function onExportPrivateDone() {
    showSecretPassphrase = false;
    key.didBackup = true;
    await identity.account.save();
  }
  async function onExportPublic() {
    await saveBlobAsFile(key.publicKeyAsFile());
  }
  async function onDelete() {
    if (!key.justCreated) {
      if (!confirm(`WARNING\nYou will not be able to read your own emails which are encrypted with this key - both old and new emails.\nMake sure that you have a backup of the key.\nDo you want to delete your own private key?`)) {
        return;
      }
    }
    identity.encryptionPrivateKeys.remove(key);
    await identity.account.save();
  }
  let fileSelector: FileSelector;
  const acceptFileTypes = [ "application/x-x509-email-cert", "application/x-x509-ca-cert", "application/pkix-cert", ".crt", "application/x-pem-file", ".pem" ];
  async function onAddCertificateSMIME() {
    let file = await fileSelector.selectFile();
    if (!file) {
      return;
    }
    let fileContent = await file.text();
    assert(fileContent.includes("-----BEGIN CERTIFICATE-----") ||
      fileContent.includes("-----BEGIN TRUSTED CERTIFICATE-----"),
      gt`Could not find a certificate in this file. It must be in PEM format.`);
    await (key as SMIMEPrivateKey).addCertificates(fileContent);
    keyStatusAsync = (key as SMIMEPrivateKey).keyStatus();
    await identity.account.save();
  }
  async function onRemoveFromChain(certificate: SMIMEPublicKey) {
    (key as SMIMEPrivateKey).chain.remove(certificate);
    keyStatusAsync = (key as SMIMEPrivateKey).keyStatus();
    await identity.account.save();
  }
  function newCSRParams() {
    CSRParams = {
      E: identity.emailAddress,
      CN: identity.realname,
      C: new Intl.Locale(navigator.language).region,
    };
  }
  function toggleCSRParam(field: string) {
    CSRParams[field] = CSRParams[field] == undefined ? "" : undefined;
  }
  async function onExportCSR() {
    CSRParams.C = CSRParams.C?.toUpperCase();
    if (CSRForm.reportValidity()) {
      await saveBlobAsFile(await (key as SMIMEPrivateKey).generateCSRFile(CSRParams));
      CSRParams = undefined;
    }
  }
</script>

<style>
  .key {
    background-color: var(--offset-bg);
    color: var(--offset-fg);
    border-radius: 2px;
    box-shadow: 1px 1px 1px 0px rgba(0, 0, 0, 15%);
    margin: 4px 0px;
  }
  .main-row {
    align-items: center;
    padding: 0px 8px;
  }
  .main-row:hover {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  .usage {
    border-radius: var(--border-radius);
    padding: 4px;
  }
  .name {
    margin-inline: 16px;
    font-weight: bold;
  }
  .keytype {
    justify-content: center;
  }
  .key.obsolete {
    opacity: 70%;
  }
  .key.obsolete .usage {
    opacity: 50%;
  }
  .system {
    opacity: 70%;
    justify-content: end;
  }
  .details {
    margin: 12px 24px 0px 48px;
  }
  .details .label {
    min-width: 8em;
    margin-inline-end: 8px;
    flex-wrap: wrap;
    opacity: 65%;
  }
  .details .label-2-column {
    margin-inline-start: 32px;
    margin-inline-end: 8px;
    opacity: 65%;
  }
  .verification-code:not(.obsolete) {
    margin-block: 24px;
  }
  .fingerprint .label,
  .verification-code .label {
    padding-block: 7px;
  }
  .fingerprint .value,
  .verification-code .value,
  .passphrase .value {
    padding-block: 8px;
    letter-spacing: 0.05em;
    font-family: 'Courier New', Courier, monospace;
    font-size: 15px;
  }
  .fingerprint:not(.obsolete) .value,
  .verification-code:not(.obsolete) .value,
  .passphrase .value {
    background-color: var(--bg);
    color: var(--fg);

    padding-inline: 12px;
    font-weight: 500;
  }
  .passphrase .value {
    padding-block-start: 12px;
    margin-block: 12px;
  }
  .warning {
    background-color: yellow;
    color: darkred;
  }
  .note {
    padding: 6px 12px;
  }
  .usage-detail {
    padding-block-start: 6px;
  }
  .buttons {
    gap: 8px;
    margin-block-start: 8px;
    margin-block-end: 16px;
    width: 100%;
    justify-content: end;
  }
</style>
