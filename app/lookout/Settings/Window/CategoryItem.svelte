<button class="nav-entry settings-category" class:selected class:sub={!category.isMain}
  role="treeitem" aria-selected={selected} aria-expanded={hasChildren ? isSectionOpen : undefined}
  on:click={onSelect}>
  {category.name}
</button>
{#if isSectionOpen}
  <SubCategoriesList subCategories={category.subCategories} mainCategory={category} />
  <AccountsList {category} />
{/if}

<script lang="ts">
  import { AccountSettingsCategory, type SettingsCategory } from "../../../frontend/Settings/SettingsCategory";
  import { selectedCategory, selectedAccount } from "../../../frontend/Settings/Window/selected";
  import SubCategoriesList from "./SubCategoriesList.svelte";
  import AccountsList from "./AccountsList.svelte";

  export let category: SettingsCategory;

  $: selected = category == $selectedCategory;
  $: hasChildren = category.subCategories.hasItems || category.accounts.hasItems || !!category.newAccountURL;
  $: isSectionOpen = selected || category.subCategories.contains($selectedCategory) || category.accounts.contains($selectedAccount);

  function onSelect() {
    if (!(category instanceof AccountSettingsCategory)) {
      $selectedAccount = null;
    }
    $selectedCategory = category;
  }
</script>

<style>
  .settings-category {
    padding-inline-start: 12px;
  }
  .settings-category.sub {
    height: 28px;
    padding-inline-start: 36px;
  }
  :global(.accounts .account-pages) .settings-category.sub {
    padding-inline-start: 60px;
  }
</style>
