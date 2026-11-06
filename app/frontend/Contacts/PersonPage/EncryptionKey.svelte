<vbox class="key" class:obsolete={$key.obsolete} class:short>
  <Clickable onClick={() => isExpanded = !isExpanded}>
    <hbox class="main-row">
      {#if showIcon}
        <hbox class="usage-icon"
          style:background-color={trustColor[$key.trustLevel] ?? "grey"}
          style:color={trustColorFG[$key.trustLevel] ?? "black"}>
          {#if $key.trustLevel == TrustLevel.Distrusted}
            <DistrustIcon title={$t`Untrusted`} size="16px" />
          {:else if $key.encryptByDefault}
            <EncryptIcon title={$t`Use for encryption and checking signatures`} size="16px" />
          {:else}
            <SignIcon title={$t`Use only for checking signatures`} size="16px" />
          {/if}
        </hbox>
      {/if}
      <hbox class="name">{$key.name}</hbox>
      {#if isExpanded}
        <hbox class="keytype" flex>{$t`Certificate`}</hbox>
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
      <hbox class="acceptance">
        <vbox>
          <label>
            <input type="radio"
              value={TrustLevel.Personal}
              on:change={onSave}
              bind:group={key.trustLevel} />
            {$t`I have personally checked the verification code with ${personName}`}
          </label>
          {#if key.caName}
            <label>
              <input type="radio"
                value={TrustLevel.ThirdParty}
                on:change={onSave}
                bind:group={key.trustLevel} />
              {$t`${key.caName} claims that this is correct *=> A company claims this`}
            </label>
          {:else}
            <label>
              <input type="radio"
                value={TrustLevel.Sender}
                on:change={onSave}
                bind:group={key.trustLevel} />
              {$t`Not checked`}
            </label>
          {/if}
          <label>
            <input type="radio"
              value={TrustLevel.Distrusted}
              on:change={onSave}
              bind:group={key.trustLevel} />
            {$t`This key is bad`}
          </label>
        </vbox>
      </hbox>
      <hbox class="usage-detail">
        <Checkbox toggle
          bind:checked={key.encryptByDefault}
          disabled={$key.trustLevel == TrustLevel.Distrusted}
          on:change={onSave}
          label={$t`Encrypt my emails to ${personName} with this key`} />
      </hbox>
      <vbox class="verification-code">
        <hbox title={$t`To communicate securely, you first need to establish that this key really belongs to ${personName}. Meet or call ${personName} on a secure channel, and have him read his verification code, and compare that it matches what you see.`}>
          <hbox class="label">{$t`Verification code`}</hbox>
          <hbox>
            <RoundButton
              icon={InfoIcon}
              border={false}
              classes="plain"
              disabled={true}
              padding="3px"
              />
          </hbox>
        </hbox>
        <hbox>
          <hbox class="label">
            <hbox class="name-label">{personName}</hbox>
          </hbox>
          <vbox class="value">
            <hbox>{key.fingerprintDisplay.substring(0, 24)}</hbox>
            <hbox>{key.fingerprintDisplay.substring(25)}</hbox>
          </vbox>
        </hbox>
        {#if myPrivateKey}
          <hbox>
            <hbox class="label">
              <hbox class="name-label">{myIdentity.realname}</hbox>
              <!--<hbox class="dropdown">
                <IdentitySelector bind:selectedIdentity={myIdentity} identities={allIdentitiesWithKeys} fromAddress="" fromName="" />
              </hbox>-->
            </hbox>
            <vbox class="value">
              <hbox>{myPrivateKey.fingerprintDisplay.substring(0, 24)}</hbox>
              <hbox>{myPrivateKey.fingerprintDisplay.substring(25)}</hbox>
            </vbox>
          </hbox>
        {/if}
      </vbox>
      {#if !short}
        <hbox>
          <hbox class="label">{$t`Created`}</hbox>
          <hbox class="value">{getDateString(key.created)}</hbox>
          <hbox class="label-2-column">{$t`Expires *=> No longer valid after this date`}</hbox>
          <hbox class="value" title={key.expires ? getDateTimeString(key.expires) : null}>{key.expires ? getDateString(key.expires) : "-"}</hbox>
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
              {#if keyStatus == KeyStatus.ChainInvalid}
                <hbox>{$t`The certificate chain could not be verified.`}</hbox>
              {:else if keyStatus == KeyStatus.ChainIncomplete}
                <hbox>
                  <Button
                    label={$t`Please add the intermediate certificate.`}
                    onClick={onAddCertificateSMIME}
                    />
                </hbox>
              {:else if keyStatus == KeyStatus.SelfSignedRoot}
                <hbox>{$t`WARNING This certificate uses a self-signed root certificate`}</hbox>
              {:else if keyStatus == KeyStatus.Valid}
                <hbox>{$t`This certificate is valid`}</hbox>
              {:else}
                <hbox>{$t`Unexpected certificate status`}</hbox>
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
          <hbox class="label" />
          <hbox class="buttons">
            <Button
              label={$t`Export…`}
              icon={ExportIcon}
              onClick={onExport}
              />
            <RoundButton
              label={$t`Delete`}
              icon={DeleteIcon}
              onClick={onDelete}
              />
          </hbox>
        </hbox>
      {/if}
    </vbox>
  {/if}
</vbox>

<FileSelector {acceptFileTypes} bind:this={fileSelector} />

<script lang="ts">
  import { PublicKey } from "../../../logic/Mail/Encryption/PublicKey";
  import { trustColor, trustColorFG, TrustLevel } from "../../../logic/Mail/Encryption/enums";
  import { SMIMEPublicKey, KeyStatus } from "../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
  import type { Person } from "../../../logic/Abstract/Person";
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import { getMyPrivateKey } from "../../../logic/Mail/Encryption/KeyUtils";
  import { findAllIdentities } from "../../../logic/Mail/MailIdentity";
  import FileSelector from "../../Mail/Composer/Attachments/FileSelector.svelte";
  import IdentitySelector from "../../Mail/Composer/IdentitySelector.svelte";
  import Checkbox from "../../Shared/Checkbox.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import Button from "../../Shared/Button.svelte";
  import Clickable from "../../Shared/Clickable.svelte";
  import ErrorMessageInline from "../../Shared/ErrorMessageInline.svelte";
  import SignIcon from "lucide-svelte/icons/signature";
  import EncryptIcon from "lucide-svelte/icons/lock";
  import DistrustIcon from "lucide-svelte/icons/octagon-x";
  import ExportIcon from "lucide-svelte/icons/share-2";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import InfoIcon from "lucide-svelte/icons/info";
  import ChevronUp from "lucide-svelte/icons/chevron-up";
  import ChevronDown from "lucide-svelte/icons/chevron-down";
  import { getDateString, getDateTimeString } from "../../../logic/util/date";
  import { saveBlobAsFile } from "../../Util/util";
  import { showError } from "../../Util/error";
  import { t } from "../../../l10n/l10n";

  export let key: PublicKey;
  /** If you don't have a `Person` */
  export let personUID: PersonUID = null;
  export let person: Person = personUID.findPerson();
  /** short = for message pane, long = in contacts app */
  export let short = false;
  export let showIcon = true;
  export let isExpanded = false;

  $: allIdentitiesWithKeys = findAllIdentities().filterObservable(i => i.encryptionPrivateKeys.some(key => !key.obsolete && (key.encryptByDefault || key.useToSign)));
  $: myIdentity = $allIdentitiesWithKeys.first;
  $: myPrivateKey = myIdentity ? getMyPrivateKey(myIdentity) : null;
  $: personName = person?.name ?? personUID?.name ?? $t`this person`;

  $: chain = key instanceof SMIMEPublicKey ? key.chain : null;
  $: keyStatusAsync = key instanceof SMIMEPublicKey ? key.keyStatus() : null;

  async function onExport() {
    await saveBlobAsFile(key.publicKeyAsFile());
  }

  async function onSave() {
    try {
      if (person) {
        await person.save();
      } else if (personUID) {
        await personUID.findPerson()?.save();
      }
    } catch (ex) {
      showError(ex);
    }
  }
  async function onDelete() {
    if (!confirm(`Do you want to delete this public key for ${personName}? You will not be able to validate emails signed with this key.`)) {
      return;
    }
    person.encryptionPublicKeys.remove(key);
    await person.save();
  }
  let fileSelector: FileSelector;
  const acceptFileTypes = [ "application/x-x509-email-cert", "application/x-x509-ca-cert", "application/pkix-cert", ".crt", "application/x-pem-file", ".pem" ];
  async function onAddCertificateSMIME() {
    let file = await fileSelector.selectFile();
    if (!file) {
      return;
    }
    let fileContent = await file.text();
    await (key as SMIMEPublicKey).addCertificates(fileContent);
    keyStatusAsync = (key as SMIMEPublicKey).keyStatus();
    await person.save();
  }
  async function onRemoveFromChain(certificate: SMIMEPublicKey) {
    (key as SMIMEPublicKey).chain.remove(certificate);
    keyStatusAsync = (key as SMIMEPublicKey).keyStatus();
    await person.save();
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
  .usage-icon {
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
  .key.obsolete .usage-icon {
    opacity: 50%;
  }
  .system {
    opacity: 70%;
    justify-content: end;
  }
  .details {
    margin: 12px 24px 0px 24px;
  }
  .details > hbox {
    margin-block-end: 2px;
  }
  .details .label {
    min-width: 8em;
    max-width: 8em;
    display: flex;
    align-items: start;
    flex-wrap: wrap;
    margin-inline-end: 8px;
    opacity: 65%;
  }
  .details .label-2-column {
    margin-inline-start: 32px;
    margin-inline-end: 8px;
    opacity: 65%;
  }
  .acceptance label {
    align-items: center;
  }
  .acceptance input[type=radio] {
    margin-inline-end: 8px;
    margin-block-end: 2px; /* align with text */
  }
  .verification-code:not(.obsolete) {
    margin-block: 20px;
  }
  .short .verification-code:not(.obsolete) {
    margin-block-start: 6px;
  }
  .fingerprint .label,
  .verification-code .label {
    padding-block: 7px;
    max-width: max-content;
  }
  .fingerprint .value,
  .verification-code .value {
    letter-spacing: 0.05em;
    padding-block: 8px;
    font-family: 'Courier New', Courier, monospace;
  }
  .fingerprint:not(.obsolete) .value,
  .verification-code:not(.obsolete) .value {
    background-color: var(--bg);
    color: var(--fg);

    font-weight: 500;
    padding-inline: 12px;
  }
  .verification-code .name-label {
    padding-inline-start: 16px;
  }
  .acceptance {
    padding-block: 4px;
  }
  .usage-detail {
    padding-block-start: 8px;
  }
  .buttons {
    gap: 8px;
    margin-block-start: 8px;
    margin-block-end: 16px;
    width: 100%;
    justify-content: end;
  }
</style>
