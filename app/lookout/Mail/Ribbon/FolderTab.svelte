<RibbonTab label={$t`Folder`}>
  <RibbonGroup label={$t`New`}>
    <RibbonButton label={$t`New Folder`} icon={NewFolderIcon}
      onClick={onNewFolder}
      disabled={!realAccount ? $t`Select a folder of an account first` : folder && !isVirtual && folder.disableSubfolders()}
      shortCutInfo={$t`Ctrl+Shift+E *=> Keyboard shortcut`} />
    <RibbonButton label={$t`New Search Folder`} shortLabel={$t`Search *=> New search folder`} icon={NewSearchFolderIcon}
      onClick={() => { $openNewSearchFolder = { account: realAccount }; }}
      shortCutInfo={$t`Ctrl+Shift+P *=> Keyboard shortcut`} />
  </RibbonGroup>
  <RibbonGroup label={$t`Actions`}>
    <RibbonButton label={$t`Rename Folder`} shortLabel={$t`Rename`} icon={RenameIcon} size="small"
      onClick={() => { $renamingFolder = folder; }}
      disabled={!folder ? $t`Select a folder first` : folder instanceof AllFolders ? $t`You cannot rename this folder` : $folderStore?.disableRename()} />
    <RibbonButton label={$t`Move Folder`} shortLabel={$t`Move`} icon={MoveFolderIcon} size="small"
      onClick={() => { $openMoveFolder = folder; }}
      disabled={!folder ? $t`Select a folder first` : FolderTreeActions.disableMove(folder)} />
    <RibbonButton label={$t`Delete Folder`} shortLabel={$t`Delete`} icon={DeleteFolderIcon} size="small"
      onClick={async () => { await FolderTreeActions.deleteFolder(folder); }}
      disabled={!folder ? $t`Select a folder first` : folder instanceof AllFolders ? $t`You cannot delete this folder` : $folderStore?.disableDelete()} />
  </RibbonGroup>
  <RibbonGroup label={$t`Clean Up *=> Ribbon group with commands to tidy up the selected folder`}>
    <RibbonButton label={$t`Mark All as Read`} shortLabel={$t`Mark Read *=> Mark all as read`} icon={MarkAllReadIcon}
      onClick={() => FolderTreeActions.markAllRead(folder)}
      disabled={!folder && $t`Select a folder first`} />
    <RibbonButton label={$t`Delete All *=> Delete all emails in the selected folder`} icon={DeleteAllIcon} size="small"
      tooltip={$t`Permanently delete all messages in this folder`}
      onClick={() => FolderTreeActions.deleteAll(folder)}
      disabled={!(folder && FolderTreeActions.canDeleteAll(folder)) && $t`Only available in the Trash and Junk folders`} />
  </RibbonGroup>
  <RibbonGroup label={$t`Properties *=> Ribbon group with the settings of the selected folder`}>
    <RibbonButton label={$t`Folder Permissions`} shortLabel={$t`Permissions *=> Set who can access the selected folder`} icon={PermissionsIcon}
      onClick={() => { $openFolderProperties = { folder: realFolder, tab: FolderPropertiesTab.Permissions }; }}
      disabled={!realFolder
        ? $t`Select a folder of an account first`
        : !(!!realAccount && realAccount.canShareWithPersons() && !realAccount.isDependentAccount) && $t`This account cannot share folders with colleagues`} />
    <RibbonButton label={$t`Folder Properties`} shortLabel={$t`Properties *=> Show the settings of the selected folder`} icon={PropertiesIcon}
      onClick={() => { $openFolderProperties = { folder }; }}
      disabled={!folder ? $t`Select a folder first` : isVirtual && $t`This is not a real folder`} />
  </RibbonGroup>
</RibbonTab>

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { AllFolders } from "../../../logic/Mail/Virtual/AllFolders";
  import { SavedSearchFolder } from "../../../logic/Mail/Virtual/SavedSearchFolder";
  import { appGlobal } from "../../../logic/app";
  import { FolderTreeActions } from "../LeftPane/FolderTreeActions";
  import { openFolderProperties, openNewFolder, openMoveFolder, openNewSearchFolder, renamingFolder } from "../Selected";
  import { FolderPropertiesTab } from "../FolderProperties.svelte";
  import RibbonTab from "../../Shared/Ribbon/RibbonTab.svelte";
  import RibbonGroup from "../../Shared/Ribbon/RibbonGroup.svelte";
  import RibbonButton from "../../Shared/Ribbon/RibbonButton.svelte";
  import NewFolderIcon from "lucide-svelte/icons/folder-plus";
  import NewSearchFolderIcon from "lucide-svelte/icons/folder-search";
  import RenameIcon from "lucide-svelte/icons/folder-pen";
  import MoveFolderIcon from "lucide-svelte/icons/folder-input";
  import DeleteFolderIcon from "lucide-svelte/icons/folder-x";
  import MarkAllReadIcon from "lucide-svelte/icons/mail-check";
  import DeleteAllIcon from "lucide-svelte/icons/trash-2";
  import PropertiesIcon from "lucide-svelte/icons/folder-cog";
  import PermissionsIcon from "lucide-svelte/icons/folder-key";
  import { t } from "../../../l10n/l10n";

  export let folder: Folder | null = null;
  export let account: MailAccount | null = null;

  $: folderStore = folder;
  $: isVirtual = folder && (folder instanceof AllFolders || folder instanceof SavedSearchFolder);
  $: realFolder = folder && !isVirtual ? folder : realAccount?.inbox ?? null;
  $: realAccount = folder && !isVirtual
    ? folder.account
    : account && appGlobal.emailAccounts.contains(account) ? account : null;

  function onNewFolder() {
    $openNewFolder = { account: realAccount, parent: folder && !isVirtual ? folder : null };
  }
</script>
