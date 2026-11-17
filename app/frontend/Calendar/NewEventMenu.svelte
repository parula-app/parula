<ContextMenu bind:this={menu}>
  {#each $shownCalendars.each as calendar}
    <NewEventMenuItem {calendar} {startTime} />
  {/each}
</ContextMenu>

<script lang="ts">
  import { createNewEvent } from "./event";
  import { shownCalendars } from "./selected";
  import ContextMenu from "../Shared/Menu/ContextMenu.svelte";
  import NewEventMenuItem from "./NewEventMenuItem.svelte";

  let menu: ContextMenu;
  let startTime: Date;

  /** Lets the user pick the calendar for the new event.
   * With only one calendar, creates the event right away. */
  export function openMenu(mouseEvent: MouseEvent, newEventStartTime: Date) {
    startTime = newEventStartTime;
    if ($shownCalendars.length > 1) {
      menu.onContextMenu(mouseEvent);
    } else {
      createNewEvent($shownCalendars.first, startTime);
    }
  }
</script>
