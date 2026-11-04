<vbox flex class="setup">
  <SetupPages />
</vbox>

<script lang="ts">
  import SetupPages from "../../frontend/Setup/SetupRoutes.svelte";
</script>

<style>
  .setup {
    min-width: 0;
    min-height: 0;
    margin: 4px 8px 8px 8px;
    overflow: auto;
    background-color: var(--lo-window-bg);
  }
  .setup :global(.background-video),
  .setup :global(.background-video + .button) {
    display: none;
  }
  .setup :global(.page-box) {
    margin: 16px;
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius);
    background-color: var(--lo-pane-bg);
    color: var(--lo-fg);
    box-shadow: var(--lo-shadow-card);
  }
  .setup :global(h1),
  .setup :global(h2),
  .setup :global(h3) {
    font-weight: 600;
  }
  .setup :global(input),
  .setup :global(select) {
    font-family: var(--lo-font);
  }
</style>
