<Header
  title={$t`Set up your existing chat account`}
  subtitle={$t`Import your existing chat account or create a new one`}
/>

<ProtocolSelectorWithAddons type="chat" {appProtocols} newAccount={newChatAccountForProtocol}
  bind:selectedProtocol={selectedProtocol} bind:this={protocolSelector} />

<ErrorMessageInline bind:this={errorUI} />

<ButtonsBottom
  onContinue={() => catchErrors(onContinue, errorUI.showError)}
  canContinue={!!selectedProtocol}
  canCancel={true}
  onCancel={onCancel}
  />

<script lang="ts">
  import { newChatAccountForProtocol } from "../../../logic/Chat/AccountsList/ChatAccounts";
  import type { ChatAccount } from "../../../logic/Chat/ChatAccount";
  import type { AddonChatAccount } from "../../../logic/Chat/Addon/AddonChatAccount";
  import { appGlobal } from "../../../logic/app";
  import ProtocolSelectorWithAddons from "../Addon/ProtocolSelectorWithAddons.svelte";
  import type { ProtocolDescription } from "../Shared/ProtocolSelector.svelte";
  import ButtonsBottom from "../Shared/ButtonsBottom.svelte";
  import Header from "../Shared/Header.svelte";
  import ErrorMessageInline from "../../Shared/ErrorMessageInline.svelte";
  import { catchErrors } from "../../Util/error";
  import XMPPLogin from "./XMPPLogin.svelte";
  import MatrixLogin from "./MatrixLogin.svelte";
  import WhatsAppLinkDevice from "./WhatsApp/LinkDevice.svelte";
  import SignalLinkDevice from "./Signal/LinkDevice.svelte";
  import { t } from "../../../l10n/l10n";

  /** out */
  export let config: ChatAccount = null;
  /** out */
  export let showPage: ConstructorOfATypedSvelteComponent;
  export let onCancel = () => undefined;

  let selectedProtocol: string;
  let protocolSelector: ProtocolSelectorWithAddons;
  let errorUI: ErrorMessageInline;
  /*$: onSelectProtocol(selectedProtocol);
  function onSelectProtocol(protocol: string) {
    config = newChatAccountForProtocol(protocol);
  }*/

  const appProtocols: ProtocolDescription[] = [
    { label: "XMPP / Jabber", protocolID: "xmpp" },
    { label: "Matrix", protocolID: "matrix" },
    { label: "WhatsApp", protocolID: "whatsapp" },
    { label: "Signal", protocolID: "signal" },
  ];

  async function onContinue() {
    let addonAccount = await protocolSelector.addonAccountFromSetup() as AddonChatAccount;
    if (addonAccount) {
      await addonAccount.loginAndStartup(true);
      await addonAccount.save();
      appGlobal.chatAccounts.add(addonAccount);
      showPage = null;
      return;
    }
    config = newChatAccountForProtocol(selectedProtocol);
    if (selectedProtocol == "xmpp") {
      showPage = XMPPLogin;
    } else if (selectedProtocol == "matrix") {
      showPage = MatrixLogin;
    } else if (selectedProtocol == "whatsapp") {
      showPage = WhatsAppLinkDevice;
    } else if (selectedProtocol == "signal") {
      showPage = SignalLinkDevice;
    }
  }
</script>

<style>
</style>
