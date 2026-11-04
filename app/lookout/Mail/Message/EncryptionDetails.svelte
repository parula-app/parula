{#if isExpanded}
  <Dialog title={$t`Message Security Properties`} cancelLabel={$t`Close`} width="560px" on:close={() => { isExpanded = false; }}>
    <vbox class="security">
      <FormGrid columns="max-content minmax(0, 1fr)">
        <span class="lo-form-label">{$t`Subject`}</span>
        <span class="value">{$message.subject ?? ""}</span>
      </FormGrid>
      <span>{$t`Messages may contain encryption and digital signature layers. Each digital signature layer may contain multiple signatures.`}</span>
      <span class="caption">{$t`Security Layers`}</span>
      <ListView items={layers} bind:selected={selectedLayer} label={$t`Security Layers`} height="96px" let:item>
        <hbox class="layer">
          <svelte:component this={item.icon} size={16} />
          <span>{item.label}</span>
        </hbox>
      </ListView>
      <span class="caption">{$t`Description`}</span>
      <div class="description">
        <div class="description-title">{title}</div>
        <div>{msg}</div>
      </div>
      {#if signingKey && !mySigningKey}
        <GroupBox label={$t`Signing key`}>
          <FormGrid columns="max-content minmax(0, 1fr)">
            <span class="lo-form-label">{$t`Signer *=> Person who signed the email`}</span>
            <span class="value">{$signingKey.name ?? fromName}</span>
            <span class="lo-form-label">{$t`System`}</span>
            <span class="value">{signingKey.system}</span>
            <span class="lo-form-label">{$t`Fingerprint`}</span>
            <span class="value fingerprint">{signingKey.fingerprintDisplay}</span>
            <span class="lo-form-label">{$t`Valid from`}</span>
            <span class="value">{signingKey.created ? getDateString(signingKey.created) : "–"}</span>
            <span class="lo-form-label">{$t`Valid to`}</span>
            <span class="value">{signingKey.expires ? getDateString(signingKey.expires) : "–"}</span>
          </FormGrid>
        </GroupBox>
        <GroupBox label={$t`Edit Trust`}>
          <!-- <copied from="../../../frontend/Contacts/PersonPage/EncryptionKey.svelte" acceptance> -->
          {#each [TrustLevel.Personal, signingKey.caName ? TrustLevel.ThirdParty : TrustLevel.Sender, TrustLevel.Distrusted] as level}
            <Radio label={trustLabel(level, signingKey.caName, fromName)}
              bind:group={signingKey.trustLevel} value={level}
              on:change={() => catchErrors(onTrustChanged)} />
          {/each}
          <!-- </copied> -->
        </GroupBox>
      {/if}
    </vbox>
  </Dialog>
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { PublicKey } from "../../../logic/Mail/Encryption/PublicKey";
  import { findIdentityForEMailAddress } from "../../../logic/Mail/MailIdentity";
  import { getPublicKeyByKeyID } from "../../../logic/Mail/Encryption/KeyUtils";
  import { TrustLevel } from "../../../logic/Mail/Encryption/enums";
  import { catchErrors, showError } from "../../../frontend/Util/error";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import FormGrid from "../../Shared/Form/FormGrid.svelte";
  import GroupBox from "../../Shared/Form/GroupBox.svelte";
  import ListView from "../../Shared/Form/ListView.svelte";
  import Radio from "../../Shared/Form/Radio.svelte";
  import SignedIcon from "lucide-svelte/icons/signature";
  import EncryptedIcon from "lucide-svelte/icons/lock";
  import SubjectIcon from "lucide-svelte/icons/mail";
  import { getDateString } from "../../../logic/util/date";
  import { t } from "../../../l10n/l10n";

  export let message: EMail;
  export let isExpanded = false;

  let signingKey: PublicKey = null;
  /* <copied from="../../../frontend/Mail/Message/EncryptionButtons.svelte"> */
  $: getPublicKeyByKeyID($message.signedByKeyID, message)
    .then(key => signingKey = key)
    .catch(showError);
  /* </copied> */
  /* <copied from="EncryptionButtons.svelte"> */
  $: isSigned = $message && !!message.signedByKeyID && !!signingKey && signingKey.trustLevel != TrustLevel.Distrusted;
  /* </copied> */
  $: isEncrypted = !!$message.wasEncrypted;
  // <copied from="../../../frontend/Mail/Message/EncryptionDetails.svelte">
  $: identity = $message.outgoing ? findIdentityForEMailAddress($message.from?.emailAddress) : null;
  $: mySigningKey = identity?.encryptionPrivateKeys.find(key => key.id == message.signedByKeyID);
  $: title = isSigned && isEncrypted
      ? $t`End-to-end encrypted and signed`
      : isSigned
        ? $t`Signed`
        : $t`End-to-end-encrypted, but not signed`;
  $: fromName = $message.from?.findPerson()?.name ?? $message.from?.nameOrEMail;
  $: msg = mySigningKey
      ? $t`You sent this email`
      : isSigned && isEncrypted
        ? $t`If - and only if - you have confidence in the certificate below, you can be sure that this email was indeed written by ${fromName}. Only the recipients can read it, but the email provider cannot.`
        : isSigned
          ? $t`If - and only if - you have confidence in the certificate below, you can be sure that this email was indeed written by ${fromName}. It was not encrypted, meaning that it was not protected from surveillance.`
          : $t`Only the recipients can read this email, but there is no assurance about who wrote it`;
  // </copied>
  $: layers = [
    { label: $t`Subject: ${message.subject ?? ""}`, icon: SubjectIcon },
    ...(isEncrypted ? [{ label: $t`Encryption Layer`, icon: EncryptedIcon }] : []),
    ...(isSigned ? [{ label: $t`Digital Signature Layer`, icon: SignedIcon }] : []),
  ];
  let selectedLayer = null;

  function trustLabel(level: TrustLevel, caName: string | null, personName: string): string {
    switch (level) {
      case TrustLevel.Personal:
        return $t`I have personally checked the verification code with ${personName}`;
      case TrustLevel.ThirdParty:
        return $t`${caName ?? ""} claims that this is correct`;
      case TrustLevel.Distrusted:
        return $t`This key is bad`;
      default:
        return $t`Not checked`;
    }
  }

  async function onTrustChanged() {
    // <copied from="../../../frontend/Contacts/PersonPage/EncryptionKey.svelte" onSave()>
    await message.from?.findPerson()?.save();
    // </copied>
  }
</script>

<style>
  .security {
    gap: 8px;
  }
  .caption {
    font-weight: 600;
    margin-top: 4px;
  }
  .layer {
    align-items: center;
    gap: 8px;
  }
  .layer :global(svg) {
    flex-shrink: 0;
    color: var(--lo-accent-text);
  }
  .description {
    padding: 8px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
    line-height: 1.4;
  }
  .description-title {
    font-weight: 600;
    margin-bottom: 4px;
  }
  .value {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .fingerprint {
    font-family: monospace;
  }
</style>
