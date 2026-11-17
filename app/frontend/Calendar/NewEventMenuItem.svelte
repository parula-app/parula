<hbox class="new-event-menuitem" style="--calendar-color: {calendar.color}">
  <MenuItem
    icon={AddIcon}
    iconSize="16px"
    label={calendar.name}
    onClick={() => createNewEvent(calendar, startTime, exact)}
    />
</hbox>

<script lang="ts">
  import type { Calendar } from "../../logic/Calendar/Calendar";
  import { createNewEvent } from "./event";
  import MenuItem from "../Shared/Menu/MenuItem.svelte";
  import AddIcon from "lucide-svelte/icons/plus";

  export let calendar: Calendar;
  export let startTime: Date;
  export let exact = true;
</script>

<style>
  /* Like the new event buttons in the calendar list, but in the size of a menu icon */
  .new-event-menuitem :global(.menuitem .icon) {
    padding: 2px;
    border-radius: 1000px;
    background-color: var(--calendar-color);
    color: lch(from var(--calendar-color) calc((49.44 - l) * infinity) 0 0);
  }
</style>
