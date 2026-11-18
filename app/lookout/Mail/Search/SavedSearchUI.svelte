<Dialog title={$t`Save Search *=> Save this search as a search folder`}
  okLabel={$t`OK`}
  okDisabled={!name?.trim() && $t`Enter a name`}
  onOK={onSave}
  on:close>
  <vbox class="dialog-content">
    <label for="save-search-name">{$t`Name of the Search Folder`}</label>
    <input id="save-search-name" class="lo-text-field" type="text" bind:value={name} />
  </vbox>
</Dialog>

<script lang="ts">
  import type { SearchEMail } from "../../../logic/Mail/Store/SearchEMail";
  import { SavedSearchFolder } from "../../../logic/Mail/Virtual/SavedSearchFolder";
  import { allAccountsAccount } from "../../../logic/Mail/AccountsList/ShowAccounts";
  import { selectedAccount, selectedFolder } from "../../../frontend/Mail/Selected";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import { t } from "../../../l10n/l10n";
  import { AppWindow } from "../../../frontend/MainWindow/AppWindow";

  const appWindow = AppWindow.current();

  export let search: SearchEMail;

  let name = search.bodyText ?? "";

  async function onSave() {
    // <copied from="../../../frontend/Mail/Search/SavedSearchUI.svelte">
    let folder = new SavedSearchFolder(search.clone());
    folder.name = name.trim();
    await folder.save();

    appWindow.uiState(selectedAccount).set(allAccountsAccount);
    appWindow.uiState(selectedFolder).set(folder);
    // </copied>
  }

</script>

<style>
  .dialog-content {
    gap: 6px;
  }
</style>
