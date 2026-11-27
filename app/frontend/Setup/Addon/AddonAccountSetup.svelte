{#if protocol}
  <vbox class="addon-account-setup">
    {#key protocol.protocol}
      <AddonFrame addon={protocol.addon} entry={protocol.contribution.setup} maxHeight={600} bind:frame />
    {/key}
  </vbox>
{:else}
  <hbox class="not-available">{$t`The addon for this protocol is not running`}</hbox>
{/if}

<script lang="ts">
  import type { Account } from "../../../logic/Abstract/Account";
  import type { AddonConnection } from "../../../logic/Addons/AddonConnection";
  import { addonProtocols } from "../../../logic/Addons/AddonProtocols";
  import type { SandboxFrame } from "../../../logic/Addons/Sandbox/SandboxFrame";
  import AddonFrame from "../../Addons/AddonFrame.svelte";
  import { UserError } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";

  /** Shows the `setup` UI of the addon that implements the protocol of `account`,
   * and takes what the user entered there. */

  export let account: Account & { connection: AddonConnection };

  let frame: SandboxFrame | null = null;

  $: protocol = $addonProtocols.find(protocol => protocol.protocol == account.protocol);

  /** The user pressed Continue
   * @returns true = can continue */
  export async function onContinue(): Promise<boolean> {
    let setup = frame && protocol?.protocols.setupOf(frame.bridge);
    if (!setup) {
      throw new UserError($t`Please enter your account in the form of the addon`);
    }
    account.connection.fromAddonSetup(setup);
    return true;
  }
</script>

<style>
  .addon-account-setup {
    margin-block-start: 24px;
    min-width: 0;
  }
  .not-available {
    margin-block-start: 24px;
  }
</style>
