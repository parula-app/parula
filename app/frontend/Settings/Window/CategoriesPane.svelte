<!-- svelte-ignore a11y_no_static_element_interactions -->
<vbox flex class="settings-categories-pane" tabindex="-1" on:keydown={event => onListKey(event, ".settings-category, .account")}>
  <Scroll>
    {#each $categories.each as category}
      <CategoryItem {category} />
    {/each}
  </Scroll>
</vbox>

<script lang="ts">
  import type { SettingsCategory } from "../SettingsCategory";
  import CategoryItem from "./CategoryItem.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import { onListKey } from "../../Util/util";
  import type { Collection } from "svelte-collections";

  /* Which apps to show on the app bar
   * in */
  export let categories: Collection<SettingsCategory>;
</script>

<style>
  .settings-categories-pane {
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
    box-shadow: var(--left-pane-shadow, 1px 0px 3px 0px rgba(22, 12, 39, 20%)); /* #160C27 */
    margin: var(--pane-margin);
    padding-block-start: 24px;
    z-index: 4;
  }
</style>
