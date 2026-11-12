<hbox class="window-header" class:os-rtl={osRTL} class:mac
  style="--workspace-color: {$selectedWorkspace?.color ?? "var(--windowheader-bg)"}">
  <vbox class="app-logo">
    <Icon data={logo} size="20px" />
  </vbox>
  {#if appWindow.isMainWindow}
    <hbox class="workspace">
      <WorkspaceHeader {selectedApp} />
    </hbox>
  {/if}
  <hbox class="app-title value">
    {title ?? $titleStore ?? selectedApp?.name ?? appName}
  </hbox>
  <vbox flex class="free" />
  {#if appWindow.isMainWindow}
    <hbox class="search-box">
      <SearchField bind:searchTerm={$globalSearchTerm} />
    </hbox>
    <hbox class="new-window">
      <Button label={$t`Open a new window`}
        icon={NewWindowIcon} iconSize="16px" plain iconOnly
        onClick={onNewWindow}
        />
    </hbox>
  {/if}
  {#if !webMail}
    <hbox class="right">
      <Button label={$t`Minimize`}
        icon={MinimizeIcon} iconSize="16px" plain iconOnly classes="minimize"
        onClick={onMinimize}
        />
      <Button label={$t`Maximize`} tooltip={canMaximize ? $t`Maximize` : $t`Restore window`}
        icon={canMaximize ? MaximizeIcon : UnmaximizeIcon}
        iconSize="12px" plain iconOnly classes="restore-window"
        onClick={onMaximizeOrRestore}
        />
      <Button label={isFirstWindow ? $t`Close entire app` : $t`Close window`}
        icon={XIcon} iconSize="16px" plain iconOnly classes="close"
        onClick={onClose}
        />
    </hbox>
  {/if}
</hbox>

<script lang="ts">
  import type { MustangApp } from "../AppsBar/MustangApp";
  import { globalSearchTerm } from "../AppsBar/selectedApp";
  import { appName, webMail } from "../../logic/build";
  import WorkspaceHeader from "./WorkspaceHeader.svelte";
  import SearchField from "../Shared/SearchField.svelte";
  import Button from "../Shared/Button.svelte";
  import Icon from 'svelte-icon/Icon.svelte';
  import logo from '../asset/icon/general/logo.svg?raw';
  import MinimizeIcon from 'lucide-svelte/icons/minus';
  import MaximizeIcon from 'lucide-svelte/icons/square';
  import UnmaximizeIcon from 'lucide-svelte/icons/copy';
  import XIcon from 'lucide-svelte/icons/x';
  import { getOSName } from "../Util/util";
  import { t } from "../../l10n/l10n";
  import { rtlLocales } from "../../l10n/list";
  import { selectedWorkspace } from "./Selected";
  import { AppWindow } from "./AppWindow";
  import MainWindow from "./MainWindow.svelte";
  import NewWindowIcon from 'lucide-svelte/icons/app-window';

  export let selectedApp: MustangApp = null;
  /** For windows that show only one thing, e.g. the composer */
  export let title: string | null = null;

  const appWindow = AppWindow.current();
  const isFirstWindow = appWindow == AppWindow.main;

  // Enable Mac Styles
  const mac = (!webMail && getOSName() == "macintosh") ? true : false;
  // Check mac system text direction
  const osRTL = (rtlLocales.includes(navigator.language) && mac) ? true : false;

  async function onMinimize() {
    await appWindow.minimize();
  }

  let canMaximize = true;
  async function onMaximizeOrRestore() {
    if (canMaximize) {
      await appWindow.maximize();
    } else {
      await appWindow.restore();
    }
    canMaximize = !canMaximize;
  }

  function onClose() {
    appWindow.close();
  }

  async function onNewWindow() {
    await AppWindow.openMainWindow(MainWindow, {}, appWindow.window.outerWidth, appWindow.window.outerHeight);
  }

  $: titleStore = selectedApp?.title;
</script>

<style>
  .window-header {
    background-color: var(--windowheader-bg);
    color: var(--windowheader-fg);
  }
  .app-logo {
    padding: 8px;
    padding-inline-start: 12px;
    width: 48px;
    align-items: start;
    justify-content: center;
    app-region: drag;
  }
  .app-title {
    font-size: 18px;
    align-items: center;
    margin-inline-start: 4px;
    app-region: drag;
  }
  .right {
    padding-inline-end: 8px;
  }
  .new-window {
    background-color: var(--workspace-color);
    padding-inline-start: 4px;
  }
  .right :global(button),
  .new-window :global(button) {
    color: white;
    padding-inline-start: 8px;
    padding-inline-end: 8px;
  }
  .right :global(.maximize) {
    padding-inline-start: 10px;
    padding-inline-end: 10px;
  }
  .right :global(.minimize svg) {
    margin-block-start: 8px; /* Find better icon */
  }
  .free {
    app-region: drag;
  }

  .window-header :global(.search) {
    margin: 6px 12px;
    outline: 1px solid rgb(255, 255, 255, 7%);
    border: none;
  }
  .window-header :global(.search:not(.has-search)) {
    background-color: var(--windowheader-bg);
    /*background-color: rgb(255, 255, 255, 10%);
    background-blend-mode: multiply;*/
  }
  .window-header :global(.search :has(input:focus)) {
    background-color: var(--inverted-bg);
  }
  .window-header :global(.search:not(.has-search) input) {
    background-color: transparent;
    color: var(--inverted-fg);
  }

  .search-box {
    --gradient-direction: 135deg;
    background-image: linear-gradient(var(--gradient-direction), var(--windowheader-bg) 10%, var(--workspace-color) 85%);
  }
  :global([dir="rtl"]) .search-box {
    --gradient-direction: 225deg;
  }
  .right {
    background-color: var(--workspace-color);
  }

  /* Styles for Mac */
  .mac .right {
    display: none;
  }
  .mac .app-logo,
  :global([dir="rtl"]) .mac.os-rtl .app-logo {
    margin-inline-start: 80px;
    width: 15px;
  }
  :global([dir="rtl"]) .mac:not(.os-rtl) .app-logo,
  .mac.os-rtl .app-logo {
    margin-inline-start: 0px;
  }
  :global([dir="rtl"]) .mac:not(.os-rtl) .search-box,
  .mac.os-rtl .search-box {
    padding-inline-end: 80px;
  }
  :global([dir="rtl"]) .mac .search-box {
    padding-inline-end: 0px;
  }
</style>
