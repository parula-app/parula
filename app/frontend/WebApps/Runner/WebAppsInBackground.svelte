<vbox class="webapps" class:running={$showingWebApp}>
  {#each $webAppsRunning.each as webApp}
    <vbox class="webapp" class:running={$showingWebApp == webApp}>
      <WebAppRunner app={webApp} />
    </vbox>
  {/each}
</vbox>

<script lang="ts">
  import { webAppsRunning, showingWebApp } from "./WebAppsRunning";
  import WebAppRunner from "./WebAppRunner.svelte";
</script>

<style>
  .webapps {
    position: fixed;
    left: 64px; /* app bar width */
    width: calc(100% - 65px);
  }
  .webapps.running {
    top: 37px;
    height: calc(100% - 37px);
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
</style>
