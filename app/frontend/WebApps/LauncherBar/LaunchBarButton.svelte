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
  <img src={app.icon} width={iconSize} height={iconSize} alt="" />
  {#if showLabel}
    <div class="label font-small">{app.nameTranslated}</div>
  {/if}
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
  /** Show the name next to the icon */
  export let showLabel = false;
  /** in px */
  export let iconSize = 32;

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
  .label {
    margin-inline-start: 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .running .dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background-color: currentColor;
  }
</style>
