{#if usesHostname}
  <ManualConfigHost bind:config bind:stepFull {isSetup} bind:this={el} />
{:else}
  <ManualConfigURL bind:config bind:stepFull {isSetup} bind:this={el} />
{/if}

{#if $config.oAuth2 instanceof OAuth2 && $config.authMethod == AuthMethod.OAuth2 && stepFull}
  <OAuth2Manual {config} />
{/if}

{#if isSetup && $config.protocol == "pop3"}
  <POP3Warning />
{/if}

{#if !isSetup}
  <hbox flex />
  <hbox class="buttons">
    <Button label={$t`Save`}
      classes="save"
      icon={SaveIcon}
      onClick={onSave}
      />
    <slot name="buttons-bottom-right" />
  </hbox>
{/if}

<script lang="ts">
  import type { MailAccount } from "../../../../logic/Mail/MailAccount";
  import { AuthMethod } from "../../../../logic/Abstract/Account";
  import { OAuth2 } from "../../../../logic/Auth/OAuth2";
  import ManualConfigURL from "./ManualConfigURL.svelte";
  import ManualConfigHost from "./ManualConfigHost.svelte";
  import OAuth2Manual from "./OAuth2Manual.svelte";
  import POP3Warning from "../../../Setup/Mail/POP3Warning.svelte";
  import Button from "../../../Shared/Button.svelte";
  import SaveIcon from "lucide-svelte/icons/save";
  import { t } from "../../../../l10n/l10n";

  /** in/out
   * The entire object changes only when the user changes the protocol,
   * which happens only when `isSetup` is true.
   * If `isSetup` is false (default), then this is: in param only. */
  export let config: MailAccount;
  export let stepFull = true;
  export let isSetup = false;

  $: usesHostname = ["imap", "pop3"].includes($config.protocol);

  $: if (config.fatalError || config.outgoing && config.outgoing.fatalError) {
    stepFull = true;
  }

  async function onSave() {
    await config.save();
    // config.saveAll() would save all dependent accounts,
    // but we're only interested in the outgoing account.
    if (config.outgoing) {
      await config.outgoing.save();
    }
  }

  let el: ManualConfigURL | ManualConfigHost  = null;
  export async function onContinue(): Promise<boolean> {
    config.source = "manual";
    return await el.onContinue();
  }
</script>

<style>
  .buttons {
    justify-content: end;
    margin-block-start: 16px;
  }
  .buttons :global(button) {
    margin-inline-start: 8px;
  }
</style>
