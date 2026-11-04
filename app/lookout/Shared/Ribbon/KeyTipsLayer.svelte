{#if level}
  <div class="keytips-layer" aria-hidden="true">
    {#each badges as badge (badge)}
      {#if badge.tip.startsWith(typed)}
        <span class="keytip" class:disabled={badge.disabled}
          style="left: {badge.x}px; top: {badge.y}px;">{badge.tip}</span>
      {/if}
    {/each}
  </div>
{/if}
<svelte:window
  on:keydown|capture={onKeyDown}
  on:keyup|capture={onKeyUp}
  on:mousedown|capture={exit}
  on:blur={exit}
  on:resize={exit} />

<script lang="ts" context="module">
  const handledEvents = new WeakSet<Event>();
</script>

<script lang="ts">
  import { assignKeyTips, quickAccessKeyTip } from "./KeyTips";
  import { tick } from "svelte";

  export let ribbonEl: HTMLElement;

  interface Badge {
    tip: string;
    x: number;
    y: number;
    disabled: boolean;
    activate: () => void | Promise<void>;
  }

  interface Target {
    el: HTMLElement;
    label: string;
    disabled: boolean;
    activate: () => void | Promise<void>;
    centered: boolean;
  }

  let level: "tabs" | "commands" | null = null;
  let badges: Badge[] = [];
  let typed = "";
  let isAltPending = false;

  function isActiveRibbon(): boolean {
    return !!ribbonEl?.isConnected && ribbonEl.getClientRects().length > 0;
  }

  function isVisible(el: HTMLElement): boolean {
    if (!el.getClientRects().length) {
      return false;
    }
    let style = getComputedStyle(el);
    return style.visibility != "hidden" && style.display != "none";
  }

  function labelOf(el: HTMLElement): string {
    return el.getAttribute("aria-label") || el.textContent?.trim() || el.getAttribute("title") || "";
  }

  function badgesFor(targets: Target[], tips: string[]): Badge[] {
    return targets.map((target, i) => {
      let rect = target.el.getBoundingClientRect();
      let x = target.centered || rect.width < 40 ? rect.left + rect.width / 2 : rect.left + 12;
      let y = target.centered ? rect.bottom + 2 : rect.top + rect.height / 2 + 6;
      return { tip: tips[i], x, y, disabled: target.disabled, activate: target.activate };
    });
  }

  function clickTarget(el: HTMLElement, label: string, centered = true): Target {
    let button = el as HTMLButtonElement;
    return {
      el, label, centered,
      disabled: !!button.disabled,
      activate: () => {
        exit();
        el.click();
      },
    };
  }

  function showTabTips() {
    let quickAccess = Array.from(document.querySelectorAll<HTMLElement>("[data-keytip-qat]"))
      .filter(el => el.dataset.keytipQat != "customize" && isVisible(el));
    let fileTab = ribbonEl.querySelector<HTMLElement>(".file-tab");
    let tabs = Array.from(ribbonEl.querySelectorAll<HTMLElement>(".tabs [role=tab]")).filter(isVisible);
    let tabTargets: Target[] = tabs.map(tabEl => ({
      el: tabEl,
      label: labelOf(tabEl),
      centered: true,
      disabled: false,
      activate: () => selectTab(tabEl),
    }));
    let tellMe = ribbonEl.querySelector<HTMLElement>(".tell-me-button");
    let tellMeTargets: Target[] = tellMe && isVisible(tellMe) ? [{
      el: tellMe, label: labelOf(tellMe), centered: true, disabled: false,
      activate: () => {
        exit();
        tellMe.click();
      },
    }] : [];
    let tabTips = assignKeyTips(tabTargets.map(target => target.label), ["F", "Q"], true);
    badges = [
      ...badgesFor(quickAccess.map(el => clickTarget(el, labelOf(el))), quickAccess.map((_el, i) => quickAccessKeyTip(i))),
      ...(fileTab ? badgesFor([clickTarget(fileTab, labelOf(fileTab))], ["F"]) : []),
      ...badgesFor(tabTargets, tabTips),
      ...badgesFor(tellMeTargets, tellMeTargets.map(() => "Q")),
    ];
    typed = "";
    level = "tabs";
  }

  async function selectTab(tabEl: HTMLElement) {
    tabEl.click();
    await tick();
    await new Promise(resolve => requestAnimationFrame(resolve));
    showCommandTips();
  }

  function commandTargets(): Target[] {
    let content = ribbonEl.querySelector<HTMLElement>(".ribbon-content");
    if (!content) {
      return [];
    }
    let elements = Array.from(content.querySelectorAll<HTMLElement>(
      "button.ribbon-button:not(.part-arrow), button.launcher, .ribbon-textbox, .ribbon-checkbox"))
      .filter(isVisible);
    return elements.map(el => {
      if (el.classList.contains("ribbon-textbox")) {
        let input = el.querySelector("input");
        return {
          el, label: input?.getAttribute("aria-label") ?? "", centered: false,
          disabled: !!input?.disabled,
          activate: () => {
            exit();
            input?.focus();
          },
        };
      }
      if (el.classList.contains("ribbon-checkbox")) {
        let input = el.querySelector("input");
        return {
          el, label: el.textContent?.trim() ?? "", centered: false,
          disabled: !!input?.disabled,
          activate: () => {
            exit();
            input?.click();
          },
        };
      }
      let isLarge = el.classList.contains("look-large");
      return clickTarget(el, labelOf(el), isLarge);
    });
  }

  function showCommandTips() {
    let targets = commandTargets();
    if (!targets.length) {
      exit();
      return;
    }
    badges = badgesFor(targets, assignKeyTips(targets.map(target => target.label)));
    typed = "";
    level = "commands";
  }

  function exit() {
    level = null;
    badges = [];
    typed = "";
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key == "Alt") {
      isAltPending = !event.ctrlKey && !event.metaKey && !event.shiftKey;
      return;
    }
    isAltPending = false;
    if (!level) {
      if (event.key == "F10" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey &&
          isActiveRibbon() && !handledEvents.has(event)) {
        handledEvents.add(event);
        event.preventDefault();
        showTabTips();
      }
      return;
    }
    if (handledEvents.has(event)) {
      return;
    }
    handledEvents.add(event);
    if (event.key == "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (level == "commands") {
        showTabTips();
      } else {
        exit();
      }
      return;
    }
    if (event.key == "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      typed = typed.slice(0, -1);
      return;
    }
    if (event.key.length != 1 || event.ctrlKey || event.metaKey) {
      exit();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onTyped(event.key.toUpperCase());
  }

  function onTyped(char: string) {
    let candidate = typed + char;
    let tips = badges.map(badge => badge.tip);
    let matches = tips.map((tip, i) => tip.startsWith(candidate) ? i : -1).filter(i => i >= 0);
    if (!matches.length) {
      return;
    }
    typed = candidate;
    let exact = matches.find(i => tips[i] == candidate);
    if (exact == null) {
      return;
    }
    let badge = badges[exact];
    if (badge.disabled) {
      typed = "";
      return;
    }
    badge.activate();
  }

  function onKeyUp(event: KeyboardEvent) {
    if (event.key != "Alt" || !isAltPending) {
      return;
    }
    isAltPending = false;
    if (handledEvents.has(event) || (!level && !isActiveRibbon())) {
      return;
    }
    handledEvents.add(event);
    event.preventDefault();
    if (level) {
      exit();
    } else {
      showTabTips();
    }
  }
</script>

<style>
  .keytips-layer {
    position: fixed;
    inset: 0;
    z-index: 1000;
    pointer-events: none;
  }
  .keytip {
    position: absolute;
    box-sizing: border-box;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    transform: translate(-50%, -50%);
    border: 1px solid var(--lo-keytip-border);
    border-radius: 3px;
    background-color: var(--lo-keytip-bg);
    color: var(--lo-keytip-fg);
    box-shadow: var(--lo-shadow-card);
    font-size: 11px;
    font-weight: 600;
    line-height: 16px;
    text-align: center;
    white-space: nowrap;
  }
  .keytip.disabled {
    opacity: 0.5;
  }
</style>
