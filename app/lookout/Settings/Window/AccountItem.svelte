<button class="nav-entry account" class:selected={itemSelected} class:open={accountSelected}
  role="treeitem" aria-selected={itemSelected} aria-expanded={$subCategories.hasItems ? accountSelected : undefined}
  title={$account.name}
  on:click={onSelect}>
  <AppIcon icon={getAccountIcon(account)} size="16px" />
  <span class="name">{$account.name}</span>
</button>
{#if accountSelected}
  <vbox class="account-pages">
    <SubCategoriesList {subCategories} mainCategory={category} />
  </vbox>
{/if}

<script lang="ts">
  import type { Account } from "../../../logic/Abstract/Account";
  import type { SettingsCategory } from "../../../frontend/Settings/SettingsCategory";
  import { MailAccount } from "../../../logic/Mail/MailAccount";
  import { accountSettings } from "../SettingsCategories";
  import { selectedCategory, selectedAccount } from "../../../frontend/Settings/Window/selected";
  import { getAccountIcon } from "../../../frontend/Settings/Shared/accountUIHelper";
  import SubCategoriesList from "./SubCategoriesList.svelte";
  import AppIcon from "../../../frontend/AppsBar/AppIcon.svelte";

  export let account: Account;
  export let category: SettingsCategory;

  $: accountSelected = account == $selectedAccount;
  $: itemSelected = accountSelected && $selectedCategory == mainAccountCategory;
  $: mainAccountCategory = accountSettings.find(cat => account instanceof cat.type && cat.isMain);
  $: subCategories = accountSettings.filterObservable(cat => account instanceof cat.type && !cat.isMain && showCat(cat, account));

  // <copied from="../../../frontend/Settings/Window/AccountItem.svelte">
  function showCat(category: SettingsCategory, account: Account): boolean {
    if (category.id == "mail-sharing" && account instanceof MailAccount) {
      return account.canShareWithPersons();
    }
    return true;
  }
  // </copied>

  function onSelect() {
    $selectedAccount = account;
    $selectedCategory = mainAccountCategory;
  }
</script>

<style>
  .nav-entry.account {
    height: 30px;
    padding-inline-start: 12px;
  }
  :global(.accounts) .nav-entry.account {
    padding-inline-start: 36px;
  }
  .nav-entry.account.open {
    font-weight: 600;
  }
  .name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .account-pages {
    flex-shrink: 0;
  }
</style>
