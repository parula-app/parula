<SplitterBidirectional horizontal={$appGlobal.isSmall} initialSecondRatio={1} firstMinPx={200} secondMinPx={200}>
  <WeekView bind:start={$selectedDate} {range} {events} slot="first" enlargeSelectedDay={true}>
    <slot name="top-left" slot="top-left" />
  </WeekView>
  <MonthView bind:start range={monthRange} {events} slot="second">
    <slot name="top-right" slot="top-right" />
  </MonthView>
</SplitterBidirectional>

<script lang="ts">
  import type { Event } from "../../logic/Calendar/Event";
  import type { Collection } from "svelte-collections";
  import { selectedDate } from "./selected";
  import { CalendarRange } from "./CalendarRange";
  import { appGlobal } from "../../logic/app";
  import WeekView from "./DayView/WeekView.svelte";
  import MonthView from "./MonthView/MonthView.svelte";
  import SplitterBidirectional from "../Shared/SplitterBidirectional.svelte";

  export let start: Date;
  /** The days of the day view */
  export let range: CalendarRange;
  export let events: Collection<Event>;

  $: monthRange = new CalendarRange("month", start);
</script>
