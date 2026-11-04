{#if needsConnect}
  <MenuItem label={$t`Connect *=> Log in to this account`} icon={ConnectIcon}
    tooltip={$t`Log in to this account`}
    onClick={() => account.loginAndStartup(true)} />
  <MenuDivider />
{/if}
{#if isSearchFolder}
  <MenuItem label={$t`Customize This Search Folder…`} icon={CustomizeIcon}
    onClick={() => { $openCustomizeSearchFolder = searchFolder; }} />
  <MenuDivider />
{:else}
  <MenuItem label={$t`New Folder…`} icon={NewFolderIcon}
    disabled={isVirtual ? $t`Select a folder of an account first` : folder.disableSubfolders()}
    onClick={() => { $openNewFolder = { account: folder.account, parent: folder }; }} />
{/if}
<MenuItem label={$t`Rename Folder`} icon={RenameIcon}
  disabled={folder instanceof AllFolders ? $t`You cannot rename this folder` : $folder.disableRename()}
  onClick={() => { $renamingFolder = folder; }} />
<MenuItem label={$t`Move Folder…`} icon={MoveIcon}
  disabled={FolderTreeActions.disableMove(folder)}
  onClick={() => { $openMoveFolder = folder; }} />
<MenuItem label={$t`Delete Folder`} icon={DeleteIcon}
  disabled={folder instanceof AllFolders ? $t`You cannot delete this folder` : $folder.disableDelete()}
  onClick={async () => { await FolderTreeActions.deleteFolder(folder); }} />
<MenuDivider />
<MenuItem label={$t`Mark All as Read`} icon={MarkReadIcon}
  disabled={!$folder.countUnread && !isVirtual && $t`There are no unread messages`}
  onClick={() => FolderTreeActions.markAllRead(folder)} />
{#if FolderTreeActions.canDeleteAll(folder)}
  <MenuItem label={$t`Delete All *=> Delete all emails in the selected folder`} icon={DeleteAllIcon} classes="danger"
    disabled={!$folder.countTotal && !$messages.hasItems && $t`The folder is empty`}
    onClick={() => FolderTreeActions.deleteAll(folder)} />
{/if}
{#if !isSearchFolder}
  <MenuDivider />
  <MenuItem label={$t`Update Folder`} icon={UpdateIcon}
    disabled={MessageActions.disableGetNewMail(folder)}
    onClick={() => MessageActions.getNewMail(folder)} />
  <MenuItem label={$t`Download All Messages`} icon={DownloadAllIcon}
    tooltip={$t`Download all messages of this folder, for offline use and search`}
    onClick={() => MessageActions.downloadAll(folder)} />
{/if}
{#if !isVirtual}
  <MenuDivider />
  <MenuItem label={$t`Properties… *=> Show the settings of the selected folder`} icon={PropertiesIcon}
    onClick={() => { $openFolderProperties = { folder }; }} />
{/if}

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import { AllFolders } from "../../../logic/Mail/Virtual/AllFolders";
  import { SavedSearchFolder } from "../../../logic/Mail/Virtual/SavedSearchFolder";
  import { FolderTreeActions } from "./FolderTreeActions";
  import { MessageActions } from "../MessageActions";
  import { openFolderProperties } from "../FolderProperties.svelte";
  import { openNewFolder } from "./NewFolderDialog.svelte";
  import { openMoveFolder } from "./MoveFolderDialog.svelte";
  import { openCustomizeSearchFolder } from "../Search/CustomizeSearchFolderDialog.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import NewFolderIcon from "lucide-svelte/icons/folder-plus";
  import RenameIcon from "lucide-svelte/icons/folder-pen";
  import MoveIcon from "lucide-svelte/icons/folder-input";
  import DeleteIcon from "lucide-svelte/icons/folder-x";
  import MarkReadIcon from "lucide-svelte/icons/mail-open";
  import UpdateIcon from "lucide-svelte/icons/refresh-cw";
  import DownloadAllIcon from "lucide-svelte/icons/hard-drive-download";
  import DeleteAllIcon from "lucide-svelte/icons/trash-2";
  import PropertiesIcon from "lucide-svelte/icons/folder-cog";
  import CustomizeIcon from "lucide-svelte/icons/folder-search";
  import ConnectIcon from "lucide-svelte/icons/plug";
  import { renamingFolder } from "./FolderLine.svelte";
  import { t } from "../../../l10n/l10n";

  export let folder: Folder;

  $: isVirtual = folder instanceof AllFolders || folder instanceof SavedSearchFolder;
  $: searchFolder = folder instanceof SavedSearchFolder ? folder : null;
  $: isSearchFolder = !!searchFolder;
  $: messages = folder.messages;
  $: account = isVirtual ? null : folder.account;
  $: needsConnect = !!account && !$account.isLoggedIn;
</script>
