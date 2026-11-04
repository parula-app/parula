<RibbonToggleButton label={$t`Day`} icon={DayIcon} shortCutInfo={$t`Ctrl+Alt+1 *=> Keyboard shortcut`}
  selected={!isTable && view == "day"} onClick={() => arrange("day")} />
<RibbonToggleButton label={$t`Work Week *=> Calendar view that shows Monday to Friday`} icon={WorkWeekIcon} shortCutInfo={$t`Ctrl+Alt+2 *=> Keyboard shortcut`}
  selected={!isTable && view == "workweek"} onClick={() => arrange("workweek")} />
<RibbonToggleButton label={$t`Week`} icon={WeekIcon} shortCutInfo={$t`Ctrl+Alt+3 *=> Keyboard shortcut`}
  selected={!isTable && view == "week"} onClick={() => arrange("week")} />
<RibbonToggleButton label={$t`Month`} icon={MonthIcon} shortCutInfo={$t`Ctrl+Alt+4 *=> Keyboard shortcut`}
  selected={!isTable && view == "month"} onClick={() => arrange("month")} />
<RibbonToggleButton label={$t`Schedule View`} icon={ScheduleIcon} shortCutInfo={$t`Ctrl+Alt+5 *=> Keyboard shortcut`}
  tooltip={$t`Show the calendars in rows, with the time running from left to right`}
  selected={!isTable && view == "schedule"} onClick={() => arrange("schedule")} />
<RibbonToggleButton label={$t`Day/Month`} icon={DualIcon}
  tooltip={$t`Show the selected day and the next day on the left, and the month on the right`}
  selected={!isTable && view == "dual"} onClick={() => arrange("dual")} />

<script lang="ts">
  import { CalendarCurrentView, eventPeek, type CalendarViewType } from "./selected";
  import RibbonToggleButton from "../Shared/Ribbon/RibbonToggleButton.svelte";
  import DayIcon from "lucide-svelte/icons/calendar-1";
  import WorkWeekIcon from "lucide-svelte/icons/columns-4";
  import WeekIcon from "lucide-svelte/icons/calendar-range";
  import MonthIcon from "lucide-svelte/icons/calendar-days";
  import ScheduleIcon from "lucide-svelte/icons/chart-gantt";
  import DualIcon from "lucide-svelte/icons/columns-2";
  import { t } from "../../l10n/l10n";

  export let view: CalendarViewType;
  export let dayCount: number;
  export let currentView: CalendarCurrentView;

  $: isTable = currentView == CalendarCurrentView.List || currentView == CalendarCurrentView.Active;

  function arrange(viewType: CalendarViewType) {
    setView(viewType);
    if (isTable) {
      currentView = CalendarCurrentView.Calendar;
    }
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
</script>
