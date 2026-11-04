<Dialog title={$t`Search Folder Criteria`} okLabel={$t`OK`} onOK={onSubmit} on:close={onClose} width="560px" bind:this={dialog}>
  <!-- <SearchCriteria bind:draft={criteria.draft} showAccount={false} showDates={false} showButtons={false} on:search={() => dialog.submit()} /> -->
  <SearchCriteria bind:draft={criteria.draft} showAccount={false} showButtons={false} on:search={() => dialog.submit()} />
  <svelte:fragment slot="buttons-start">
    <DialogButton label={$t`Clear All *=> Remove all criteria`} onClick={onClear} />
  </svelte:fragment>
</Dialog>

<script lang="ts">
  import type { SearchEMail } from "../../../logic/Mail/Store/SearchEMail";
  import { SearchFolderCriteria } from "./SearchFolderCriteria";
  import SearchCriteria from "./SearchCriteria.svelte";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let search: SearchEMail;
  const dispatch = createEventDispatcher<{ change: void, close: void }>();

  let dialog: Dialog;
  let criteria = new SearchFolderCriteria(search);

  function onClear() {
    criteria.draft.clear();
    criteria = criteria;
  }

  function onSubmit() {
    criteria.writeTo(search);
    dispatch("change");
  }

  function onClose() {
    dispatch("close");
  }
</script>
