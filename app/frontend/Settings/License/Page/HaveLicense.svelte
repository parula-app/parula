<vbox>
  <div>{$t`Your license is valid until ${getDateString(license.expiresOn)}`}</div>
  <hbox class="thankyou">
    <div>{$t`Thank you for your purchase.`}</div>
    <HeartIcon />
  </hbox>
  {#if paidJustNow}
    <hbox class="party">
      <PartyIcon size="96px" />
    </hbox>
  {/if}
</vbox>

<script lang="ts">
  import { Ticket } from "../../../../logic/util/LicenseClient";
  import { getDateString } from "../../../../logic/util/date";
  import HeartIcon from "lucide-svelte/icons/heart";
  import PartyIcon from "lucide-svelte/icons/party-popper";
  import { t } from "../../../../l10n/l10n";

  export let license: Ticket;
  export let paidJustNow = false;
</script>

<style>
  .thankyou {
    margin-block-start: 2px;
  }
  .thankyou :global(svg) {
    fill: red;
    stroke: #FF000033;
    margin-inline-start: 8px;
  }
  .party {
    margin-inline-start: 48px;
    margin-block-start: 48px;
  }
  .party :global(svg) {
    fill: yellow;
    stroke: green;
    stroke-width: 1px;
  }
</style>
