<vbox class="app-bar">
  {#if noTitleBar}
    <hbox class="window-buttons window-drag" class:mac> <!-- macOS shows its traffic lights here -->
      {#if !mac}
        <WindowButtons />
      {/if}
    </hbox>
  {/if}
  {#each $showApps.each as app}
    <AppButton selected={selectedApp == app && !(app == webAppsMustangApp && $showingWebApp)} classes={app.id}
      on:click={() => catchErrors(() => onSelectApp(app))} >
      <AppIcon slot="icon" icon={app.icon} size="24px" />
      <hbox slot="label" class="label">
        {app.name}
      </hbox>
    </AppButton>
    <SubAppsList mainApp={app} bind:selectedApp />
  {/each}

  {#if selectedApp == webAppsMustangApp}
    <LaunchBar freeHeight={middleHeight} bind:showMore={showMoreWebApps} />
  {/if}
  <vbox flex class="middle window-drag" bind:clientHeight={middleHeight}>
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
  import WindowButtons from "../MainWindow/WindowButtons.svelte";
  import { webAppsMustangApp } from "../WebApps/WebAppsMustangApp";
  import { showingWebApp } from "../WebApps/Runner/WebAppsRunning";
  import { catchErrors } from "../Util/error";
  import { getOSName } from "../Util/util";
  import type { Collection } from "svelte-collections";

  /* in/out */
  export let selectedApp: MustangApp;
  /* Which apps to show on the app bar
   * readonly */
  export let showApps: Collection<MustangApp>;
  /** The window has no title bar, and the window buttons are on top of the app bar.
   * macOS shows its traffic lights there.
   * in */
  export let noTitleBar = false;

  const mac = getOSName() == "macintosh";

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
  .window-buttons {
    margin-block-start: -8px;
    background-color: var(--appbar-bg);
  }
  .window-buttons.mac {
    /* Electron gives the height of the macOS traffic lights.
     * 0 in fullscreen, where macOS hides them, and in a web browser. */
    height: calc(env(titlebar-area-height, 0px) + 8px);
    /* The macOS 26 traffic lights are wider than the app bar */
    min-width: env(titlebar-area-x, 0px);
  }
  .window-buttons:not(.mac) {
    justify-content: center;
    padding-block: 4px;
  }
  .window-buttons :global(button) {
    color: var(--appbar-fg);
    padding: 4px 2px;
  }
  .app-bar {
    width: 64px;
    background-color: var(--appbar-bg);
    color: var(--appbar-fg);
    box-shadow: 1px 0px 3px 0px rgba(22, 12, 39, 20%); /* #160C27 */
    padding-block-start: 8px;
    z-index: 4;
    position: relative; /* for the 2nd bar of `LaunchBar` */
    /* The content must not make the app bar higher than the window,
     * else `LaunchBar` would count that as space for more web apps */
    contain: size;
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
