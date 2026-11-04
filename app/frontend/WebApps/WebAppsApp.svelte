<hbox flex class="web-apps">
  <LaunchBar {apps} bind:showStore />
  <vbox flex class="main-pane">
    <Scroll>
      {#if showStore}
        <WebAppStore bind:showStore />
      {:else}
        <hbox class="background-pattern" flex />
      {/if}
    </Scroll>
  </vbox>
</hbox>

<script lang="ts">
  import { showingWebApp, selectedWebApp } from "./Runner/WebAppsRunning";
  import { appGlobal } from "../../logic/app";
  import LaunchBar from "./LauncherBar/LaunchBar.svelte";
  import WebAppStore from "./Shop/WebAppStore.svelte";
  import Scroll from "../Shared/Scroll.svelte";
  import { catchErrors } from "../Util/error";
  import { onDestroy, onMount } from "svelte";

  let showStore = false;

  $: apps = appGlobal.webApps.myApps;

  onMount(() => catchErrors(async () => {
    await appGlobal.webApps.load();
    if (appGlobal.webApps.myApps.isEmpty) {
      showStore = true;
    }
  }));

  onDestroy(() => {
    $showingWebApp = null;
  });

  $: showApp(showStore)
  function showApp(showStore: boolean) {
    if (showStore && $showingWebApp) {
      $showingWebApp = null;
    } else if (!showStore && !$showingWebApp) {
      $showingWebApp = $selectedWebApp;
    }
  }

  // $: console.log("showing app", $showingWebApp?.nameTranslated, "running", $webAppsRunning.contents.map(app => app.nameTranslated));
</script>

<style>
  .main-pane {
    background-color: var(--pane-bg);
    margin: var(--pane-margin);
    border-radius: var(--pane-radius);
    box-shadow: var(--pane-shadow, none);
  }
</style>
