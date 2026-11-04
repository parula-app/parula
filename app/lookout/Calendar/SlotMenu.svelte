<ContextMenu bind:this={contextMenu}>
  <NewEventSubMenu label={$t`New Appointment`} icon={NewAppointmentIcon} shortCutInfo={$t`Ctrl+N *=> Keyboard shortcut`}
    calendar={$selectedSlots?.calendar} onCreate={calendar => CalendarActions.newEventAtSelection(calendar)} />
  <NewEventSubMenu label={$t`New All Day Event`} icon={AllDayIcon}
    calendar={$selectedSlots?.calendar} onCreate={calendar => CalendarActions.newEventAtSelection(calendar, "all-day")} />
  <NewEventSubMenu label={$t`New Meeting Request`} icon={NewMeetingIcon} shortCutInfo={$t`Ctrl+Shift+Q *=> Keyboard shortcut`}
    calendar={$selectedSlots?.calendar} onCreate={calendar => CalendarActions.newEventAtSelection(calendar, "meeting")} />
  <NewEventSubMenu label={$t`New Recurring Appointment`} icon={RecurringIcon}
    calendar={$selectedSlots?.calendar} onCreate={calendar => CalendarActions.newEventAtSelection(calendar, "recurring")} />
  <NewEventSubMenu label={$t`New Recurring Meeting`} icon={RecurringMeetingIcon}
    calendar={$selectedSlots?.calendar} onCreate={calendar => CalendarActions.newEventAtSelection(calendar, "recurring-meeting")} />
  <MenuDivider />
  <MenuItem label={$t`Today`} icon={TodayIcon} onClick={goToToday} />
  <MenuItem label={$t`Next 7 Days`} icon={NextDaysIcon} onClick={showNext7Days} />
  <MenuDivider />
  <MenuItem label={$t`Day`} icon={DayIcon} shortCutInfo={$t`Ctrl+Alt+1 *=> Keyboard shortcut`} onClick={() => setView("day")} />
  <MenuItem label={$t`Work Week *=> Calendar view that shows Monday to Friday`} icon={WorkWeekIcon} shortCutInfo={$t`Ctrl+Alt+2 *=> Keyboard shortcut`} onClick={() => setView("workweek")} />
  <MenuItem label={$t`Week`} icon={WeekIcon} shortCutInfo={$t`Ctrl+Alt+3 *=> Keyboard shortcut`} onClick={() => setView("week")} />
  <MenuItem label={$t`Month`} icon={MonthIcon} shortCutInfo={$t`Ctrl+Alt+4 *=> Keyboard shortcut`} onClick={() => setView("month")} />
  <MenuItem label={$t`Schedule View`} icon={ScheduleIcon} shortCutInfo={$t`Ctrl+Alt+5 *=> Keyboard shortcut`} onClick={() => setView("schedule")} />
  <MenuItem label={$t`Day/Month`} icon={DualIcon} onClick={() => setView("dual")} />
  <MenuDivider />
  <MenuItem label={$t`View Settings…`} icon={ViewSettingsIcon} onClick={() => isViewSettingsOpen = true} />
</ContextMenu>
{#if isViewSettingsOpen}
  <ViewSettingsDialog on:close={() => isViewSettingsOpen = false} />
{/if}

<script lang="ts">
  import { eventPeek, selectedSlots, type CalendarViewType } from "./selected";
  import { CalendarActions } from "./CalendarActions";
  import { selectedDate, startDate } from "../../frontend/Calendar/selected";
  import { getToday } from "../../logic/util/date";
  import ContextMenu from "../Shared/Menu/ContextMenu.svelte";
  import MenuItem from "../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../Shared/Menu/MenuDivider.svelte";
  import NewEventSubMenu from "./NewEventSubMenu.svelte";
  import ViewSettingsDialog from "./ViewSettings/ViewSettingsDialog.svelte";
  import NewAppointmentIcon from "lucide-svelte/icons/calendar-plus";
  import NewMeetingIcon from "lucide-svelte/icons/users-round";
  import AllDayIcon from "lucide-svelte/icons/sun";
  import RecurringIcon from "lucide-svelte/icons/repeat";
  import RecurringMeetingIcon from "lucide-svelte/icons/calendar-sync";
  import TodayIcon from "lucide-svelte/icons/calendar-check";
  import NextDaysIcon from "lucide-svelte/icons/calendar-clock";
  import DayIcon from "lucide-svelte/icons/calendar-1";
  import WorkWeekIcon from "lucide-svelte/icons/columns-4";
  import WeekIcon from "lucide-svelte/icons/calendar-range";
  import MonthIcon from "lucide-svelte/icons/calendar-days";
  import ScheduleIcon from "lucide-svelte/icons/chart-gantt";
  import DualIcon from "lucide-svelte/icons/columns-2";
  import ViewSettingsIcon from "lucide-svelte/icons/sliders-horizontal";
  import { t } from "../../l10n/l10n";

  export let view: CalendarViewType;
  export let dayCount: number;

  let contextMenu: ContextMenu;
  let isViewSettingsOpen = false;

  export function openFor(mouseEvent: MouseEvent) {
    contextMenu.onContextMenu(mouseEvent);
  }

  // <copied from="ViewSelector.svelte">
  function setView(viewType: CalendarViewType) {
    view = viewType;
    if (viewType == "day" || viewType == "schedule") {
      dayCount = 1;
    }
    $eventPeek = null;
  }
  // </copied>

  // <copied from="CalendarRibbon.svelte">
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
</script>
