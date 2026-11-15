<Clickable onClick={onWorkspaceToggle} tooltip={$selectedWorkspace?.name ?? $t`Workspace`}>
  <hbox class="workspace-button" bind:this={workspaceE}
    class:in-settings-workspaces={$selectedApp == settingsMustangApp && $selectedCategory?.id == "global-workspaces"}
    style="--workspace-color: {$selectedWorkspace?.color}">
    <hbox class="dot" class:selected={$selectedWorkspace} />
    <Popup bind:popupOpen={showWorkspaceDropdown} popupAnchor={workspaceE} placement="bottom-start" boundaryElSel="body">
      <WorkspaceDropDown bind:open={showWorkspaceDropdown} />
    </Popup>
  </hbox>
</Clickable>

<script lang="ts">
  import { selectedApp } from "./selectedApp";
  import { selectedWorkspace } from "../MainWindow/Selected";
  import { settingsMustangApp } from "../Settings/Window/SettingsMustangApp";
  import { selectedCategory } from "../Settings/Window/selected";
  import WorkspaceDropDown from "../MainWindow/WorkspaceDropDown.svelte";
  import Popup from "../Shared/Popup.svelte";
  import Clickable from "../Shared/Clickable.svelte";
  import { t } from "../../l10n/l10n";

  let workspaceE: HTMLDivElement;
  let showWorkspaceDropdown = false;
  function onWorkspaceToggle() {
    showWorkspaceDropdown = !showWorkspaceDropdown;
  }
</script>

<style>
  .workspace-button {
    width: 28px;
    height: 28px;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: rgba(255, 255, 255, 80%);
  }
  .workspace-button:hover {
    background-color: rgba(255, 255, 255, 25%);
  }
  .dot {
    width: 14px;
    height: 14px;
    border: 2px solid currentColor;
    border-radius: 50%;
    box-sizing: border-box;
  }
  .dot.selected {
    border: none;
    background-color: var(--workspace-color);
  }
  .workspace-button :global(.workspace-selector) {
    margin-block-start: 0px;
    border-radius: 10px;
  }
  .in-settings-workspaces {
    animation: flashColor 1s linear infinite alternate;
  }
  @keyframes flashColor {
    0% {
      background-color: var(--hover-bg);
    }
    100% {
      background-color: var(--appbar-bg);
    }
  }
</style>
