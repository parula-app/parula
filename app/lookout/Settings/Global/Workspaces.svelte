<OptionsPage icon={WorkspacesIcon} description={$t`Your work-life balance: Mute some accounts at times to focus or relax. You can choose the workspace in the window header.`}>
  {#each $workspaces.each as workspace}
    <WorkspaceBlock {workspace} on:change={onSaveDelayed} />
  {/each}
  {#if haveUnassigned}
    <WorkspaceBlock workspace={null} />
  {/if}
  <hbox class="add">
    <DialogButton label={$t`Add Workspace`} icon={AddIcon} onClick={onAdd} />
  </hbox>
</OptionsPage>

<script lang="ts">
  import { Workspace, randomAccountColor, saveWorkspaces } from "../../../logic/Abstract/Workspace";
  import { appGlobal } from "../../../logic/app";
  import { changedWorkspace } from "../../../frontend/MainWindow/Selected";
  import { catchErrors } from "../../../frontend/Util/error";
  import { UserError, assert } from "../../../logic/util/util";
  import OptionsPage from "../Shared/OptionsPage.svelte";
  import WorkspaceBlock from "./WorkspaceBlock.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import WorkspacesIcon from "lucide-svelte/icons/layers";
  import AddIcon from "lucide-svelte/icons/plus";
  import debounce from "lodash/debounce";
  import { t } from "../../../l10n/l10n";

  // <copied from="../../../frontend/Settings/Global/Workspaces.svelte"> plus the changedWorkspace update in onSave(), for the workspace names in the Move to workspace lists
  $: workspaces = appGlobal.workspaces;
  $: haveUnassigned =
    appGlobal.emailAccounts.find(acc => !acc.workspace) ||
    appGlobal.chatAccounts.find(acc => !acc.workspace) ||
    appGlobal.meetAccounts.find(acc => !acc.workspace) ||
    appGlobal.calendars.find(acc => !acc.workspace) ||
    appGlobal.addressbooks.find(acc => !acc.workspace) ||
    $changedWorkspace < 0;

  function onAdd() {
    let workspace = new Workspace("", randomAccountColor(), null);
    workspaces.add(workspace);
  }

  async function onSave() {
    assert(workspaces.hasItems, $t`Need at least 1 workspace`);
    for (let workspace of workspaces) {
      if (!workspace.name) {
        throw new UserError($t`Please enter a workspace name`);
      }
    }
    await saveWorkspaces();
    $changedWorkspace++;
  }
  const onSaveDelayed = debounce(() => catchErrors(onSave), 500);
  // </copied>
</script>

<style>
  .add {
    margin-block-start: 8px;
  }
</style>
