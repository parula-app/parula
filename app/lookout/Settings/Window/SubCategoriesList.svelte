{#if $subCategories.hasItems}
  <vbox class="sub-categories" app={mainCategory?.id}>
    {#each $subCategories.each as category (category.id)}
      <CategoryItem {category} />
    {/each}
  </vbox>
{/if}

<script lang="ts">
  import type { SettingsCategory } from "../../../frontend/Settings/SettingsCategory";
  import CategoryItem from "./CategoryItem.svelte";
  import type { Collection } from "svelte-collections";

  export let subCategories: Collection<SettingsCategory>;
  export let mainCategory: SettingsCategory;
</script>

<style>
  .sub-categories {
    flex-shrink: 0;
  }
</style>
