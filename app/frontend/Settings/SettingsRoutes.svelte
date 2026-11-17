{#if appGlobal.isMobile}
  <Route path="/">
    <CategoryM category={null} />
  </Route>
  <Route path="/category/:categoryID">
    <CategoryM category={params?.category ?? $selectedCategory ?? requiredParam()} />
  </Route>
  <Route path="/account/:accountID">
    <AccountM isMain={true}
      account={params?.account ?? $selectedAccount ?? requiredParam()}
      category={null} />
  </Route>
  <Route path="/account/:accountID/:categoryID">
    <AccountM isMain={false}
      account={params?.account ?? $selectedAccount ?? requiredParam()}
      category={params?.category ?? $selectedCategory ?? requiredParam()} />
  </Route>
{:else}
  <Route path="/">
    {params?.category ? $selectedCategory = params.category : null, "" }
    <SettingsApp />
  </Route>
{/if}

<script lang="ts">
  import { selectedCategory, selectedAccount } from "./Window/selected";
  import { appGlobal } from "../../logic/app";
  import { getParams } from "../AppsBar/selectedApp";
  import SettingsApp from "./Window/SettingsApp.svelte";
  import CategoryM from "./Mobile/CategoryM.svelte";
  import AccountM from "./Mobile/AccountM.svelte";
  import { requiredParam } from "../Util/route";
  import { Route, useLocation } from "svelte-navigator";

  $: location = useLocation();
  $: params = getParams($location?.state);
</script>
