<Clickable onClick={onSelect}>
  <vbox class="settings-category" class:selected class:sub={!category.isMain}>
    <hbox class="label font-small" class:main={category.isMain}>
      {category.name}
    </hbox>
  </vbox>
</Clickable>
{#if isSectionOpen}
  <SubCategoriesList subCategories={category.subCategories} mainCategory={category} />
  <AccountsList {category} />
{/if}

<script lang="ts">
  import type { SettingsCategory } from "../SettingsCategory";
  import { selectedCategory, selectedAccount } from "./selected";
  import { openSettingsCategory } from "./CategoriesUtils";
  import SubCategoriesList from "./SubCategoriesList.svelte";
  import AccountsList from "./AccountsList.svelte";
  import Clickable from "../../Shared/Clickable.svelte";
  import { appGlobal } from "../../../logic/app";

  /** in */
  export let category: SettingsCategory;

  $: selected = category == $selectedCategory;
  $: isSectionOpen = selected || category.subCategories.contains($selectedCategory) || category.accounts.contains($selectedAccount);

  function onSelect() {
    if (appGlobal.isMobile && (category.subCategories.hasItems || category.accounts.hasItems)) {
      isSectionOpen = !isSectionOpen;
    } else {
      openSettingsCategory(category);
    }
  }
</script>

<style>
  .settings-category {
    align-items: start;
    padding-block: 0px 2px;
    padding-inline: 18px 0px;
  }
  .settings-category.sub {
    padding-inline-start: 30px;
  }
  :global(.accounts) .settings-category.sub {
    padding-inline-start: 42px;
  }
  .settings-category:hover {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  .selected {
    background-color: var(--selected-bg);
    color:  var(--selected-fg);
  }
  .label {
    white-space: nowrap;
    overflow: hidden;
    margin-block-start: 4px;
    margin-inline-start: 4px;
    margin-inline-end: 4px;
  }
</style>
