<hbox class="web-app" class:running class:showing title={app.nameTranslated}
  on:click={() => catchErrors(startApp)}
  on:contextmenu={contextMenu.onContextMenu}>
  <vbox class="gutter">
    <hbox class="close" title={$t`Close` + " " + app.nameTranslated}
      on:click|stopPropagation={() => catchErrors(closeApp)}>
      <CloseIcon size="12px" />
    </hbox>
    <hbox class="dot" />
  </vbox>
  <vbox class="icon-label">
    <img src={app.icon} width="32" height="32" alt="" />
    {#if showLabel}
      <div class="label font-smallest">{app.nameTranslated}</div>
    {/if}
  </vbox>
</hbox>

<ContextMenu bind:this={contextMenu}>
  {#if running}
    <MenuItem
      onClick={closeApp}
      label={$t`Close` + " " + app.nameTranslated}
      icon={CloseIcon} />
  {/if}
</ContextMenu>

<script lang="ts">
  import type { WebAppListed } from "../../../logic/WebApps/WebAppListed";
  import { showingWebApp, selectedWebApp, webAppsRunning } from "../Runner/WebAppsRunning";
  import { startWebApp } from "../Runner/open";
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import CloseIcon from "lucide-svelte/icons/x";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import { catchErrors } from "../../Util/error";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let app: WebAppListed;
  /** Show the name underneath the icon */
  export let showLabel = false;

  $: showing = $showingWebApp == app;
  $: running = $webAppsRunning.contains(app);
  let contextMenu: ContextMenu;
  const dispatch = createEventDispatcher<{ start: void }>();

  function startApp() {
    startWebApp(app);
    dispatch("start");
  }

  function closeApp() {
    webAppsRunning.remove(app);
    if ($showingWebApp == app) {
      $showingWebApp = webAppsRunning.last;
    }
    if ($selectedWebApp == app) {
      $selectedWebApp = webAppsRunning.last;
    }
  }
</script>

<style>
  .web-app {
    align-items: center;
    padding-block: 8px;
    padding-inline-end: 8px;
    color: var(--appbar-fg);
  }
  .web-app:hover {
    background-color: rgba(255, 255, 255, 25%);
  }
  .web-app.showing {
    background-color: rgba(255, 255, 255, 95%);
    color: #494558 /* var(--appbar-bg) */;
  }
  .gutter {
    position: relative;
    align-self: stretch;
    width: 13px;
    min-width: 13px;
    align-items: center;
    justify-content: center;
  }
  /* On the left, above the dot */
  .close {
    position: absolute;
    top: 0px;
    visibility: hidden;
  }
  .running:hover .close {
    visibility: visible;
  }
  .icon-label {
    flex: 1 0 0;
    min-width: 0px;
    align-items: center;
  }
  .label {
    max-width: 100%;
    margin-block-start: 4px;
    text-align: center;
    overflow-wrap: break-word;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .running .dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background-color: currentColor;
  }
</style>
