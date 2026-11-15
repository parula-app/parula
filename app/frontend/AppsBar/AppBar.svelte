<vbox class="app-bar-column">
  {#if noTitleBar}
    <hbox class="window-buttons" /> <!-- macOS shows its traffic lights here -->
  {/if}
  <vbox flex class="app-bar">
    {#if noTitleBar}
      <hbox class="global-buttons">
        <WorkspaceButton />
        <SearchButton />
      </hbox>
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

    <vbox flex class="middle" class:window-drag={noTitleBar}>
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
</vbox>

<script lang="ts">
  import type { MustangApp } from "./MustangApp";
  import { openApp, showDemoToggle } from "./selectedApp";
  import AppButton from "./AppButton.svelte";
  import AppIcon from "./AppIcon.svelte";
  import SubAppsList from "./SubAppsList.svelte";
  import DemoToggle from "./DemoToggle.svelte";
  import DemoBarMiddle from "./DemoBarMiddle.svelte";
  import WorkspaceButton from "./WorkspaceButton.svelte";
  import SearchButton from "./SearchButton.svelte";
  import { catchErrors } from "../Util/error";
  import type { Collection } from "svelte-collections";

  /* in/out */
  export let selectedApp: MustangApp;
  /* Which apps to show on the app bar
   * readonly */
  export let showApps: Collection<MustangApp>;
  /** macOS: The window has no title bar.
   * The traffic lights are above the app bar, and the workspace and search are in it.
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
    height: env(titlebar-area-height, 0px);
    background-color: var(--leftbar-bg);
    app-region: drag;
  }
  .app-bar {
    width: 64px;
    background-color: var(--appbar-bg);
    color: var(--appbar-fg);
    box-shadow: 1px 0px 3px 0px rgba(22, 12, 39, 20%); /* #160C27 */
    padding-block-start: 8px;
    z-index: 4;
  }
  .global-buttons {
    justify-content: space-evenly;
    padding-block-end: 4px;
  }
  .app-bar :global(.app-button),
  .global-buttons,
  .middle {
    border-right: 1px dotted var(--border);
  }
  @media (prefers-color-scheme: light) {
    .app-bar :global(.app-button),
    .global-buttons,
    .middle {
      border-right: 1px dotted grey;
    }
  }
  .middle.window-drag {
    app-region: drag;
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
