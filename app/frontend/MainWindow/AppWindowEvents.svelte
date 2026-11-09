<!--
  @component
  Like `<svelte:window on:...>`, but for the window in which this component shows.
  `<svelte:window>` always listens on the main window, also in secondary windows.

  E.g. `<AppWindowEvents on:pointermove={onMove} on:pointerup={onUp} />`
  `<AppWindowEvents capture on:click={onClick} />` is like `<svelte:window on:click|capture={onClick} />`
-->
<script lang="ts">
  import { AppWindow } from "./AppWindow";
  import { createBubbler } from "svelte/legacy";
  import { onMount } from "svelte";

  interface $$Events extends WindowEventMap {
    mousewheel: WheelEvent;
  }

  /** Listen in the capture phase */
  export let capture = false;

  const appWindow = AppWindow.current();
  const bubble = createBubbler();

  onMount(() => {
    const kEvents = [
      "click", "dblclick", "auxclick", "contextmenu",
      "mousedown", "mouseup", "mousemove", "mouseover", "mouseout", "wheel", "mousewheel",
      "pointerdown", "pointerup", "pointermove", "pointercancel", "pointerover", "pointerout",
      "touchstart", "touchmove", "touchend", "touchcancel",
      "keydown", "keyup",
      "focus", "blur", "focusin", "focusout",
      "dragstart", "drag", "dragend", "dragenter", "dragleave", "dragover", "drop",
      "copy", "cut", "paste",
      "resize", "scroll", "hashchange", "popstate", "pageshow", "pagehide", "beforeunload",
      "visibilitychange", "online", "offline", "message", "storage", "languagechange",
    ];
    let win = appWindow.window;
    let listeners = kEvents.map(type => [type, bubble(type)] as const);
    for (let [type, listener] of listeners) {
      win.addEventListener(type, listener, { capture });
    }
    return () => {
      for (let [type, listener] of listeners) {
        win.removeEventListener(type, listener, { capture });
      }
    };
  });
</script>
