<RibbonTab label={$t`View *=> Ribbon tab with layout and display settings`}>
  <RibbonGroup label={$t`Current View`}>
    <RibbonMenuButton label={$t`Change View`} shortLabel={$t`Views *=> Choose another view of the items`} icon={ChangeViewIcon}>
      {#each viewTypes as viewType}
        <MenuItem label={viewType.label} tooltip={viewType.tooltip} icon={viewType.icon}
          checked={$settings.type == viewType.id}
          onClick={() => changeViewSettings(folder, { type: viewType.id })} />
      {/each}
      <MenuDivider />
      <MenuItem label={$t`Apply Current View to Other Mail Folders…`}
        onClick={() => { $openApplyView = { folder }; }} />
    </RibbonMenuButton>
    <RibbonButton label={$t`View Settings`} icon={ViewSettingsIcon} size="small"
      tooltip={$t`Change the columns, grouping, sorting and filter of this view`}
      onClick={() => { $openViewSettings = { folder }; }} />
    <RibbonButton label={$t`Reset View`} icon={ResetIcon} size="small"
      tooltip={$t`Reset the message list and the layout to the default settings`}
      onClick={onResetView} />
  </RibbonGroup>
  <RibbonGroup label={$t`Messages`}>
    <RibbonCheckBox label={$t`Show as Conversations`}
      bind:checked={conversationsChecked}
      on:change={event => catchErrors(() => onShowAsConversations(event.detail))} />
    <RibbonMenuButton label={$t`Conversation Settings`} shortLabel={$t`Settings`} icon={ConversationSettingsIcon} size="small"
      disabled={!$settings.showAsConversations && $t`Turn on Show as Conversations first`}>
      <MenuItem label={$t`Show Senders Above the Subject`} checked={$settings.showSendersAboveSubject} checkable
        onClick={() => changeViewSettings(folder, { showSendersAboveSubject: !$settings.showSendersAboveSubject }, ApplyScope.AllFolders)} />
      <MenuItem label={$t`Always Expand Selected Conversation`} checked={$settings.alwaysExpandSelected} checkable
        onClick={() => changeViewSettings(folder, { alwaysExpandSelected: !$settings.alwaysExpandSelected }, ApplyScope.AllFolders)} />
      <MenuItem label={$t`Use Classic Indented View`} checked={$settings.classicIndented} checkable
        onClick={() => changeViewSettings(folder, { classicIndented: !$settings.classicIndented }, ApplyScope.AllFolders)} />
    </RibbonMenuButton>
  </RibbonGroup>
  <RibbonGroup label={$t`Arrangement *=> Ribbon group for how the items are arranged`}>
    <RibbonMenuButton label={$t`Message Preview`} icon={PreviewIcon}>
      {#each previewOptions as option}
        <MenuItem label={option.label} checked={$settings.previewLines == option.lines}
          onClick={() => onPreviewLines(option.lines)} />
      {/each}
    </RibbonMenuButton>
    <RibbonMenuButton label={$t`Arrange By`} shortLabel={$t`Arrange *=> Choose how the items are sorted`} icon={ArrangeIcon}>
      <ArrangeByMenuItems {folder} />
    </RibbonMenuButton>
    <RibbonToggleButton label={$t`Reverse Sort`} icon={ReverseIcon} size="small"
      selected={!!$settings.reverseSort}
      onClick={() => changeViewSettings(folder, { reverseSort: !$settings.reverseSort })} />
    <RibbonButton label={$t`Add Columns`} icon={AddColumnsIcon} size="small"
      tooltip={$t`Choose the columns of the single-line view`}
      onClick={onAddColumns} />
    <RibbonMenuButton label={$t`Expand/Collapse *=> Expand or collapse the groups in the message list`} icon={ExpandCollapseIcon} size="small"
      disabled={!$settings.showInGroups && $t`Turn on Show in Groups first`}>
      <MenuItem label={$t`Collapse This Group`} icon={CollapseIcon} onClick={() => { dispatch("collapsegroup", true); }} />
      <MenuItem label={$t`Expand This Group`} icon={ExpandIcon} onClick={() => { dispatch("collapsegroup", false); }} />
      <MenuDivider />
      <MenuItem label={$t`Collapse All Groups`} icon={CollapseAllIcon} onClick={() => { dispatch("collapseall", true); }} />
      <MenuItem label={$t`Expand All Groups`} icon={ExpandAllIcon} onClick={() => { dispatch("collapseall", false); }} />
    </RibbonMenuButton>
  </RibbonGroup>
  <RibbonGroup label={$t`Layout *=> Ribbon group with settings for the window panes`}>
    <RibbonToggleButton label={$t`Use Tighter Spacing`} icon={SpacingIcon}
      selected={!!$settings.tighterSpacing}
      onClick={() => changeViewSettings(folder, { tighterSpacing: !$settings.tighterSpacing }, ApplyScope.AllFolders)} />
    <RibbonMenuButton label={$t`Folder Pane`} shortLabel={$t`Folders`} icon={FolderPaneIcon}>
      <MenuItem label={$t`Normal *=> Folder pane at full width`} checked={$folderPane.value == FolderPaneMode.Normal}
        onClick={() => { $folderPane.value = FolderPaneMode.Normal; }} />
      <MenuItem label={$t`Minimized *=> Folder pane as a narrow bar`} checked={$folderPane.value == FolderPaneMode.Minimized}
        onClick={() => { $folderPane.value = FolderPaneMode.Minimized; }} />
      <MenuItem label={$t`Off *=> The pane is hidden`} checked={$folderPane.value == FolderPaneMode.Off}
        onClick={() => { $folderPane.value = FolderPaneMode.Off; }} />
      <MenuDivider />
      <MenuItem label={$t`Favorites *=> Section of the folder pane with the favorite folders`} checked={$showFavorites.value} checkable
        onClick={() => { $showFavorites.value = !$showFavorites.value; }} />
    </RibbonMenuButton>
    <RibbonMenuButton label={$t`Reading Pane`} shortLabel={$t`Reading *=> Reading pane: where the selected item is shown`} icon={ReadingPaneIcon}>
      <MenuItem label={$t`Right *=> Reading pane on the right side`} icon={RightIcon} checked={$readingPane.value == "right"}
        onClick={() => { $readingPane.value = "right"; }} />
      <MenuItem label={$t`Bottom *=> Reading pane at the bottom`} icon={BottomIcon} checked={$readingPane.value == "bottom"}
        onClick={() => { $readingPane.value = "bottom"; }} />
      <MenuItem label={$t`Off *=> The pane is hidden`} icon={OffIcon} checked={$readingPane.value == "off"}
        onClick={() => { $readingPane.value = "off"; }} />
      <MenuDivider />
      <MenuItem label={$t`Options… *=> Options for the reading pane`} onClick={() => { $openReadingPaneOptions = true; }} />
    </RibbonMenuButton>
    <RibbonMenuButton label={$t`To-Do Bar`} icon={ToDoBarIcon}>
      <MenuItem label={$t`Calendar`} icon={CalendarIcon} checkable checked={$toDoBar.value?.includes(ToDoBarPart.Calendar)}
        onClick={() => setToDoBarPart(ToDoBarPart.Calendar, !$toDoBar.value?.includes(ToDoBarPart.Calendar))} />
      <MenuItem label={$t`People *=> or Persons - Short word, less than 10 characters`} icon={PeopleIcon} checkable checked={$toDoBar.value?.includes(ToDoBarPart.People)}
        onClick={() => setToDoBarPart(ToDoBarPart.People, !$toDoBar.value?.includes(ToDoBarPart.People))} />
      <MenuDivider />
      <MenuItem label={$t`Off *=> The pane is hidden`} checked={!$toDoBar.value?.length}
        onClick={() => { $toDoBar.value = []; }} />
    </RibbonMenuButton>
  </RibbonGroup>
  <RibbonDisplayGroup />
</RibbonTab>

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import { FolderPaneMode } from "../LeftPane/LeftPane.svelte";
  import { ToDoBarPart } from "../ToDoBar/ToDoBar.svelte";
  import type { ReadingPanePosition } from "../3pane/3Pane.svelte";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import { catchErrors } from "../../../frontend/Util/error";
  import { ApplyScope, viewSettingsOf, viewSettingsStore, changeViewSettings, resetViewSettings, ViewType } from "../ViewSettings/ViewSettings";
  import { openViewSettings, openShowColumns, askedScope, openApplyView, openReadingPaneOptions } from "../Selected";
  import ArrangeByMenuItems from "../ViewSettings/ArrangeByMenuItems.svelte";
  import RibbonTab from "../../Shared/Ribbon/RibbonTab.svelte";
  import RibbonGroup from "../../Shared/Ribbon/RibbonGroup.svelte";
  import RibbonDisplayGroup from "../../Shared/Ribbon/RibbonDisplayGroup.svelte";
  import RibbonButton from "../../Shared/Ribbon/RibbonButton.svelte";
  import RibbonToggleButton from "../../Shared/Ribbon/RibbonToggleButton.svelte";
  import RibbonMenuButton from "../../Shared/Ribbon/RibbonMenuButton.svelte";
  import RibbonCheckBox from "../../Shared/Ribbon/RibbonCheckBox.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import ChangeViewIcon from "lucide-svelte/icons/layout-list";
  import CompactIcon from "lucide-svelte/icons/rows-2";
  import SingleIcon from "lucide-svelte/icons/list";
  import PreviewViewIcon from "lucide-svelte/icons/scroll-text";
  import ViewSettingsIcon from "lucide-svelte/icons/settings-2";
  import ResetIcon from "lucide-svelte/icons/rotate-ccw";
  import PreviewIcon from "lucide-svelte/icons/text-quote";
  import ArrangeIcon from "lucide-svelte/icons/arrow-down-up";
  import ReverseIcon from "lucide-svelte/icons/arrow-up-down";
  import AddColumnsIcon from "lucide-svelte/icons/columns-3";
  import ConversationSettingsIcon from "lucide-svelte/icons/message-square-more";
  import ExpandCollapseIcon from "lucide-svelte/icons/list-collapse";
  import FolderPaneIcon from "lucide-svelte/icons/panel-left";
  import ReadingPaneIcon from "lucide-svelte/icons/columns-2";
  import RightIcon from "lucide-svelte/icons/panel-right";
  import BottomIcon from "lucide-svelte/icons/panel-bottom";
  import OffIcon from "lucide-svelte/icons/square";
  import SpacingIcon from "lucide-svelte/icons/fold-vertical";
  import ToDoBarIcon from "lucide-svelte/icons/panel-right-open";
  import CalendarIcon from "lucide-svelte/icons/calendar";
  import PeopleIcon from "lucide-svelte/icons/users";
  import CollapseIcon from "lucide-svelte/icons/chevron-up";
  import ExpandIcon from "lucide-svelte/icons/chevron-down";
  import CollapseAllIcon from "lucide-svelte/icons/chevrons-down-up";
  import ExpandAllIcon from "lucide-svelte/icons/chevrons-up-down";
  import { t } from "../../../l10n/l10n";
  import { createEventDispatcher } from "svelte";

  export let folder: Folder | null;

  const dispatch = createEventDispatcher<{ collapsegroup: boolean, collapseall: boolean }>();

  const folderPane = getLocalStorage<FolderPaneMode>("lookout.mail.folderPane", FolderPaneMode.Normal);
  const readingPane = getLocalStorage<ReadingPanePosition>("lookout.mail.readingPane", "right");
  const showFavorites = getLocalStorage<boolean>("lookout.mail.showFavorites", true);
  const toDoBar = getLocalStorage<ToDoBarPart[]>("lookout.mail.toDoBar", []);
  $: settings = viewSettingsStore(folder);
  let conversationsChecked = false;
  $: conversationsChecked = !!$settings.showAsConversations;

  async function onShowAsConversations(checked: boolean) {
    let scope = await askScope(checked
      ? $t`Do you want to show messages arranged by conversations in all folders or just this folder?`
      : $t`Do you want to stop showing messages arranged by conversations in all folders or just this folder?`);
    if (scope) {
      changeViewSettings(folder, { showAsConversations: checked }, scope);
    }
    conversationsChecked = !!viewSettingsOf(folder).showAsConversations;
  }

  async function onPreviewLines(lines: number) {
    let scope = await askScope($t`Do you want to change the message preview in all folders or just this folder?`);
    if (scope) {
      changeViewSettings(folder, { previewLines: lines }, scope);
    }
  }

  function askScope(question: string): Promise<ApplyScope | null> {
    return new Promise(resolve => $askedScope = { question, onChoice: resolve });
  }

  /* <copied to="../3pane/ColumnHeader.svelte"> */
  function onAddColumns() {
    if (viewSettingsOf(folder).type == ViewType.Compact) {
      changeViewSettings(folder, { type: ViewType.Single });
    }
    $openShowColumns = { folder };
  }
  /* </copied> */

  function setToDoBarPart(part: ToDoBarPart, show: boolean) {
    let parts = ($toDoBar.value ?? []).filter(existing => existing != part);
    if (show) {
      parts.push(part);
      parts.sort((a, b) => Object.values(ToDoBarPart).indexOf(a) - Object.values(ToDoBarPart).indexOf(b));
    }
    $toDoBar.value = parts;
  }

  function onResetView() {
    resetViewSettings(folder);
    $readingPane.value = "right";
    $folderPane.value = FolderPaneMode.Normal;
  }

  const viewTypes = [
    { id: ViewType.Compact, label: $t`Compact *=> View with sender, subject and preview in a narrow list`, icon: CompactIcon, tooltip: $t`Sender, subject and preview in a narrow list` },
    { id: ViewType.Single, label: $t`Single *=> View with one line per email, in columns`, icon: SingleIcon, tooltip: $t`One line per message, in columns` },
    { id: ViewType.Preview, label: $t`Preview`, icon: PreviewViewIcon, tooltip: $t`One line per message in columns, with a preview of the text` },
  ];
  const previewOptions = [
    { lines: 0, label: $t`Off *=> No preview text in the message list` },
    { lines: 1, label: $t`1 Line` },
    { lines: 2, label: $t`2 Lines` },
    { lines: 3, label: $t`3 Lines` },
  ];
</script>
