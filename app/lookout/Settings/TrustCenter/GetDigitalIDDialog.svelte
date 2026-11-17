<Dialog title={$t`Get a Digital ID`} okLabel={type == "smime" ? $t`Create and Save Request…` : $t`Create *=> Create the Digital ID`}
  onOK={onOK} width="560px" on:close>
  <vbox class="get-digital-id">
    <span>{$t`A Digital ID lets you add a digital signature to your messages, and lets others send you encrypted messages`}</span>
    <FormGrid columns="150px minmax(0, 1fr)">
      <span>{$t`E-mail address`}</span>
      <ComboBox options={identityOptions} bind:value={identity} on:change={event => onIdentityChanged(event.detail)} label={$t`E-mail address`} />
    </FormGrid>
    <GroupBox label={$t`Type *=> Kind of Digital ID: OpenPGP key or S/MIME certificate`}>
      <vbox class="types">
        <Radio label={$t`OpenPGP key, created on this computer`} bind:group={type} value="openpgp" />
        <Radio label={$t`S/MIME certificate from a certificate authority`} bind:group={type} value="smime" />
      </vbox>
    </GroupBox>
    {#if type == "smime"}
      <GroupBox label={$t`Certificate request`}>
        <vbox class="request">
          <CertificateRequestFields {request} />
          <span class="hint">{$t`The key is created on this computer, and the certificate request is saved as a .csr file. Send it to a certificate authority, e.g. your organization. When you get the certificate, add it in the Trust Center with Add Certificate…, or import the .p12 or .pfx file with Import/Export.`}</span>
        </vbox>
      </GroupBox>
    {/if}
  </vbox>
</Dialog>

<script lang="ts">
  import type { MailIdentity } from "../../../logic/Mail/MailIdentity";
  import { identityLabel, createOpenPGPKey, createSMIMEKey } from "./DigitalIDs";
  import { CertificateRequest } from "./CertificateRequest";
  import CertificateRequestFields from "./CertificateRequestFields.svelte";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import FormGrid from "../../Shared/Form/FormGrid.svelte";
  import GroupBox from "../../Shared/Form/GroupBox.svelte";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import Radio from "../../Shared/Form/Radio.svelte";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let identity: MailIdentity;
  export let identities: MailIdentity[];
  const dispatch = createEventDispatcher<{ change: MailIdentity }>();

  let type: "openpgp" | "smime" = "openpgp";
  let request = CertificateRequest.forIdentity(identity);
  $: identityOptions = identities.map(listed => ({ value: listed, label: identityLabel(listed) }));

  function onIdentityChanged(chosen: MailIdentity) {
    let name = request.name;
    request = CertificateRequest.forIdentity(chosen);
    request.name = name || request.name;
  }

  async function onOK() {
    if (type == "smime") {
      request.validate();
      let key = await createSMIMEKey(identity);
      dispatch("change", identity);
      await request.save(key);
      return;
    }
    await createOpenPGPKey(identity);
    dispatch("change", identity);
  }
</script>

<style>
  .get-digital-id {
    gap: 12px;
  }
  .types,
  .request {
    gap: 8px;
  }
  .hint {
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
</style>
