<hbox class="web-app" class:running class:showing
  on:contextmenu={contextMenu.onContextMenu}>
  <hbox class="dot" />
  <Button
    label={app.nameTranslated}
    onClick={startApp}
    {disabled}
    iconOnly plain>
    <img slot="icon" src={app.icon} width="24" height="24" alt="" />
  </Button>
  <Button
    onClick={closeApp}
    icon={CloseIcon}
    iconSize="12px"
    iconOnly
    plain
    label={$t`Close` + " " + app.nameTranslated}
    classes="close"
    />
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
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import Button from "../../Shared/Button.svelte";
  import CloseIcon from "lucide-svelte/icons/x";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import { t } from "../../../l10n/l10n";

  export let app: WebAppListed;
  export let disabled = false;

  $: showing = $showingWebApp == app;
  $: running = $webAppsRunning.contains(app);
  let contextMenu: ContextMenu;

  function startApp() {
    webAppsRunning.add(app);
    $showingWebApp = $selectedWebApp = app;
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
    height: 28px;
    min-height: 28px;
    border-radius: 6px;
    color: var(--appbar-fg);
  }
  .web-app:hover {
    background-color: rgba(255, 255, 255, 25%);
  }
  .web-app.showing {
    background-color: rgba(255, 255, 255, 95%);
    color: #494558 /* var(--appbar-bg) */;
  }
  .web-app :global(button),
  .web-app :global(button:hover:not(.disabled)) {
    height: 100%;
    padding: 0px;
    background-color: transparent;
    color: inherit;
  }
  .dot,
  .web-app :global(button.close) {
    width: 12px;
    min-width: 12px;
  }
  .running .dot::before {
    content: "";
    width: 4px;
    height: 4px;
    margin: auto;
    border-radius: 50%;
    background-color: currentColor;
  }
  /* Close only the app that the user sees, or points to */
  .web-app:not(.running) :global(button.close),
  .web-app:not(.showing):not(:hover) :global(button.close) {
    visibility: hidden;
  }
</style>
