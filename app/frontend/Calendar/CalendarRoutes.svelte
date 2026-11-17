<Route path="event">
  <ShowEvent event={params?.event ?? requiredParam()} />
</Route>
<Route path="todos">
  <TODOsM />
</Route>
<Route path="person">
  <PersonM person={params?.person ?? $selectedPerson ?? requiredParam()} />
</Route>
<Route path="search">
  <SearchM searchTerm={params?.searchTerm} />
</Route>
<Route path="/">
  <CalendarApp />
</Route>

<script lang="ts">
  import { selectedEvent } from "./selected";
  import { selectedPerson } from "../Contacts/Person/Selected";
  import CalendarApp from "./CalendarApp.svelte";
  import ShowEvent from "./DisplayEvent/ShowEvent.svelte";
  import PersonM from "./ListView/PersonM.svelte";
  import SearchM from "./ListView/SearchM.svelte";
  import TODOsM from "./TODO/TODOsM.svelte";
  import { getParams } from "../AppsBar/selectedApp";
  import { requiredParam } from "../Util/route";
  import { Route, useLocation } from "svelte-navigator";

  $: location = useLocation();
  $: params = getParams($location?.state);
  // Set only when params.event changes, not when $selectedEvent changes
  $: params, setEvent()
  let lastEvent = null;
  function setEvent() {
    if (params.event && params.event != lastEvent) {
      $selectedEvent = params.event;
      lastEvent = params.event;
    }
  }
</script>
