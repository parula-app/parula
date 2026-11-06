<!--
  @component
  The frame of a secondary window, which shows only one thing, e.g. an email or the composer,
  instead of the whole app with all apps. It adds the window header with the title,
  notifications, theme colors and text direction.

  Usage: A component wraps its content in this, e.g. `ComposerWindow.svelte`:
  `<SecondaryWindow title={...}><MailComposer {mail} /></SecondaryWindow>`.
  Then `AppWindow.current().open(ComposerWindow, { mail }, width)` opens the window
  and mounts `ComposerWindow` into it.

  Content: Any component of the app.
  - The window is an `about:blank` page that the main window opened, and the content runs
    in the JS context of the main window. So, it shares `appGlobal` with all accounts, emails etc.
    and sees all changes.
  - The UI state from the `selected.ts` files is separate for each window, see `AppWindow.perWindow()`.
    What opens in an app, e.g. a person, shows in the main window from which this window was opened.
  - The global `window` and `document` are those of the main window. Use `AppWindow.current().window`
    instead, and call `AppWindow.current()` during component initialization.
  - `<svelte:window>` listens on the main window. Use `<AppWindowEvents>` instead.
  - Code after an `await` changes the stores of the window that the user used last,
    see `AppWindow.current()`.
  - The window closes when the first main window closes or reloads.
-->
<vbox flex class="secondary-window" dir={rtl}>
  <WindowHeader {title} />
  <NotificationBar notifications={$notifications} />
  <slot />
</vbox>

<script lang="ts">
  import { AppWindow } from "./AppWindow";
  import { notifications } from "../../logic/util/Notification";
  import WindowHeader from "./WindowHeader.svelte";
  import NotificationBar from "./NotificationBar.svelte";
  import { applyColors } from "../Settings/Global/AppThemeColors";
  import { getLocalStorage } from "../Util/LocalStorage";
  import { getUILocale } from "../../l10n/l10n";
  import { rtlLocales } from "../../l10n/list";

  export let title: string;

  const appWindow = AppWindow.current();
  $: appWindow.title = title;

  // <copied from="MainWindow.svelte">
  $: rtl = rtlLocales.includes(getUILocale()) ? 'rtl' : null;
  let colorsSetting = getLocalStorage("appearance.colors", {});
  $: applyColors($colorsSetting.value, appWindow.window.document);
  // </copied>
</script>

<style>
  .secondary-window {
    border: 1px solid gray;
    min-width: 0;
  }
</style>
