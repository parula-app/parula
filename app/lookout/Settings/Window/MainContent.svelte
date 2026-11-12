<vbox flex class="settings-content" role="tabpanel">
  {#if category?.windowContent}
    {#key $selectedAccount}
      <svelte:component this={category.windowContent} account={$selectedAccount} />
    {/key}
  {/if}
</vbox>

<script lang="ts">
  import type { SettingsCategory } from "../../../frontend/Settings/SettingsCategory";
  import { selectedAccount } from "../../../frontend/Settings/Window/selected";

  export let category: SettingsCategory;
</script>

<style>
  .settings-content {
    --headerbar-bg: transparent;
    min-width: 0;
    min-height: 0;
    padding-inline-end: 8px;
    overflow-y: auto;
  }
  .settings-content :global(h2),
  .settings-content :global(.title:has(+ .subtitle)) {
    margin: 0 0 4px 0;
    font-size: 20px;
    font-weight: 600;
  }
  .settings-content :global(.group) {
    margin-block-end: 12px;
  }
  .settings-content :global(.group > .header) {
    font-size: var(--lo-font-size);
  }
  .settings-content :global(input:not([type="checkbox"]):not([type="radio"]):not([type="color"])),
  .settings-content :global(select) {
    font-family: var(--lo-font);
    font-size: var(--lo-font-size);
  }
</style>
