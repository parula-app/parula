<MenuItem
  onClick={getNewMessages}
  label={$t`Get mail`}
  icon={DownloadIcon} />
<MenuItem
  onClick={downloadAll}
  label={$t`Download all messages`}
  icon={DownloadAllIcon} />
<hbox class="menuitem markasread">
  <MenuItem
    onClick={markAllRead}
    label={$t`Mark all messages as read`}
    iconSize="12px"
    icon={CircleIcon} />
</hbox>
{#if folder.specialFolder == SpecialFolder.Trash || folder.specialFolder == SpecialFolder.Spam}
  <MenuItem
    onClick={deleteAllMsgs}
    label={$t`Delete all messages`}
    classes="danger"
    icon={DeleteIcon} />
{/if}
<MenuDivider />
<MenuItem
  onClick={openFolderSettings}
  label={$t`Folder properties`}
  icon={FolderSettingsIcon} />
<!--
<MenuDivider />
<MenuLabel>
  <grid class="msg-counts">
    <hbox class="count">{$folder.countNewArrived}</hbox>
    <hbox>{$t`new`}</hbox>
    <hbox class="count">{$folder.countUnread}</hbox>
    <hbox>{$t`unread`}</hbox>
    <hbox class="count">{$folder.countTotal}</hbox>
    <hbox>{$t`total`}</hbox>
  </grid>
</MenuLabel>
-->

<script lang="ts">
  import { type Folder, SpecialFolder } from "../../../logic/Mail/Folder";
  import { selectedFolder } from "../Selected";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuLabel from "../../Shared/Menu/MenuLabel.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import { openFolderProperties } from '../FolderPropertiesPage.svelte';
  import DownloadIcon from "lucide-svelte/icons/download";
  import DownloadAllIcon from "lucide-svelte/icons/hard-drive-download";
  import CircleIcon from "lucide-svelte/icons/circle";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import FolderSettingsIcon from "lucide-svelte/icons/folder-cog";
  import { t } from "../../../l10n/l10n";

  export let folder: Folder;

  async function getNewMessages() {
    let account = folder.account;
    if (!account.isLoggedIn) {
      await account.loginAndStartup(true);
    }
    await folder.getNewMessages();
  }

  async function downloadAll() {
    await folder.listMessages();
    await folder.downloadAllMessages();
  }

  async function markAllRead() {
    await folder.markAllRead();
  }

  async function deleteAllMsgs() {
    for (let msg of folder.messages.contents) { // copy: deleting alters `folder.messages`
      await msg.deleteMessage();
    }
  }

  function openFolderSettings() {
    $selectedFolder = folder;
    $openFolderProperties = true;
  }
</script>

<style>
  /* .msg-counts {
    opacity: 50%;
    grid-template-columns: max-content max-content;
    column-gap: 8px;
  }
  .count {
    justify-self: end;
  }*/
  .menuitem.markasread :global(.icon) {
    margin-inline-start: 2px;
    margin-inline-end: 2px;
  }
</style>
