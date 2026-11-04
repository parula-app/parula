{#each calendars as calendar (calendar.id)}
  <MenuItem label={calendar.name} onClick={() => onCreate(calendar)}>
    <span slot="icon" class="calendar-dot" style:background-color={calendar.color ?? "var(--lo-accent)"}></span>
  </MenuItem>
{/each}

<script lang="ts">
  import type { Calendar } from "../../logic/Calendar/Calendar";
  import { CalendarGroups } from "./CalendarGroups";
  import { shownCalendars } from "../../frontend/Calendar/selected";
  import { getLocalStorage } from "../../frontend/Util/LocalStorage";
  import MenuItem from "../Shared/Menu/MenuItem.svelte";

  export let onCreate: (calendar: Calendar) => void;

  const order = getLocalStorage<string[]>("lookout.calendar.order", []);
  $: calendars = new CalendarGroups($shownCalendars.contents, $order.value).groups.flatMap(group => group.calendars);
</script>

<style>
  .calendar-dot {
    display: block;
    width: 12px;
    height: 12px;
    margin: 2px;
    border-radius: 50%;
  }
</style>
