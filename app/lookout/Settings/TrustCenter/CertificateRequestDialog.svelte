<Dialog title={$t`Request a Certificate`} okLabel={$t`Save Request…`} onOK={() => request.save(key)} width="520px" on:close>
  <vbox class="certificate-request">
    <span>{$t`Save a certificate request for this Digital ID, and send it to a certificate authority, e.g. your organization. When you get the certificate, add it with Add Certificate….`}</span>
    <CertificateRequestFields {request} />
  </vbox>
</Dialog>

<script lang="ts">
  import type { MailIdentity } from "../../../logic/Mail/MailIdentity";
  import type { SMIMEPrivateKey } from "../../../logic/Mail/Encryption/SMIME/SMIMEPrivateKey";
  import { CertificateRequest } from "./CertificateRequest";
  import CertificateRequestFields from "./CertificateRequestFields.svelte";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import { t } from "../../../l10n/l10n";

  export let identity: MailIdentity;
  export let key: SMIMEPrivateKey;

  let request = CertificateRequest.forIdentity(identity);
</script>

<style>
  .certificate-request {
    gap: 12px;
  }
</style>
