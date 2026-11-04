<MenuItem label={$t`Mark as Junk`} icon={JunkIcon} shortCutInfo={$t`Ctrl+J *=> Keyboard shortcut`}
  tooltip={$t`Move to the Junk folder, and train the junk filter`}
  disabled={allJunk && $t`The selected messages are already junk`}
  onClick={async () => { await Promise.all(messages.map(message => message.treatSpam(true))); }} />
<MenuDivider />
<MenuItem label={$t`Not Junk`} icon={NotJunkIcon} shortCutInfo={$t`Ctrl+Alt+J *=> Keyboard shortcut`}
  tooltip={$t`Move back to the Inbox, and train the junk filter`}
  disabled={!anyJunk && $t`The selected messages are not junk`}
  onClick={async () => { await Promise.all(messages.map(message => message.treatSpam(false))); }} />

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { MessageActions } from "../MessageActions";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import JunkIcon from "lucide-svelte/icons/shield-x";
  import NotJunkIcon from "lucide-svelte/icons/shield-check";
  import { t } from "../../../l10n/l10n";

  export let messages: EMail[];

  $: allJunk = MessageActions.isJunk(messages);
  $: anyJunk = messages.some(message => MessageActions.isJunk([message]));
</script>
