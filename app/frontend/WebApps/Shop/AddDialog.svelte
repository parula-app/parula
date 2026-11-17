<vbox class="add-dialog">
  {#if needsAccount}
    <hbox class="needs-account">{$t`Add a ${providerName} mail account first`}</hbox>
  {:else}
    <AccountDropDown bind:selectedAccount showAllOption={loginProvider ? false : $t`Custom`} accounts={loginAccounts} filterByWorkspace={false} />
  {/if}
  <hbox class="last-row">
    <hbox flex />
    {#if needsAccount}
      <!--<RoundButton
        icon={SettingsIcon}
        label={$t`Add mail account`}
        onClick={onAddAccount}
        classes="add-account"
        />-->
    {:else}
      <RoundButton
        icon={SaveIcon}
        label={$t`Save`}
        onClick={save}
        classes="save create"
        />
    {/if}
  </hbox>
</vbox>

<script lang="ts">
  import type { WebAppListed } from "../../../logic/WebApps/WebAppListed";
  import type { Account } from "../../../logic/Abstract/Account";
  import { capitalizeStart } from "../../../logic/util/util";
  import { appGlobal } from "../../../logic/app";
  import AccountDropDown from "../../Shared/AccountDropDown.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import { getSettingsCategoryForApp } from "../../Settings/Window/CategoriesUtils";
  import { mailMustangApp } from "../../Mail/MailMustangApp";
  import { goTo } from "../../AppsBar/selectedApp";
  import SaveIcon from "lucide-svelte/icons/check";
  import SettingsIcon from "lucide-svelte/icons/settings";
  import { t } from "../../../l10n/l10n";
  import { createEventDispatcher } from 'svelte';
  const dispatchEvent = createEventDispatcher<{ added: WebAppListed }>();

  export let app: WebAppListed;

  let loginProvider = app.loginProvider;
  let loginAccounts = loginProvider
    ? appGlobal.emailAccounts.filterObservable(acc => acc.provider() == loginProvider)
    : appGlobal.emailAccounts;
  let providerName = loginProvider && capitalizeStart(loginProvider);
  /** The app needs an account of its provider, and the user has none yet */
  $: needsAccount = !!loginProvider && $loginAccounts.isEmpty;

  /** null = "Custom", i.e. the user logs in within the app itself.
   * Apps that need a specific provider have no "Custom", and the dropdown
   * preselects the first account. */
  let selectedAccount: Account | null = null;

  function onAddAccount() {
    goTo(getSettingsCategoryForApp(mailMustangApp).newAccountURL, {});
  }

  function save() {
    let instance = app.instantiate(selectedAccount);
    appGlobal.webApps.myApps.add(instance);
    dispatchEvent("added", instance);
  }
</script>

<style>
  .add-dialog {
    border: 1px solid var(--border);
    border-radius: 3px;
    margin: -6px 4px 4px 4px;
    padding: 12px;
    max-width: 192px; /* Same as the app entry above us, so that the text wraps */
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
  }
  .needs-account {
    flex-wrap: wrap;
  }
  .last-row {
    margin-block-start: 8px;
  }
</style>
