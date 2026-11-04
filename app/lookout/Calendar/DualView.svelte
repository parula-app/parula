<SplitterBidirectional horizontal={$appGlobal.isSmall} initialSecondRatio={1} firstMinPx={200} secondMinPx={200}>
  <vbox flex class="days" slot="first">
    <DateRange bind:date={$selectedDate} range={daysRange} />
    <DayViewGrid range={daysRange} {groups} enlargeSelectedDay={true}
      on:openday={event => selectDay(event.detail)} on:slotmenu />
  </vbox>
  <vbox flex class="month" slot="second">
    <DateRange bind:date={start} range={monthRange} showToday={false}>
      <slot name="top-right" />
    </DateRange>
    <MonthView range={monthRange} {events} on:openday={event => selectDay(event.detail)} on:slotmenu />
  </vbox>
</SplitterBidirectional>

<script lang="ts">
  import type { Event } from "../../logic/Calendar/Event";
  import { CalendarRange } from "./CalendarRange";
  import { eventPeek } from "./selected";
  import { selectedDate } from "../../frontend/Calendar/selected";
  import { appGlobal } from "../../logic/app";
  import DateRange from "./DateRange.svelte";
  import DayViewGrid, { type CalendarColumnGroup } from "./DayView/DayViewGrid.svelte";
  import MonthView from "./MonthView/MonthView.svelte";
  import SplitterBidirectional from "../../frontend/Shared/SplitterBidirectional.svelte";
  import type { Collection } from "svelte-collections";

  export let start: Date;
  export let events: Collection<Event>;
  export let groups: CalendarColumnGroup[];

  $: daysRange = new CalendarRange("dual", $selectedDate);
  $: monthRange = new CalendarRange("month", start);

  function selectDay(day: Date) {
    $eventPeek = null;
    $selectedDate = day;
  }
</script>

<style>
  .days,
  .month {
    min-width: 0;
    min-height: 0;
  }
</style>
