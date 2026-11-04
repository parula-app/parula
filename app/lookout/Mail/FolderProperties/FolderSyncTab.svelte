<vbox class="synchronization">
  <GroupBox label={$t`Statistics for this folder`}>
    <FormGrid columns="max-content minmax(0, 1fr)">
      <span class="lo-form-label">{$t`Server folder contains`}</span>
      <span>{$t`${$folder.countTotal ?? 0} items`}</span>
      <span class="lo-form-label">{$t`Unread *=> State of the message that has not been read`}</span>
      <span>{$t`${$folder.countUnread ?? 0} items`}</span>
      <span class="lo-form-label">{$t`Downloaded to this computer`}</span>
      <span>{$t`${downloadedCount} items`}</span>
    </FormGrid>
  </GroupBox>
  <hbox class="buttons">
    <DialogButton label={$t`Update Folder`} onClick={onUpdateFolder} />
    <DialogButton label={$t`Download All Messages`} onClick={() => refreshHack(onDownloadAll)} />
    <DialogButton label={$t`Full Re-sync`} onClick={() => refreshHack(onFullResync)} />
  </hbox>
</vbox>

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { EMail } from "../../../logic/Mail/EMail";
  import GroupBox from "../../Shared/Form/GroupBox.svelte";
  import FormGrid from "../../Shared/Form/FormGrid.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import { t } from "../../../l10n/l10n";

  export let folder: Folder;

  $: messages = $folder.messages;
  $: downloadedCount = countDownloaded($messages.contents, refreshTrigger);

  function countDownloaded(list: EMail[], _refresh: number): number {
    return list.filter(message => message.downloadComplete).length;
  }

  async function onUpdateFolder() {
    await folder.getNewMessages();
  }

  // <copied from="../../../frontend/Settings/Mail/Account/FolderGeneral.svelte">
  async function onDownloadAll() {
    await folder.listMessages();
    await folder.downloadAllMessages();
  }

  async function onFullResync() {
    await folder.fullResync();
    await folder.downloadAllMessages();
  }

  /** `downloadedMessages` depends on `.downloadComplete`
   * property of emails, not list of emails (emails added and removed),
   * Would need to observe all emails. Instead, use this hack for now. */
  let refreshTrigger = 0;
  async function refreshHack(asyncFunc: () => Promise<void>) {
    let interval = setInterval(() => {
      refreshTrigger++;
    }, 1000);
    try {
      await asyncFunc();
    } finally {
      refreshTrigger++;
      clearInterval(interval);
    }
  }
  // </copied>
</script>

<style>
  .synchronization {
    gap: 16px;
    padding-top: 16px;
  }
  .buttons {
    gap: 8px;
    flex-wrap: wrap;
  }
</style>
