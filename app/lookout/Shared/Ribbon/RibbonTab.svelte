{#if $selectedTab == tab || $isSurveying}
  <hbox class="ribbon-tab-content" class:surveyed={$selectedTab != tab}
    role="tabpanel" aria-label={label} inert={$selectedTab != tab}
    bind:this={contentEl}>
    <hbox class="groups">
      <slot />
    </hbox>
    {#if overflowGroups.length}
      <hbox class="more" bind:this={moreEl}>
        <RibbonButtonBase label={$t`More commands`} icon={MoreIcon}
          fixedLook="simplified-icon" isItem={false}
          classes="menu-trigger more-button"
          pressed={isMoreMenuOpen}
          onClick={onToggleMoreMenu} />
      </hbox>
    {/if}
  </hbox>
{/if}
<div class="ribbon-more-menu" class:open={isMoreMenuOpen && overflowGroups.length}
  style={moreMenuStyle}
  role="menu" aria-label={$t`More commands`}
  bind:this={moreMenuEl}>
  {#each overflowGroups as group (group)}
    <div class="more-menu-group" use:hostGroupBody={group}></div>
  {/each}
</div>
<AppWindowEvents on:click={onClickOutside} on:keydown={onKeyDown} on:resize={closeMoreMenu} />

<script lang="ts">
  import { fitGroupStages, isOverflowStage, type RibbonGroupInfo, type RibbonLayout, type RibbonMetrics, type RibbonTabInfo } from "./RibbonGroup";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import RibbonButtonBase from "./RibbonButtonBase.svelte";
  import { AppWindow } from "../../../frontend/MainWindow/AppWindow";
  import AppWindowEvents from "../../../frontend/MainWindow/AppWindowEvents.svelte";
  import MoreIcon from "lucide-svelte/icons/ellipsis";
  import { getContext, setContext, onDestroy } from "svelte";
  import { writable, type Readable, type Writable } from "svelte/store";
  import { t } from "../../../l10n/l10n";

  export let label: string;
  export let contextual = false;
  export let isSelected = false;

  const appWindow = AppWindow.current();
  const tabs = getContext<Writable<RibbonTabInfo[]>>("ribbonTabs");
  const selectedTab = getContext<Writable<RibbonTabInfo>>("ribbonSelectedTab");
  const isSurveying = getContext<Readable<boolean>>("ribbonIsSurveying");
  const metrics = getContext<Readable<RibbonMetrics>>("ribbonMetrics");
  const onTabAdded = getContext<(tab: RibbonTabInfo) => void>("onRibbonTabAdded");
  const onTabRemoved = getContext<(tab: RibbonTabInfo) => void>("onRibbonTabRemoved");
  const tab: RibbonTabInfo = { label, isContextual: contextual, groups: [] };
  const tabLabel = writable(label);
  $: $tabLabel = label;
  setContext("ribbonTabLabel", tabLabel);
  setContext("onRibbonGroupAdded", addGroup);
  setContext("onRibbonGroupRemoved", removeGroup);
  setContext("onRibbonGroupResized", fitGroups);
  setContext("onRibbonMoreMenuClose", closeMoreMenu);
  onTabAdded(tab);
  if (isSelected) {
    $selectedTab = tab;
  }
  onDestroy(() => onTabRemoved(tab));
  $: renameTab(label);
  function renameTab(newLabel: string) {
    if (tab.label == newLabel) {
      return;
    }
    tab.label = newLabel;
    tabs.update(list => list);
  }
  $: isSelected = $selectedTab == tab;
  $: if (isSelected && $selectedTab != tab) {
    selectedTab.set(tab);
  }
  const layoutSetting = getLocalStorage<RibbonLayout>("lookout.ribbon.layout", "classic");
  let overflowGroups: RibbonGroupInfo[] = [];
  let isMoreMenuOpen = false;
  let availableWidth = 0;
  let overflowWidth = 0;

  $: setOverflowWidth($layoutSetting.value == "simplified" && $metrics
    ? $metrics.simplifiedIconWidth + $metrics.groupChrome
    : 0);
  function setOverflowWidth(width: number) {
    if (overflowWidth == width) {
      return;
    }
    overflowWidth = width;
    fitGroups();
  }

  function addGroup(group: RibbonGroupInfo) {
    let pos = tab.groups.findIndex(existing => existing.el && group.el &&
      group.el.compareDocumentPosition(existing.el) & Node.DOCUMENT_POSITION_FOLLOWING);
    tab.groups.splice(pos < 0 ? tab.groups.length : pos, 0, group);
    fitGroups();
  }

  function removeGroup(group: RibbonGroupInfo) {
    let pos = tab.groups.indexOf(group);
    if (pos >= 0) {
      tab.groups.splice(pos, 1);
    }
    fitGroups();
  }

  function fitGroups() {
    if (!availableWidth) {
      return;
    }
    let stages = fitGroupStages(tab.groups, availableWidth, overflowWidth);
    tab.groups.forEach((group, i) => group.setStage(stages[i]));
    let fittedOverflow = tab.groups.filter((group, i) => isOverflowStage(group, stages[i]));
    if (overflowGroups.length != fittedOverflow.length || overflowGroups.some((group, i) => group != fittedOverflow[i])) {
      overflowGroups = fittedOverflow;
    }
  }

  function closeMoreMenu() {
    isMoreMenuOpen = false;
  }

  let contentEl: HTMLElement;
  let moreEl: HTMLElement;
  let moreMenuEl: HTMLElement;
  let moreMenuStyle = "";
  let resizeObserver: ResizeObserver;
  $: observeContent(contentEl);
  function observeContent(el: HTMLElement) {
    resizeObserver?.disconnect();
    if (!el) {
      return;
    }
    resizeObserver = new ResizeObserver(entries => {
      availableWidth = entries[0].contentRect.width;
      fitGroups();
    });
    resizeObserver.observe(el);
  }
  onDestroy(() => resizeObserver?.disconnect());

  $: if (!overflowGroups.length || $selectedTab != tab) {
    closeMoreMenu();
  }

  function onToggleMoreMenu() {
    if (isMoreMenuOpen) {
      closeMoreMenu();
      return;
    }
    let anchor = moreEl.getBoundingClientRect();
    let right = Math.max(4, appWindow.window.innerWidth - anchor.right);
    moreMenuStyle = `right: ${right}px; top: ${anchor.bottom + 4}px;`;
    isMoreMenuOpen = true;
  }

  function hostGroupBody(node: HTMLElement, group: RibbonGroupInfo) {
    if (group.bodyEl) {
      node.appendChild(group.bodyEl);
    }
  }

  function onClickOutside(event: MouseEvent) {
    let target = event.target as HTMLElement;
    if (!isMoreMenuOpen || moreMenuEl?.contains(target) || moreEl?.contains(target)) {
      return;
    }
    if (target?.closest?.(".popup")) {
      return;
    }
    closeMoreMenu();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (isMoreMenuOpen && event.key == "Escape") {
      closeMoreMenu();
    }
  }
</script>

<style>
  .ribbon-tab-content {
    flex: 1 1 0;
    min-width: 0;
    align-items: stretch;
    overflow: hidden;
  }
  .ribbon-tab-content.surveyed {
    display: none;
  }
  .groups {
    flex: 1 1 auto;
    min-width: 0;
    align-items: stretch;
  }
  .more {
    flex: 0 0 auto;
    align-items: center;
    padding: 0 var(--lo-ribbon-group-padding);
  }
  .ribbon-more-menu {
    position: fixed;
    z-index: 30;
    display: flex;
    flex-direction: column;
    min-width: 200px;
    max-height: calc(100vh - 120px);
    overflow-y: auto;
    padding: 4px;
    box-sizing: border-box;
    visibility: hidden;
    background-color: var(--lo-ribbon-bg);
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius);
    box-shadow: var(--lo-shadow-popup);
  }
  .ribbon-more-menu.open {
    visibility: visible;
  }
  .more-menu-group:not(:first-child) {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid var(--lo-divider);
  }
</style>
