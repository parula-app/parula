{#if $subApps.hasItems}
  <hbox class="sub-apps">
    {#each $subApps.each as app (app)}
      <AppButton {app} small selected={selectedApp == app}
        on:click={() => catchErrors(() => onSelectApp(app))} />
    {/each}
  </hbox>
{/if}

<script lang="ts">
  import type { MustangApp } from "../../frontend/AppsBar/MustangApp";
  import { openApp, selectedApp as selectedAppOfWindow } from "../../frontend/AppsBar/selectedApp";
  import { AppWindow } from "../../frontend/MainWindow/AppWindow";
  import AppButton from "./AppButton.svelte";
  import { catchErrors } from "../../frontend/Util/error";
  import { get } from "svelte/store";

  const appWindow = AppWindow.current();

  export let mainApp: MustangApp;
  export let selectedApp: MustangApp | null;

  $: subApps = $mainApp.subApps;

  function onSelectApp(app: MustangApp) {
    // <copied from="../../frontend/AppsBar/SubAppsList.svelte">
    let shownIn = AppWindow.all.find(other => other != appWindow && other.isMainWindow && get(other.uiState(selectedAppOfWindow)) == app);
    if (shownIn) {
      shownIn.focus();
      return;
    }
    // </copied>
    openApp(app, app.windowParams);
  }
</script>

<style>
  .sub-apps {
    flex-wrap: wrap;
    justify-content: center;
    gap: 2px;
    width: calc(var(--lo-nav-rail-width) - 8px);
  }
</style>
