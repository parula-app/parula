<hbox class="status-bar" role="status">
  <hbox class="side left">
    {#each $statusBarContent?.left ?? [] as item}
      <StatusBarEntry {item} />
    {/each}
  </hbox>
  <hbox flex class="spacer" />
  <hbox class="side right">
    {#each $statusBarContent?.right ?? [] as item}
      <StatusBarEntry {item} />
    {/each}
  </hbox>
  {#if $statusBarContent?.views?.length}
    <hbox class="views" role="group">
      {#each $statusBarContent.views as view (view.label)}
        <button type="button" class="view" class:active={view.isActive}
          title={view.label} aria-label={view.label} aria-pressed={view.isActive}
          on:click={view.onClick}>
          <svelte:component this={view.icon} size="14" />
        </button>
      {/each}
    </hbox>
  {/if}
</hbox>

<script lang="ts">
  import { statusBarContent } from "./Selected";
  import StatusBarEntry from "./StatusBarEntry.svelte";
</script>

<style>
  .status-bar {
    flex: 0 0 auto;
    align-items: center;
    height: var(--lo-statusbar-height);
    padding: 0 12px;
    background-color: var(--lo-statusbar-bg);
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
    border-block-start: 1px solid var(--lo-divider);
    white-space: nowrap;
    overflow: hidden;
  }
  .views {
    align-items: center;
    gap: 2px;
    margin-inline-start: 16px;
  }
  .view {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 20px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
  }
  .view:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  .view.active {
    background-color: var(--lo-selected-bg);
    border-color: var(--lo-selected-hover-bg);
    color: var(--lo-fg);
  }
  .side {
    align-items: center;
    gap: 16px;
    min-width: 0;
  }
</style>
