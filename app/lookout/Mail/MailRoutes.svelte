<Route path="compose">
  <MailComposer mail={params?.mail ?? $selectedFolder?.newEMail() ?? ($selectedAccount ?? appGlobal.emailAccounts.first).newEMailFrom()} />
</Route>
<Route path="/*">
  <MailApp />
  <Route path="rules">
    <Rules account={params?.account ?? $selectedAccount ?? appGlobal.emailAccounts.first} on:close={goBack} />
  </Route>
  <Route path="rules/create">
    {#if params?.message}
      <CreateRuleDialog message={params.message} on:close={goBack} />
    {/if}
  </Route>
</Route>

<script lang="ts">
  import { appGlobal } from "../../logic/app";
  import { selectedAccount, selectedFolder } from "../../frontend/Mail/Selected";
  import { getParams, goBack } from "../../frontend/AppsBar/selectedApp";
  import MailComposer from "./Composer/MailComposer.svelte";
  import Rules from "./Rules/Rules.svelte";
  import CreateRuleDialog from "./Rules/CreateRuleDialog.svelte";
  import MailApp from "./MailApp.svelte";
  import { Route, useLocation } from "svelte-navigator";

  $: location = useLocation();
  $: params = getParams($location?.state);
</script>
