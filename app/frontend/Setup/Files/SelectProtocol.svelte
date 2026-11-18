<Header
  title={$t`Set up your file sharing account`}
  subtitle={$t`Access your cloud files in your existing account`}
/>

<ProtocolSelectorWithAddons type="files" {appProtocols} newAccount={newFileSharingAccountForProtocol}
  bind:selectedProtocol={selectedProtocol} bind:this={protocolSelector} />

<ErrorMessageInline bind:this={errorUI} />

<ButtonsBottom
  onContinue={() => catchErrors(onContinue, errorUI.showError)}
  canContinue={!!selectedProtocol}
  canCancel={true}
  onCancel={onCancel}
  />

<script lang="ts">
  import { FileSharingAccount } from "../../../logic/Files/FileSharingAccount";
  import { newFileSharingAccountForProtocol } from "../../../logic/Files/AccountsList/FileSharingAccounts";
  import type { AddonFileSharingAccount } from "../../../logic/Files/Addon/AddonFileSharingAccount";
  import { appGlobal } from "../../../logic/app";
  import ProtocolSelectorWithAddons from "../Addon/ProtocolSelectorWithAddons.svelte";
  import WebDAVSetup from "./WebDAVSetup.svelte";
  import type { ProtocolDescription } from "../Shared/ProtocolSelector.svelte";
  import ButtonsBottom from "../Shared/ButtonsBottom.svelte";
  import Header from "../Shared/Header.svelte";
  import ErrorMessageInline from "../../Shared/ErrorMessageInline.svelte";
  import { catchErrors } from "../../Util/error";
  import { NotReached } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";

  /** out */
  export let config: FileSharingAccount = null;
  /** out */
  export let showPage: ConstructorOfATypedSvelteComponent;
  export let onCancel = (event: Event) => undefined;

  let selectedProtocol: string;

  let protocolSelector: ProtocolSelectorWithAddons;
  let errorUI: ErrorMessageInline;

  const appProtocols: ProtocolDescription[] = [
    //{ label: `openCloud, ownCloud`, protocolID: "webdav-opencloud" },
    { label: `NextCloud`, protocolID: "webdav-nextcloud" },
    //{ label: `GMX, web.de, 1&1`, protocolID: "webdav" },
    //{ label: `OneDrive`, protocolID: "graph-onedrive" },
    //{ label: `SharePoint`, protocolID: "graph-sharepoint" },
    { label: `WebDAV`, protocolID: "webdav" },
  ];

  async function onContinue() {
    let addonAccount = await protocolSelector.addonAccountFromSetup() as AddonFileSharingAccount;
    if (addonAccount) {
      await addonAccount.login(true);
      await addonAccount.save();
      appGlobal.fileSharingAccounts.add(addonAccount);
      showPage = null;
      return;
    }
    config = newFileSharingAccountForProtocol(selectedProtocol);
    if (selectedProtocol.startsWith("webdav")) {
      showPage = WebDAVSetup;
    } else {
      throw new NotReached();
    }
  }
</script>

<style>
</style>
