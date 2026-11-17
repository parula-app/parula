<Dialog title={$t`Create New Folder`}
  okLabel={$t`OK`}
  okDisabled={!name?.trim() && $t`Enter a name`}
  onOK={onCreate}
  on:close>
  <vbox class="dialog-content">
    <span>{$t`Name`}</span>
    <TextField label={$t`Name`} bind:value={name} />
    <span class="caption">{$t`Select where to place the folder`}</span>
    <FolderPicker label={$t`Folders`} allowAccount
      bind:selectedFolder={parent} bind:selectedAccount={account}
      disableFolder={folder => folder.disableSubfolders()} />
  </vbox>
</Dialog>

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { selectedAccount, selectedFolder } from "../../../frontend/Mail/Selected";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import FolderPicker from "./FolderPicker.svelte";
  import TextField from "../../Shared/Form/TextField.svelte";
  import { assert } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";

  export let account: MailAccount;
  export let parent: Folder | null = null;
  export let onCreated: (folder: Folder) => void = null;

  let name = "";

  async function onCreate() {
    assert(account, $t`Select where to place the folder`);
    let folder = parent
      ? await parent.createSubFolder(name.trim())
      : await account.createToplevelFolder(name.trim());
    if (parent) {
      /* <copied to="FolderTreeActions.ts"> */
      let expandedIDs = getLocalStorage<string[]>("lookout.mail.expandedFolders", []);
      let parentID = parent.account?.id + "/" + parent.id;
      expandedIDs.value = [...(expandedIDs.value ?? []).filter(id => id != parentID), parentID];
      /* </copied> */
    }
    if (onCreated) {
      onCreated(folder);
      return;
    }
    $selectedAccount = folder.account;
    $selectedFolder = folder;
  }

</script>

<style>
  .dialog-content {
    gap: 6px;
  }
  .caption {
    margin-block-start: 8px;
  }
</style>
