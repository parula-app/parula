<vbox class="right-side-bar">
  <Rename file={dir} />

  <ActionToolbar file={dir} />
</vbox>

<FileSelector bind:this={fileSelector} />

<script lang="ts">
  import { Directory } from "../../../logic/Files/Directory";
  import Rename from "./Rename.svelte";
  import ActionToolbar from "./ActionToolbar.svelte";
  import FileSelector from "../../Mail/Composer/Attachments/FileSelector.svelte";
  import { t } from "../../../l10n/l10n";

  export let dir: Directory;

  let fileSelector: FileSelector;
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
  async function newFolder() {
    let newFolder = dir.newDirectory($t`New Folder`);
    // TODO open sidebar and focus rename
    await dir.createSubDirectory(newFolder.name);
  }
</script>

<style>
  .right-side-bar {
    align-items: stretch;
    margin-block: 40px;
    margin-inline: 20px;
  }
  .name {
    font-size: 120%;
    font-weight: bold;
    margin-inline-start: 20px;
  }
  .buttons {
    align-items: center;
    gap: 8px;
    margin: 6px 8px 6px 0px;
  }
  .action.buttons {
    justify-content: end;
  }
</style>
