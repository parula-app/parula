<MenuItem label={$t`No Date *=> Flag the selected emails for follow-up without a due date`} icon={FlagIcon} shortCutInfo={$t`Insert *=> Insert key`}
  tooltip={$t`Flag the message for follow up`}
  checked={allFlagged}
  onClick={async () => { await Promise.all(messages.map(message => message.markStarred(true))); }} />
<MenuDivider />
<MenuItem label={$t`Clear Flag`} icon={ClearFlagIcon}
  disabled={!anyFlagged && $t`The selected messages are not flagged`}
  onClick={async () => { await Promise.all(messages.map(message => message.markStarred(false))); }} />

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import FlagIcon from "lucide-svelte/icons/flag";
  import ClearFlagIcon from "lucide-svelte/icons/flag-off";
  import { t } from "../../../l10n/l10n";

  export let messages: EMail[];

  $: allFlagged = messages.length > 0 && messages.every(message => message.isStarred);
  $: anyFlagged = messages.some(message => message.isStarred);
</script>
