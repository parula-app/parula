<vbox class="webapps" class:running={$showingWebApp} class:no-title-bar={noTitleBar}>
  {#each $webAppsRunning.each as webApp}
    <vbox class="webapp" class:running={$showingWebApp == webApp}>
      <WebAppRunner app={webApp} />
    </vbox>
  {/each}
</vbox>

<script lang="ts">
  import { webAppsRunning, showingWebApp } from "./WebAppsRunning";
  import WebAppRunner from "./WebAppRunner.svelte";

  /** The window has no title bar above the web app
   * in */
  export let noTitleBar = false;
</script>

<style>
  .webapps {
    position: fixed;
    left: 64px; /* app bar width */
    width: calc(100% - 65px);
  }
  .webapps.running {
    top: 37px; /* window header height */
    height: calc(100% - 37px);
  }
  .webapps.running.no-title-bar {
    top: 0px;
    height: 100%;
  }
  .webapps:not(.running) {
    bottom: 0px;
    height: 0px;
  }
  .webapp.running {
    height: 100%;
    width: 100%;
    position: absolute;
    top: 0px;
  }
  .webapp:not(.running) {
    visibility: collapse;
  }
  :global(.lookout-window) .webapps.running:not(.no-title-bar) {
    top: var(--lo-titlebar-height);
    height: calc(100% - var(--lo-titlebar-height));
  }
</style>
