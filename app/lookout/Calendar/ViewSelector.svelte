<button class="view-button" bind:this={viewButtonEl} on:click|stopPropagation={() => isViewMenuOpen = !isViewMenuOpen}
  aria-haspopup="menu" title={$t`Change the view`}>
  <svelte:component this={viewIcons[view]} size="16" />
  <span>{viewLabels[view]}</span>
  <ChevronIcon size="14" />
</button>
<Menu bind:isMenuOpen={isViewMenuOpen} anchor={viewButtonEl} placement="bottom-end">
  {#each viewTypes as viewType}
    <MenuItem label={viewLabels[viewType]} icon={viewIcons[viewType]} checked={viewType == view}
      onClick={() => setView(viewType)} />
  {/each}
</Menu>

<script lang="ts">
  import { eventPeek, type CalendarViewType } from "./selected";
  import Menu from "../Shared/Menu/Menu.svelte";
  import MenuItem from "../Shared/Menu/MenuItem.svelte";
  import ChevronIcon from "lucide-svelte/icons/chevron-down";
  import DayIcon from "lucide-svelte/icons/calendar-1";
  import WorkWeekIcon from "lucide-svelte/icons/columns-4";
  import WeekIcon from "lucide-svelte/icons/calendar-range";
  import MonthIcon from "lucide-svelte/icons/calendar-days";
  import ScheduleIcon from "lucide-svelte/icons/chart-gantt";
  import DualIcon from "lucide-svelte/icons/columns-2";
  import { t } from "../../l10n/l10n";

  export let view: CalendarViewType;
  export let dayCount: number;

  const viewTypes: CalendarViewType[] = ["day", "workweek", "week", "month", "schedule", "dual"];
  const viewIcons = { day: DayIcon, workweek: WorkWeekIcon, week: WeekIcon, month: MonthIcon, schedule: ScheduleIcon, dual: DualIcon };

  let viewButtonEl: HTMLButtonElement;
  let isViewMenuOpen = false;

  $: viewLabels = { day: $t`Day`, workweek: $t`Work Week *=> Calendar view that shows Monday to Friday`, week: $t`Week`, month: $t`Month`, schedule: $t`Schedule View`, dual: $t`Day/Month` };

  // <copied to="ArrangeButtons.svelte, SlotMenu.svelte">
  function setView(viewType: CalendarViewType) {
    view = viewType;
    if (viewType == "day" || viewType == "schedule") {
      dayCount = 1;
    }
    $eventPeek = null;
  }
  // </copied>
</script>

<style>
  .view-button {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 8px 0 10px;
    border: 1px solid transparent;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg);
    font: inherit;
    cursor: pointer;
  }
  .view-button:hover {
    background-color: var(--lo-hover-bg);
  }
  .view-button:active {
    background-color: var(--lo-pressed-bg);
  }
  .view-button :global(svg:first-child) {
    color: var(--lo-accent-text);
  }
</style>
