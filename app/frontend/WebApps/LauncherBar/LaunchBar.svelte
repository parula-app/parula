<!-- Shows in the AppBar underneath the Apps button -->
<vbox class="launch-bar" bind:clientHeight={height}>
  {#if appsOnBar.length}
    <!-- Separate the colored icons of the web apps from the outline icons of our apps -->
    <vbox class="tray">
      {#each appsOnBar as app (app)}
        <AppLaunchButton {app} on:start={() => showMore = false} />
      {/each}
    </vbox>
  {/if}
  <hbox class="add" title={$t`Add apps`}
    on:click={() => catchErrors(startStore)}>
    <AddIcon size="24px" />
  </hbox>
</vbox>

{#if showMore && appsOnBar.length < $apps.length}
  <!-- All web apps, with their names, next to the AppBar -->
  <vbox class="more">
    {#each $apps.contents as app (app)}
      <AppLaunchButton {app} showLabel iconSize={24} on:start={() => showMore = false} />
    {/each}
  </vbox>
{/if}

<script lang="ts">
  import type { WebAppListed } from "../../../logic/WebApps/WebAppListed";
  import { showingWebApp, showWebAppStore, webAppsRunning } from "../Runner/WebAppsRunning";
  import { webAppsMustangApp } from "../WebAppsMustangApp";
  import { openApp } from "../../AppsBar/selectedApp";
  import { appGlobal } from "../../../logic/app";
  import AppLaunchButton from "./LaunchBarButton.svelte";
  import AddIcon from "lucide-svelte/icons/plus";
  import { getLocalStorage } from "../../Util/LocalStorage";
  import { catchErrors } from "../../Util/error";
  import { t } from "../../../l10n/l10n";

  /** Empty space in the AppBar underneath the web apps, in px */
  export let freeHeight = 0;
  /** Show all web apps next to the AppBar, if not all fit into it
   * in/out */
  export let showMore = false;

  let apps = appGlobal.webApps.myApps.merge(webAppsRunning);
  /** Keys of the web apps that the user opened, the last one first */
  let recent = getLocalStorage<string[]>("webapps.recent", []);
  let height = 0;

  // We can use our height and the empty space underneath.
  // 48px per app, and 28px for the Add button. Must match the CSS.
  $: rows = Math.max(Math.floor((height + freeHeight - 28) / 48), 1);
  $: appsOnBar = mostRecent($apps.contents, $recent.value, rows);

  $: $showingWebApp && setRecent($showingWebApp)
  function setRecent(app: WebAppListed) {
    let key = app.webSessionID ?? app.id;
    recent.value = [key, ...recent.value.filter(k => k != key)].slice(0, 50);
  }

  /** The `count` apps that the user opened last, in the order of `apps` */
  function mostRecent(apps: WebAppListed[], recentKeys: string[], count: number): WebAppListed[] {
    if (apps.length <= count) {
      return apps;
    }
    let lastOpened = recentKeys.map(key => apps.find(app => (app.webSessionID ?? app.id) == key)).filter(app => app);
    let shown = [...lastOpened, ...apps.filter(app => !lastOpened.includes(app))].slice(0, count);
    return apps.filter(app => shown.includes(app));
  }

  function startStore() {
    showMore = false;
    $showWebAppStore = true;
    $showingWebApp = null;
    openApp(webAppsMustangApp, {});
  }
</script>

<style>
  .launch-bar {
    min-height: 0px;
    overflow: hidden;
  }
  .tray {
    background-color: rgba(0, 0, 0, 10%);
  }
  .add {
    height: 28px;
    min-height: 28px;
    align-items: center;
    justify-content: center;
    color: var(--appbar-fg);
  }
  .add:hover {
    background-color: rgba(255, 255, 255, 25%);
  }
  .add :global(svg) {
    stroke-width: 1.5px;
  }
  .more {
    position: absolute;
    inset-inline-start: 100%;
    top: 0px;
    bottom: 0px;
    max-width: 200px;
    justify-content: safe center;
    overflow-y: auto;
    background-color: var(--appbar-bg);
    box-shadow: 1px 0px 3px 0px rgba(22, 12, 39, 20%); /* #160C27 */
  }
  .launch-bar,
  .more {
    border-right: 1px dotted var(--border);
  }
  @media (prefers-color-scheme: light) {
    .launch-bar,
    .more {
      border-right: 1px dotted grey;
    }
  }
  :global(.lookout-window) .launch-bar,
  :global(.lookout-window) .more {
    border-right: none;
  }
  :global(.lookout-window) .more {
    box-shadow: var(--lo-shadow-popup);
  }
</style>
