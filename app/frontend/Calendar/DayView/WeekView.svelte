<vbox class="week-view" flex>
  <hbox class="range-header">
    <slot name="top-left" />
    <hbox flex />
    <slot name="top-center">
      <DateRange bind:date={start} {range} />
      <Button classes="today-button" label={$t`Go back to today`} icon={TodayIcon} onClick={goToToday} iconSize="16px" plain iconOnly />
    </slot>
    <slot name="top-center" />
    <hbox flex />
    <slot name="top-right" />
  </hbox>
  <DayViewGrid {range} {events} {showHours} {defaultFocusHour} {enlargeSelectedDay}
    on:celldblclick={(param) => newEventMenu.openMenu(param.detail.mouseEvent, param.detail.start)}
    on:swipeleft={() => page(1)}
    on:swiperight={() => page(-1)} />
</vbox>

<NewEventMenu bind:this={newEventMenu} />

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import type { CalendarRange } from "../CalendarRange";
  import { getToday } from "../../../logic/util/date";
  import DayViewGrid from "./DayViewGrid.svelte";
  import NewEventMenu from "../NewEventMenu.svelte";
  import DateRange from "../DateRange.svelte";
  import Button from "../../Shared/Button.svelte";
  import TodayIcon from "lucide-svelte/icons/home";
  import type { Collection } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  export let start: Date;
  export let range: CalendarRange;
  export let events: Collection<Event>;
  /* Number of hours visible at the same time. Larger range reduces size per hour.
   * Other hours are available on scroll. */
  export let showHours = 10;
  export let defaultFocusHour: number | null = null;
  export let enlargeSelectedDay = false;

  let newEventMenu: NewEventMenu;

  function goToToday() {
    start = getToday();
  }

  function page(direction: number) {
    start = range.step(start, direction);
  }
</script>

<style>
  .range-header {
    align-items: center;
  }
  .range-header :global(.today-button) {
    align-self: end;
    margin-block-end: 8px;
  }
</style>
