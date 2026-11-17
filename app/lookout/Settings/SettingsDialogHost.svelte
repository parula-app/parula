{#if $settingsDialog?.kind == "options" || $settingsDialog?.kind == "account"}
  {#key $settingsDialog}
    <SettingsApp categoryID={$settingsDialog?.categoryID} account={$settingsDialog?.account} showOnlyAccount={$settingsDialog?.kind == "account"} on:close={onClose} />
  {/key}
{:else if $settingsDialog?.kind == "import-export"}
  {#key $settingsDialog}
    <ImportExportWizard preselected={$settingsDialog?.preselected} action={$settingsDialog?.action} on:close={onClose} />
  {/key}
{:else if $settingsDialog?.kind == "new-folder-account"}
  <NewFolderAccountDialog kind={$settingsDialog?.folderKind} localOnly={$settingsDialog?.localOnly} on:close={onClose} />
{/if}

<script lang="ts">
  import { settingsDialog, closeSettingsDialog } from "./SettingsDialogs";
  import SettingsApp from "./Window/SettingsApp.svelte";
  import ImportExportWizard from "./ImportExport/ImportExportWizard.svelte";
  import NewFolderAccountDialog from "../Setup/NewFolderAccountDialog.svelte";


  function onClose() {
    closeSettingsDialog();
  }
</script>
