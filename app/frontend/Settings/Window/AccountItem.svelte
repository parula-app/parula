<Clickable onClick={onSelect}>
  <vbox class="account" class:selected={itemSelected}>
    <hbox class="label font-small">
      {$account.name}
    </hbox>
  </vbox>
</Clickable>
{#if accountSelected}
  <SubCategoriesList {subCategories} mainCategory={category} />
{/if}

<script lang="ts">
  import type { Account } from "../../../logic/Abstract/Account";
  import { MailAccount } from "../../../logic/Mail/MailAccount";
  import { accountSettings, type SettingsCategory } from "../SettingsCategory";
  import { selectedCategory, selectedAccount } from "./selected";
  import { getSettingsCategoryForAccount, openSettingsCategoryForAccount } from "./CategoriesUtils";
  import SubCategoriesList from "./SubCategoriesList.svelte";
  import Clickable from "../../Shared/Clickable.svelte";

  /** in */
  export let account: Account;
  export let category: SettingsCategory;

  $: accountSelected = account == $selectedAccount;
  $: itemSelected = account == $selectedAccount && $selectedCategory == mainAccountCategory;
  $: mainAccountCategory = getSettingsCategoryForAccount(account);
  $: subCategories = accountSettings.filterObservable(cat => account instanceof cat.type && !cat.isMain && showCat(cat, account));

  function showCat(category: SettingsCategory, account: Account): boolean {
    if (category.id == "mail-sharing" && account instanceof MailAccount) {
      return account.canShareWithPersons();
    }
    return true;
  }

  function onSelect() {
    openSettingsCategoryForAccount(account);
  }
</script>

<style>
  .account {
    align-items: start;
    padding-block: 0px 2px;
    padding-inline: 30px 0px;
  }
  .account:hover {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  .selected {
    background-color: var(--selected-bg);
    color:  var(--selected-fg);
  }
  .label {
    color: var(--fg);
    white-space: nowrap;
    overflow: hidden;
    margin-block-start: 4px;
    margin-inline-start: 4px;
    margin-inline-end: 4px;
  }
</style>
