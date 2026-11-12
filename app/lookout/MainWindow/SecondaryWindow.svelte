<vbox flex class="secondary-window lookout-window" dir={rtl}>
  <WindowHeader {title} />
  <vbox flex class="app-area">
    <NotificationBar notifications={$notifications} />
    <slot />
  </vbox>
  <SettingsDialogHost />
  <MessageBoxHost />
</vbox>

<script lang="ts">
  import { AppWindow } from "../../frontend/MainWindow/AppWindow";
  import { notifications } from "../../logic/util/Notification";
  import WindowHeader from "./WindowHeader.svelte";
  import NotificationBar from "../../frontend/MainWindow/NotificationBar.svelte";
  import SettingsDialogHost from "../Settings/SettingsDialogHost.svelte";
  import MessageBoxHost from "../Shared/Dialog/MessageBoxHost.svelte";
  import { applyColors } from "../../frontend/Settings/Global/AppThemeColors";
  import { getLocalStorage } from "../../frontend/Util/LocalStorage";
  import { getUILocale } from "../../l10n/l10n";
  import { rtlLocales } from "../../l10n/list";

  export let title: string;

  /* <copied from="../../frontend/MainWindow/SecondaryWindow.svelte"> */
  const appWindow = AppWindow.current();
  $: appWindow.title = title;

  $: rtl = rtlLocales.includes(getUILocale()) ? 'rtl' : null;
  let colorsSetting = getLocalStorage("appearance.colors", {});
  $: applyColors($colorsSetting.value, appWindow.window.document);
  /* </copied> */
</script>

<style>
  .secondary-window {
    min-width: 0;
    /* <copied from="MainWindow.svelte"> */
    min-height: 0;
    background-color: var(--lo-window-bg);
    color: var(--lo-fg);
    font-family: var(--lo-font);
    font-size: var(--lo-font-size);
    overflow: hidden;
    /* </copied> */
  }
  .app-area {
    min-width: 0;
    min-height: 0;
  }
</style>
