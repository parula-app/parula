{#if $subApps.hasItems}
  <!-- A list of parts of the app,
    shown in the AppBar underneath the app button -->
  <hbox class="sub-app-bar" app={mainApp.id}>
    {#each $subApps.each as app}
      <SubAppButton selected={selectedApp == app} {app}
        on:click={() => catchErrors(() => onSelectApp(app))}>
        <AppIcon slot="icon" icon={app.icon} size="16px" />
      </SubAppButton>
    {/each}
  </hbox>
{/if}

<script lang="ts">
  import type { MustangApp } from "./MustangApp";
  import { openApp, selectedApp as selectedAppOfWindow } from "./selectedApp";
  import { AppWindow } from "../MainWindow/AppWindow";
  import SubAppButton from "./SubAppButton.svelte";
  import AppIcon from "./AppIcon.svelte";
  import { catchErrors } from "../Util/error";
  import { CollectionObserver } from "svelte-collections";
  import { onDestroy, onMount } from "svelte";
  import { get } from "svelte/store";

  const appWindow = AppWindow.current();

  export let mainApp: MustangApp;
  /* in/out */
  export let selectedApp: MustangApp | null;

  $: subApps = $mainApp.subApps;

  function onSelectApp(app: MustangApp) {
    let shownIn = AppWindow.all.find(other => other != appWindow && other.isMainWindow && get(other.uiState(selectedAppOfWindow)) == app);
    if (shownIn) {
      shownIn.focus();
      return;
    }
    openApp(app, app.windowParams);
  }

  // Unselect sub-app that has been removed
  class RemovalObserver extends CollectionObserver<MustangApp> {
    added(apps: MustangApp[]) {}
    removed(apps: MustangApp[]) {
      for (let app of apps) {
        if (selectedApp == app) {
          selectedApp = mainApp.subApps.last ?? mainApp;
        }
      }
    }
  }
  let removalObserver = new RemovalObserver();
  onMount(() => catchErrors(() => {
    subApps.registerObserver(removalObserver);
  }));
  onDestroy(() => catchErrors(() => {
    subApps.unregisterObserver(removalObserver);
  }));
</script>

<style>
  .sub-app-bar {
    justify-content: end;
    flex-wrap: wrap;
    margin: 0px 12px 2px 6px;
  }
  .sub-app-bar[app="webapps"] {
    margin-block-start: 8px;
  }
</style>
