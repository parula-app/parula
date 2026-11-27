<div class="addon-frame" class:fill={!maxHeight} bind:this={containerE} bind:contentRect={containerRect}
  style:height={maxHeight ? Math.min($frame?.contentHeight ?? 0, maxHeight) + "px" : null}
  style:--frame-width={containerRect ? wholeDevicePixels(containerRect.width) + "px" : null}>
</div>

<script lang="ts">
  import type { Addon } from "../../logic/Addons/Addon";
  import type { AddonSandbox } from "../../logic/Addons/AddonSandbox";
  import type { AppFonts, SandboxFrame } from "../../logic/Addons/Sandbox/SandboxFrame";
  import type { AddonGroup } from "../../logic/Addons/API/addon";
  import { catchErrors } from "../Util/error";
  import { onDestroy } from "svelte";

  /** Shows a UI module of an addon, isolated in a sandboxed frame, but looking like a part of the app.
   * The frame starts when this component shows, and stays when `context` changes. */

  export let addon: Addon;
  /** Path of the addon's UI module in its package */
  export let entry: string;
  /** App objects for `mustang.ui.context` of the addon, e.g. `{ message }`.
   * When it changes, the addon can no longer use the previous objects. */
  export let context: Record<string, object> = {};
  /** What the addon may do with the objects in `context` */
  export let groups: AddonGroup[] = [];
  /** Grows with the content of the addon up to this height in px, then scrolls. 0 = fills the parent. */
  export let maxHeight = 400;
  /** The user pressed Escape in the frame */
  export let onEscape: () => void = () => {};

  export let frame: SandboxFrame | null = null;

  let containerE: HTMLDivElement;
  let containerRect: DOMRectReadOnly;
  let frameSandbox: AddonSandbox | null = null;
  let sentContext: Record<string, object> | null = null;
  let sentGroups: AddonGroup[] | null = null;

  $: sandbox = $addon.sandbox;
  $: containerE && sandbox != frameSandbox && catchErrors(openFrame);
  $: frame && catchErrors(() => sendContext(context, groups));

  async function openFrame() {
    closeFrame();
    frameSandbox = sandbox;
    if (!sandbox) {
      return;
    }
    let opening = sandbox;
    // Loaded only when needed, because they are big
    let { appFonts } = await import("./AddonFonts");
    if (frameSandbox != opening) {
      return;
    }
    let opened = await opening.openUIFrame(containerE, entry, newFrame => {
      newFrame.onEscape = () => onEscape();
      sendTheme(newFrame, appFonts);
      sendContext(context, groups, newFrame);
    });
    if (frameSandbox != opening) {
      opening.closeUIFrame(opened);
      return;
    }
    frame = opened;
  }

  function closeFrame() {
    if (frame) {
      frameSandbox?.closeUIFrame(frame);
    }
    frame = null;
    sentContext = null;
    sentGroups = null;
  }

  function sendContext(context: Record<string, object>, groups: AddonGroup[], target = frame) {
    if (context == sentContext && groups == sentGroups) {
      return;
    }
    target.setContext(context, groups);
    sentContext = context;
    sentGroups = groups;
  }

  const darkMode = window.matchMedia("(prefers-color-scheme: dark)");
  function onThemeChange() {
    if (frame) {
      sendTheme(frame);
    }
  }
  darkMode.addEventListener("change", onThemeChange);

  /** The app's CSS variables and fonts, so that the addon looks like the app
   * @param fonts Only once per frame */
  function sendTheme(target: SandboxFrame, fonts?: AppFonts) {
    let style = getComputedStyle(containerE);
    let properties: [string, string][] = [];
    for (let name of style) {
      if (name.startsWith("--")) {
        properties.push([name, style.getPropertyValue(name)]);
      }
    }
    for (let name of ["font-family", "font-size", "line-height", "color"]) {
      properties.push([name, style.getPropertyValue(name)]);
    }
    target.setTheme(properties, style.colorScheme, darkMode.matches, fonts);
  }

  /** The browser rounds the frame width for the content, but clips at the rounded edges, which can cut off 1px of the content */
  function wholeDevicePixels(cssPixels: number): number {
    return Math.floor(cssPixels * devicePixelRatio) / devicePixelRatio;
  }

  onDestroy(() => {
    darkMode.removeEventListener("change", onThemeChange);
    closeFrame();
    frameSandbox = null;
  });
</script>

<style>
  .addon-frame {
    width: 100%;
    overflow: hidden;
  }
  .addon-frame.fill {
    height: 100%;
  }
  .addon-frame :global(iframe) {
    display: block;
    width: var(--frame-width, 100%);
    height: 100%;
    border: none;
    background: transparent;
  }
</style>
