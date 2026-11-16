<vbox class="app-bar">
  {#each $showApps.each as app}
    <AppButton selected={selectedApp == app && !(app == webAppsMustangApp && $showingWebApp)} classes={app.id}
      on:click={() => catchErrors(() => onSelectApp(app))} >
      <AppIcon slot="icon" icon={app.icon} size="24px" />
      <hbox slot="label" class="label">
        {app.name}
      </hbox>
    </AppButton>
    <SubAppsList mainApp={app} bind:selectedApp />
    {#if app == webAppsMustangApp && app == selectedApp}
      <LaunchBar freeHeight={middleHeight} bind:showMore={showMoreWebApps} />
    {/if}
  {/each}

  <vbox flex class="middle" bind:clientHeight={middleHeight}>
    <DemoBarMiddle />
  </vbox>
  {#if $showDemoToggle}
    // #if [!WEBMAIL]
    <vbox class="above-setup">
      <DemoToggle />
    </vbox>
    // #endif
  {/if}
</vbox>

<script lang="ts">
  import type { MustangApp } from "./MustangApp";
  import { openApp, showDemoToggle } from "./selectedApp";
  import AppButton from "./AppButton.svelte";
  import AppIcon from "./AppIcon.svelte";
  import SubAppsList from "./SubAppsList.svelte";
  import DemoToggle from "./DemoToggle.svelte";
  import DemoBarMiddle from "./DemoBarMiddle.svelte";
  import LaunchBar from "../WebApps/LauncherBar/LaunchBar.svelte";
  import { webAppsMustangApp } from "../WebApps/WebAppsMustangApp";
  import { showingWebApp } from "../WebApps/Runner/WebAppsRunning";
  import { catchErrors } from "../Util/error";
  import type { Collection } from "svelte-collections";

  /* in/out */
  export let selectedApp: MustangApp;
  /* Which apps to show on the app bar
   * readonly */
  export let showApps: Collection<MustangApp>;

  let middleHeight: number;
  /** Clicking on Apps shows all web apps, if not all fit into the app bar */
  let showMoreWebApps = false;
  $: if (selectedApp != webAppsMustangApp) showMoreWebApps = false;

  function onSelectApp(app: MustangApp) {
    if (app == webAppsMustangApp) {
      showMoreWebApps = !showMoreWebApps;
    }
    openApp(app, app.windowParams);
  }
</script>

<style>
  .app-bar {
    width: 64px;
    background-color: var(--appbar-bg);
    color: var(--appbar-fg);
    box-shadow: 1px 0px 3px 0px rgba(22, 12, 39, 20%); /* #160C27 */
    padding-block-start: 8px;
    z-index: 4;
    position: relative; /* for the 2nd bar of `LaunchBar` */
  }
  .app-bar :global(.app-button),
  .middle {
    border-right: 1px dotted var(--border);
  }
  @media (prefers-color-scheme: light) {
    .app-bar :global(.app-button),
    .middle {
      border-right: 1px dotted grey;
    }
  }
  .middle {
    min-height: 0px;
  }
  .above-setup {
    margin-block-end: 14px;
  }
  .app-bar :global(.app-button.settings) {
    order: 1; /* After the middle */
    margin-block-end: 10px;
  }
  .app-bar :global(.app-button.settings:not(.selected) .label .label) {
    display: none;
  }
</style>
