<hbox class="title-bar">
  {#if $calendars.length > 1 && !$isCalendarListOpen}
    <ShowCalendarsButton />
  {/if}
  {#if !$isCalendarListOpen}
    <NewEventButton />
  {/if}
</hbox>

<script lang="ts">
  import { isCalendarListOpen } from "./selected";
  import { appGlobal } from "../../logic/app";
  import ShowCalendarsButton from "./ShowCalendarsButton.svelte";
  import NewEventButton from "./NewEventButton.svelte";

  let calendars = appGlobal.calendars;
</script>

<style>
  .title-bar {
    align-items: center;
    justify-content: center;
    margin: 4px;
  }
</style>
