<Dialog title={$t`Rules and Alerts`} bind:this={dialog}
  okLabel={$t`OK`}
  okDisabled={!folder && $t`Select a folder first`}
  onOK={onOK}
  on:close={onClose} width="400px">
  <vbox class="content">
    <span class="caption">{$t`Choose a folder`}</span>
    <FolderPicker label={$t`Folders`} bind:selectedFolder={folder}
      disableFolder={candidate => candidate.account != account && $t`Rules can only use folders of the account ${account.name}`}
      on:choose={() => dialog.submit()} />
  </vbox>
  <svelte:fragment slot="buttons-start">
    <DialogButton label={$t`New… *=> Create a new folder`} onClick={() => { isCreating = true; }}
      tooltip={folder ? $t`Create a subfolder of ${folder.name}` : $t`Create a new folder`} />
  </svelte:fragment>
</Dialog>
{#if isCreating}
  <NewFolderDialog {account} parent={folder?.account == account ? folder : null}
    onCreated={created => { folder = created; }}
    on:close={() => { isCreating = false; }} />
{/if}

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import FolderPicker from "../LeftPane/FolderPicker.svelte";
  import NewFolderDialog from "../LeftPane/NewFolderDialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let account: MailAccount;
  export let folder: Folder | null = null;
  export let onChosen: (folder: Folder) => void | Promise<void>;
  const dispatch = createEventDispatcher<{ close: void }>();

  let dialog: Dialog;
  let isCreating = false;

  async function onOK() {
    if (!folder) {
      return;
    }
    await onChosen(folder);
  }

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  .content {
    gap: 6px;
  }
  .caption {
    color: var(--lo-fg-secondary);
  }
</style>
