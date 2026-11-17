<MenuItem label={isJunk ? $t`Not Junk` : $t`Mark as Junk`}
  icon={isJunk ? NotJunkIcon : JunkIcon}
  tooltip={isJunk ? $t`Move back to the Inbox, and train the junk filter` : $t`Move to the Junk folder, and train the junk filter`}
  shortCutInfo={isJunk ? $t`Ctrl+Alt+J *=> Keyboard shortcut` : $t`Ctrl+J *=> Keyboard shortcut`}
  onClick={() => MessageActions.toggleJunk(messages)} />

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { MessageActions } from "../MessageActions";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import JunkIcon from "lucide-svelte/icons/shield-x";
  import NotJunkIcon from "lucide-svelte/icons/shield-check";
  import { t } from "../../../l10n/l10n";

  export let messages: EMail[];

  $: isJunk = MessageActions.isJunk(messages);
</script>
