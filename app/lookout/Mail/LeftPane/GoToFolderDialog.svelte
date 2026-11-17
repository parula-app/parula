<Dialog title={$t`Go to Folder`} bind:this={dialog}
  okLabel={$t`OK`}
  okDisabled={!target && $t`Select a folder first`}
  onOK={onGo}
  on:close>
  <vbox class="dialog-content">
    <span class="caption">{$t`Folders`}</span>
    <FolderPicker label={$t`Folders`} bind:selectedFolder={target} on:choose={() => dialog.submit()} />
  </vbox>
</Dialog>

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import { selectedAccount, selectedFolder } from "../../../frontend/Mail/Selected";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import FolderPicker from "./FolderPicker.svelte";
  import { t } from "../../../l10n/l10n";

  let dialog: Dialog;
  let target: Folder | null = $selectedFolder;

  function onGo() {
    $selectedAccount = target.account;
    $selectedFolder = target;
  }
</script>

<style>
  .dialog-content {
    gap: 8px;
  }
</style>
