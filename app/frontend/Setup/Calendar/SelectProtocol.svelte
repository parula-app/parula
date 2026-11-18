<Header
  title={$t`Set up your calendar`}
  subtitle=""
/>

<ProtocolSelectorWithAddons type="calendar" {appProtocols} newAccount={newCalendarForProtocol}
  bind:selectedProtocol={selectedProtocol} bind:this={protocolSelector} />

<ErrorMessageInline bind:this={errorUI} />

<ButtonsBottom
  onContinue={() => catchErrors(onContinue, errorUI.showError)}
  canContinue={!!selectedProtocol}
  canCancel={true}
  onCancel={onCancel}
  />

<script lang="ts">
  import type { Calendar } from "../../../logic/Calendar/Calendar";
  import { newCalendarForProtocol } from "../../../logic/Calendar/AccountsList/Calendars";
  import type { AddonCalendar } from "../../../logic/Calendar/Addon/AddonCalendar";
  import { appGlobal } from "../../../logic/app";
  import ProtocolSelectorWithAddons from "../Addon/ProtocolSelectorWithAddons.svelte";
  import LocalCalendarSetup from "./LocalCalendarSetup.svelte";
  import CalDAVSetup from "./CalDAVSetup.svelte";
  import type { ProtocolDescription } from "../Shared/ProtocolSelector.svelte";
  import ButtonsBottom from "../Shared/ButtonsBottom.svelte";
  import Header from "../Shared/Header.svelte";
  import ErrorMessageInline from "../../Shared/ErrorMessageInline.svelte";
  import { catchErrors } from "../../Util/error";
  import { NotReached } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";

  /** out */
  export let config: Calendar = null;
  /** out */
  export let showPage: ConstructorOfATypedSvelteComponent;
  export let onCancel = (event: Event) => undefined;

  let selectedProtocol: string;
  let protocolSelector: ProtocolSelectorWithAddons;
  let errorUI: ErrorMessageInline;

  const appProtocols: ProtocolDescription[] = [
    { label: $t`New local calendar`, protocolID: "calendar-local" },
    { label: $t`New CalDAV calendar`, protocolID: "caldav" },
  ];

  async function onContinue() {
    let addonAccount = await protocolSelector.addonAccountFromSetup() as AddonCalendar;
    if (addonAccount) {
      await addonAccount.login(true);
      await addonAccount.listEvents(); // check whether it works
      appGlobal.calendars.add(addonAccount);
      await addonAccount.save();
      showPage = null;
      return;
    }
    config = newCalendarForProtocol(selectedProtocol);
    if (selectedProtocol == "calendar-local") {
      showPage = LocalCalendarSetup;
    } else if (selectedProtocol == "caldav") {
      showPage = CalDAVSetup;
    } else {
      throw new NotReached();
    }
  }
</script>

<style>
</style>
