<Ribbon id="files">
  <RibbonTab label={$t`Home *=> Ribbon tab with the most-used commands`}>
    {#if isFolderView}
      <RibbonGroup label={$t`New`}>
        <RibbonButton label={$t`Upload File`} shortLabel={$t`Upload *=> Upload a file`} icon={UploadIcon}
          tooltip={$t`Upload files from your computer into this folder`}
          onClick={upload}
          disabled={!folder && $t`Select a folder first`} />
        <RibbonButton label={$t`New Folder`} icon={NewFolderIcon}
          onClick={() => { newFolderParent = folder; }}
          disabled={!folder && $t`Select a folder first`} />
      </RibbonGroup>
    {/if}
    <RibbonGroup label={$t`Current View`}>
      <RibbonMenuButton label={$t`Change View`} shortLabel={$t`Views *=> Choose another view of the items`} icon={ChangeViewIcon}>
        <ChangeViewGallery views={fileViews} currentView={$viewSetting.value} on:change={event => setView(event.detail)} />
      </RibbonMenuButton>
    </RibbonGroup>
    {#if $viewFile}
      <RibbonGroup label={$t`Preview *=> Ribbon group for the file that is shown`}>
        <RibbonButton label={$t`Close Preview`} shortLabel={$t`Close *=> Close the preview`} icon={CloseIcon}
          onClick={closeViewer}
          shortCutInfo={$t`Esc *=> Escape key`} />
      </RibbonGroup>
    {/if}
    <RibbonGroup label={$t`Open *=> Ribbon group with the commands to open the selected file`}>
      <RibbonButton label={$t`Open *=> Open the selected file or folder`} icon={OpenIcon}
        tooltip={$t`Open the file in the app that fits best, or go into the folder`}
        onClick={open}
        disabled={!selected && $t`Select a file or folder first`} />
      <RibbonButton label={$t`Preview *=> Show the file here`} icon={PreviewIcon} size="small"
        onClick={() => openPreview(file)}
        disabled={!file && $t`Select a file first` || !canShowPreview(file) && $t`There is no preview for this file type`} />
      <RibbonButton label={$t`Open in Desktop App`} shortLabel={$t`Desktop App *=> Open in an app on this computer`} icon={DesktopAppIcon} size="small"
        tooltip={$t`Open with a local application on your computer`}
        onClick={() => file.openOSApp()}
        disabled={!file && $t`Select a file first`} />
      <RibbonButton label={$t`Open in Web App`} shortLabel={$t`Web App *=> Open in an app on the web`} icon={WebAppIcon} size="small"
        tooltip={$t`Open with a cloud app on the web`}
        onClick={() => openFileInCloudApp(file)}
        disabled={!file && $t`Select a file first` || webAppDisabledReason} />
    </RibbonGroup>
    {#if isFolderView}
      <RibbonGroup label={$t`Share *=> Ribbon group to give others access to the file`}>
        <RibbonButton label={$t`Copy Link`} icon={LinkIcon}
          tooltip={$t`Copy a link, with which anybody can read the file`}
          onClick={copyLink}
          disabled={!selected && $t`Select a file or folder first` || isOnHarddrive && $t`Files on your computer have no link`} />
      </RibbonGroup>
      <RibbonGroup label={$t`Organize *=> Ribbon group to rename, move and delete files`}>
        <RibbonButton label={$t`Rename`} icon={RenameIcon}
          onClick={() => { renaming = selected; }}
          disabled={!selected && $t`Select a file or folder first`} />
        {#if targetFolders.length > maxMenuFolders}
          <RibbonButton label={$t`Move`} icon={MoveIcon}
            tooltip={$t`Move the selected file to another folder`}
            onClick={() => { moving = { file: movableFile, copy: false }; }}
            disabled={!movableFile && $t`Select a file first`} />
          <RibbonButton label={$t`Copy`} icon={CopyIcon} size="small"
            tooltip={$t`Copy the selected file to another folder`}
            onClick={() => { moving = { file: movableFile, copy: true }; }}
            disabled={!movableFile && $t`Select a file first`} />
        {:else}
          <RibbonMenuButton label={$t`Move`} icon={MoveIcon}
            tooltip={$t`Move the selected file to another folder`}
            disabled={!movableFile && $t`Select a file first`}>
            {#each targetFolders as target (target.dir)}
              <MenuItem label={target.label} icon={FolderIcon}
                disabled={movableFile?.parent == target.dir}
                onClick={() => target.dir.moveFileHere(movableFile)} />
            {:else}
              <MenuLabel label={$t`There are no other folders`} />
            {/each}
          </RibbonMenuButton>
          <RibbonMenuButton label={$t`Copy`} icon={CopyIcon} size="small"
            tooltip={$t`Copy the selected file to another folder`}
            disabled={!movableFile && $t`Select a file first`}>
            {#each targetFolders as target (target.dir)}
              <MenuItem label={target.label} icon={FolderIcon}
                disabled={movableFile?.parent == target.dir}
                onClick={() => target.dir.copyFileHere(movableFile)} />
            {:else}
              <MenuLabel label={$t`There are no other folders`} />
            {/each}
          </RibbonMenuButton>
        {/if}
        <RibbonButton label={$t`Delete`} icon={DeleteIcon}
          onClick={deleteSelected}
          disabled={!selected && $t`Select a file or folder first`}
          shortCutInfo={$t`Del *=> Delete key`} />
      </RibbonGroup>
    {/if}
  </RibbonTab>
  {#if isFolderView}
    <RibbonTab label={$t`Folder`}>
      <RibbonGroup label={$t`New`}>
        <RibbonButton label={$t`New Folder`} icon={NewFolderIcon}
          onClick={() => { newFolderParent = folder; }}
          disabled={!folder && $t`Select a folder first`} />
      </RibbonGroup>
      <RibbonGroup label={$t`Actions`}>
        <RibbonButton label={$t`Rename Folder`} shortLabel={$t`Rename`} icon={RenameIcon}
          onClick={() => { renaming = folder; }}
          disabled={!folder && $t`Select a folder first`} />
        <RibbonButton label={$t`Delete Folder`} shortLabel={$t`Delete`} icon={DeleteIcon}
          onClick={deleteFolder}
          disabled={!folder && $t`Select a folder first`} />
      </RibbonGroup>
      <RibbonGroup label={$t`Update *=> Ribbon group to get the latest files from the server`}>
        <RibbonButton label={$t`Update Folder`} shortLabel={$t`Update *=> Get the latest items of the selected folder from the server`} icon={SyncIcon}
          onClick={refresh}
          disabled={!folder && $t`Select a folder first`} />
        <RibbonButton label={$t`Update Account`} icon={SyncAllIcon}
          tooltip={$t`Get the latest files of all folders of this account`}
          onClick={syncAccount}
          disabled={!folder?.account && $t`Select a folder first`} />
      </RibbonGroup>
    </RibbonTab>
  {/if}
  <RibbonTab label={$t`View *=> Ribbon tab with layout and display settings`}>
    <RibbonGroup label={$t`Current View`}>
      <RibbonMenuButton label={$t`Change View`} shortLabel={$t`Views *=> Choose another view of the items`} icon={ChangeViewIcon}>
        <ChangeViewGallery views={fileViews} currentView={$viewSetting.value} on:change={event => setView(event.detail)} />
      </RibbonMenuButton>
      <RibbonButton label={$t`Reset View`} icon={ResetViewIcon}
        tooltip={$t`Reset the view and the sort order to the default settings`}
        onClick={resetView} />
    </RibbonGroup>
    <RibbonGroup label={$t`Arrangement *=> Ribbon group for how the items are arranged`}>
      <RibbonMenuButton label={$t`Arrange By`} shortLabel={$t`Arrange *=> Choose how the items are sorted`} icon={ArrangeIcon}
        disabled={$viewSetting.value == "gallery" && $t`Available in the List view`}>
        {#each sortOptions as option}
          <MenuItem label={option.label} checked={$sortSetting.value == option.id}
            onClick={() => { $sortSetting.value = option.id; }} />
        {/each}
      </RibbonMenuButton>
    </RibbonGroup>
    <RibbonDisplayGroup />
  </RibbonTab>
</Ribbon>
<FileSelector bind:this={fileSelector} />
{#if renaming}
  <RenameDialog file={renaming} on:close={() => renaming = null} />
{/if}
{#if moving}
  <MoveFileDialog file={moving.file} copy={moving.copy} rootDirs={folder.account.rootDirs} on:close={() => moving = null} />
{/if}
{#if newFolderParent}
  <NewFolderDialog parent={newFolderParent} on:close={() => newFolderParent = null} />
{/if}

<script lang="ts">
  import type { FileOrDirectory } from "../../logic/Files/FileOrDirectory";
  import { File } from "../../logic/Files/File";
  import { Directory } from "../../logic/Files/Directory";
  import type { WebAppListed } from "../../logic/WebApps/WebAppListed";
  import { myHarddrive } from "../../logic/Files/Harddrive/HarddriveAccount";
  import { selectedFile, selectedFolder, selectedLeftTab, viewFile, fileViewer } from "../../frontend/Files/selected";
  import { canShowPreview, openFileInCloudApp, openFileInDefaultApp, openPreview } from "../../frontend/Files/file";
  import { FilesView } from "../../frontend/Files/LeftPane/PaneViewSwitcher.svelte";
  import { SortCriteria } from "../../frontend/Files/FilesList/FilesList.svelte";
  import { getLocalStorage } from "../../frontend/Util/LocalStorage";
  import { showMessageBox } from "../Shared/Dialog/MessageBox";
  import { minorError } from "../../logic/util/error";
  import { AppWindow } from "../../frontend/MainWindow/AppWindow";
  import Ribbon from "../Shared/Ribbon/Ribbon.svelte";
  import RibbonTab from "../Shared/Ribbon/RibbonTab.svelte";
  import RibbonGroup from "../Shared/Ribbon/RibbonGroup.svelte";
  import RibbonDisplayGroup from "../Shared/Ribbon/RibbonDisplayGroup.svelte";
  import RibbonButton from "../Shared/Ribbon/RibbonButton.svelte";
  import RibbonMenuButton from "../Shared/Ribbon/RibbonMenuButton.svelte";
  import ChangeViewGallery from "../Shared/Ribbon/ChangeViewGallery.svelte";
  import MenuItem from "../Shared/Menu/MenuItem.svelte";
  import MenuLabel from "../Shared/Menu/MenuLabel.svelte";
  import RenameDialog from "./RenameDialog.svelte";
  import NewFolderDialog from "./NewFolderDialog.svelte";
  import MoveFileDialog from "./MoveFileDialog.svelte";
  import FileSelector from "../../frontend/Mail/Composer/Attachments/FileSelector.svelte";
  import UploadIcon from "lucide-svelte/icons/upload";
  import NewFolderIcon from "lucide-svelte/icons/folder-plus";
  import ChangeViewIcon from "lucide-svelte/icons/layout-template";
  import ListViewIcon from "lucide-svelte/icons/table-properties";
  import GalleryViewIcon from "lucide-svelte/icons/layout-grid";
  import ArrangeIcon from "lucide-svelte/icons/arrow-down-wide-narrow";
  import ResetViewIcon from "lucide-svelte/icons/rotate-ccw";
  import CloseIcon from "lucide-svelte/icons/x";
  import OpenIcon from "lucide-svelte/icons/external-link";
  import PreviewIcon from "lucide-svelte/icons/eye";
  import DesktopAppIcon from "lucide-svelte/icons/monitor";
  import WebAppIcon from "lucide-svelte/icons/cloud";
  import LinkIcon from "lucide-svelte/icons/link";
  import RenameIcon from "lucide-svelte/icons/pencil-line";
  import MoveIcon from "lucide-svelte/icons/folder-input";
  import CopyIcon from "lucide-svelte/icons/copy";
  import FolderIcon from "lucide-svelte/icons/folder";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import SyncIcon from "lucide-svelte/icons/refresh-cw";
  import SyncAllIcon from "lucide-svelte/icons/refresh-ccw-dot";
  import type { Collection } from "svelte-collections";
  import { t } from "../../l10n/l10n";

  const appWindow = AppWindow.current();
  const viewSetting = getLocalStorage("files.view", "table");
  const sortSetting = getLocalStorage("files.sort", SortCriteria.Name);

  let fileSelector: FileSelector;
  let renaming: FileOrDirectory | null = null;
  let newFolderParent: Directory | null = null;
  let moving: { file: File, copy: boolean } | null = null;
  const maxMenuFolders = 8;

  $: selected = $selectedFile;
  $: folder = $selectedFolder;
  $: isFolderView = $selectedLeftTab == FilesView.CloudStorage || $selectedLeftTab == FilesView.Harddrive;
  $: file = selected instanceof File ? selected : null;
  $: isOnHarddrive = (selected instanceof Directory ? selected.account : selected?.parent?.account) == myHarddrive;
  $: movableFile = file?.parent ? file : null;
  $: targetFolders = allFolders(folder?.account?.rootDirs);

  $: fileViews = [
    { id: "table", label: $t`List`, icon: ListViewIcon, tooltip: $t`Files in a table` },
    { id: "gallery", label: $t`Gallery *=> View that shows the files as tiles with a preview`, icon: GalleryViewIcon, tooltip: $t`Files as tiles with a preview` },
  ];
  $: sortOptions = [
    { id: SortCriteria.Name, label: $t`File name` },
    { id: SortCriteria.Type, label: $t`File type` },
    { id: SortCriteria.Size, label: $t`Size *=> Size of the file` },
    { id: SortCriteria.LastMod, label: $t`Last mod *=> Last modification time for the file` },
  ];

  let editors: Collection<WebAppListed> | null = null;
  $: loadEditors(file);
  async function loadEditors(file: File | null) {
    editors = null;
    if (!file) {
      return;
    }
    try {
      editors = await file.availableOnlineEditors();
    } catch (ex) {
      minorError(ex);
    }
  }
  $: webAppDisabledReason = editors?.hasItems ? null
    : file?.account
      ? $t`${file.account.name} does not offer a cloud app for this file type`
      : $t`No cloud app is available for this file`;

  function allFolders(roots: Collection<Directory> | null): { dir: Directory, label: string }[] {
    let result: { dir: Directory, label: string }[] = [];
    function addFolders(dirs: Collection<Directory>, path: string[]) {
      for (let dir of dirs) {
        if (result.some(target => target.dir == dir) || result.length >= 500) {
          continue;
        }
        let dirPath = [...path, dir.name];
        result.push({ dir, label: dirPath.join(" › ") });
        addFolders(dir.subDirs, dirPath);
      }
    }
    if (roots) {
      addFolders(roots, []);
    }
    return result;
  }

  async function open() {
    if (selected instanceof Directory) {
      $selectedFolder = selected;
    } else if (selected instanceof File) {
      await openFileInDefaultApp(selected);
    }
  }

  export function closeViewer() {
    $viewFile = null;
    $fileViewer = null;
  }

  async function copyLink() {
    let url = await selected.shareLink();
    await navigator.clipboard.writeText(url);
  }

  export async function deleteSelected() {
    let entry = selected;
    if (!entry || !isFolderView || !await showMessageBox($t`Delete`, $t`Do you want to permanently delete ${entry.name}?`)) {
      return;
    }
    await entry.deleteIt();
    if ($selectedFile == entry) {
      appWindow.uiState(selectedFile).set(null);
    }
    if ($selectedFolder == entry && entry instanceof Directory) {
      appWindow.uiState(selectedFolder).set(entry.parent);
    }
  }

  async function deleteFolder() {
    let entry = folder;
    if (!await showMessageBox($t`Delete Folder`, $t`Do you want to permanently delete the folder ${entry.name} and all its files?`)) {
      return;
    }
    await entry.deleteIt();
    if ($selectedFile == entry) {
      appWindow.uiState(selectedFile).set(null);
    }
    appWindow.uiState(selectedFolder).set(entry.parent);
  }

  // <copied from="../../frontend/Files/MainPane/FilesHeader.svelte">
  async function upload() {
    let fileBlobs = await fileSelector.selectFiles();
    if (!fileBlobs?.length) {
      return;
    }
    for (let fileBlob of fileBlobs) {
      let ourFile = folder.newFile(fileBlob.name);
      ourFile.fromBrowserFile(fileBlob);
      await folder.addFile(ourFile);
    }
  }
  // </copied>

  async function refresh() {
    await folder.listContents();
    await folder.uploadChangedFiles();
  }

  async function syncAccount() {
    let account = folder.account;
    if (!account.isLoggedIn) {
      await account.login(true);
    }
    await account.sync();
  }

  function setView(newView: string) {
    viewSetting.value = newView;
  }

  function resetView() {
    viewSetting.value = viewSetting.defaultValue;
    sortSetting.value = sortSetting.defaultValue;
  }
</script>
