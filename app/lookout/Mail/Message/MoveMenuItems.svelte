{#each recent as folder (folder)}
  <MenuItem label={FolderTreeActions.displayName(folder)}
    tooltip={$t`Move to ${folder.account?.name} / ${folder.fullPath}`}
    disabled={(messages.length > 0 && messages.every(message => message.folder == folder)) && $t`The messages are already in this folder`}
    onClick={() => MessageActions.moveTo(messages, folder)}>
    <FolderIcon slot="icon" {folder} size="16px" />
  </MenuItem>
{/each}
{#if recent.length}
  <MenuDivider />
{/if}
<MenuItem label={$t`Other Folder… *=> Move the selected emails to another folder`} icon={MoveIcon} shortCutInfo={$t`Ctrl+Shift+V *=> Keyboard shortcut`}
  onClick={() => { $openMoveMessages = { messages, copy: false }; }} />
<MenuItem label={$t`Copy to Folder… *=> Copy the selected emails to another folder`} icon={CopyIcon} shortCutInfo={$t`Ctrl+Shift+Y *=> Keyboard shortcut`}
  onClick={() => { $openMoveMessages = { messages, copy: true }; }} />

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { appGlobal } from "../../../logic/app";
  import { recentFolders } from "../RecentFolders";
  import { MessageActions } from "../MessageActions";
  import { openMoveMessages } from "../Selected";
  import { FolderTreeActions } from "../LeftPane/FolderTreeActions";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import FolderIcon from "../../../frontend/Mail/LeftPane/FolderIcon.svelte";
  import MoveIcon from "lucide-svelte/icons/folder-input";
  import CopyIcon from "lucide-svelte/icons/copy";
  import { t } from "../../../l10n/l10n";

  export let messages: EMail[];

  let recent = recentFolders.folders(appGlobal.emailAccounts.contents);
</script>
