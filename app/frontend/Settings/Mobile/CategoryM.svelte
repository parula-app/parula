<vbox class="category" flex>
  <Scroll>
    <hbox class="header">
      {category?.name ?? $t`Settings`}
    </hbox>

    {#if $subCategories.hasItems}
      <vbox class="sub-categories">
        {#each $subCategories.each as subCategory}
          <RowButton label={subCategory.name}
            icon={subCategory.icon}
            onClick={() => goToCategory(subCategory)} />
        {/each}
      </vbox>
    {/if}

    {#if category?.accounts?.hasItems}
      <hbox class="accounts-header">
        {$t`Accounts`}
      </hbox>
      <vbox class="accounts">
        {#each category.accounts.each as account}
          <RowButton label={account.name}
            icon={account.icon ?? InboxIcon}
            onClick={() => goToAccount(account)} />
        {/each}
      </vbox>
      <RowButton label={$t`New account`} onClick={onNewAccount} />
    {/if}

    {#if category?.windowContent}
      <vbox class="settings-panel" flex>
        <svelte:component this={category.windowContent} account={$selectedAccount} />
      </vbox>
    {/if}
  </Scroll>
</vbox>

{#if $appGlobal.isMobile}
  <CategoryBarM {category} />
{/if}

<script lang="ts">
  import { settingsCategories } from "../SettingsCategory";
  import type { SettingsCategory } from "../SettingsCategory";
  import { Account } from "../../../logic/Abstract/Account";
  import { selectedAccount } from "../Window/selected";
  import { SetupMustangApp } from "../../Setup/SetupMustangApp";
  import { appGlobal } from "../../../logic/app";
  import { goTo, mustangApps } from "../../AppsBar/selectedApp";
  import { URLPart } from "../../../logic/util/blob";
  import CategoryBarM from "./CategoryBarM.svelte";
  import RowButton from "./RowButton.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import InboxIcon from "lucide-svelte/icons/inbox";
  import { assert } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";

  export let category: SettingsCategory | null;

  $: subCategories = category
    ? category.subCategories
    : settingsCategories.filterObservable(cat => cat.isMain && (!cat.forApp || mustangApps.includes(cat.forApp)));

  function goToCategory(category: SettingsCategory) {
    goTo(URLPart`/settings/category/${category.id}`, { category });
  }

  function goToAccount(account: Account) {
    goTo(URLPart`/settings/account/${account.id}`, { category, account });
  }

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
  .category {
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
    padding: 32px 24px;
  }
  .header {
    font-size: 24px;
    font-weight: bold;
    margin-block-end: 12px;
  }
  .sub-categories {
    margin-block-end: 32px;
  }
  .accounts-header {
    font-weight: bold;
    margin-inline-start: 12px;
    margin-block-end: 4px;
    opacity: 50%;
  }
  .accounts {
    margin-block-end: 32px;
  }
</style>
