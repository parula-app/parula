<OptionsSection title={workspace ? $workspace.name || $t`New` : $t`Unassigned`}>
  <OptionsRow icon={workspace ? $workspace.icon : UnassignedIcon}>
    {#if workspace}
      <hbox class="name-row">
        <label for="workspace-name-{index}">{$t`Name`}</label>
        <input id="workspace-name-{index}" class="lo-text-field" type="text" bind:value={workspace.name} on:change required />
        <input type="color" class="color" bind:value={workspace.color} on:change list="proposed-workspace-colors"
          title={$t`Color *=> Color of the workspace`} aria-label={$t`Color *=> Color of the workspace`} />
        {#if $workspaces.length > 1}
          <DialogButton label={$t`Delete`} icon={DeleteIcon} classes="plain" onClick={onDelete} />
        {/if}
      </hbox>
    {/if}
    {#if accounts.length}
      <grid class="accounts">
        {#each accounts as account}
          <button class="account" on:click={() => onOpenAccount(account)} title={$t`Open settings of this account`}>
            <AppIcon icon={getAccountIcon(account)} size="16px" />
            <span class="name">{account.name}</span>
          </button>
          <ComboBox options={workspaceOptions}
            value={account.workspace} placeholder={$t`Move to workspace`}
            label={$t`Workspace of ${account.name}`} width="200px"
            on:change={event => catchErrors(() => onMove(account, event.detail))} />
        {/each}
      </grid>
    {:else}
      <span class="hint">{$t`No accounts in this workspace yet. You can move accounts here.`}</span>
    {/if}
  </OptionsRow>
</OptionsSection>

<!-- <copied from="../../../frontend/Settings/Global/WorkspaceBlock.svelte"> -->
<datalist id="proposed-workspace-colors">
  {#each accountColors as color}
    <option value={color}></option>
  {/each}
</datalist>
<!-- </copied> -->

<script lang="ts">
  import type { Account } from "../../../logic/Abstract/Account";
  import { Workspace, accountColors, saveWorkspaces } from "../../../logic/Abstract/Workspace";
  import { appGlobal } from "../../../logic/app";
  import { catchErrors } from "../../../frontend/Util/error";
  import { changedWorkspace, selectedWorkspace } from "../../../frontend/MainWindow/Selected";
  import { getAccountIcon } from "../../../frontend/Settings/Shared/accountUIHelper";
  import { accountSettings } from "../SettingsCategories";
  import { selectedCategory, selectedAccount } from "../Window/selected";
  import { assert } from "../../../logic/util/util";
  import OptionsSection from "../Shared/OptionsSection.svelte";
  import OptionsRow from "../Shared/OptionsRow.svelte";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import AppIcon from "../../../frontend/AppsBar/AppIcon.svelte";
  import UnassignedIcon from "lucide-svelte/icons/circle-dashed";
  import type { Collection } from "svelte-collections";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import { t } from "../../../l10n/l10n";

  export let workspace: Workspace | null;

  const workspaces = appGlobal.workspaces;
  const allAccounts: Collection<Account>[] = [ appGlobal.emailAccounts, appGlobal.chatAccounts, appGlobal.meetAccounts, appGlobal.calendars, appGlobal.addressbooks ];

  $: index = $workspaces.contents.indexOf(workspace);
  $: workspaceOptions = $changedWorkspace && $workspaces.contents.map(listed => ({ value: listed, label: listed.name || $t`New` }));
  $: accounts = $changedWorkspace && allAccounts
    .flatMap(list => list.contents)
    .filter(account => (account.workspace ?? null) == workspace);

  // <copied from="../../../frontend/Settings/Global/WorkspaceBlock.svelte">
  async function onDelete() {
    assert(workspaces.length > 1, $t`Cannot remove the last workspace`);
    workspaces.remove(workspace);
    await saveWorkspaces();
  }
  // </copied>

  // <copied from="../../../frontend/Settings/Global/WorkspaceAccountMenu.svelte">
  async function onMove(account: Account, otherWorkspace: Workspace) {
    account.workspace = otherWorkspace;
    $changedWorkspace++;
    $selectedWorkspace = $selectedWorkspace;
    await account.save();
  }
  // </copied>

  function onOpenAccount(account: Account) {
    $selectedAccount = account;
    $selectedCategory = accountSettings.find(cat => account instanceof cat.type && cat.isMain);
  }
</script>

<style>
  .name-row {
    align-items: center;
    gap: 8px;
  }
  .name-row label {
    width: 64px;
  }
  .name-row input[type="text"] {
    width: 240px;
  }
  .color {
    width: 32px;
    height: 28px;
    padding: 2px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background: none;
  }
  .accounts {
    grid-template-columns: minmax(160px, 280px) max-content;
    align-items: center;
    gap: 4px 12px;
  }
  .account {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 28px;
    padding: 0 6px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .account:hover {
    background-color: var(--lo-hover-bg);
  }
  .name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
