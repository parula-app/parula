<vbox flex class="main-pane">
  <Scroll>
    {#if $showWebAppStore}
      <WebAppStore bind:showStore={$showWebAppStore} />
    {:else}
      <hbox class="background-pattern" flex />
    {/if}
  </Scroll>
</vbox>

<script lang="ts">
  import { showingWebApp, selectedWebApp, showWebAppStore } from "./Runner/WebAppsRunning";
  import { appGlobal } from "../../logic/app";
  import WebAppStore from "./Shop/WebAppStore.svelte";
  import Scroll from "../Shared/Scroll.svelte";
  import { catchErrors } from "../Util/error";
  import { onDestroy, onMount } from "svelte";

  onMount(() => catchErrors(async () => {
    await appGlobal.webApps.load();
    if (appGlobal.webApps.myApps.isEmpty) {
      $showWebAppStore = true;
    }
  }));

  onDestroy(() => {
    $showingWebApp = null;
    $showWebAppStore = false;
  });

  $: showApp($showWebAppStore)
  function showApp(showStore: boolean) {
    if (showStore && $showingWebApp) {
      $showingWebApp = null;
    } else if (!showStore && !$showingWebApp) {
      $showingWebApp = $selectedWebApp;
    }
  }

  $: $showingWebApp && closeStore()
  function closeStore() {
    $showWebAppStore = false;
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
