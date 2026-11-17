{#if hasTop && hasBottom}
  <vbox class="splitter" bind:clientHeight={containerHeight} class:mobile={appGlobal.isMobile}>
    <hbox class="top" bind:clientHeight={currentTopHeight}
      style="min-height: {topMinWidth}px;">
      <ErrorBoundary>
        <slot name="top" />
      </ErrorBoundary>
    </hbox>
    <hbox
      class="splitter-bar"
      on:pointerdown={onMouseDown}
      style="height: {barHeight}px;"
      />
    <hbox class="bottom" style="flex: {bottomRatio} 0 0; min-height: {bottomMinWidth}px;">
      <ErrorBoundary>
        <slot name="bottom" />
      </ErrorBoundary>
    </hbox>
  </vbox>
{:else if hasTop}
  <ErrorBoundary>
    <slot name="top" />
  </ErrorBoundary>
{:else if hasBottom}
  <ErrorBoundary>
    <slot name="bottom" />
  </ErrorBoundary>
{:else}
  <vbox class="splitter" />
{/if}

<AppWindowEvents
  on:pointermove={onMouseMove}
  on:pointerup={onMouseUp}
  />

<script lang="ts">
  import { sanitize } from "../../../lib/util/sanitizeDatatypes";
  import { appGlobal } from "../../logic/app";
  import ErrorBoundary from "./ErrorBoundary.svelte";
  import AppWindowEvents from "../MainWindow/AppWindowEvents.svelte";

  /** Copy of <Splitter> */

  /** Left pane cannot be made smaller than this
   * in px */
  export let topMinWidth = 30;
  /** Right pane cannot be made smaller than this
   * in px */
  export let bottomMinWidth = 30;
  /** Initial size of right pane compared to left pane */
  export let initialBottomRatio = 1;
  /** If false, will hide the top part and remove the splitter */
  export let hasTop = true;
  /** If false, will hide the bottom part and remove the splitter */
  export let hasBottom = true;
  /** If set, will save the ratio in localStorage as preference and restore it */
  export let name: string = null;

	const barHeight = appGlobal.isMobile ? 6 : 2;
	let bottomRatio = JSON.parse(sanitize.nonemptystring(localStorage?.getItem("ui.splitter." + name), null)) ?? initialBottomRatio;

  let isMouseDown = false;
  let previousMousePosY: number;
  let mouseMoveY: number;
  let containerHeight: number;
  let currentTopHeight: number;
  let previousTopHeight: number;

  function onMouseMove(event: PointerEvent) {
    if (!isMouseDown) {
      return;
    }
    let availableHeight = containerHeight - barHeight;
    mouseMoveY = previousMousePosY - event.clientY;
    let newLeftWidth = Math.max(
      Math.min(
        previousTopHeight - mouseMoveY,
        availableHeight - bottomMinWidth),
      topMinWidth);
    let newBottomWidth = availableHeight - newLeftWidth;
    let bottom = newBottomWidth / availableHeight;
    let top = newLeftWidth / availableHeight;
    // const topRatio = 1, so that we have to save only 1 value
    bottomRatio = bottom / top;

    if (name) {
      localStorage.setItem("ui.splitter." + name, JSON.stringify(bottomRatio));
    }
  }

  function onMouseDown(event: PointerEvent){
    previousTopHeight = currentTopHeight;
    previousMousePosY = event.clientY;
    isMouseDown = true;
  }

  function onMouseUp() {
    isMouseDown = false;
  }
</script>

<style>
  .splitter {
    height: 100%;
  }

  .splitter-bar {
    cursor: row-resize;
    z-index: 100;
  }
	.mobile .splitter-bar {
		background-color: var(--headerbar-bg);
	}
  .splitter-bar:hover {
    background-color: var(--hover-bg);
  }

  .top {
    flex: 1 0 0; /* by definition, see topRatio above */
  }

  .top :global(> *:first-child),
  .bottom :global(> *:first-child) {
    flex: 1 0 0;
  }

  .top,
  .bottom {
    overflow-y: clip;
  }
</style>
