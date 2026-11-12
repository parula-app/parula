<Ribbon id="calendar">
  <RibbonTab label={$t`Home *=> Ribbon tab with the most-used commands`}>
    <RibbonGroup label={$t`New`}>
      <NewEventRibbonButton label={$t`New Event`} icon={NewAppointmentIcon} shortCutInfo={$t`Ctrl+N *=> Keyboard shortcut`}
        onCreate={calendar => CalendarActions.newEventAtSelection(calendar)}
        disabled={noCalendar} />
      <NewEventRibbonButton label={$t`New Meeting`} shortLabel={$t`Meeting`} icon={NewMeetingIcon} shortCutInfo={$t`Ctrl+Shift+Q *=> Keyboard shortcut`}
        onCreate={calendar => CalendarActions.newEventAtSelection(calendar, "meeting")}
        disabled={noCalendar} />
      <RibbonMenuButton label={$t`New Items`} icon={NewItemsIcon} disabled={noCalendar}>
        <NewEventMenu />
      </RibbonMenuButton>
    </RibbonGroup>
    <RibbonGroup label={$t`Online Meeting`}>
      <NewEventRibbonButton label={$t`New Online Meeting`} shortLabel={$t`Online *=> New online meeting`} icon={OnlineMeetingIcon}
        tooltip={$t`New meeting with a link to an online meeting`}
        onCreate={calendar => CalendarActions.newEventAtSelection(calendar, "online-meeting")}
        disabled={noCalendar} />
    </RibbonGroup>
    <RibbonGroup label={$t`Go To *=> Ribbon group to jump to a date in the calendar`} onLauncher={openGoToDate} launcherTooltip={$t`Go To Date (Ctrl+G)`}>
      <RibbonButton label={$t`Today`} icon={TodayIcon} onClick={() => { goToToday(); showCalendar(); }} />
      <RibbonButton label={$t`Next 7 Days`} icon={NextDaysIcon} onClick={() => { showNext7Days(); showCalendar(); }} />
      {#if isSimplified}
        <RibbonButton label={$t`Go To Date`} icon={GoToDateIcon} shortCutInfo={$t`Ctrl+G *=> Keyboard shortcut`} onClick={openGoToDate} />
      {/if}
    </RibbonGroup>
    <RibbonGroup label={$t`Arrange *=> Ribbon group to choose the day, week or month view`} onLauncher={onCalendarOptions} launcherTooltip={$t`Calendar Options`}>
      <ArrangeButtons bind:view bind:dayCount bind:currentView />
    </RibbonGroup>
    <RibbonGroup label={$t`Manage Calendars`}>
      <RibbonMenuButton label={$t`Open Calendar`} icon={OpenCalendarIcon}>
        <OpenCalendarMenuItems />
      </RibbonMenuButton>
    </RibbonGroup>
    <RibbonGroup label={$t`Share *=> Ribbon group with commands to share the calendar`}>
      <RibbonButton label={$t`Share Calendar`} icon={ShareIcon}
        onClick={() => { $openCalendarProperties = { calendar: $selectedCalendar, tab: "permissions" }; }}
        disabled={!isShareable && $t`This calendar cannot be shared`} />
      <RibbonButton label={$t`Calendar Permissions`} icon={PermissionsIcon}
        onClick={() => { $openCalendarProperties = { calendar: $selectedCalendar, tab: "permissions" }; }}
        disabled={!isShareable && $t`This calendar cannot be shared`} />
    </RibbonGroup>
    <RibbonGroup label={$t`Find *=> Ribbon group with search commands`}>
      <SearchPeopleBox on:select={event => ContactActions.show(event.detail)} />
      <RibbonButton label={$t`Address Book`} icon={AddressBookIcon} shortCutInfo={$t`Ctrl+Shift+B *=> Keyboard shortcut`} size="small"
        onClick={() => openApp(contactsMustangApp, {})} />
    </RibbonGroup>
  </RibbonTab>
  <RibbonTab label={$t`Send / Receive`}>
    <RibbonGroup label={$t`Send & Receive`}>
      <RibbonButton label={$t`Update Folder`} shortLabel={$t`Update *=> Get the latest items of the selected folder from the server`} icon={SyncIcon}
        tooltip={$t`Get the latest events of the selected calendar`}
        onClick={() => CalendarActions.update([ $selectedCalendar ])}
        disabled={noSelection} />
      <RibbonButton label={$t`Update All *=> Get the latest items of all folders from the server`} icon={SyncAllIcon}
        tooltip={$t`Get the latest events of all calendars`}
        onClick={() => CalendarActions.update($calendars.contents)}
        disabled={noCalendar} />
    </RibbonGroup>
  </RibbonTab>
  <RibbonTab label={$t`Folder`}>
    <RibbonGroup label={$t`New`}>
      <RibbonButton label={$t`New Calendar`} shortLabel={$t`New`} icon={NewCalendarIcon}
        tooltip={$t`Create a new calendar on this computer`}
        onClick={() => openSettingsDialog({ kind: "new-folder-account", folderKind: "calendar", localOnly: true })} />
    </RibbonGroup>
    <RibbonGroup label={$t`Actions`}>
      <RibbonButton label={$t`Rename Calendar`} shortLabel={$t`Rename`} icon={RenameIcon}
        tooltip={$t`Rename the calendar in this app`}
        onClick={() => { renamingCalendar = $selectedCalendar; }}
        disabled={noSelection} />
      <RibbonButton label={$t`Delete Calendar`} shortLabel={$t`Delete`} icon={DeleteIcon}
        tooltip={$t`Remove the calendar from this app`}
        onClick={() => onDeleteCalendar()}
        disabled={!canDelete && $t`Only calendars that you added or opened yourself can be removed here`} />
    </RibbonGroup>
    <RibbonGroup label={$t`Open & Share`}>
      <RibbonMenuButton label={$t`Open Calendar`} shortLabel={$t`Open`} icon={OpenCalendarIcon}
        tooltip={$t`Open Calendar`}>
        <OpenCalendarMenuItems />
      </RibbonMenuButton>
      <RibbonButton label={$t`Share Calendar`} shortLabel={$t`Share *=> Share the selected calendar with other people`} icon={ShareIcon}
        tooltip={$t`Share Calendar`}
        onClick={() => { $openCalendarProperties = { calendar: $selectedCalendar, tab: "permissions" }; }}
        disabled={!isShareable && $t`This calendar cannot be shared`} />
      <RibbonButton label={$t`Calendar Permissions`} shortLabel={$t`Permissions *=> Set who can access the selected folder`} icon={PermissionsIcon}
        tooltip={$t`Calendar Permissions`}
        onClick={() => { $openCalendarProperties = { calendar: $selectedCalendar, tab: "permissions" }; }}
        disabled={!isShareable && $t`This calendar cannot be shared`} />
    </RibbonGroup>
    <RibbonGroup label={$t`Properties *=> Ribbon group with the settings of the selected folder`}>
      <RibbonButton label={$t`Calendar Properties`} shortLabel={$t`Properties *=> Show the settings of the selected folder`} icon={PropertiesIcon}
        tooltip={$t`Calendar Properties`}
        onClick={() => { $openCalendarProperties = { calendar: $selectedCalendar, tab: "general" }; }}
        disabled={noSelection} />
    </RibbonGroup>
  </RibbonTab>
  <RibbonTab label={$t`View *=> Ribbon tab with layout and display settings`}>
    <RibbonGroup label={$t`Current View`}>
      <RibbonMenuButton label={$t`Change View`} shortLabel={$t`Views *=> Choose another view of the items`} icon={ChangeViewIcon}>
        <ChangeViewGallery views={calendarViews} {currentView} on:change={event => setCurrentView(event.detail)} />
      </RibbonMenuButton>
      <RibbonButton label={$t`View Settings`} icon={ViewSettingsIcon}
        onClick={() => { isViewSettingsOpen = true; }} />
      <RibbonButton label={$t`Reset View`} icon={ResetViewIcon}
        tooltip={$t`Reset the view and the table columns to the default settings`}
        onClick={resetView} />
    </RibbonGroup>
    <RibbonGroup label={$t`Arrangement *=> Ribbon group for how the items are arranged`} onLauncher={onCalendarOptions} launcherTooltip={$t`Calendar Options`}>
      <ArrangeButtons bind:view bind:dayCount bind:currentView />
      <RibbonMenuButton label={$t`Time Scale *=> Minutes per row in the day and week views`} icon={TimeScaleIcon} size="small"
        disabled={view == "month" && $t`The time scale applies to the Day, Work Week, Week and Schedule views`}>
        {#each [60, 30, 15, 10, 6, 5] as scale}
          <MenuItem label={timeScaleLabel(scale)} checked={scale == timeScale}
            onClick={() => onTimeScale(scale)} />
        {/each}
      </RibbonMenuButton>
      <RibbonToggleButton label={$t`Overlay *=> Show the calendars on top of each other`} icon={OverlayIcon} size="small"
        tooltip={$t`Show the calendars on top of each other, instead of side by side`}
        selected={!splitView}
        disabled={overlayDisabled}
        onClick={onOverlay} />
    </RibbonGroup>
    <RibbonGroup label={$t`Color *=> Ribbon group to set the color of the calendar`}>
      <RibbonMenuButton label={$t`Color *=> Choose the color of the selected calendar`} icon={ColorIcon}
        disabled={noSelection}>
        {#if $selectedCalendar}
          <ColorPalette colors={calendarColors()} selected={$selectedCalendar.color} label={$t`Calendar color`}
            columns={5} on:select={event => catchErrors(async () => { $selectedCalendar.color = event.detail; await $selectedCalendar.save(); })} />
        {/if}
      </RibbonMenuButton>
    </RibbonGroup>
    <RibbonGroup label={$t`Layout *=> Ribbon group with settings for the window panes`}>
      <RibbonMenuButton label={$t`Folder Pane`} shortLabel={$t`Folders`} icon={FolderPaneIcon}>
        <MenuItem label={$t`Normal *=> Folder pane at full width`} checked={$folderPane.value == CalendarFolderPane.Normal}
          onClick={() => onFolderPane(CalendarFolderPane.Normal)} />
        <MenuItem label={$t`Minimized *=> Folder pane as a narrow bar`} checked={$folderPane.value == CalendarFolderPane.Minimized}
          onClick={() => onFolderPane(CalendarFolderPane.Minimized)} />
        <MenuItem label={$t`Off *=> The pane is hidden`} checked={$folderPane.value == CalendarFolderPane.Off}
          onClick={() => onFolderPane(CalendarFolderPane.Off)} />
      </RibbonMenuButton>
      <RibbonMenuButton label={$t`Reading Pane`} shortLabel={$t`Reading *=> Reading pane: where the selected item is shown`} icon={ReadingPaneIcon}>
        <MenuItem label={$t`Right *=> Reading pane on the right side`} checked={$readingPane.value == "right"}
          onClick={() => { $readingPane.value = "right"; }} />
        <MenuItem label={$t`Bottom *=> Reading pane at the bottom`} checked={$readingPane.value == "bottom"}
          onClick={() => { $readingPane.value = "bottom"; }} />
        <MenuItem label={$t`Off *=> The pane is hidden`} checked={$readingPane.value == "off"}
          onClick={() => { $readingPane.value = "off"; }} />
      </RibbonMenuButton>
    </RibbonGroup>
    <RibbonDisplayGroup />
  </RibbonTab>
  <slot />
</Ribbon>
{#if renamingCalendar}
  <RenameDialog account={renamingCalendar} title={$t`Rename Calendar`} on:close={() => renamingCalendar = null} />
{/if}
{#if isViewSettingsOpen}
  <ViewSettingsDialog on:close={() => isViewSettingsOpen = false} />
{/if}

<script lang="ts">
  import type { Calendar } from "../../logic/Calendar/Calendar";
  import { CalendarActions } from "./CalendarActions";
  import { globalSearchTerm, openApp } from "../../frontend/AppsBar/selectedApp";
  import { contactsMustangApp } from "../../frontend/Contacts/ContactsMustangApp";
  import { CalendarGroups } from "./CalendarGroups";
  import { calendarColors } from "./CalendarColors";
  import { MailAccount } from "../../logic/Mail/MailAccount";
  import { openSettingsDialog, openOptions } from "../Settings/SettingsDialogs";
  import { selectedCalendar, selectedDate, startDate } from "../../frontend/Calendar/selected";
  import { calendarSearchOptions, isGoToDateOpen, openCalendarProperties, CalendarCurrentView, CalendarFolderPane, type CalendarViewType } from "./selected";
  import { EventTable, EventTableColumn, EventTableGrouping } from "./ListView/EventTable";
  import { getToday } from "../../logic/util/date";
  import { getLocalStorage } from "../../frontend/Util/LocalStorage";
  import { catchErrors } from "../../frontend/Util/error";
  import { appGlobal } from "../../logic/app";
  import type { RibbonLayout } from "../Shared/Ribbon/RibbonGroup";
  import Ribbon from "../Shared/Ribbon/Ribbon.svelte";
  import RibbonTab from "../Shared/Ribbon/RibbonTab.svelte";
  import RibbonGroup from "../Shared/Ribbon/RibbonGroup.svelte";
  import RibbonDisplayGroup from "../Shared/Ribbon/RibbonDisplayGroup.svelte";
  import RibbonButton from "../Shared/Ribbon/RibbonButton.svelte";
  import RibbonToggleButton from "../Shared/Ribbon/RibbonToggleButton.svelte";
  import RibbonMenuButton from "../Shared/Ribbon/RibbonMenuButton.svelte";
  import MenuItem from "../Shared/Menu/MenuItem.svelte";
  import ColorPalette from "../Shared/ColorPalette.svelte";
  import ArrangeButtons from "./ArrangeButtons.svelte";
  import SearchPeopleBox from "../Contacts/Search/SearchPeopleBox.svelte";
  import { ContactActions } from "../Contacts/ContactActions";
  import ChangeViewGallery from "../Shared/Ribbon/ChangeViewGallery.svelte";
  import NewEventMenu from "./NewEventMenu.svelte";
  import NewEventRibbonButton from "./NewEventRibbonButton.svelte";
  import OpenCalendarMenuItems from "./OpenCalendarMenuItems.svelte";
  import ViewSettingsDialog from "./ViewSettings/ViewSettingsDialog.svelte";
  import RenameDialog from "../Settings/Shared/RenameDialog.svelte";
  import ChangeViewIcon from "lucide-svelte/icons/layout-template";
  import CalendarViewIcon from "lucide-svelte/icons/calendar-days";
  import PreviewViewIcon from "lucide-svelte/icons/scan-text";
  import ListViewIcon from "lucide-svelte/icons/list";
  import ActiveViewIcon from "lucide-svelte/icons/list-todo";
  import ResetViewIcon from "lucide-svelte/icons/rotate-ccw";
  import NewAppointmentIcon from "lucide-svelte/icons/calendar-plus";
  import NewMeetingIcon from "lucide-svelte/icons/users-round";
  import NewItemsIcon from "lucide-svelte/icons/calendar-plus-2";
  import NewCalendarIcon from "lucide-svelte/icons/calendar-fold";
  import OnlineMeetingIcon from "lucide-svelte/icons/video";
  import TodayIcon from "lucide-svelte/icons/calendar-check";
  import NextDaysIcon from "lucide-svelte/icons/calendar-clock";
  import GoToDateIcon from "lucide-svelte/icons/calendar-search";
  import OverlayIcon from "lucide-svelte/icons/layers";
  import OpenCalendarIcon from "lucide-svelte/icons/folder-open";
  import PropertiesIcon from "lucide-svelte/icons/file-cog";
  import ShareIcon from "lucide-svelte/icons/share-2";
  import PermissionsIcon from "lucide-svelte/icons/user-lock";
  import AddressBookIcon from "lucide-svelte/icons/book-user";
  import RenameIcon from "lucide-svelte/icons/pencil-line";
  import ColorIcon from "lucide-svelte/icons/palette";
  import SyncIcon from "lucide-svelte/icons/refresh-cw";
  import SyncAllIcon from "lucide-svelte/icons/refresh-ccw-dot";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import TimeScaleIcon from "lucide-svelte/icons/ruler";
  import FolderPaneIcon from "lucide-svelte/icons/panel-left";
  import ReadingPaneIcon from "lucide-svelte/icons/panel-right";
  import type { ReadingPanePosition } from "../Mail/3pane/3Pane.svelte";
  import ViewSettingsIcon from "lucide-svelte/icons/sliders-horizontal";
  import { t } from "../../l10n/l10n";

  export let view: CalendarViewType;
  export let dayCount: number;
  export let currentView: CalendarCurrentView;

  $: calendarViews = [
    { id: CalendarCurrentView.Calendar, label: $t`Calendar`, icon: CalendarViewIcon, tooltip: $t`Day, week and month calendar` },
    { id: CalendarCurrentView.Preview, label: $t`Preview`, icon: PreviewViewIcon, tooltip: $t`Calendar with location and notes in the appointments` },
    { id: CalendarCurrentView.List, label: $t`List`, icon: ListViewIcon, tooltip: $t`All appointments and meetings in a table` },
    { id: CalendarCurrentView.Active, label: $t`Active *=> View that shows the upcoming events`, icon: ActiveViewIcon, tooltip: $t`Appointments and meetings that are still to come` },
  ];
  const folderPane = getLocalStorage<CalendarFolderPane>("lookout.calendar.folderPaneMode", CalendarFolderPane.Normal);
  const readingPane = getLocalStorage<ReadingPanePosition>("lookout.calendar.readingPane", "off");
  const splitViewSetting = getLocalStorage<boolean>("lookout.calendar.splitView", false);
  const timeScaleSetting = getLocalStorage<number>("lookout.calendar.timeScale", 30);
  $: splitView = $splitViewSetting.value;
  $: timeScale = $timeScaleSetting.value;
  const ribbonLayout = getLocalStorage<RibbonLayout>("lookout.ribbon.layout", "classic");
  $: isSimplified = $ribbonLayout.value == "simplified";

  let calendars = appGlobal.calendars;
  $: noCalendar = !$calendars.hasItems && $t`Please set up a calendar first`;
  $: noSelection = !$selectedCalendar && $t`Select a calendar first`;
  $: isTable = currentView == CalendarCurrentView.List || currentView == CalendarCurrentView.Active;
  $: isSearch = !!$globalSearchTerm?.trim();
  $: canDelete = !!$selectedCalendar && (CalendarGroups.isShared($selectedCalendar) || !$selectedCalendar.mainAccount);
  $: isShareable = canShare($selectedCalendar);
  let renamingCalendar: Calendar | null = null;
  let isViewSettingsOpen = false;
  $: overlayDisabled = view == "schedule" && $t`Overlay is available in the Day, Work Week, Week and Month views`;

  // <copied from="CalendarPropertiesDialog.svelte">
  function canShare(calendar: Calendar | null): boolean {
    let account = calendar?.mainAccount;
    return !!calendar?.sharePermissionLevels.length &&
      account instanceof MailAccount && !account.isDependentAccount && account.canShareWithPersons();
  }
  // </copied>

  // <copied to="SlotMenu.svelte">
  function goToToday() {
    $startDate = getToday();
    $selectedDate = getToday();
  }

  function showNext7Days() {
    goToToday();
    view = "day";
    dayCount = 7;
  }
  // </copied>

  // <copied from="CalendarApp.svelte">
  function showCalendar() {
    if (isTable) {
      currentView = CalendarCurrentView.Calendar;
    } else if (isSearch) {
      closeSearch();
    }
  }
  // </copied>

  // <copied from="CalendarApp.svelte">
  function closeSearch() {
    $globalSearchTerm = null;
    $calendarSearchOptions = { scope: $calendarSearchOptions.scope, isRecurring: false, hasAttachments: false, organizerEMail: null };
  }
  // </copied>

  function setCurrentView(newView: CalendarCurrentView) {
    currentView = newView;
    if (isSearch) {
      closeSearch();
    }
  }

  function resetView() {
    const listSettings = [
      getLocalStorage<EventTableColumn>("lookout.calendar.list.sortColumn", EventTableColumn.Start),
      getLocalStorage<boolean>("lookout.calendar.list.sortAscending", true),
      getLocalStorage<EventTableGrouping>("lookout.calendar.list.grouping", EventTableGrouping.Recurrence),
      getLocalStorage<EventTableColumn[]>("lookout.calendar.list.columns", EventTable.defaultColumns),
    ];
    folderPane.value = CalendarFolderPane.Normal;
    readingPane.value = "off";
    setCurrentView(CalendarCurrentView.Calendar);
    view = "workweek";
    splitViewSetting.value = false;
    timeScaleSetting.value = timeScaleSetting.defaultValue;
    for (let setting of listSettings) {
      setting.value = setting.defaultValue;
    }
  }

  function openGoToDate() {
    $isGoToDateOpen = true;
  }

  function onCalendarOptions() {
    openOptions("calendar");
  }

  async function onDeleteCalendar() {
    await CalendarActions.deleteCalendar($selectedCalendar);
  }

  function onOverlay() {
    splitViewSetting.value = !splitView;
  }

  function onTimeScale(minutes: number) {
    timeScaleSetting.value = minutes;
  }

  // <copied to="ViewSettings/OtherSettingsDialog.svelte">
  function timeScaleLabel(minutes: number): string {
    if (minutes == 60) {
      return $t`60 minutes - Least space for details`;
    }
    if (minutes == 5) {
      return $t`5 minutes - Most space for details`;
    }
    return $t`${minutes} minutes`;
  }
  // </copied>

  function onFolderPane(mode: CalendarFolderPane) {
    folderPane.value = mode;
  }
</script>
