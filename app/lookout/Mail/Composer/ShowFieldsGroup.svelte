<RibbonGroup label={$t`Show Fields`}>
  <RibbonToggleButton label={$t`Bcc`} icon={BccIcon}
    tooltip={$t`Show the Bcc field`}
    selected={$showBcc.value || hasBCC}
    disabled={hasBCC && $t`Remove the Bcc recipients first`}
    onClick={() => { $showBcc.value = !$showBcc.value; }} />
  <RibbonToggleButton label={$t`From`} icon={FromIcon}
    tooltip={$t`Show the From field`}
    disabled={!hasSeveralIdentities && $t`You have only one sender identity`}
    selected={$showFrom.value}
    onClick={() => { $showFrom.value = !$showFrom.value; }} />
</RibbonGroup>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { findAllIdentities } from "../../../logic/Mail/MailIdentity";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import RibbonGroup from "../../Shared/Ribbon/RibbonGroup.svelte";
  import RibbonToggleButton from "../../Shared/Ribbon/RibbonToggleButton.svelte";
  import BccIcon from "lucide-svelte/icons/eye-off";
  import FromIcon from "lucide-svelte/icons/user-round";
  import { t } from "../../../l10n/l10n";

  export let mail: EMail;

  const showBcc = getLocalStorage<boolean>("lookout.mail.compose.showBcc", false);
  const showFrom = getLocalStorage<boolean>("lookout.mail.compose.showFrom", true);

  $: fromIdentity = mail.identity;
  /* <copied from="MailComposer.svelte"> */
  let identities = findAllIdentities();
  $: hasSeveralIdentities = $identities.length > 1 || !!fromIdentity?.isCatchAll;
  /* </copied> */
  /* <copied from="../../../frontend/Mail/Composer/MailComposer.svelte"> */
  $: bccList = mail.bcc;
  $: hasBCC = $bccList.hasItems;
  /* </copied> */
</script>
