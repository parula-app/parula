<hbox class="payment-bar">
  <hbox flex />
  <div class="message">{$t`Your license expires in ${license.daysLeft} days, on ${getDateString(license.expiresOn)}`}</div>
  <hbox flex />
  <Button
    label={$t`Renew`}
    onClick={() => openPurchasePage(paid => license = paid)}
    />
</hbox>

<script lang="ts">
  import { Ticket, openPurchasePage } from "../../../../logic/util/LicenseClient";
  import { getDateString } from "../../../../logic/util/date";
  import Button from "../../../Shared/Button.svelte";
  import { t } from "../../../../l10n/l10n";

  export let license: Ticket;
</script>

<style>
  .payment-bar {
    padding: 6px 16px;
    align-items: center;
    background-color: #FFF160;
    color: #160C27;
    border-radius: inherit;
  }
  .payment-bar :global(button) {
    padding: 2px 12px !important;
  }
</style>
