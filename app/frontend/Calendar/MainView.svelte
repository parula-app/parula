{#if dateInterval == 0 || $globalSearchTerm}
  <ListViewWithSearch {events}>
    <slot name="top-left" slot="top-left" />
    <slot name="top-right" slot="top-right" />
  </ListViewWithSearch>
{:else if range.view == "dual"}
  <DualView bind:start {range} {events}>
    <slot name="top-left" slot="top-left" />
    <slot name="top-right" slot="top-right" />
  </DualView>
{:else if range.view == "month" || range.view == "4weeks"}
  <MonthView bind:start {range} {events}>
    <slot name="top-left" slot="top-left" />
    <slot name="top-right" slot="top-right" />
  </MonthView>
{:else}
  <WeekView bind:start {range} {events}>
    <slot name="top-left" slot="top-left" />
    <slot name="top-right" slot="top-right" />
  </WeekView>
{/if}

<script lang="ts">
  import type { Event } from "../../logic/Calendar/Event";
  import type { DateInterval } from "./selected";
  import type { CalendarRange } from "./CalendarRange";
  import { globalSearchTerm } from "../AppsBar/selectedApp";
  import WeekView from "./DayView/WeekView.svelte";
  import MonthView from "./MonthView/MonthView.svelte";
  import DualView from "./DualView.svelte";
  import ListViewWithSearch from "./ListView/ListViewWithSearch.svelte";
  import type { Collection } from "svelte-collections";

  export let start: Date;
  export let events: Collection<Event>;
  export let dateInterval: DateInterval;
  /** The days that the view shows. Day/Month: The days of the day view */
  export let range: CalendarRange;
</script>
