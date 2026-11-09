{#if popupOpen}
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <vbox class="popup"
    on:close
    on:click={onClickInside} on:mousewheel={onClickInside}
    bind:this={popupEl}
    use:popupContent={popupOptions}>
    <slot />
  </vbox>
{/if}
<AppWindowEvents on:click={onClickOutside} on:mousewheel={onClickOutside} />

<script lang="ts">
  import { AppWindow } from '../MainWindow/AppWindow';
  import AppWindowEvents from '../MainWindow/AppWindowEvents.svelte';
  import { createPopperActions } from 'svelte-popperjs';
  import type { Placement } from '@popperjs/core';
  import { onDestroy } from 'svelte';

  /** in/out */
  export let popupOpen: boolean;
  /** Under/above which element the popup window should appear.
   * The popup will not cover this element, but be just above/below it.
   * in */
  export let popupAnchor: HTMLElement;
  /** Where the popup should appear in relation to the anchor.
   * above/below ("top"/"bottom") and left/right ("start"/"end")
   * in */
  export let placement: Placement = "bottom-end";
  /**
   * In which area the popup may appear. Much larger than the anchor.
   * Typically the entire page,  or just a part of it.
   * Should be large enough to contain the entire popup window
   * in any situation, e.g. if the anchor is in the middle of this area.
   * The popup window will be entirely within this area, and
   * be cut off larger.
   * Document element selector, e.g. '.mail-composer-window'
   * in */
  export let boundaryElSel: string;
  export let autoClose: boolean = true;

  const appWindow = AppWindow.current();

  const [popupRef, popupContent, getInstance] = createPopperActions({
    placement: placement,
    strategy: 'fixed',
  });
  const popupOptions = {
    modifiers: [
      {
        name: 'offset',
        options: { offset: [0, 4] },
        preventOverflow: true,
        allow: true,
      },
      {
        name: 'preventOverflow',
        options: {
          padding: 8,
          boundary: appWindow.window.document.querySelector(boundaryElSel),
        },
      },
      {
        name: 'hide',
      },
    ],
  };
  let contentObserver: ResizeObserver;

  // popupRef is not yet defined when use: hook in parent is invoked, so do it manually
  let popupHook: { destroy?(); };
  if (popupAnchor) {
    popupHook = popupRef(popupAnchor);
    popupAnchor = null;
  }
  $: popupAnchor && popupRef && (popupHook = popupRef(popupAnchor));
  onDestroy(() => {
    popupHook?.destroy();
    contentObserver?.disconnect();
  });

  function onClickOutside() {
    if (!autoClose || !popupOpen) {
      return;
    }
    popupOpen = false;
  }
  function onClickInside(event: Event) {
    if (!autoClose || !popupOpen) {
      return;
    }
    event.stopPropagation();
  }

  // Re-position popup when popup content changes
  let popupEl: HTMLDivElement;
  $: popupEl && createResizeObserver();
  function createResizeObserver() {
    contentObserver?.disconnect();
    contentObserver = new ResizeObserver(async () => {
      let popper = getInstance();
      await popper?.update();
    });
    contentObserver.observe(popupEl);
  }
</script>

<style>
  .popup {
    z-index: 100;
    background-color: unset;
    padding: 0;
    border-radius: 5px;
    margin: 5px;
    box-shadow: 2.281px 1.14px 9.123px 0px rgba(var(--shadow-color), 10%);
  }
</style>
