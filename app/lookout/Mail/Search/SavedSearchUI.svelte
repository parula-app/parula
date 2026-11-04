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

<script lang="ts" context="module">
  import type { SearchEMail } from "../../../logic/Mail/Store/SearchEMail";
  import { writable } from "svelte/store";

  export const openSaveSearch = writable<SearchEMail | null>(null);
</script>

<script lang="ts">
  import { SavedSearchFolder } from "../../../logic/Mail/Virtual/SavedSearchFolder";
  import { allAccountsAccount } from "../../../logic/Mail/AccountsList/ShowAccounts";
  import { selectedAccount, selectedFolder } from "../../../frontend/Mail/Selected";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import { t } from "../../../l10n/l10n";

  export let search: SearchEMail;

  let name = search.bodyText ?? "";

  async function onSave() {
    // <copied from="../../../frontend/Mail/Search/SavedSearchUI.svelte">
    let folder = new SavedSearchFolder(search.clone());
    folder.name = name.trim();
    await folder.save();

    $selectedAccount = allAccountsAccount;
    $selectedFolder = folder;
    // </copied>
  }

</script>

<style>
  .dialog-content {
    gap: 6px;
  }
</style>
