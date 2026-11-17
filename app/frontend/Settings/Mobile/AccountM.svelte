<vbox class="category" flex>
  <Scroll>
    <hbox class="header">
      <hbox class="account-icon">
        {#if account.icon}
          <Icon data={account.icon} />
        {:else}
          <InboxIcon />
        {/if}
      </hbox>
      {account.name}
    </hbox>

    {#if $subCategories.hasItems && isMain}
      <vbox class="sub-categories">
        {#each $subCategories.each as subCategory}
          <RowButton label={subCategory.name}
            icon={subCategory.icon}
            onClick={() => goToSubCategory(subCategory)} />
        {/each}
      </vbox>
    {/if}

    {#if category?.windowContent}
      <vbox class="settings-panel" flex>
        <svelte:component this={category.windowContent} {account} />
      </vbox>
    {/if}
  </Scroll>
</vbox>

{#if $appGlobal.isMobile}
  <AccountBarM {account} {category} {isMain} />
{/if}

<script lang="ts">
  import { accountSettings } from "../SettingsCategory";
  import type { SettingsCategory } from "../SettingsCategory";
  import { Account } from "../../../logic/Abstract/Account";
  import { appGlobal } from "../../../logic/app";
  import { goTo } from "../../AppsBar/selectedApp";
  import { URLPart } from "../../../logic/util/blob";
  import AccountBarM from "./AccountBarM.svelte";
  import RowButton from "./RowButton.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import Icon from "../../Shared/Icon.svelte";
  import InboxIcon from "lucide-svelte/icons/inbox";

  export let account: Account;
  export let category: SettingsCategory;
  export let isMain: boolean;

  $: category = isMain ? accountSettings.find(cat => account instanceof cat.type && cat.isMain) : category;
  $: subCategories = accountSettings.filterObservable(cat => account instanceof cat.type && !cat.isMain && cat.isAvailable(account));

  function goToSubCategory(category: SettingsCategory) {
    goTo(URLPart`/settings/account/${account.id}/${category.id}`, { account, category });
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
  .account-icon {
    align-items: center;
    margin-inline-end: 16px;
  }
  .sub-categories {
    margin-block-end: 32px;
  }
</style>
