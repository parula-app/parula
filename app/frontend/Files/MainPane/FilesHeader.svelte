<hbox class="header">
  <hbox class="buttons" class:hidden={!dir.parent}>
    <RoundButton
      onClick={goBack}
      icon={BackIcon}
      iconSize="24px"
      padding="4px"
      border={false}
      />
  </hbox>

  <hbox class="parent-dirs font-small">
    {#each parentDirs as parent, i}
      <Clickable onClick={() => changeTo(parent)}>
        <hbox class="parent-dir">
          {parent.name}
        </hbox>
      </Clickable>
      {#if i < parentDirs.length}
        <hbox class="dir-separator">
          <SubIcon size="16px" />
        </hbox>
      {/if}
    {/each}
  </hbox>

  <hbox class="name">
    {$dir.name}
  </hbox>

  <hbox flex />
  <hbox class="count font-small">
    {$t`${$subDirs.length + $files.length} files`}
  </hbox>
  <hbox class="buttons">
    <RoundButton
      onClick={refresh}
      icon={RefreshIcon}
      iconSize="14px"
      padding="6px"
      classes="refresh"
      />
    <RoundButton
      onClick={addFile}
      icon={PlusIcon}
      iconSize="18px"
      padding="4px"
      classes="create"
      />
    <RoundButton
      onClick={newFolder}
      icon={FolderPlusIcon}
      iconSize="18px"
      padding="4px"
      classes="new-folder"
      />
    <RightViewSwitcher />
  </hbox>
</hbox>

<FileSelector bind:this={fileSelector} />

<script lang="ts">
  import { Directory } from "../../../logic/Files/Directory";
  import { selectedFolder } from "../selected";
  import RightViewSwitcher from "./MainViewSwitcher.svelte";
  import FileSelector from "../../Mail/Composer/Attachments/FileSelector.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import Clickable from "../../Shared/Clickable.svelte";
  import PlusIcon from "lucide-svelte/icons/plus";
  import FolderPlusIcon from "lucide-svelte/icons/folder-plus";
  import RefreshIcon from "lucide-svelte/icons/refresh-ccw";
  import BackIcon from "lucide-svelte/icons/chevron-left";
  import SubIcon from "lucide-svelte/icons/chevron-right";
  import { t } from "../../../l10n/l10n";

  export let dir: Directory;

  $: subDirs = dir.subDirs;
  $: files = dir.files;

  let parentDirs: Directory[] = [];
  $: dir, getParentDirs()
  function getParentDirs() {
    parentDirs = [];
    let cur = dir.parent;
    while (cur && !parentDirs.includes(cur)) {
      parentDirs.unshift(cur);
      cur = cur.parent;
    }
    console.log("Parent dirs", parentDirs.map(dir => dir.name).join(" / "), parentDirs)
  }

  function changeTo(dir: Directory) {
    $selectedFolder = dir;
  }
  function goBack() {
    if (!dir.parent) {
      return;
    }
    changeTo(dir.parent);
  }
  async function refresh() {
    await dir.listContents();
    await dir.uploadChangedFiles();
  }

  let fileSelector: FileSelector;
  // <copied to="../../../lookout/Files/FilesRibbon.svelte, ../drag.ts">
  async function addFile() {
    let fileBlobs = await fileSelector.selectFiles();
    if (!fileBlobs?.length) {
      console.log("no file selected");
      return;
    }
    for (let fileBlob of fileBlobs) {
      let ourFile = dir.newFile(fileBlob.name);
      ourFile.fromBrowserFile(fileBlob);
      await dir.addFile(ourFile);
    }
  }
  // </copied>
  async function newFolder() {
    let newFolder = dir.newDirectory($t`New Folder`);
    // TODO open sidebar and focus rename
    await dir.createSubDirectory(newFolder.name);
  }
</script>

<style>
  .header {
    align-items: center;
    margin-block: 4px;
    margin-inline: 8px;
  }
  .parent-dirs {
    align-items: center;
    margin-inline-start: 4px;
  }
  .parent-dir {
    padding-inline: 6px;
  }
  .parent-dir:hover {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  .dir-separator {
    opacity: 50%;
  }
  .name {
    font-size: 120%;
    font-weight: bold;
    margin-inline-start: 20px;
  }
  .count {
    opacity: 75%;
    margin-inline-end: 16px;
  }
  .buttons {
    align-items: center;
    gap: 8px;
    margin: 6px 8px 6px 0px;
  }
  .buttons :global(.new-folder svg path) {
    stroke-width: 1.5px;
  }
  .hidden {
    display: none;
  }
</style>
