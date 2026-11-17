<hbox class="buttons">
  <AppBarM>
    <!-- left -->
    {#if isMain && parentCategory}
      <hbox class="back">
        <Button
          icon={parentCategory.icon ?? settingsMustangApp.icon}
          iconSize="24px"
          iconOnly
          label={parentCategory.name}
          onClick={() => goToCategory(parentCategory)}
          plain
          />
      </hbox>
    {:else if account}
      <hbox class="back">
        <Button
          icon={account.icon ?? InboxIcon}
          iconSize="24px"
          iconOnly
          label={account.name}
          onClick={() => goToAccount(account)}
          plain
          />
      </hbox>
    {/if}

    <!-- left middle -->
    <hbox class="empty" />

    <AppMenuButton />

    <!-- right middle -->
    <hbox class="empty" />

    <!-- right -->
    <hbox class="empty" />
  </AppBarM>
</hbox>

<script lang="ts">
  import { Account } from "../../../logic/Abstract/Account";
  import { settingsCategories, type SettingsCategory } from "../SettingsCategory";
  import { settingsMustangApp } from "../Window/SettingsMustangApp";
  import { goTo } from "../../AppsBar/selectedApp";
  import { URLPart } from "../../../logic/util/blob";
  import AppBarM from "../../AppsBar/AppBarM.svelte";
  import AppMenuButton from "../../AppsBar/AppMenuM/AppMenuButton.svelte";
  import Button from "../../Shared/Button.svelte";
  import InboxIcon from "lucide-svelte/icons/inbox";

  export let account: Account;
  export let category: SettingsCategory;
  export let isMain: boolean;

  $: parentCategory = category && settingsCategories.find(cat => cat.accounts.contains(account));
  $: console.log("account", account, "category", category, "parent", parentCategory, "main", isMain);

  function goToCategory(category: SettingsCategory) {
    goTo(URLPart`/settings/category/${category.id}`, { category });
  }

  function goToAccount(account: Account) {
    goTo(URLPart`/settings/account/${account.id}`, { category, account });
  }
</script>
