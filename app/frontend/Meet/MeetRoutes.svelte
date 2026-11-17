<Route path="history">
  <CallHistory />
</Route>
<Route path="call">
  <Calling meeting={params.meeting ?? requiredParam()} />
</Route>
<Route path="phone/dial">
  <PhoneDialScreen isPhoneDial={true} />
</Route>
<Route path="/">
  <!-- param is optional -->
  {params?.meeting && !appGlobal.meetings.includes(params.meeting) && appGlobal.meetings.add(params.meeting), ""}
  <Main />
</Route>

<script lang="ts">
  import Main from "./Main.svelte";
  import CallHistory from "./Start/CallHistory.svelte";
  import { getParams } from "../AppsBar/selectedApp";
  import { appGlobal } from "../../logic/app";
  import { requiredParam } from "../Util/route";
  import Calling from "./Start/Calling.svelte";
  import { Route, useLocation } from "svelte-navigator";
  import PhoneDialScreen from "./Start/Phone/PhoneDialScreen.svelte";

  $: location = useLocation();
  $: params = getParams($location?.state);
</script>
