{#if !haveError}
  <StatusMessage status="success" message={successMessage}>
    <CheckIcon slot="icon" />
  </StatusMessage>
{/if}

{#if !altConfigs || altConfigs.length == 1}
  <hbox class="display single">
    <DisplayConfig {config} />
  </hbox>
{:else}
  <vbox class="configs">
    {#each $uniqueConfigs.each as altConfig}
      <vbox class="alt">
        <hbox class="protocol-header">
          <label class="protocol">
            <input type="radio"
              checked={altConfig == config}
              value={altConfig}
              bind:group={config}
              />
            {labelForMailProtocol(altConfig.protocol)}
          </label>
        </hbox>
        {#if altConfig == config}
          <hbox class="display">
            <DisplayConfig config={altConfig} />
          </hbox>
        {/if}
      </vbox>
    {/each}
  </vbox>
{/if}

{#if config?.protocol == "pop3"}
  <POP3Warning />
{/if}

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { labelForMailProtocol } from "../../../logic/Mail/AccountsList/MailAccounts";
  import DisplayConfig from "./DisplayConfig.svelte";
  import POP3Warning from "./POP3Warning.svelte";
  import StatusMessage from "../Shared/StatusMessage.svelte";
  import CheckIcon from "lucide-svelte/icons/check";
  import { filterUnique } from "../../../logic/util/collections";
  import type { ArrayColl } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  export let config: MailAccount;
  export let altConfigs: ArrayColl<MailAccount>;
  export let haveError = false;

  // Show only the most preferred (= first) config of the same protocol
  $: uniqueConfigs = filterUnique(altConfigs, (a, b) => a.protocol == b.protocol);

  $: successMessage = !config?.source ? $t`No config found` :
    config.source == "ispdb" ? $t`We found the configuration in our database.` :
    config.source == "autoconfig-isp" ? $t`We received the configuration from your email provider.` :
    config.source == "harddisk" ? $t`We found a configuration on your computer.` :
    config.source == "guess" ? $t`We guessed a configuration that might work.` :
    config.source == "autodiscover-xml" ? $t`We received the configuration from Microsoft Exchange.` :
    config.source == "autodiscover-json" ? $t`We received the configuration for Microsoft Exchange` :
    $t`We found a configuration`;
</script>

<style>
  .display.single {
    justify-content: center;
    margin-block-start: 24px;
    margin-block-end: 24px;
  }
  .configs {
    margin-block-start: 24px;
  }
  .alt .display {
    justify-content: start;
    margin-inline-start: 26px;
    margin-block-start: 12px;
    margin-block-end: 24px;
  }
  .protocol {
    margin-inline-start: 8px;
  }
</style>
