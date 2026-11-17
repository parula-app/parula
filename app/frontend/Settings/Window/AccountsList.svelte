{#if $accounts.hasItems || category.newAccountURL}
  <vbox class="accounts" app={category.id}>
    <hbox class="header font-smallest">
      {$t`Accounts`}
      <hbox flex />
      {#if category.newAccountURL}
        <RoundButton
          icon={AddIcon}
          iconSize="10px"
          padding="3px"
          classes="small"
          label={$t`New account for ${category.name}`}
          onClick={onNewAccount}
          />
      {/if}
    </hbox>
    {#each $accounts.each as account}
      <AccountItem {account} {category} />
    {/each}
  </vbox>
{/if}

<script lang="ts">
  import type { SettingsCategory } from "../SettingsCategory";
  import { goTo } from "../../AppsBar/selectedApp";
  import { URLPart } from "../../../logic/util/blob";
  import { SetupMustangApp } from "../../Setup/SetupMustangApp";
  import AccountItem from "./AccountItem.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import AddIcon from "lucide-svelte/icons/plus";
  import { assert } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";

  /** in */
  export let category: SettingsCategory;

  $: accounts = category.accounts;

  function onNewAccount() {
    assert(category.newAccountURL, "Need newAccountURL");
    let setupApp = new SetupMustangApp();
    setupApp.appURL = category.newAccountURL;
    setupApp.onBack = () => onReOpenThis();
    goTo(category.newAccountURL, {});
  }

  function onReOpenThis() {
    goTo(URLPart`settings/category/${category.id}`, { category });
  }
</script>

<style>
  .accounts {
    justify-content: start;
    flex-wrap: wrap;
  }
  .accounts[app="webapps"] {
    margin-block-start: 128px;
  }
  .header {
    align-items: center;
    color: darkgray;
    margin-inline-start: 34px;
    margin-inline-end: 12px;
  }
  .header :global(button) {
    margin: 1px;
  }
</style>
