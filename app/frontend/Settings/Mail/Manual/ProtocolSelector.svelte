<select value={config.protocol} required disabled={!isSetup}
  on:change={onProtocolChanged}
  class="protocol"
  {tabindex}
  >
  {#each protocols as protocol}
    <option value={protocol}>{labelForMailProtocol(protocol)}</option>
  {/each}
</select>

<script lang="ts">
  import type { MailAccount } from "../../../../logic/Mail/MailAccount";
  import { SMTPAccount } from "../../../../logic/Mail/SMTP/SMTPAccount";
  import { TLSSocketType } from "../../../../logic/Abstract/TCPAccount";
  import { kStandardPorts } from "../../../../logic/Mail/AutoConfig/configInfo";
  import { newAccountForProtocol, listMailProtocols, labelForMailProtocol } from "../../../../logic/Mail/AccountsList/MailAccounts";
  import { createEventDispatcher } from "svelte";
  const dispatchEvent = createEventDispatcher();

  /** in/out */
  export let config: MailAccount;
  export let isSetup: boolean;
  export let tabindex: number | undefined = undefined;

  /** Also an addon protocol whose addon doesn't run */
  $: protocols = [...new Set([...listMailProtocols(), $config.protocol])];

  function onProtocolChanged(event: Event) {
    let el = event.target as HTMLSelectElement;
    let protocol = el.value;
    console.log("new protocol", protocol);
    let newConfig = newAccountForProtocol(protocol);
    newConfig.cloneFrom(config);
    if (!kStandardPorts.find(p => p.protocol == newConfig.protocol && p.tls == newConfig.tls)) {
      newConfig.tls = TLSSocketType.TLS;
    }
    newConfig.port = kStandardPorts.find(p => p.protocol == newConfig.protocol && p.tls == newConfig.tls)?.port ?? 443;
    newConfig.url = "";
    if ((protocol == "imap" || protocol == "pop3") && !newConfig.outgoing) {
      let lastOutgoing = config.outgoing;
      let outgoing = newAccountForProtocol("smtp");
      outgoing.cloneFrom(lastOutgoing ?? newConfig);
      if (!lastOutgoing) {
        outgoing.port = kStandardPorts.find(p => p.protocol == outgoing.protocol && p.tls == outgoing.tls)?.port ?? 587;
      }
      newConfig.outgoing = outgoing as SMTPAccount;
    }
    config = newConfig;
    dispatchEvent("newProtocol", protocol);
  }
</script>

<style>
  select.protocol {
    opacity: unset;
  }
  select {
    min-width: 7em;
  }
</style>
