{#if $mail.shouldEncrypt && $recipientsWithoutKeys.hasItems}
  <hbox class="info-bar warning" role="alert">
    <WarningIcon size={16} />
    <span class="text">
      {$t`To encrypt this message, add certificates for`}
      {$recipientsWithoutKeys.contents.map(recipient => recipient.name || recipient.emailAddress).join("; ")}
    </span>
    {#if hasKeyServers}
      <button class="link" on:click={() => catchErrors(() => queryKeyServers(recipientsWithoutKeys))}>{$t`Query Key Servers`}</button>
    {/if}
    <button class="link" on:click={() => { isDialogOpen = true; }}>{$t`Certificates… *=> Manage the encryption certificates of the recipients`}</button>
    <button class="link" on:click={() => removeRecipients(recipientsWithoutKeys.contents)}>{$t`Remove These Recipients`}</button>
  </hbox>
{/if}
{#if isDialogOpen}
  <RecipientCertificatesDialog {mail} {recipientsWithoutKeys} {hasKeyServers} on:close={() => { isDialogOpen = false; }} />
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { MailIdentity } from "../../../logic/Mail/MailIdentity";
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import { EncryptionSystem } from "../../../logic/Mail/Encryption/enums";
  import { getEncryptionSystem, getPublicKeyForPersonUID } from "../../../logic/Mail/Encryption/KeyUtils";
  import { queryKeyServers } from "./RecipientKeys";
  import RecipientCertificatesDialog from "./RecipientCertificatesDialog.svelte";
  import WarningIcon from "lucide-svelte/icons/triangle-alert";
  import { catchErrors } from "../../../frontend/Util/error";
  import type { Collection } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  export let mail: EMail;
  export let identity: MailIdentity;
  export let encryptionError: string | null = null;

  let isDialogOpen = false;
  // <copied from="../../../frontend/Mail/Composer/EncryptionDetails.svelte">
  $: to = mail.to;
  $: cc = mail.cc;
  $: bcc = mail.bcc;
  $: allRecipients = $to.concat($cc).concat($bcc);
  $: recipientKeys = $allRecipients.flatMap(recipient => recipient.findPerson()?.encryptionPublicKeys);
  let recipientsWithoutKeys: Collection<PersonUID>;
  $: $recipientKeys, recipientsWithoutKeys = $allRecipients.filterObservable(p => !getPublicKeyForPersonUID(p));
  let hasKeyServers = false;
  $: identity, hasKeyServers = getEncryptionSystem(mail) == EncryptionSystem.PGP;
  $: $mail.shouldEncrypt && $recipientsWithoutKeys.hasItems && catchErrors(autoFetchMissingKeys);
  $: encryptionError = $mail.shouldEncrypt && $recipientsWithoutKeys.hasItems ?
    $t`Some recipients are missing certificates for encryption.\nEither add certificates for them, remove them, or disable encryption.` : null;

  async function autoFetchMissingKeys() {
    await Promise.all([
      Promise.all(recipientsWithoutKeys.contents.map(recipient =>
        recipient.fetchEncryptionKeys())),
      hasKeyServers ? queryKeyServers(recipientsWithoutKeys, true) : null,
    ]);
  }
  // </copied>

  /* <copied to="RecipientCertificatesDialog.svelte"> */
  function removeRecipients(recipients: PersonUID[]) {
    mail.to.removeAll(recipients);
    mail.cc.removeAll(recipients);
    mail.bcc.removeAll(recipients);
  }
  /* </copied> */
</script>

<style>
  .info-bar {
    align-items: center;
    flex-shrink: 0;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin: 4px 24px 0 24px;
    padding: 6px 12px;
    border-radius: var(--lo-radius-small);
    background-color: color-mix(in srgb, var(--lo-warning) 14%, var(--lo-pane-bg));
    border: 1px solid color-mix(in srgb, var(--lo-warning) 45%, transparent);
    color: var(--lo-fg);
    font-size: 13px;
  }
  .info-bar :global(svg) {
    flex-shrink: 0;
    color: var(--lo-warning);
  }
  .text {
    flex: 1 1 200px;
    min-width: 0;
  }
  .link {
    flex-shrink: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--lo-accent-text);
    font: inherit;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
</style>
