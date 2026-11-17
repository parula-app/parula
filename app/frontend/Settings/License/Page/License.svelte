<vbox flex>
  {#if appGlobal.emailAccounts.isEmpty}
    <SetupMail />
  {:else}
    {#await getLicense()}
      <div class="message">{$t`Checking...`}</div>
    {:then}
      {#if license.isSoonExpiring}
        <div>{$t`Your license expires in ${license.daysLeft} days, on ${getDateString(license.expiresOn)}`}</div>
      {:else if license.isExpired}
        <div>{$t`Your license has expired on ${getDateString(license.expiresOn)}`}</div>
      {:else if license.valid && !wasValid}
        <HaveLicense bind:license paidJustNow />
      {:else if license.valid}
        <HaveLicense bind:license />
      {:else if owlLicense}
        <div>{$t`You can upgrade your license from Owl`}</div>
      {:else}
        <div>{$t`You can buy a license to use ${appName} fully`}</div>
      {/if}

      {#if !license?.valid || license.isExpired || license.isSoonExpiring}
        <vbox class="payment-page" flex>
          <hbox class="buttons">
            <Button
              label={$t`Open in browser`}
              onClick={() => openPurchasePage(paid => license = paid)}
              classes="tertiary"
              />
          </hbox>

          <PaymentPage />
        </vbox>
      {/if}
    {:catch ex}
      <div class="error-intro message">{$t`Failed to contact the license server`}</div>
      <ErrorMessageInline {ex} />
    {/await}
  {/if}
</vbox>

<script lang="ts">
  import { checkSavedLicense, Ticket, BadTicket, fetchLicenseFromServer, openPurchasePage, startFastPolling, stopFastPolling } from "../../../../logic/util/LicenseClient";
  import { appGlobal } from "../../../../logic/app";
  import { appName } from "../../../../logic/build";
  import HaveLicense from "./HaveLicense.svelte";
  import PaymentPage from "./PaymentPage.svelte";
  import SetupMail from "../../../Setup/Mail/SetupMail.svelte";
  import ErrorMessageInline from "../../../Shared/ErrorMessageInline.svelte";
  import Button from "../../../Shared/Button.svelte";
  import { getDateString } from "../../../../logic/util/date";
  import { t } from "../../../../l10n/l10n";
  import { onDestroy } from "svelte";

  let license: Ticket = new BadTicket();
  let owlLicense: Ticket | null = null;
  let wasValid = false; // to detect that the license was just purchased

  async function getLicense() {
    license = await checkSavedLicense();
    license = await fetchLicenseFromServer();
    wasValid = license.valid;
    console.log("License ticket on payment settings page", license);
    if (!license.valid || license.isSoonExpiring) {
      startFastPolling(paid => license = paid);
    }
  }

  onDestroy(stopFastPolling);

  function testLicense() {
    license = new Ticket();
    let exp = new Date();
    exp.setDate(exp.getDate() - 2);
    license.expiresOn = exp;
    license.valid = !license.isExpired;
    console.log("Test license expires in", license.daysLeft, "days, soon", license.isSoonExpiring, "old", license.hasRecentlyExpired, "expired", license.isExpired, "ticket", license);
  }
</script>

<style>
  .error-intro {
    margin: 4px 20px;
  }
  .payment-page .buttons {
    justify-content: end;
    margin-block-start: -24px;
    margin-block-end: 12px;
  }
</style>
