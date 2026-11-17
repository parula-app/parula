{#if $recipientsWithoutKeys.hasItems}
  <vbox class="no-keys">
    <hbox class="all box">
      <div class="explanation">{$t`To encrypt this message, add certificates for the following recipients`}</div>
      <hbox flex />
      <hbox class="buttons">
        {#if hasKeyServers}
          <Button
            label={$t`Query key servers`}
            icon={QueryServerIcon}
            onClick={onQueryKeyServer}
            classes="key-server"
            />
        {/if}
        <Button
          label={$t`Import…`}
          icon={ImportIcon}
          onClick={() => showImport = !showImport}
          classes="import"
          selected={showImport}
          />
        <Button
          label={$t`Remove recipients`}
          icon={RemoveAllIcon}
          onClick={onRemoveAll}
          />
      </hbox>
    </hbox>
    <hbox class="recipients">
      {#each $recipientsWithoutKeys.each as recipient}
        <vbox class="recipient box">
          <hbox class="first-row">
            <vbox>
              <Recipient {recipient} />
              <hbox class="email-address font-smallest">{recipient.emailAddress}</hbox>
            </vbox>
            <hbox class="buttons">
              <Button
                label={$t`Remove`}
                icon={RemoveOneIcon}
                onClick={() => onRemoveOne(recipient)}
                />
              <RoundButton
                label={$t`Import`}
                icon={showImport ? ChevronUp : ChevronDown}
                onClick={() => showImport = !showImport}
                border={false}
                classes="plain"
                padding="4px"
                />
            </hbox>
          </hbox>
          {#if showImport}
            <EncryptionImport person={recipient.createPerson(appGlobal.collectedAddressbook)} isOpen={true} />
          {/if}
        </vbox>
      {/each}
    </hbox>
  </vbox>
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { MailIdentity } from "../../../logic/Mail/MailIdentity";
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import { EncryptionSystem } from "../../../logic/Mail/Encryption/enums";
  import { getEncryptionSystem, getPublicKeyForPersonUID } from "../../../logic/Mail/Encryption/KeyUtils";
  import { queryPGPKeyServersForUID } from "../../../logic/Mail/Encryption/PGP/KeyServer";
  import { appGlobal } from "../../../logic/app";
  import EncryptionImport from "../../Contacts/PersonPage/EncryptionImport.svelte";
  import Recipient from "../Message/Recipient.svelte";
  import Button from "../../Shared/Button.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import QueryServerIcon from "lucide-svelte/icons/cloud-download";
  import ImportIcon from "lucide-svelte/icons/file-lock";
  import RemoveAllIcon from "lucide-svelte/icons/trash-2";
  import RemoveOneIcon from "lucide-svelte/icons/trash-2";
  import ChevronDown from "lucide-svelte/icons/chevron-down";
  import ChevronUp from "lucide-svelte/icons/chevron-up";
  import { catchErrors } from "../../Util/error";
  import { gt, t } from "../../../l10n/l10n";
  import { Collection } from "svelte-collections";

  export let mail: EMail;
  export let identity: MailIdentity;
  /** If the email cannot be sent, gives an error message.
   * out only */
  export let encryptionError: string | null = null;

  let showImport = false;

  $: to = mail.to;
  $: cc = mail.cc;
  $: bcc = mail.bcc;
  $: allRecipients = $to.concat($cc).concat($bcc);
  $: recipientKeys = $allRecipients.flatMap(recipient => recipient.findPerson()?.encryptionPublicKeys);
  // TODO Observe `encryptionPublicKeys`
  let recipientsWithoutKeys: Collection<PersonUID>;
  $: $recipientKeys, recipientsWithoutKeys = $allRecipients.filterObservable(p => !getPublicKeyForPersonUID(p));
  /** The key servers have PGP keys, but no S/MIME certificates */
  let hasKeyServers = false;
  $: identity, hasKeyServers = getEncryptionSystem(mail) == EncryptionSystem.PGP;
  $: $recipientsWithoutKeys.hasItems && catchErrors(autoFetchMissingKeys);
  $: encryptionError = $mail.shouldEncrypt && $recipientsWithoutKeys.hasItems ?
    gt`Some recipients are missing certificates for encryption.\nEither add certificates for them, remove them, or disable encryption.` : null;

  async function onQueryKeyServer() {
    await queryKeyServerFor(recipientsWithoutKeys);
  }

  async function autoFetchMissingKeys() {
    await Promise.all([autoFetchAddressbookKeys(), autoQueryKeyServer()]);
  }

  /** The address book search leaves the keys out, to stay fast */
  async function autoFetchAddressbookKeys() {
    await Promise.all(recipientsWithoutKeys.contents.map(recipient =>
      recipient.fetchEncryptionKeys()));
  }

  async function autoQueryKeyServer() {
    if (!hasKeyServers) {
      return;
    }
    let notYetQueried = recipientsWithoutKeys.filterOnce(r => !(r as any)._queriedKeyserver);
    await queryKeyServerFor(notYetQueried);
  }

  async function queryKeyServerFor(recipients: Collection<PersonUID>) {
    if (recipients.isEmpty) {
      return;
    }
    recipients.forEach(recipient => (recipient as any)._queriedKeyserver = true);
    await Promise.all(recipients.contents.map(recipient =>
      queryPGPKeyServersForUID(recipient)));
  }

  function onRemoveAll() {
    mail.to.removeAll(recipientsWithoutKeys);
    mail.cc.removeAll(recipientsWithoutKeys);
    mail.bcc.removeAll(recipientsWithoutKeys);
  }

  function onRemoveOne(recipient: PersonUID) {
    mail.to.remove(recipient);
    mail.cc.remove(recipient);
    mail.bcc.remove(recipient);
  }
</script>

<style>
  .box {
    background-color: var(--offset-bg);
    color: var(--offset-fg);
    border-radius: 2px;
    box-shadow: 1px 1px 1px 0px rgba(0, 0, 0, 15%);
    margin: 4px 0px;
    padding: 6px 16px;
  }
  .all {
    flex-wrap: wrap;
    align-items: center;
    row-gap: 6px;
  }
  .recipients {
    flex-wrap: wrap;
    column-gap: 8px;
    margin-block-end: 16px;
    max-height: 140px; /* A little more than one row, so that the user can see that there is more. */
    overflow-y: scroll;
  }
  .recipient {
    padding-block: 4px;
    padding-inline-start: 16px;
    padding-inline-end: 6px;
  }
  .recipient .email-address {
    opacity: 70%;
  }
  .recipient :global(.key-import) {
    box-shadow: none;
    margin-block-end: -4px;
    padding-inline-start: 0px;
    padding-block: 4px;
  }
  .recipient :global(.button.close),
  .recipient :global(.button.keyserver) {
    display: none;
  }
  .recipient .first-row {
    align-items: center;
    gap: 16px;
  }
  .buttons {
    align-items: baseline;
    justify-items: end;
    gap: 12px;
  }
  .no-keys :global(.button svg) {
    stroke-width: 1.2px;
  }
</style>
