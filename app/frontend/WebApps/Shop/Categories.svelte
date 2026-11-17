<vbox class="categories">
  {#each $showCategories.each as category}
    <CategoryEntry {category} {allCategories} bind:selected {indent} />
  {/each}
</vbox>

<script lang="ts">
  import type { WebAppCategory } from "../../../logic/WebApps/WebAppCategory";
  import CategoryEntry from "./CategoryEntry.svelte";
  import type { MapColl, Collection } from "svelte-collections";

  export let allCategories: MapColl<string, WebAppCategory>;
  export let showCategories: Collection<WebAppCategory>;
  export let selected: WebAppCategory; /* in/out */
  export let indent = 0;
</script>

<style>
</style>
