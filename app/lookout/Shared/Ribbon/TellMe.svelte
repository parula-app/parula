<hbox class="tell-me" class:expanded={isExpanded} class:active={isActive} bind:this={fieldEl}>
  <button class="tell-me-button" bind:this={buttonEl}
    title={$t`Tell me what you want to do`}
    aria-label={$t`Tell me what you want to do`}
    aria-expanded={isExpanded}
    on:click={onButton}>
    <TellMeIcon size={16} />
  </button>
  {#if isExpanded}
    <input type="text" class="tell-me-input"
      bind:value={searchTerm}
      bind:this={inputEl}
      placeholder={$t`Tell me what you want to do`}
      aria-label={$t`Tell me what you want to do`}
      aria-haspopup="menu"
      aria-expanded={isMenuOpen}
      autocomplete="off" spellcheck="false"
      on:focus={onFocus}
      on:blur={onBlur}
      on:input={onInput}
      on:keydown={onKeyDown} />
  {/if}
</hbox>
<Menu bind:isMenuOpen anchor={fieldEl} placement="bottom-start" autoFocus={false}
  on:close={onMenuClosed} bind:this={menu}>
  <MenuLabel label={$t`Actions`} />
  {#each results as result (result)}
    <MenuItem label={result.label} disabled={result.disabled}
      tooltip={result.tooltip}
      onClick={() => run(result)}>
      <svelte:fragment slot="icon">
        {#if result.iconHTML}
          <span class="result-icon">{@html result.iconHTML}</span>
        {/if}
      </svelte:fragment>
      <svelte:fragment slot="label">
        <span class="result-label">{result.label}</span>
        <span class="result-place">{result.tabLabel}{result.groupLabel ? " › " + result.groupLabel : ""}</span>
      </svelte:fragment>
    </MenuItem>
  {:else}
    <MenuItem label={$t`No matching commands`} disabled />
  {/each}
</Menu>
<AppWindowEvents on:keydown={onKeyOnWindow} />

<script lang="ts">
  import { searchRibbonCommands, type RibbonCommandEntry } from "./RibbonCommands";
  import Menu from "../Menu/Menu.svelte";
  import MenuItem from "../Menu/MenuItem.svelte";
  import MenuLabel from "../Menu/MenuLabel.svelte";
  import TellMeIcon from "lucide-svelte/icons/lightbulb";
  import { AppWindow } from "../../../frontend/MainWindow/AppWindow";
  import AppWindowEvents from "../../../frontend/MainWindow/AppWindowEvents.svelte";
  import { getOSName } from "../../../frontend/Util/util";
  import { tick } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let ribbonEl: HTMLElement;

  const appWindow = AppWindow.current();

  let fieldEl: HTMLElement;
  let buttonEl: HTMLButtonElement;
  let inputEl: HTMLInputElement;
  let menu: Menu;
  let searchTerm = "";
  let isMenuOpen = false;
  let isExpanded = false;
  let isActive = false;
  export let isSurveying = false;
  let entries: RibbonCommandEntry[] = [];
  let results: RibbonCommandEntry[] = [];

  async function startSurvey() {
    if (!isSurveying) {
      isSurveying = true;
    }
    await tick();
    entries = collect(ribbonEl);
  }

  function endSurvey() {
    if (isSurveying) {
      isSurveying = false;
    }
  }

  async function onButton() {
    isExpanded = true;
    await tick();
    inputEl?.focus();
  }

  function onKeyOnWindow(event: KeyboardEvent) {
    // <copied from="../../MainWindow/MainWindow.svelte">
    let target = event.target as HTMLElement;
    if (event.defaultPrevented || event.cancelBubble || appWindow.window.document.querySelector("dialog:modal") ||
        target?.closest?.("[contenteditable]:not([contenteditable='false'])")) {
      return;
    }
    // </copied>
    // Option+Q types a character on macOS
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.code == "KeyQ" &&
        getOSName() != "macintosh" && buttonEl?.getClientRects().length) {
      event.preventDefault();
      event.stopPropagation();
      buttonEl.click();
    }
  }

  async function onFocus() {
    isActive = true;
    await startSurvey();
    updateResults();
  }

  function onBlur(event: FocusEvent) {
    let target = event.relatedTarget as Node;
    if (target && appWindow.window.document.querySelector(".lo-menu")?.contains(target)) {
      return;
    }
    if (!isMenuOpen) {
      close();
    }
  }

  async function onInput() {
    if (!isSurveying) {
      await startSurvey();
    }
    updateResults();
  }

  function updateResults() {
    results = searchRibbonCommands(entries, searchTerm);
    isMenuOpen = !!searchTerm.trim();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key == "Escape") {
      event.preventDefault();
      event.stopPropagation();
      searchTerm = "";
      inputEl.blur();
      close();
    } else if (event.key == "ArrowDown" && isMenuOpen) {
      event.preventDefault();
      menu?.focusFirstItem();
    } else if (event.key == "Enter") {
      event.preventDefault();
      let first = results.find(result => !result.disabled);
      if (first) {
        run(first);
      }
    }
  }

  function onMenuClosed() {
    if (appWindow.window.document.activeElement != inputEl) {
      close();
    }
  }

  function close() {
    isMenuOpen = false;
    isActive = false;
    endSurvey();
    if (appWindow.window.document.activeElement != inputEl) {
      searchTerm = "";
      isExpanded = false;
    }
  }

  async function run(entry: RibbonCommandEntry) {
    isMenuOpen = false;
    searchTerm = "";
    let tabEl = Array.from(ribbonEl.querySelectorAll<HTMLElement>(".tabs [role=tab]"))
      .find(candidate => candidate.textContent.trim() == entry.tabLabel);
    if (tabEl && tabEl.getAttribute("aria-selected") != "true") {
      tabEl.click();
    }
    await tick();
    close();
    await tick();
    let el = entry.el.isConnected ? entry.el : collect(ribbonEl)
      .find(candidate => candidate.tabLabel == entry.tabLabel && candidate.groupLabel == entry.groupLabel && candidate.label == entry.label)?.el;
    if (!el) {
      return;
    }
    let input = el.querySelector("input");
    if (el.classList.contains("ribbon-textbox")) {
      input?.focus();
    } else if (el.classList.contains("ribbon-checkbox")) {
      input?.click();
    } else {
      el.click();
    }
  }

  function collect(ribbonEl: HTMLElement): RibbonCommandEntry[] {
    const kItemSelector = "button.ribbon-button:not(.part-arrow):not(.group-collapsed-button):not(.more-button), button.launcher, .ribbon-textbox, .ribbon-checkbox";
    let entries: RibbonCommandEntry[] = [];
    let seen = new Set<string>();
    for (let content of Array.from(ribbonEl.querySelectorAll<HTMLElement>(".ribbon-tab-content"))) {
      let tabLabel = content.getAttribute("aria-label") ?? "";
      for (let el of Array.from(content.querySelectorAll<HTMLElement>(kItemSelector))) {
        let entry = commandEntry(el, tabLabel);
        let key = [entry.tabLabel, entry.groupLabel, entry.label].join("\n");
        if (!entry.label || seen.has(key)) {
          continue;
        }
        seen.add(key);
        entries.push(entry);
      }
    }
    return entries;
  }

  function commandEntry(el: HTMLElement, tabLabel: string): RibbonCommandEntry {
    let input = el.querySelector("input");
    let label = el.classList.contains("ribbon-textbox")
      ? input?.getAttribute("aria-label")
      : el.classList.contains("ribbon-checkbox")
        ? el.textContent
        : el.getAttribute("aria-label") || el.textContent;
    let groupEl = el.closest<HTMLElement>(".ribbon-group");
    return {
      label: (label ?? "").replace(/\s+/g, " ").trim(),
      tooltip: el.getAttribute("title") ?? "",
      tabLabel,
      groupLabel: groupEl?.getAttribute("aria-label") ?? "",
      iconHTML: el.querySelector(".icon svg")?.outerHTML ?? "",
      disabled: !!(el as HTMLButtonElement).disabled || !!input?.disabled,
      el,
    };
  }
</script>

<style>
  .tell-me {
    flex: 0 0 auto;
    align-items: center;
    gap: 2px;
    height: 28px;
    margin-inline-end: 4px;
    border: 1px solid transparent;
    border-radius: var(--lo-radius-small);
    color: var(--lo-fg-secondary);
  }
  .tell-me.expanded {
    flex: 0 1 240px;
    min-width: 120px;
    padding-inline-end: 8px;
    border-color: var(--lo-border);
  }
  .tell-me.active {
    border-color: var(--lo-border-strong);
    background-color: var(--lo-input-bg);
  }
  .tell-me-button {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .tell-me:not(.expanded) .tell-me-button:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  .tell-me-input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: none;
    outline: none;
    background: none;
    color: var(--lo-fg);
    font: inherit;
    font-size: var(--lo-font-size-small);
  }
  .tell-me-input::placeholder {
    color: var(--lo-fg-secondary);
  }
  .result-icon {
    display: flex;
    width: 16px;
    height: 16px;
  }
  .result-icon :global(svg) {
    width: 16px;
    height: 16px;
  }
  .result-label {
    margin-inline-end: 12px;
  }
  .result-place {
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
</style>
