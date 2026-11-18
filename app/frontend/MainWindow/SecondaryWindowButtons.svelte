<!-- A secondary window without title bar has the window buttons at the start of its header.
  macOS shows its traffic lights here. The main window has them on the app bar. -->
{#if $noTitleBar && !appWindow.isMainWindow && !webMail}
  <hbox class="window-buttons" class:mac>
    {#if !mac}
      <WindowButtons atStart />
    {/if}
  </hbox>
{/if}

<script lang="ts">
  import WindowButtons from "./WindowButtons.svelte";
  import { noTitleBar } from "./Selected";
  import { AppWindow } from "./AppWindow";
  import { getOSName } from "../Util/util";
  import { webMail } from "../../logic/build";

  const appWindow = AppWindow.current();
  const mac = getOSName() == "macintosh";
</script>

<style>
  .window-buttons {
    align-items: start;
    margin-inline-end: 12px;
  }
  .window-buttons.mac {
    /* The traffic lights are at x 5 and up to 61px wide, see `trafficLightPosition` in desktop/src/main/index.ts.
     * The padding of the header is before this. */
    width: 48px;
  }
  .window-buttons :global(button) {
    padding: 4px 2px;
  }
</style>
