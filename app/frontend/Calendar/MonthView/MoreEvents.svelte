<Clickable onClick={changeToDay}>
  <hbox class="more-events"
    style="grid-column: {column}; grid-row: {startRow + 1} / {endRow + 1}"
    title={events.map(event => event.title).join("\n")}>
    +{events.length}
  </hbox>
</Clickable>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { selectedDate } from "../selected";
  import Clickable from "../../Shared/Clickable.svelte";
  import { getLocalStorage } from "../../Util/LocalStorage";

  export let day: Date;
  export let events: Event[];
  export let column: number;
  export let startRow: number;
  export let endRow: number;

  function changeToDay() {
    $selectedDate = day;
    getLocalStorage("calendar.view").value = 2;
  }
</script>

<style>
  .more-events {
    position: relative;
    align-items: center;
    padding-inline-start: 4px;
    margin-inline-start: 1px;
    font-weight: 600;
    cursor: pointer;
  }
  .more-events:hover {
    text-decoration: underline;
  }
</style>
