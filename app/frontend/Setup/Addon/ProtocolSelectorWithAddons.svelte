<ProtocolSelector {protocols} bind:selectedProtocol={selectedProtocol} />

{#if account}
  <AddonAccountSetup {account} bind:this={addonSetup} />
{/if}

<script lang="ts">
  import type { Account } from "../../../logic/Abstract/Account";
  import type { AddonConnection } from "../../../logic/Addons/AddonConnection";
  import { addonProtocols } from "../../../logic/Addons/AddonProtocols";
  import AddonAccountSetup from "./AddonAccountSetup.svelte";
  import ProtocolSelector, { type ProtocolDescription } from "../Shared/ProtocolSelector.svelte";

  /** Offers the addon protocols of this type, e.g. "chat" */
  export let type: string;
  export let appProtocols: ProtocolDescription[];
  export let selectedProtocol: string;
  export let newAccount: (protocol: string) => Account;

  let addonSetup: AddonAccountSetup;

  $: protocols = appProtocols.concat($addonProtocols.contents.filter(protocol => protocol.type == type).map(protocol => ({ label: protocol.label, protocolID: protocol.protocol })));
  $: account = addonAccountFor(selectedProtocol);
  function addonAccountFor(protocolID: string): Account & { connection: AddonConnection } | null {
    let isAddonProtocol = addonProtocols.some(protocol => protocol.protocol == protocolID);
    return isAddonProtocol ? newAccount(protocolID) as Account & { connection: AddonConnection } : null;
  }

  /** @returns The account as the user entered it in the setup UI of the addon, or null for a protocol of the app */
  export async function addonAccountFromSetup(): Promise<Account | null> {
    if (!account) {
      return null;
    }
    await addonSetup.onContinue();
    return account;
  }
</script>
