<OptionsPage icon={TrustCenterIcon} description={$t`Help keep your messages secure and your computer healthy`}>
  <OptionsSection title={$t`Encrypted email`}>
    <OptionsRow icon={EncryptIcon}>
      {#if identity}
        <grid class="fields">
          <span>{$t`E-mail address`}</span>
          <ComboBox options={identityOptions} value={identity} on:change={event => onIdentityChosen(event.detail)} label={$t`E-mail address`} width="100%" />
          <span>{$t`Digital ID`}</span>
          {#if keyOptions.length}
            <ComboBox options={keyOptions} value={key} on:change={event => catchErrors(() => onKeyChosen(event.detail))} label={$t`Digital ID`} width="100%" />
          {:else}
            <span class="hint">{$t`You don't have a Digital ID for ${identity.emailAddress} yet. Import one or get a new one below.`}</span>
          {/if}
          {#if key}
            <span>{$t`Issued to *=> Owner of the Digital ID`}</span>
            <span class="value">{key.userIDs.contents.join(", ") || "-"}</span>
            <span>{$t`Issued by *=> Certificate authority that certified the Digital ID`}</span>
            <span class="value">{key.caName || $t`Not certified by a certification authority`}</span>
            <span>{$t`Valid to *=> Date until which the Digital ID is valid`}</span>
            <span class="value">{key.expires ? getDateString(key.expires) : $t`No end date`}</span>
            <span>{$t`Verification code`}</span>
            <span class="value code">{key.fingerprintDisplay}</span>
            {#if key instanceof SMIMEPrivateKey}
              <span>{$t`Certificate`}</span>
              <vbox class="status">
                {#await statusAsync then status}
                  <span class="value">{keyStatusText(status)}</span>
                  {#if needsCertificate(status)}
                    <hbox class="buttons">
                      <DialogButton label={$t`Request Certificate…`} onClick={() => { isRequestOpen = true; }} />
                      <DialogButton label={$t`Add Certificate…`} onClick={onAddCertificate} />
                    </hbox>
                  {/if}
                {:catch ex}
                  <span class="value error">{ex?.message ?? ex}</span>
                {/await}
              </vbox>
            {/if}
          {/if}
        </grid>
        <Checkbox label={$t`Encrypt contents and attachments for outgoing messages`}
          checked={encrypt} disabled={!isUsable && noKeyReason}
          on:change={event => catchErrors(() => onEncrypt(event.detail))} />
        <Checkbox label={$t`Add digital signature to outgoing messages`}
          checked={sign}
          disabled={!isUsable ? noKeyReason : encrypt && $t`Encrypted messages are always signed`}
          on:change={event => catchErrors(() => onSign(event.detail))} />
      {:else}
        <span class="hint">{$t`Add an email account first`}</span>
      {/if}
    </OptionsRow>
  </OptionsSection>

  <OptionsSection title={$t`Digital IDs (Certificates)`}>
    <OptionsRow icon={CertificateIcon}>
      <span>{$t`Digital IDs or Certificates are documents that allow you to prove your identity in electronic transactions`}</span>
      <hbox class="buttons">
        <DialogButton label={$t`Import/Export… *=> Import a Digital ID from a file or export it to a file`} onClick={() => { isImportExportOpen = true; }}
          disabled={!identity && $t`Add an email account first`} />
        <DialogButton label={$t`Get a Digital ID…`} onClick={() => { isGetOpen = true; }}
          disabled={!identity && $t`Add an email account first`} />
      </hbox>
    </OptionsRow>
  </OptionsSection>

  <OptionsSection title={$t`Read as Plain Text`}>
    <OptionsRow icon={PlainTextIcon}>
      <Checkbox label={$t`Read all standard mail in plain text`} checked={$contentRenderingSetting.value == "plaintext"}
        on:change={event => { contentRenderingSetting.value = event.detail ? "plaintext" : "html"; }} />
    </OptionsRow>
  </OptionsSection>
</OptionsPage>

{#if isImportExportOpen && identity}
  <DigitalIDDialog {identity} {identities} on:change={event => onKeysChanged(event.detail)}
    on:close={() => { isImportExportOpen = false; }} />
{/if}
{#if isGetOpen && identity}
  <GetDigitalIDDialog {identity} {identities} on:change={event => onKeysChanged(event.detail)}
    on:close={() => { isGetOpen = false; }} />
{/if}
{#if isRequestOpen && key instanceof SMIMEPrivateKey}
  <CertificateRequestDialog {identity} {key} on:close={() => { isRequestOpen = false; }} />
{/if}
<FileSelector bind:this={fileSelector} {acceptFileTypes} />

<script lang="ts">
  import type { MailIdentity } from "../../../logic/Mail/MailIdentity";
  import { usableDigitalIDs, keysAwaitingCertificate, digitalIDLabel, identityLabel, setDefaultDigitalID, addCertificateFile, keyStatusText, needsCertificate, type DigitalID } from "./DigitalIDs";
  import { selectedIdentity } from "./selected";
  import { SMIMEPrivateKey } from "../../../logic/Mail/Encryption/SMIME/SMIMEPrivateKey";
  import { getMyPrivateKey } from "../../../logic/Mail/Encryption/KeyUtils";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import { getDateString } from "../../../logic/util/date";
  import { catchErrors } from "../../../frontend/Util/error";
  import { appGlobal } from "../../../logic/app";
  import OptionsPage from "../Shared/OptionsPage.svelte";
  import OptionsSection from "../Shared/OptionsSection.svelte";
  import OptionsRow from "../Shared/OptionsRow.svelte";
  import DigitalIDDialog from "./DigitalIDDialog.svelte";
  import GetDigitalIDDialog from "./GetDigitalIDDialog.svelte";
  import CertificateRequestDialog from "./CertificateRequestDialog.svelte";
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import FileSelector from "../../../frontend/Mail/Composer/Attachments/FileSelector.svelte";
  import TrustCenterIcon from "lucide-svelte/icons/shield-check";
  import EncryptIcon from "lucide-svelte/icons/lock-keyhole";
  import CertificateIcon from "lucide-svelte/icons/badge-check";
  import PlainTextIcon from "lucide-svelte/icons/file-text";
  import { t } from "../../../l10n/l10n";

  const contentRenderingSetting = getLocalStorage<string>("mail.contentRendering", "html");
  const identities = appGlobal.emailAccounts.contents
    .flatMap(account => account.identities.contents)
    .filter(listed => !listed.isCatchAll);
  // <copied from="../../../frontend/Settings/Mail/Account/EncryptionKey.svelte">
  const acceptFileTypes = [ "application/x-x509-email-cert", "application/x-x509-ca-cert", "application/pkix-cert", ".crt", "application/x-pem-file", ".pem", ".p7b", ".p7c" ];
  // </copied>

  let identity: MailIdentity = identities.find(listed => listed == $selectedIdentity) ?? identities[0] ?? null;
  let key: DigitalID | null = null;
  let encrypt = false;
  let sign = false;
  let fileSelector: FileSelector;
  let isImportExportOpen = false;
  let isGetOpen = false;
  let isRequestOpen = false;

  $: identityOptions = identities.map(listed => ({ value: listed, label: identityLabel(listed) }));
  $: privateKeys = identity?.encryptionPrivateKeys;
  $: $privateKeys, identity, reload();
  $: usableKeys = identity && $privateKeys ? usableDigitalIDs(identity) : [];
  $: keyOptions = identity && $privateKeys ? [ ...usableKeys, ...keysAwaitingCertificate(identity).filter(listed => !usableKeys.includes(listed)) ]
    .map(listed => ({
      value: listed as DigitalID,
      label: usableKeys.includes(listed) ? digitalIDLabel(listed) : $t`${digitalIDLabel(listed)} - waiting for the certificate`,
    })) : [];
  $: isUsable = usableKeys.includes(key);
  $: noKeyReason = !identity ? null
    : key ? $t`Your Digital ID for ${identity.emailAddress} is waiting for its certificate. Request or add it above.`
    : $t`You don't have a Digital ID for ${identity.emailAddress} yet. Import one or get a new one below.`;
  $: statusAsync = key instanceof SMIMEPrivateKey ? key.keyStatus() : Promise.resolve(null);

  function reload() {
    if (key && identity?.encryptionPrivateKeys.contains(key)) {
      return;
    }
    key = identity ? (getMyPrivateKey(identity) as DigitalID) ?? keysAwaitingCertificate(identity)[0] ?? null : null;
    encrypt = !!key?.encryptByDefault;
    sign = !!key?.useToSign || encrypt;
  }

  function onIdentityChosen(chosen: MailIdentity) {
    key = null;
    identity = chosen;
  }

  async function onKeyChosen(chosen: DigitalID) {
    key = chosen;
    if (isUsableKey(chosen)) {
      await save();
    }
  }

  async function onEncrypt(checked: boolean) {
    encrypt = checked;
    sign = sign || encrypt;
    await save();
  }

  async function onSign(checked: boolean) {
    sign = checked || encrypt;
    await save();
  }

  async function save() {
    await setDefaultDigitalID(identity, key, encrypt, sign);
  }

  function isUsableKey(listed: DigitalID): boolean {
    return usableDigitalIDs(identity).includes(listed);
  }

  function onKeysChanged(changed: MailIdentity) {
    key = null;
    identity = changed;
    reload();
  }

  async function onAddCertificate() {
    let file = await fileSelector.selectFile();
    if (!file || !(key instanceof SMIMEPrivateKey)) {
      return;
    }
    await addCertificateFile(identity, key, file);
    statusAsync = key.keyStatus();
    key = key;
  }
</script>

<style>
  .fields {
    grid-template-columns: 136px minmax(200px, 400px);
    align-items: center;
    gap: 8px 12px;
    margin-block-end: 4px;
  }
  .value {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--lo-fg-secondary);
  }
  .code {
    font-family: "Cascadia Mono", Consolas, monospace;
    letter-spacing: 0.04em;
  }
  .status {
    gap: 8px;
  }
  .buttons {
    gap: 8px;
  }
  .buttons :global(.dialog-button) {
    min-width: 140px;
  }
  .error {
    color: var(--lo-danger);
  }
</style>
