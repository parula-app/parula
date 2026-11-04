<Route path="event">
  {#if event}
    {#key event}
      <EditEvent {event} />
    {/key}
  {/if}
</Route>
<Route path="/">
  <CalendarApp />
</Route>

<script lang="ts">
  import type { Event } from "../../logic/Calendar/Event";
  import { selectedEvent } from "../../frontend/Calendar/selected";
  import { getParams } from "../../frontend/AppsBar/selectedApp";
  import CalendarApp from "./CalendarApp.svelte";
  import EditEvent from "./EditEvent/EditEvent.svelte";
  import { Route, useLocation } from "svelte-navigator";

  const location = useLocation();
  $: params = getParams($location?.state);
  $: event = params?.event as Event;
  $: event && selectedEvent.set(event);
</script>
