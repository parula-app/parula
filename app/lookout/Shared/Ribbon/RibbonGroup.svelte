<div class="ribbon-group {layout}" class:collapsed={collapsed} class:in-more-menu={isInMoreMenu}
  class:hidden-by-user={isHiddenByUser}
  role="group" aria-label={label}
  bind:this={groupEl}>
  {#if collapsed && !isInMoreMenu}
    <RibbonButtonBase {label} icon={icon ?? firstIcon}
      classes="group-collapsed-button menu-trigger"
      size="large" fixedLook="large"
      hasMenu pressed={isPopupOpen}
      onClick={onTogglePopup}
      bind:buttonEl={collapsedButtonEl}
      />
  {/if}
  <div class="body-home" style:min-width={labelWidth && layout == "classic" ? labelWidth + "px" : null} bind:this={homeEl}>
    <div class="group-body" bind:this={bodyEl}>
      <div class="more-menu-label">{label}</div>
      <div class="group-buttons stage-{stage}" data-stage={stage}
        class:popup={collapsed && !isInMoreMenu}
        class:open={collapsed && !isInMoreMenu && isPopupOpen}
        style={collapsed && !isInMoreMenu ? popupStyle : ""}
        on:click|capture={onClickInside}
        bind:this={buttonsEl}>
        <slot />
      </div>
    </div>
  </div>
  {#if !collapsed}
    <div class="group-label">
      <span class="group-label-text" bind:this={labelTextEl}>{label}</span>
      {#if onLauncher}
        <button class="launcher" title={launcherTooltip ?? label} aria-label={launcherTooltip ?? label}
          on:click={onLauncherClicked}>
          <LauncherIcon size="12" />
        </button>
      {/if}
    </div>
  {/if}
</div>
<svelte:window on:click={onClickOutside} on:keydown={onKeyDown} on:resize={closePopup} />

<script lang="ts">
  import { computeStageWidths, type RibbonGroupInfo, type RibbonGroupLook, type RibbonItemInfo, type RibbonLayout, type RibbonMetrics } from "./RibbonGroup";
  import type { RibbonHiddenParts } from "./RibbonCustomization";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import RibbonButtonBase from "./RibbonButtonBase.svelte";
  import { showError } from "../../../frontend/Util/error";
  import LauncherIcon from "lucide-svelte/icons/arrow-down-right";
  import { getContext, setContext, onMount, onDestroy } from "svelte";
  import { readable, writable, type Readable } from "svelte/store";

  export let label: string;
  export let icon: ConstructorOfATypedSvelteComponent = null;
  export let onLauncher: () => void | Promise<void> = null;
  export let launcherTooltip: string = null;

  const ribbonID = getContext<string>("ribbonID");
  const tabLabel = getContext<Readable<string>>("ribbonTabLabel") ?? readable<string>(undefined);
  const onGroupAdded = getContext<(group: RibbonGroupInfo) => void>("onRibbonGroupAdded");
  const onGroupRemoved = getContext<(group: RibbonGroupInfo) => void>("onRibbonGroupRemoved");
  const onGroupResized = getContext<() => void>("onRibbonGroupResized");
  const onMoreMenuClose = getContext<() => void>("onRibbonMoreMenuClose");
  const group: RibbonGroupInfo = {
    label,
    el: null,
    bodyEl: null,
    stageWidths: [0],
    hasOverflowStage: false,
    setStage,
  };
  $: group.label = label;

  let stage = 0;
  let collapsed = false;
  const layoutSetting = getLocalStorage<RibbonLayout>("lookout.ribbon.layout", "classic");
  let layout: RibbonLayout;
  $: layout = ribbonID && $layoutSetting.value == "simplified" ? "simplified" : "classic";
  const look = writable<RibbonGroupLook>({ layout: "classic", stage, collapsed });
  $: $look = { layout, stage, collapsed };
  setContext("ribbonGroupLook", look);
  let firstIcon: ConstructorOfATypedSvelteComponent = null;
  setContext("onRibbonItemIcon", (itemIcon: ConstructorOfATypedSvelteComponent) => {
    if (!firstIcon && itemIcon) {
      firstIcon = itemIcon;
    }
  });

  const metrics = getContext<Readable<RibbonMetrics>>("ribbonMetrics") ?? readable<RibbonMetrics>(null);
  $: isInMoreMenu = collapsed && layout == "simplified";
  const customization = getLocalStorage<Record<string, RibbonHiddenParts>>("lookout.ribbon.customization", {});
  $: isHiddenByUser = ($customization.value?.[ribbonID]?.groups ?? []).includes($tabLabel + "/" + label);

  let groupEl: HTMLElement;
  let homeEl: HTMLElement;
  let bodyEl: HTMLElement;
  let buttonsEl: HTMLElement;
  let collapsedButtonEl: HTMLButtonElement;
  let labelTextEl: HTMLElement;
  let labelWidth = 0;
  let isPopupOpen = false;
  let popupStyle = "";

  let resizeObserver: ResizeObserver;
  onMount(() => {
    group.el = groupEl;
    group.bodyEl = bodyEl;
    onGroupAdded?.(group);
    resizeObserver = new ResizeObserver(() => measure(true));
    resizeObserver.observe(buttonsEl);
    measure(false);
  });
  onDestroy(() => {
    resizeObserver?.disconnect();
    onGroupRemoved?.(group);
  });

  $: measure(false, $metrics, layout, isHiddenByUser);
  function measure(isRendered: boolean, ..._dependencies: any[]) {
    if (!buttonsEl || !$metrics) {
      return;
    }
    if (isHiddenByUser) {
      setStageWidths([0], false, "hidden");
      onGroupResized?.();
      return;
    }
    let items = Array.from(buttonsEl.querySelectorAll<HTMLElement>(".ribbon-item"))
      .filter(item => !item.parentElement.closest(".ribbon-item"));
    let fixedItems = items.filter(item => item.classList.contains("fixed-width"));
    if (fixedItems.some(item => !item.offsetWidth)) {
      return;
    }
    let infos: RibbonItemInfo[] = items.map(item => ({
      size: item.dataset.size == "small" ? "small" : "large",
      fixedWidth: fixedItems.includes(item) ? item.offsetWidth : 0,
    }));
    let currentLayout: RibbonLayout = layout;
    if (labelTextEl) {
      let text = document.createRange();
      text.selectNodeContents(labelTextEl);
      labelWidth = Math.ceil(text.getBoundingClientRect().width);
    }
    let minWidth = currentLayout == "classic" ? labelWidth : 0;
    let itemsKey = [currentLayout, label, ...items.map(item => item.querySelector(".label")?.textContent ?? "")].join("\n");
    let renderedStage = Number(buttonsEl.dataset.stage);
    if (isRendered && !collapsed && renderedStage == stage) {
      let width = Math.max(Math.ceil(buttonsEl.getBoundingClientRect().width), minWidth) + $metrics.groupChrome;
      setRenderedWidth(renderedStage, width, itemsKey);
    }
    setStageWidths(computeStageWidths(currentLayout, infos, $metrics, minWidth), currentLayout == "simplified", itemsKey);
    onGroupResized?.();
  }

  let renderedWidths: number[] = [];
  let measuredItemsKey = "";
  function setStageWidths(widths: number[], hasOverflowStage: boolean, itemsKey: string) {
    forgetRenderedWidths(itemsKey);
    widths = widths.map((width, widthStage) => Math.max(width, renderedWidths[widthStage] ?? 0));
    group.stageWidths = widths.length ? widths : [0];
    group.hasOverflowStage = hasOverflowStage;
  }

  function setRenderedWidth(renderedStage: number, width: number, itemsKey: string) {
    forgetRenderedWidths(itemsKey);
    renderedWidths[renderedStage] = width;
  }

  function forgetRenderedWidths(itemsKey: string) {
    if (itemsKey != measuredItemsKey) {
      measuredItemsKey = itemsKey;
      renderedWidths = [];
    }
  }

  function setStage(newStage: number) {
    stage = newStage;
    collapsed = newStage > 0 && newStage == group.stageWidths.length - 1;
  }

  $: placeBody(isInMoreMenu);
  function placeBody(inMoreMenu: boolean) {
    if (!inMoreMenu && bodyEl && bodyEl.parentElement != homeEl) {
      homeEl.appendChild(bodyEl);
    }
  }

  $: if (!collapsed) {
    isPopupOpen = false;
  }

  function onTogglePopup() {
    if (isPopupOpen) {
      closePopup();
      return;
    }
    let anchor = collapsedButtonEl.getBoundingClientRect();
    let left = Math.max(4, Math.min(anchor.left, window.innerWidth - buttonsEl.offsetWidth - 8));
    popupStyle = `left: ${left}px; top: ${anchor.bottom + 4}px;`;
    isPopupOpen = true;
  }

  function closePopup() {
    isPopupOpen = false;
  }

  function onClickInside(event: MouseEvent) {
    if (!collapsed || (!isPopupOpen && !isInMoreMenu)) {
      return;
    }
    let target = event.target as HTMLElement;
    if (target.closest(".menu-trigger") || !target.closest("button")) {
      return;
    }
    closePopup();
    onMoreMenuClose?.();
  }

  function onClickOutside(event: MouseEvent) {
    if (!isPopupOpen || groupEl?.contains(event.target as Node)) {
      return;
    }
    closePopup();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (isPopupOpen && event.key == "Escape") {
      closePopup();
      collapsedButtonEl?.focus();
    }
  }

  async function onLauncherClicked() {
    try {
      await onLauncher?.();
    } catch (ex) {
      showError(ex);
    }
  }
</script>

<style>
  .ribbon-group {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    padding: 0 var(--lo-ribbon-group-padding);
  }
  .ribbon-group.hidden-by-user {
    display: none;
  }

  .ribbon-group.in-more-menu {
    display: none;
  }
  .ribbon-group:not(:last-child)::after {
    content: "";
    position: absolute;
    inset-inline-end: 0;
    top: 6px;
    bottom: 6px;
    width: 1px;
    background-color: var(--lo-divider);
  }
  .body-home {
    display: flex;
    flex: 1 0 auto;
  }
  .group-body {
    display: flex;
    flex-direction: column;
  }
  .more-menu-label {
    display: none;
  }
  .group-buttons {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(3, var(--lo-ribbon-row-height));
    grid-auto-columns: max-content;
    align-items: center;
    justify-items: stretch;
    column-gap: var(--lo-ribbon-gap);
    width: max-content;
  }
  .ribbon-group.simplified .group-buttons {
    grid-template-rows: var(--lo-ribbon-button-height);
  }
  .group-buttons :global(.ribbon-item.look-large) {
    grid-row: span 3;
    align-self: start;
  }
  .group-buttons :global(.ribbon-item.fixed-width) {
    justify-self: start;
  }
  .group-buttons.popup {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 30;
    visibility: hidden;
    padding: 4px;
    background-color: var(--lo-ribbon-bg);
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius);
    box-shadow: var(--lo-shadow-popup);
  }
  .group-buttons.popup.open {
    visibility: visible;
  }
  .group-label {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 0;
    min-width: 100%;
    height: 18px;
    font-size: 11px;
    line-height: 18px;
    color: var(--lo-fg-secondary);
  }
  .group-label-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .launcher {
    position: absolute;
    inset-inline-end: -2px;
    top: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    padding: 0;
    border: none;
    border-radius: 2px;
    background: none;
    color: var(--lo-fg-secondary);
  }
  .launcher:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  .ribbon-group.simplified .group-label {
    display: none;
  }

  :global(.ribbon-more-menu) .group-body {
    width: 100%;
  }
  :global(.ribbon-more-menu) .more-menu-label {
    display: block;
    padding: 6px 8px 2px 8px;
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
    font-weight: 600;
  }
  :global(.ribbon-more-menu) .group-buttons {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: auto;
    gap: 0;
  }
</style>
