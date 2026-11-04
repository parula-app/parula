<Dialog title={showOnlyAccount ? $t`Account Settings` : $t`${appName} Options`}
  cancelLabel={$t`Close`}
  width="1040px"
  height="720px"
  on:close={onClose}>
  <hbox flex class="settings-app">
    <CategoriesPane {categories} account={showOnlyAccount ? $selectedAccount : null} />
    <MainContent category={$selectedCategory} />
  </hbox>
</Dialog>

<script lang="ts">
  import type { Account } from "../../../logic/Abstract/Account";
  import { settingsCategories, accountSettings } from "../SettingsCategories";
  import { selectedCategory, selectedAccount } from "./selected";
  import { mustangApps } from "../../../frontend/AppsBar/selectedApp";
  import CategoriesPane from "./CategoriesPane.svelte";
  import MainContent from "./MainContent.svelte";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import { appName } from "../../../logic/build";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let categoryID: string = null;
  export let account: Account = null;
  export let showOnlyAccount = false;

  const dispatch = createEventDispatcher<{ close: void }>();

  let categories = settingsCategories.filterObservable(cat => !cat.forApp || mustangApps.includes(cat.forApp));

  $selectedAccount = account;
  $selectedCategory = account
    ? accountSettings.find(cat => account instanceof cat.type && cat.id == categoryID) ??
      accountSettings.find(cat => account instanceof cat.type && cat.isMain)
    : [ ...categories.contents, ...categories.contents.flatMap(cat => cat.subCategories.contents) ]
        .find(cat => cat.id == categoryID) ?? categories.first;

  $: if (showOnlyAccount && !$selectedAccount) {
    onClose();
  }

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  .settings-app {
    gap: 16px;
    height: 100%;
    min-height: 0;
  }
</style>
