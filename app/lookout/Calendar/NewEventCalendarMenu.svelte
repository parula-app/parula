<ContextMenu bind:this={menu}>
  <NewEventCalendarItems {onCreate} />
</ContextMenu>

<script lang="ts">
  import type { Calendar } from "../../logic/Calendar/Calendar";
  import { shownCalendars } from "../../frontend/Calendar/selected";
  import ContextMenu from "../Shared/Menu/ContextMenu.svelte";
  import NewEventCalendarItems from "./NewEventCalendarItems.svelte";

  export let calendar: Calendar | null = null;

  let menu: ContextMenu;
  let onCreate: (calendar: Calendar | null) => void;

  export function openMenu(at: MouseEvent | HTMLElement, create: (calendar: Calendar | null) => void) {
    if (calendar || $shownCalendars.length <= 1) {
      create(calendar);
      return;
    }
    onCreate = create;
    if (at instanceof MouseEvent) {
      menu.onContextMenu(at);
      return;
    }
    let button = at.getBoundingClientRect();
    menu.onContextMenu(new MouseEvent("click", { clientX: button.left, clientY: button.bottom }));
  }
</script>
