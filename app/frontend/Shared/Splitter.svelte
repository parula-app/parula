{#if hasLeft && hasRight}
  <hbox class="splitter" bind:clientWidth={containerWidth}
    class:mobile={appGlobal.isMobile}>
    <hbox class="left" bind:clientWidth={currentLeftWidth}
      style="min-width: {leftMinWidth}px;">
      <ErrorBoundary>
        <slot name="left" />
      </ErrorBoundary>
    </hbox>
    <hbox class="splitter-bar"
      on:pointerdown={onMouseDown}
      style="width: {barWidth}px;"
      />
    <hbox class="right" style={
      rightFixedWidth
      ? `width: ${rightFixedWidth}px;`
      : `flex: ${rightRatio} 0 0; min-width: ${rightMinWidth}px;`
      }>
      <ErrorBoundary>
        <slot name="right" />
      </ErrorBoundary>
    </hbox>
  </hbox>
{:else if hasLeft}
  <ErrorBoundary>
    <slot name="left" />
  </ErrorBoundary>
{:else if hasRight}
  <ErrorBoundary>
    <slot name="right" />
  </ErrorBoundary>
{:else}
  <vbox class="splitter" />
{/if}

<AppWindowEvents
  on:pointermove={onMouseMove}
  on:pointerup={onMouseUp}
  />

<script lang="ts">
	import { appGlobal } from "../../logic/app";
  import { sanitize } from "../../../lib/util/sanitizeDatatypes";
  import ErrorBoundary from "./ErrorBoundary.svelte";
  import AppWindowEvents from "../MainWindow/AppWindowEvents.svelte";

  /** Left pane cannot be made smaller than this
   * in px */
  export let leftMinWidth = 30;
  /** Right pane cannot be made smaller than this
   * in px */
  export let rightMinWidth = 30;
  /** Initial size of right pane compared to left pane */
  export let initialRightRatio = 1;
  /** If false, will hide the left part and remove the splitter */
  export let hasLeft = true;
  /** If false, will hide the right part and remove the splitter */
  export let hasRight = true;
  /** Override right width
   * Make the right bar exactly this width, not changable
   * null = normal mode */
  export let rightFixedWidth: number | null = null;
  /** If set, will save the ratio in localStorage as preference and restore it */
  export let name: string = null;

	const barWidth = appGlobal.isMobile ? 6 : 2;
  let rightRatio = JSON.parse(sanitize.nonemptystring(localStorage?.getItem("ui.splitter." + name), null)) ?? initialRightRatio;

  let isMouseDown = false;
  let previousMousePosX: number;
  let mouseMoveX: number;
  let containerWidth: number;
  let currentLeftWidth: number;
  let previousLeftWidth: number;

  function onMouseMove(event: PointerEvent) {
    if (!isMouseDown) {
      return;
    }
    let availableWidth = containerWidth - barWidth;
    mouseMoveX = previousMousePosX - event.clientX;
    let newLeftWidth = Math.max(
      Math.min(
        previousLeftWidth - mouseMoveX,
        availableWidth - rightMinWidth),
      leftMinWidth);
    let newRightWidth = availableWidth - newLeftWidth;
    let right = newRightWidth / availableWidth;
    let left = newLeftWidth / availableWidth;
    // const leftRatio = 1, so that we have to save only 1 value
    rightRatio = right / left;

    if (name) {
      localStorage.setItem("ui.splitter." + name, JSON.stringify(rightRatio));
    }
  }

  function onMouseDown(event: PointerEvent){
    if (rightFixedWidth) {
      return;
    }
    previousLeftWidth = currentLeftWidth;
    previousMousePosX = event.clientX;
    isMouseDown = true;
  }

  function onMouseUp() {
    isMouseDown = false;
  }

  /** Copied to <SplitterHorizontal> */
</script>

<style>
  .splitter {
    height: 100%;
    flex: 1 0 0;
  }

  .splitter-bar {
    cursor: col-resize;
    z-index: 100;
    /*background: linear-gradient(
      to bottom,
      transparent 48%,
      var(--border) 48%,
      var(--border) 52%,
      transparent 52%
    );*/
  }
	.mobile .splitter-bar {
		background-color: var(--headerbar-bg);
	}
  .splitter-bar:hover {
    background-color: var(--hover-bg);
  }

  .left {
    flex: 1 0 0; /* by definition, see leftRatio above */
  }

  .left :global(> *:first-child),
  .right :global(> *:first-child) {
    flex: 1 0 0;
  }

  .left,
  .right {
    overflow-x: clip;
    contain: inline-size; /* else content width widens the window. Vertically, height: 100% prevents that */
  }

  /*
  .left,
  .right {
    overflow: auto; TODO breaks popups
  }*/
</style>
