{#if appGlobal.isMobile}
  <Route path="person/:personID/edit">
    <PersonM person={params?.person ?? $selectedPerson ?? requiredParam()} />
  </Route>
  <Route path="person/:personID/history">
    <ContactHistoryM person={params?.person ?? $selectedPerson ?? requiredParam()} />
  </Route>
  <Route path="account/:accountID/persons" let:params={urlParams}>
    <PersonsM selectedAddressbook={params?.addressbook ?? appGlobal.addressbooks.find(ab => ab.id == urlParams.accountID) ?? requiredParam()} />
  </Route>
  <Route path="search">
    <PersonsM doSearch={true} />
  </Route>
  <Route path="/">
    <PersonsM />
  </Route>
{:else}
  <Route path="/">
    <ContactsAppD />
  </Route>
{/if}

<script lang="ts">
  import { selectedPerson } from "./Person/Selected";
  import { appGlobal } from "../../logic/app";
  import ContactsAppD from "./ContactsAppD.svelte";
  import PersonsM from "./PersonsM.svelte";
  import PersonM from "./PersonPage/PersonM.svelte";
  import ContactHistoryM from "./ContactHistoryM.svelte";
  import { getParams } from "../AppsBar/selectedApp";
  import { requiredParam } from "../Util/route";
  import { Route, useLocation } from "svelte-navigator";

  $: location = useLocation();
  $: params = getParams($location?.state);
</script>
