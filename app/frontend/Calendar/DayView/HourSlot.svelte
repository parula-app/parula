<Clickable {onDoubleClick}>
  <vbox class="hour-slot"
    style="grid-row: {row} / span {kRowsPerHour}"
    on:pointerenter={() => hovering = true}
    on:pointerleave={() => hovering = false}
    >
    {#if hovering}
      <slot name="event-hover" {start} {end} {empty} />
    {/if}
  </vbox>
</Clickable>

<script lang="ts">
  import { kRowsPerHour } from "./DayColumn";
  import Clickable from "../../Shared/Clickable.svelte";
  import { createEventDispatcher } from 'svelte';
  const dispatchEvent = createEventDispatcher<{ celldblclick: { start: Date, end: Date, mouseEvent: MouseEvent } }>();

  export let start: Date;
  export let row: number;
  export let empty: boolean;

  let end: Date;
  $: start, setEnd();
  function setEnd() {
    end = new Date(start);
    end.setHours(end.getHours() + 1);
  }

  let hovering = false;

  function onDoubleClick(mouseEvent: MouseEvent) {
    dispatchEvent("celldblclick", { start, end, mouseEvent });
  }
</script>

<style>
  .hour-slot {
    grid-column: 1;
    position: relative;
    background-image: linear-gradient(to right, var(--border) 0%, rgba(255,255,255,0) 100%);
    background-position: bottom;
    background-size: 3px 1px;
    background-repeat: repeat-x;
  }
  .hour-slot:hover {
    background-color: color-mix(in srgb, var(--selected-calendar-color) 10%, transparent);
    color: white;
  }
</style>
