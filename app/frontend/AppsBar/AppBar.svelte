<vbox class="app-bar">
  {#if noTitleBar}
    <hbox class="window-buttons window-drag" /> <!-- macOS shows its traffic lights here -->
  {/if}
  {#each $showApps.each as app}
    <AppButton selected={selectedApp == app} classes={app.id}
      on:click={() => catchErrors(() => onSelectApp(app))} >
      <AppIcon slot="icon" icon={app.icon} size="24px" />
      <hbox slot="label" class="label">
        {app.name}
      </hbox>
    </AppButton>
    <SubAppsList mainApp={app} bind:selectedApp />
  {/each}

  <vbox flex class="middle window-drag">
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
  import { catchErrors } from "../Util/error";
  import type { Collection } from "svelte-collections";

  /* in/out */
  export let selectedApp: MustangApp;
  /* Which apps to show on the app bar
   * readonly */
  export let showApps: Collection<MustangApp>;
  /** macOS: The window has no title bar, and the traffic lights are on top of the app bar.
   * in */
  export let noTitleBar = false;

  function onSelectApp(app: MustangApp) {
    openApp(app, app.windowParams);
  }
</script>

<style>
  .window-buttons {
    /* Electron gives the height of the macOS traffic lights.
     * 0 in fullscreen, where macOS hides them, and in a web browser. */
    height: calc(env(titlebar-area-height, 0px) + 8px);
    margin-block-start: -8px;
    /* The macOS 26 traffic lights are wider than the app bar */
    min-width: env(titlebar-area-x, 0px);
    background-color: var(--appbar-bg);
  }
  .app-bar {
    width: 64px;
    background-color: var(--appbar-bg);
    color: var(--appbar-fg);
    box-shadow: 1px 0px 3px 0px rgba(22, 12, 39, 20%); /* #160C27 */
    padding-block-start: 8px;
    z-index: 4;
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
  .above-setup {
    position: fixed;
    width: 63px;
    bottom: 68px;
    margin: 0 auto;
  }
  .app-bar :global(.app-button.settings) {
    position: fixed;
    width: 63px;
    bottom: 10px;
    margin: 0 auto;
  }
  .app-bar :global(.app-button.settings:not(.selected) .label .label) {
    display: none;
  }
</style>
