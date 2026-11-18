<vbox class="license">
  {#if $emailAccounts.isEmpty}
    <span class="lo-secondary">{$t`Add an email account to buy or check your license`}</span>
  {:else if isChecking}
    <span class="lo-secondary">{$t`Checking…`}</span>
  {:else if error}
    <span>{$t`Failed to contact the license server`}</span>
    <span class="lo-secondary error">{error.message ?? String(error)}</span>
  {:else}
    <span>{status.text}</span>
  {/if}
  {#if !$emailAccounts.isEmpty && !isChecking && (error || status.needsPurchase)}
    <hbox>
      <DialogButton label={status.purchaseLabel} icon={PurchaseIcon} onClick={purchase} />
    </hbox>
  {/if}
</vbox>

<script lang="ts">
  import { checkSavedLicense, fetchLicenseFromServer, openPurchasePage, startFastPolling, stopFastPolling, type Ticket } from "../../../../logic/util/LicenseClient";
  import { appGlobal } from "../../../../logic/app";
  import { LicenseStatus } from "../LicenseStatus";
  import DialogButton from "../../../Shared/Dialog/DialogButton.svelte";
  import PurchaseIcon from "lucide-svelte/icons/external-link";
  import { onDestroy, onMount } from "svelte";
  import { t } from "../../../../l10n/l10n";

  const emailAccounts = appGlobal.emailAccounts;

  let status = new LicenseStatus();
  let isChecking = true;
  let error: Error = null;

  function setLicense(license: Ticket) {
    status = new LicenseStatus(license);
  }

  // <copied from="../../../../frontend/Settings/License/Page/License.svelte">
  async function getLicense() {
    setLicense(await checkSavedLicense());
    setLicense(await fetchLicenseFromServer());
    if (status.needsPurchase) {
      startFastPolling(setLicense);
    }
  }
  onDestroy(stopFastPolling);
  // </copied>

  onMount(async () => {
    if ($emailAccounts.isEmpty) {
      return;
    }
    try {
      await getLicense();
    } catch (ex) {
      error = ex;
    } finally {
      isChecking = false;
    }
  });

  async function purchase() {
    await openPurchasePage(setLicense);
  }
</script>

<style>
  .license {
    gap: 8px;
  }
  .error {
    font-size: var(--lo-font-size-small);
  }
</style>
