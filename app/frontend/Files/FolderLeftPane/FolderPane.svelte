{#if accounts?.hasItems}
  {#if activeTab == FilesView.CloudStorage}
    <AccountList {accounts} bind:selectedAccount />
  {/if}
  <FolderList folders={rootDirs} bind:selectedFolder bind:selectedFolders />
  {#if selectedFolder}
    <TagsList folder={selectedFolder} bind:searchFiles />
  {/if}
{:else}
  <NoAccounts />
{/if}

<script lang="ts">
  import { File } from "../../../logic/Files/File";
  import { Directory } from "../../../logic/Files/Directory";
  import { FileOrDirectory } from "../../../logic/Files/FileOrDirectory";
  import { FileSharingAccount } from "../../../logic/Files/FileSharingAccount";
  import { myHarddrive } from "../../../logic/Files/Harddrive/HarddriveAccount";
  import { selectedFile, selectedAccount as selectedAccountStore } from "../selected";
  import { appGlobal } from "../../../logic/app";
  import AccountList from "./AccountList.svelte";
  import FolderList from "./FolderList.svelte";
  import TagsList from "./TagsList.svelte";
  import NoAccounts from "./NoAccounts.svelte";
  import { FilesView } from "../LeftPane/PaneViewSwitcher.svelte";
  import { ArrayColl, Collection } from 'svelte-collections';
  import { catchErrors } from "../../Util/error";

  /** The list of files and folders to show on the right pane
   * in/out only */
  export let listFiles: Collection<File>;
  export let listDirs: Collection<Directory>;
  export let selectedFolder: Directory;
  export let activeTab: FilesView;

  $: accounts = activeTab == FilesView.CloudStorage
    ? appGlobal.fileSharingAccounts.filterObservable(acc => acc != myHarddrive)
    : new ArrayColl([myHarddrive]);
  let selectedAccount: FileSharingAccount = myHarddrive;
  let selectedFolders: ArrayColl<Directory>;
  let searchFiles: ArrayColl<FileOrDirectory> | null;

  $: rootDirs = selectedAccount?.rootDirs ?? new ArrayColl<Directory>();
  $: $selectedAccountStore = selectedAccount;

  $: selectedFolder, catchErrors(changeDir)
  async function changeDir() {
    if (!selectedFolder) {
      listDirs = null;
      listFiles = null;
      return;
    }
    listDirs = selectedFolder.subDirs;
    listFiles = selectedFolder.files;
    await selectedFolder.listContents();
  }

  $: $selectedFile instanceof Directory && changeToDir($selectedFile)
  function changeToDir(folder: Directory) {
    selectedFolder = folder;
  }
</script>

<style>
  .warn {
    padding: 24px;
    flex-wrap: wrap;
  }
</style>
