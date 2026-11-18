<Dialog title={$t`Move Folder`}
  okLabel={$t`OK`}
  okDisabled={!target && $t`Select a folder first`}
  onOK={onMove}
  on:close>
  <vbox class="dialog-content">
    <span class="caption">{$t`Move the folder "${FolderTreeActions.displayName(folder)}" to the folder`}</span>
    <FolderPicker label={$t`Folders`} bind:selectedFolder={target}
      disableFolder={candidate => !FolderTreeActions.canMoveFolderInto(folder, candidate) && $t`The folder cannot be moved there`} />
  </vbox>
</Dialog>

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import { FolderTreeActions } from "./FolderTreeActions";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import FolderPicker from "./FolderPicker.svelte";
  import { t } from "../../../l10n/l10n";

  export let folder: Folder;

  let target: Folder | null = null;

  async function onMove() {
    await FolderTreeActions.moveFolder(folder, target);
  }
</script>

<style>
  .dialog-content {
    gap: 8px;
  }
</style>
