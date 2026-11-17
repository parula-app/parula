<Dialog title={$t`${FolderTreeActions.displayName(folder)} Properties`}
  okLabel={$t`OK`} onOK={onApply}
  onApply={onApply} applyDisabled={!isChanged}
  width="520px"
  on:close>
  <DialogTabs tabs={tabs} bind:selected={tab} />
  {#if tab == FolderPropertiesTab.General}
    <FolderGeneralTab {folder} bind:name bind:specialFolder bind:countMode />
  {:else if tab == FolderPropertiesTab.Permissions && permissions}
    <FolderPermissionsTab bind:permissions on:change={() => { permissionsVersion++; }} />
  {:else if tab == FolderPropertiesTab.Synchronization}
    <FolderSyncTab {folder} />
  {/if}
</Dialog>

<script lang="ts" context="module">
  export enum FolderPropertiesTab {
    General = "general",
    Permissions = "permissions",
    Synchronization = "synchronization",
  }
</script>

<script lang="ts">
  import type { Folder } from "../../logic/Mail/Folder";
  import { FolderCountMode, FolderTreeActions } from "./LeftPane/FolderTreeActions";
  import { FolderPermissions } from "./FolderProperties/FolderPermissions";
  import FolderGeneralTab from "./FolderProperties/FolderGeneralTab.svelte";
  import FolderPermissionsTab from "./FolderProperties/FolderPermissionsTab.svelte";
  import FolderSyncTab from "./FolderProperties/FolderSyncTab.svelte";
  import Dialog from "../Shared/Dialog/Dialog.svelte";
  import DialogTabs from "../Shared/Dialog/DialogTabs.svelte";
  import { assert } from "../../logic/util/util";
  import { getLocalStorage } from "../../frontend/Util/LocalStorage";
  import { t } from "../../l10n/l10n";

  export let folder: Folder;
  export let tab: FolderPropertiesTab = FolderPropertiesTab.General;

  let name = folder.name;
  let specialFolder = folder.specialFolder;
  const countModes = getLocalStorage<Record<string, FolderCountMode>>("lookout.mail.folderCountModes", {});
  let initialCountMode = FolderTreeActions.showsTotalCount(folder, countModes.value) ? FolderCountMode.Total : FolderCountMode.Unread;
  let countMode = initialCountMode;
  let permissions = (!!folder.account && folder.account.canShareWithPersons() && !folder.account.isDependentAccount) ? new FolderPermissions(folder) : null;
  let permissionsVersion = 0;

  $: tabs = [
    { id: FolderPropertiesTab.General, label: $t`General` },
    ...(permissions ? [{ id: FolderPropertiesTab.Permissions, label: $t`Permissions *=> Who can access this folder` }] : []),
    { id: FolderPropertiesTab.Synchronization, label: $t`Synchronization *=> Tab with the sync status of the folder` },
  ];
  $: isChanged = isDirty(name, specialFolder, countMode, permissionsVersion);

  function isDirty(..._dependencies: any[]): boolean {
    return name != folder.name || specialFolder != folder.specialFolder ||
      countMode != initialCountMode || !!permissions?.isChanged;
  }

  async function onApply() {
    let isRenamed = name != folder.name;
    let isSpecialChanged = specialFolder != folder.specialFolder;
    if (isRenamed) {
      assert(name.trim(), $t`Name cannot be empty`);
      await folder.rename(name.trim());
      name = folder.name;
    }
    if (isSpecialChanged) {
      folder.specialFolder = specialFolder;
    }
    if (isRenamed || isSpecialChanged) {
      await folder.save();
    }
    if (countMode != initialCountMode) {
      countModes.value = { ...countModes.value, [folder.account?.id + "/" + folder.id]: countMode };
      initialCountMode = countMode;
    }
    if (permissions?.isChanged) {
      await permissions.apply();
      permissions = permissions;
    }
    permissionsVersion++;
  }
</script>
