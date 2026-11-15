<!-- Shows in the AppBar underneath the Apps button -->
<vbox class="launch-bar" bind:clientHeight={height}>
  {#if $apps.hasItems}
    <!-- Separate the colored icons of the web apps from the outline icons of our apps -->
    <vbox class="tray">
      {#each onBar as app (app)}
        <AppLaunchButton {app} />
      {/each}
      {#if more.length}
        <!-- stopPropagation: Else, the click closes the menu right away -->
        <hbox class="more" title={$t`More apps`} bind:this={moreE}
          on:click|stopPropagation={() => isMoreOpen = !isMoreOpen}>
          <MoreIcon size="20px" />
        </hbox>
      {/if}
    </vbox>
  {/if}
  <hbox class="add" class:selected={$showWebAppStore} title={$t`Add apps`}
    on:click={startStore}>
    <AddIcon size="24px" />
  </hbox>
</vbox>

<Menu bind:isMenuOpen={isMoreOpen} anchor={moreE} placement="right-end">
  {#each more as app (app)}
    <MenuItem label={app.nameTranslated} onClick={() => startApp(app)}>
      <img slot="icon" src={app.icon} width="16" height="16" alt="" />
    </MenuItem>
  {/each}
</Menu>

<script lang="ts">
  import type { WebAppListed } from "../../../logic/WebApps/WebAppListed";
  import { selectedWebApp, showingWebApp, showWebAppStore, webAppsRunning } from "../Runner/WebAppsRunning";
  import { appGlobal } from "../../../logic/app";
  import AppLaunchButton from "./LaunchBarButton.svelte";
  import Menu from "../../Shared/Menu/Menu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import AddIcon from "lucide-svelte/icons/plus";
  import MoreIcon from "lucide-svelte/icons/ellipsis";
  import { t } from "../../../l10n/l10n";

  /** Empty space in the AppBar underneath all apps, in px */
  export let freeHeight: number;

  let apps = appGlobal.webApps.myApps.merge(webAppsRunning);
  let height: number;
  let moreE: HTMLElement;
  let isMoreOpen = false;

  // 32px per app. The Add button and the paddings take 2 rows. Must match the CSS.
  $: rows = Math.floor(((height ?? 0) + freeHeight) / 32) - 2;
  $: onBar = appsOnBar($apps.contents, $showingWebApp, rows);
  $: more = $apps.contents.filter(app => !onBar.includes(app));

  /** As many apps as fit into `rows`, and always the app that the user sees.
   * If not all fit, the last row is for the More button. */
  function appsOnBar(apps: WebAppListed[], showing: WebAppListed, rows: number): WebAppListed[] {
    if (apps.length <= rows) {
      return apps;
    }
    let onBar = apps.slice(0, Math.max(rows - 1, 1));
    if (showing && !onBar.includes(showing)) {
      onBar[onBar.length - 1] = showing;
    }
    return onBar;
  }

  function startApp(app: WebAppListed) {
    webAppsRunning.add(app);
    $showingWebApp = $selectedWebApp = app;
  }

  function startStore() {
    $showWebAppStore = true;
    $showingWebApp = null;
  }
</script>

<style>
  .launch-bar {
    align-items: center;
    padding-block: 4px 8px;
    min-height: 0px;
    overflow: hidden;
    border-right: 1px dotted var(--border);
  }
  @media (prefers-color-scheme: light) {
    .launch-bar {
      border-right: 1px dotted grey;
    }
  }
  .tray {
    width: 52px;
    padding: 2px;
    gap: 4px;
    border-radius: 8px;
    background-color: rgba(0, 0, 0, 25%);
  }
  .more,
  .add {
    height: 28px;
    min-height: 28px;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    color: var(--appbar-fg);
  }
  .add {
    width: 52px;
    margin-block-start: 4px;
  }
  .more:hover,
  .add:hover {
    background-color: rgba(255, 255, 255, 25%);
  }
  .add.selected {
    background-color: rgba(255, 255, 255, 95%);
    color: #494558 /* var(--appbar-bg) */;
  }
  .add :global(svg) {
    stroke-width: 1.5px;
  }
</style>
