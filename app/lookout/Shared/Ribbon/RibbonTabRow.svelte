<hbox class="tab-row"
  class:collapsed={isCollapsed}
  class:temp-open={isCollapsed && $isTempOpen}
  on:contextmenu={ribbon.onContextMenu}
  bind:this={tabRowEl}>
  {#if appWindow.isMainWindow}
    <button class="tab file-tab" class:selected={isBackstageShown} on:click={ribbon.onFile} title={$t`File`}>
      <span class="tab-label">{$t`File`}</span>
    </button>
  {/if}
  <hbox class="tabs" role="tablist" tabindex="-1" on:keydown={onKeyDown}>
    {#each $shownTabs as tab}
      <button class="tab" role="tab"
        class:selected={tab == $selectedTab && !isBackstageShown}
        class:contextual={tab.isContextual}
        aria-selected={tab == $selectedTab && !isBackstageShown}
        tabindex={tab == $selectedTab ? 0 : -1}
        on:click={() => ribbon.onSelectTab(tab)}
        on:dblclick={ribbon.onToggleCollapsed}>
        <span class="tab-label">{tab.label}</span>
      </button>
    {/each}
  </hbox>
  <hbox flex class="spacer" />
  <slot />
  <KeyTipsLayer {ribbon} {tabRowEl} />
</hbox>

<script lang="ts">
  import type { RibbonState } from "./RibbonGroup";
  import KeyTipsLayer from "./KeyTipsLayer.svelte";
  import { isBackstageOpen } from "../../Settings/Backstage/selected";
  import { AppWindow } from "../../../frontend/MainWindow/AppWindow";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import { t } from "../../../l10n/l10n";

  /** Shown in the ribbon, or in the window title bar */
  export let ribbon: RibbonState;

  const appWindow = AppWindow.current();

  $: shownTabs = ribbon.shownTabs;
  $: selectedTab = ribbon.selectedTab;
  $: isTempOpen = ribbon.isTempOpen;
  /** Then the File tab is selected, not the ribbon tab.
   * A window opened for one thing has no File tab, but the same store as its main window. */
  $: isBackstageShown = appWindow.isMainWindow && $isBackstageOpen;
  const collapsedSetting = getLocalStorage<boolean>("lookout.ribbon.collapsed", false);
  $: isCollapsed = !!$collapsedSetting.value;
  let tabRowEl: HTMLElement;

  function onKeyDown(event: KeyboardEvent) {
    if (event.key != "ArrowLeft" && event.key != "ArrowRight") {
      return;
    }
    let tabButtons = Array.from(tabRowEl.querySelectorAll<HTMLElement>(".tabs .tab"));
    let pos = tabButtons.indexOf(appWindow.window.document.activeElement as HTMLElement);
    if (pos < 0) {
      return;
    }
    let forward = (event.key == "ArrowRight") != (getComputedStyle(tabRowEl).direction == "rtl");
    let next = tabButtons[(pos + (forward ? 1 : -1) + tabButtons.length) % tabButtons.length];
    next.focus();
    event.preventDefault();
  }
</script>

<style>
  .tab-row {
    align-items: stretch;
    min-width: 0;
    app-region: drag;
  }
  .tabs {
    align-items: stretch;
    min-width: 0;
  }
  .tabs:focus {
    outline: none;
  }
  .tab {
    position: relative;
    display: flex;
    align-items: center;
    min-width: 0;
    padding: 0;
    margin: 2px 1px;
    border: none;
    border-radius: var(--lo-radius-small);
    background-color: transparent;
    color: var(--lo-fg);
    font-family: inherit;
    font-size: var(--lo-font-size);
    white-space: nowrap;
    app-region: no-drag;
  }
  /* The padding. If the tabs don't fit, the padding shrinks first, then the label. */
  .tab::before,
  .tab::after {
    content: "";
    width: 12px;
  }
  .tab-label {
    flex-shrink: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tab:hover {
    background-color: var(--lo-hover-bg);
  }
  .tab.selected {
    font-weight: 600;
  }
  .tab.contextual {
    color: var(--lo-accent-text);
  }
  .tab.selected .tab-label::after {
    content: "";
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 3px;
    height: 3px;
    border-radius: 2px;
    background-color: var(--lo-accent);
  }
  /* The collapsed ribbon doesn't show the selected tab, but the File view shows */
  .collapsed:not(.temp-open) .tab.selected:not(.file-tab) {
    font-weight: normal;
  }
  .collapsed:not(.temp-open) .tab.selected:not(.file-tab) .tab-label::after {
    display: none;
  }
</style>
