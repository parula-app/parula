<button class="ribbon-button look-{look} part-{part} {classes}"
  class:ribbon-item={isItem}
  class:pressed
  class:disabled={isDisabled}
  class:has-menu={hasMenu}
  data-size={isItem ? size : undefined}
  disabled={isDisabled}
  title={tooltipCalc}
  aria-label={ariaLabel ?? label}
  aria-pressed={toggle ? pressed : undefined}
  aria-haspopup={hasMenu ? "menu" : undefined}
  aria-expanded={hasMenu ? pressed : undefined}
  bind:this={buttonEl}
  on:click={myOnClick}
  >
  <span class="icon">
    {#if loading}
      <span class="loading"><LoadingIcon /></span>
    {:else if icon}
      <svelte:component this={icon} />
    {/if}
  </span>
  <span class="label">
    <span class="text">{firstLine}{#if secondLine || hasMenu}<br class="large-line-break" />{/if}{secondStart}{#if hasMenu}<span class="last-word">{lastWord}<span class="chevron large-chevron"><ChevronDownIcon size="12" /></span></span>{:else}{lastWord}{/if}</span>
  </span>
  {#if hasMenu}
    <span class="chevron line-chevron"><ChevronDownIcon size="12" /></span>
  {/if}
</button>

<script lang="ts">
  import { itemLook, largeLabelLines, type RibbonGroupLook, type RibbonItemLook, type RibbonItemSize } from "./RibbonGroup";
  import { showError } from "../../../frontend/Util/error";
  import LoadingIcon from "lucide-svelte/icons/loader-circle";
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
  import { getContext } from "svelte";
  import { readable, type Readable } from "svelte/store";
  import { t } from "../../../l10n/l10n";

  export let label: string;
  export let shortLabel: string = null;
  export let icon: ConstructorOfATypedSvelteComponent = null;
  export let tooltip: string = null;
  export let shortCutInfo: string = null;
  export let disabled: boolean | string = false;
  export let pressed = false;
  export let toggle = false;
  export let hasMenu = false;
  export let size: RibbonItemSize = "large";
  export let fixedLook: RibbonItemLook = null;
  export let part: "whole" | "main" | "arrow" = "whole";
  export let isItem = !getContext<boolean>("ribbonButtonRow");
  export let ariaLabel: string = null;
  export let classes = "";
  export let onClick: (event: Event) => void | Promise<void> = null;
  export let errorCallback = showError;
  export let buttonEl: HTMLButtonElement = null;
  export let loadDelayMS = 500;

  const groupLook = getContext<Readable<RibbonGroupLook>>("ribbonGroupLook") ?? readable<RibbonGroupLook>({ layout: "classic", stage: 0, collapsed: false });
  const isInButtonRow = !!getContext<boolean>("ribbonButtonRow");
  if (part != "arrow") {
    getContext<(itemIcon: ConstructorOfATypedSvelteComponent) => void>("onRibbonItemIcon")?.(icon);
  }
  let look: RibbonItemLook;
  $: look = fixedLook ?? (isInButtonRow
    ? buttonRowLook($groupLook)
    : itemLook($groupLook.layout, $groupLook.stage, $groupLook.collapsed, size));

  // <copied to="RibbonButtonRow.svelte">
  function buttonRowLook(group: RibbonGroupLook): RibbonItemLook {
    if (group.layout == "simplified") {
      return group.collapsed ? "list" : "simplified-icon";
    }
    return "small-icon";
  }
  // </copied>

  $: shownLabel = shortLabel && (look == "simplified" || look == "simplified-icon") ? shortLabel : label;
  // Chrome breaks lines before the chevron icon even after a word joiner, so the last word and the chevron get a nowrap box.
  // Chrome also never breaks after a slash, so "Send/Receive" gets a zero-width space there.
  $: wrappingLabel = shownLabel?.replace(/\/(?=\S)/g, "/​") ?? "";
  $: [firstLine, secondLine] = largeLabelLines(wrappingLabel, hasMenu);
  $: lastBreak = secondLine.lastIndexOf(" ");
  $: secondStart = (secondLine ? " " : "") + secondLine.slice(0, lastBreak + 1);
  $: lastWord = secondLine.slice(lastBreak + 1);

  /* <copied from="../../../frontend/Shared/Button.svelte"> */
  $: tooltipCalc = typeof(disabled) == "string"
    ? disabled
    : tooltip
      ? tooltip
      : label
        ? label +
          (shortCutInfo
            ? "\n\n" + $t`Shortcut: ${shortCutInfo}`
            : "")
        : null;

  let loading = false;
  let running = false;
  $: isDisabled = !!disabled || running;
  async function myOnClick(event: Event) {
    if (!(onClick && typeof(onClick) == "function")) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    running = true;
    let loadTimeout = setTimeout(() => {
      loading = true;
    }, loadDelayMS);
    try {
      await onClick(event);
    } catch (ex) {
      errorCallback(ex);
    } finally {
      clearTimeout(loadTimeout);
      loading = false;
      running = false;
    }
  }
  /* </copied> */
</script>

<style>
  .ribbon-button {
    display: flex;
    flex-direction: row;
    align-items: center;
    box-sizing: border-box;
    flex: 0 0 auto;
    min-width: 0;
    margin: 0;
    padding: 0 4px;
    gap: 4px;
    border: 1px solid transparent;
    border-radius: var(--lo-radius-small);
    background-color: transparent;
    color: var(--lo-fg);
    font-family: inherit;
    font-size: var(--lo-font-size-small);
    line-height: 15px;
    text-align: start;
    white-space: nowrap;
    cursor: default;
  }
  .ribbon-button:hover:not(.disabled) {
    background-color: var(--lo-hover-bg);
  }
  .ribbon-button:active:not(.disabled) {
    background-color: var(--lo-pressed-bg);
  }
  .ribbon-button.pressed:not(.disabled) {
    background-color: var(--lo-selected-bg);
    border-color: var(--lo-selected-hover-bg);
  }
  .ribbon-button.pressed:hover:not(.disabled) {
    background-color: var(--lo-selected-hover-bg);
  }
  .ribbon-button.disabled {
    color: var(--lo-fg-disabled);
  }
  .ribbon-button:focus-visible {
    outline: 2px solid var(--lo-focus-ring);
    outline-offset: -2px;
  }
  .icon {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--lo-ribbon-icon-color, var(--lo-accent-text));
  }
  .disabled .icon {
    color: var(--lo-fg-disabled);
  }
  .icon :global(svg) {
    width: 100%;
    height: 100%;
    stroke-width: 1.75;
  }
  .loading {
    display: flex;
    width: 100%;
    height: 100%;
    animation: lo-ribbon-spin 1s linear infinite;
  }
  @keyframes lo-ribbon-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .last-word {
    white-space: nowrap;
  }
  .chevron {
    display: inline-flex;
    flex: 0 0 auto;
    vertical-align: middle;
    color: var(--lo-fg-secondary);
  }
  .large-chevron,
  .large-line-break {
    display: none;
  }

  .look-large {
    flex-direction: column;
    justify-content: flex-start;
    width: var(--lo-ribbon-large-width);
    height: var(--lo-ribbon-large-height);
    padding: 5px 2px 0 2px;
    gap: 0;
    text-align: center;
    white-space: normal;
  }
  .look-large .icon {
    width: 26px;
    height: 26px;
  }
  .look-large .icon :global(svg) {
    stroke-width: 1.5;
  }
  .look-large .label {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    flex: 0 0 auto;
    max-width: 100%;
    margin-block-start: 3px;
  }
  .look-large .large-chevron {
    display: inline-flex;
    margin-inline-start: 1px;
  }
  .look-large .large-line-break {
    display: inline;
  }
  .look-large .line-chevron {
    display: none;
  }

  .look-small {
    width: 100%;
    min-width: var(--lo-ribbon-small-width);
    height: var(--lo-ribbon-row-height);
  }
  .look-small-icon {
    justify-content: center;
    width: var(--lo-ribbon-small-icon-width);
    height: var(--lo-ribbon-row-height);
    gap: 1px;
  }

  .look-simplified,
  .look-simplified-icon,
  .look-list {
    height: var(--lo-ribbon-button-height);
    padding: 0 8px;
    gap: 6px;
    font-size: 13px;
  }
  .look-simplified {
    width: var(--lo-ribbon-simplified-width);
  }
  .look-simplified-icon {
    justify-content: center;
    width: var(--lo-ribbon-simplified-icon-width);
    padding: 0;
    gap: 1px;
  }
  .look-list {
    width: 100%;
  }
  .look-simplified .icon,
  .look-simplified-icon .icon,
  .look-list .icon {
    width: 18px;
    height: 18px;
  }
  .look-list .label {
    overflow: visible;
  }

  .look-small-icon .label,
  .look-simplified-icon .label {
    display: none;
  }

  .part-main,
  .part-arrow {
    width: auto;
    min-width: 0;
  }
  .part-main:not(.look-large) {
    flex: 1 1 auto;
  }
  .part-main.look-small-icon,
  .part-main.look-simplified-icon {
    flex: 1 1 auto;
    padding: 0;
  }
  .part-arrow:not(.look-large) {
    justify-content: center;
    padding: 0;
  }
  .part-arrow:not(.look-large) .icon,
  .part-arrow:not(.look-large) .label {
    display: none;
  }
  .part-arrow.look-small,
  .part-arrow.look-small-icon {
    width: 16px;
  }
  .part-arrow.look-simplified,
  .part-arrow.look-simplified-icon {
    width: 20px;
  }
  .part-arrow.look-list {
    width: 28px;
  }
  .part-main.look-large {
    width: 100%;
    height: 38px;
    padding-top: 5px;
    border-end-start-radius: 0;
    border-end-end-radius: 0;
  }
  .part-main.look-large .label {
    display: none;
  }
  .part-arrow.look-large {
    width: 100%;
    height: calc(var(--lo-ribbon-large-height) - 38px);
    padding-top: 0;
    border-start-start-radius: 0;
    border-start-end-radius: 0;
  }
  .part-arrow.look-large .icon {
    display: none;
  }
  .part-arrow.look-large .label {
    margin-block-start: 0;
  }
</style>
