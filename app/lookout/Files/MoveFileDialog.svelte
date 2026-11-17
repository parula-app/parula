<Dialog title={copy ? $t`Copy Items` : $t`Move Items`}
  okLabel={$t`OK`}
  okDisabled={!target && $t`Select a folder first` || target == file.parent && $t`The items are already in this folder`}
  onOK={onOK}
  on:close>
  <vbox class="dialog-content">
    <span class="caption">
      {copy ? $t`Copy the selected items to the folder` : $t`Move the selected items to the folder`}
    </span>
    <vbox class="folders">
      <FolderList folders={rootDirs} bind:selectedFolder={target} bind:selectedFolders />
    </vbox>
  </vbox>
  <svelte:fragment slot="buttons-start">
    <DialogButton label={$t`New… *=> Create a new folder`} onClick={() => { isCreating = true; }}
      disabled={!target && $t`Select a folder first`}
      tooltip={target ? $t`Create a subfolder of ${target.name}` : $t`Create a new folder`} />
  </svelte:fragment>
</Dialog>
{#if isCreating}
  <NewFolderDialog parent={target} on:close={() => { isCreating = false; }} />
{/if}

<script lang="ts">
  import type { File } from "../../logic/Files/File";
  import type { Directory } from "../../logic/Files/Directory";
  import FolderList from "../../frontend/Files/FolderLeftPane/FolderList.svelte";
  import Dialog from "../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../Shared/Dialog/DialogButton.svelte";
  import NewFolderDialog from "./NewFolderDialog.svelte";
  import { ArrayColl, type Collection } from "svelte-collections";
  import { t } from "../../l10n/l10n";

  export let file: File;
  export let rootDirs: Collection<Directory>;
  export let copy = false;

  let target: Directory | null = null;
  let selectedFolders = new ArrayColl<Directory>();
  let isCreating = false;

  async function onOK() {
    if (copy) {
      await target.copyFileHere(file);
    } else {
      await target.moveFileHere(file);
    }
  }
</script>

<style>
  .dialog-content {
    gap: 8px;
  }
  .folders {
    min-height: 240px;
    max-height: 360px;
    padding: 4px;
    overflow-y: auto;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
  }
</style>
