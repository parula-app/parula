<vbox class="nav-rail" role="navigation" aria-label={$t`Apps`}>
  {#if noTitleBar}
    <hbox class="window-buttons" class:mac> <!-- macOS shows its traffic lights here -->
      {#if !mac && !webMail}
        <WindowButtons atStart />
      {/if}
    </hbox>
  {/if}
  {#each railApps as app (app.id)}
    <AppButton {app} selected={isSelected(app, selectedApp) && !(app == webAppsMustangApp && $showingWebApp)}
      on:click={() => catchErrors(() => onSelectApp(app))} />
    <SubAppsList mainApp={app} bind:selectedApp />
  {/each}
  {#if selectedApp == webAppsMustangApp}
    <LaunchBar freeHeight={spacerHeight} bind:showMore={showMoreWebApps} />
  {/if}
  <vbox flex class="spacer" bind:clientHeight={spacerHeight} />
  <AppButton app={settingsMustangApp} selected={isSelected(settingsMustangApp, selectedApp)}
    on:click={() => openOptions()} />
</vbox>

<script lang="ts">
  import type { MustangApp } from "../../frontend/AppsBar/MustangApp";
  import { openApp } from "../../frontend/AppsBar/selectedApp";
  import { mailMustangApp } from "../../frontend/Mail/MailMustangApp";
  import { calendarMustangApp } from "../../frontend/Calendar/CalendarMustangApp";
  import { contactsMustangApp } from "../../frontend/Contacts/ContactsMustangApp";
  import { settingsMustangApp } from "../../frontend/Settings/Window/SettingsMustangApp";
  import { openOptions } from "../Settings/SettingsDialogs";
  import AppButton from "./AppButton.svelte";
  import SubAppsList from "./SubAppsList.svelte";
  import LaunchBar from "../../frontend/WebApps/LauncherBar/LaunchBar.svelte";
  import WindowButtons from "../../frontend/MainWindow/WindowButtons.svelte";
  import { webAppsMustangApp } from "../../frontend/WebApps/WebAppsMustangApp";
  import { showingWebApp } from "../../frontend/WebApps/Runner/WebAppsRunning";
  import { catchErrors } from "../../frontend/Util/error";
  import { getOSName } from "../../frontend/Util/util";
  import { webMail } from "../../logic/build";
  import type { Collection } from "svelte-collections";
  import { t } from "../../l10n/l10n";

  export let selectedApp: MustangApp;
  export let showApps: Collection<MustangApp>;
  /** The window has no title bar, and the window buttons are on top of the app bar.
   * macOS shows its traffic lights there.
   * in */
  export let noTitleBar = false;

  const mac = getOSName() == "macintosh";

  let spacerHeight: number;
  /** Clicking on Apps shows all web apps, if not all fit into the app bar */
  let showMoreWebApps = false;
  $: if (selectedApp != webAppsMustangApp) showMoreWebApps = false;

  $: railApps = sortRailApps($showApps.contents);

  function sortRailApps(apps: MustangApp[]): MustangApp[] {
    const firstApps: MustangApp[] = [ mailMustangApp, calendarMustangApp, contactsMustangApp ];
    return [
      ...firstApps.filter(app => apps.includes(app)),
      ...apps.filter(app => !firstApps.includes(app) && app != settingsMustangApp),
    ];
  }

  function onSelectApp(app: MustangApp) {
    if (app == webAppsMustangApp) {
      showMoreWebApps = !showMoreWebApps;
    }
    openApp(app, app.windowParams);
  }

  function isSelected(app: MustangApp, current: MustangApp): boolean {
    return !!current && (current == app || app.subApps.includes(current));
  }
</script>

<style>
  .nav-rail {
    flex: 0 0 auto;
    width: var(--lo-nav-rail-width);
    align-items: center;
    gap: 8px;
    padding: var(--lo-ribbon-tab-row-height) 0 8px 0;
    background-color: var(--lo-window-bg);
    app-region: drag;
    position: relative; /* for the 2nd bar of `LaunchBar` */
    z-index: 4; /* The 2nd bar is above the app and the running web app */
    /* The content must not make the nav rail higher than the window,
     * else `LaunchBar` would count that as space for more web apps */
    contain: size;
  }
  .window-buttons.mac {
    /* Electron gives the height of the macOS traffic lights.
     * 0 in fullscreen, where macOS hides them, and in a web browser. */
    height: env(titlebar-area-height, 0px);
  }
  .window-buttons :global(button) {
    color: var(--lo-fg);
    padding: 4px 2px;
    app-region: no-drag;
  }
</style>
