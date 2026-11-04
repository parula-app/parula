<vbox flex class="main-window desktop lookout-window" dir={rtl}>
  <WindowHeader selectedApp={$selectedApp} bind:this={windowHeader} />
  <vbox flex class="below-title">
    <hbox flex class="window-body">
      <AppBar bind:selectedApp={$selectedApp} showApps={mustangApps} />
      <vbox flex class="app-area">
        <NotificationBar notifications={$notifications} />
        {#if $selectedApp}
          <RouterWithContent primary={false} {history}>
            <Splitter name="sidebar" initialRightRatio={0.25} hasRight={!!sidebar}>
              <AppContentRoutes slot="left" />
              <vbox flex class="sidebar" slot="right">
                <svelte:component this={sidebar} />
              </vbox>
            </Splitter>
          </RouterWithContent>
        {/if}
      </vbox>
    </hbox>
    <StatusBar />
    {#if $isBackstageOpen}
      <vbox class="backstage-overlay">
        <Backstage />
      </vbox>
    {/if}
  </vbox>
  <SettingsDialogHost />
  <MessageBoxHost />
</vbox>

<svelte:window on:keydown|capture={onKeyDownCapture} />

<script lang="ts">
  import lookoutCSS from "../app.css?inline";
  import { selectedApp, sidebarApp, history, openApp, mustangApps } from "../../frontend/AppsBar/selectedApp";
  import { notifications } from "../../logic/util/Notification";
  import { meetMustangApp } from "../../frontend/Meet/MeetMustangApp";
  import { isBackstageOpen } from "../Settings/Backstage/selected";
  import { getLocalStorage } from "../../frontend/Util/LocalStorage";
  import { getKeyDigit } from "../Util/util";
  import { getOSName } from "../../frontend/Util/util";
  import { MessageActions } from "../Mail/MessageActions";
  import { ContactActions } from "../Contacts/ContactActions";
  import { selectedFolder } from "../../frontend/Mail/Selected";
  import { mailMustangApp } from "../../frontend/Mail/MailMustangApp";
  import { calendarMustangApp } from "../../frontend/Calendar/CalendarMustangApp";
  import { contactsMustangApp } from "../../frontend/Contacts/ContactsMustangApp";
  import { catchErrors } from "../../frontend/Util/error";
  import WindowHeader from "./WindowHeader.svelte";
  import StatusBar from "./StatusBar.svelte";
  import AppBar from "../AppsBar/AppBar.svelte";
  import AppContentRoutes from "../AppsBar/AppContentRoutes.svelte";
  import Backstage from "../Settings/Backstage/Backstage.svelte";
  import SettingsDialogHost from "../Settings/SettingsDialogHost.svelte";
  import MessageBoxHost from "../Shared/Dialog/MessageBoxHost.svelte";
  import NotificationBar from "../../frontend/MainWindow/NotificationBar.svelte";
  import Splitter from "../../frontend/Shared/Splitter.svelte";
  import { getUILocale } from "../../l10n/l10n";
  import { rtlLocales } from "../../l10n/list";
  import { Router } from "svelte-navigator";
  import type { RouterProps } from "svelte-navigator/types/Router";
  import { onDestroy, type Component, type Snippet } from "svelte";
  import { createNewEvent } from "../../frontend/Calendar/event";
  import { get } from "svelte/store";
  import { selectedCalendar } from "../../frontend/Calendar/selected";

  /* <copied from="../../frontend/MainWindow/MainWindow.svelte"> */
  $: $sidebarApp = $meetMustangApp.showSidebar ? meetMustangApp : null;
  $: sidebar = $sidebarApp?.sidebar;
  $: rtl = rtlLocales.includes(getUILocale()) ? 'rtl' : null;
  /* </copied> */

  // Not a plain CSS import: the global CSS must go away when the user switches to the classic frontend at runtime
  const globalStyle = document.createElement("style");
  globalStyle.textContent = lookoutCSS;
  document.head.append(globalStyle);
  onDestroy(() => globalStyle.remove());

  // svelte-navigator's types don't declare the default slot, so svelte-check rejects any content
  const RouterWithContent = Router as unknown as Component<RouterProps & { children: Snippet }>;

  const unlistenHistory = history.listen(onNavigate);
  onDestroy(unlistenHistory);
  function onNavigate() {
    $isBackstageOpen = false;
  }

  function onKeyDownCapture() {
    // Appended anew for every key, so that it runs after the pages' own window listeners, which take precedence
    window.removeEventListener("keydown", onKeyDown);
    window.addEventListener("keydown", onKeyDown);
  }
  onDestroy(() => window.removeEventListener("keydown", onKeyDown));

  function onKeyDown(event: KeyboardEvent) {
    catchErrors(() => onKeyOnWindow(event));
  }

  function onKeyOnWindow(event: KeyboardEvent) {
    let target = event.target as HTMLElement;
    if (event.defaultPrevented || event.cancelBubble || document.querySelector("dialog:modal") ||
        target?.closest?.("[contenteditable]:not([contenteditable='false'])")) {
      return;
    }
    let isCtrl = event.ctrlKey || event.metaKey;
    let key = event.key.length == 1 ? event.key.toLowerCase() : event.key;
    // Ctrl+ (or Cmd+)
    if (isCtrl && !event.altKey && !event.shiftKey) {
      let digit = getKeyDigit(event);
      if (digit == 1) {
        event.preventDefault();
        event.stopPropagation();
        openApp(mailMustangApp, mailMustangApp.windowParams);
        return;
      } else if (digit == 2) {
        event.preventDefault();
        event.stopPropagation();
        openApp(calendarMustangApp, calendarMustangApp.windowParams);
        return;
      } else if (digit == 3 || digit == 4) {
        event.preventDefault();
        event.stopPropagation();
        openApp(contactsMustangApp, contactsMustangApp.windowParams);
        return;
      } else if (key == "e") {
        event.preventDefault();
        event.stopPropagation();
        windowHeader?.focusSearch();
        return;
      } else if (key == "F1") {
        event.preventDefault();
        event.stopPropagation();
        $ribbonCollapsed.value = !$ribbonCollapsed.value;
        return;
      }
    }
    // Ctrl+Shift+
    if (isCtrl && event.shiftKey && !event.altKey) {
      if (key == "m") {
        event.preventDefault();
        event.stopPropagation();
        mailMustangApp.writeMail(MessageActions.accountForNewMail($selectedFolder).newEMailFrom());
        return;
      } else if (key == "a") {
        event.preventDefault();
        event.stopPropagation();
        createNewEvent(get(selectedCalendar), new Date(), false);
        return;
      } else if (key == "q") {
        event.preventDefault();
        event.stopPropagation();
        MessageActions.newMeeting();
        return;
      } else if (key == "c") {
        event.preventDefault();
        event.stopPropagation();
        MessageActions.newContact();
        return;
      } else if (key == "l") {
        event.preventDefault();
        event.stopPropagation();
        ContactActions.newGroup(null);
        return;
      } else if (key == "b") {
        event.preventDefault();
        event.stopPropagation();
        openApp(contactsMustangApp, {});
        return;
      }
    }
    // Alt+ (Option+Q types a character on macOS)
    if (event.altKey && !isCtrl && !event.shiftKey && getOSName() != "macintosh") {
      if (event.code == "KeyQ") {
        event.preventDefault();
        event.stopPropagation();
        openTellMe();
        return;
      }
    }
    // No modifier
    if (!isCtrl && !event.altKey && !event.shiftKey) {
      if (key == "F3") {
        event.preventDefault();
        event.stopPropagation();
        windowHeader?.focusSearch();
        return;
      }
    }
  }

  const ribbonCollapsed = getLocalStorage<boolean>("lookout.ribbon.collapsed", false);
  let windowHeader: WindowHeader;

  function openTellMe() {
    let tellMe = Array.from(document.querySelectorAll<HTMLButtonElement>(".tell-me-button")).find(button => button.offsetParent);
    if (tellMe) {
      tellMe.click();
    } else {
      windowHeader?.focusSearch();
    }
  }
</script>

<style>
  .lookout-window {
    min-width: 640px;
    min-height: 0;
    background-color: var(--lo-window-bg);
    color: var(--lo-fg);
    font-family: var(--lo-font);
    font-size: var(--lo-font-size);
    overflow: hidden;
  }
  .below-title {
    position: relative;
    min-height: 0;
  }
  .window-body {
    min-height: 0;
    isolation: isolate;
  }
  .app-area {
    min-width: 0;
    min-height: 0;
  }
  .app-area > :global(.notification-bar) {
    min-height: 34px;
    margin: 0 8px 6px 8px;
    padding-inline-start: 4px;
    border: 1px solid var(--lo-infobar-border);
    border-radius: var(--lo-radius);
    background-color: var(--lo-infobar-bg);
    color: var(--lo-fg);
    box-shadow: none;
  }
  .app-area > :global(.notification-bar[severity="error"]) {
    border-color: var(--lo-infobar-error-border);
    background-color: var(--lo-infobar-error-bg);
  }
  .app-area > :global(.notification-bar[severity="meltdown"]) {
    border-color: var(--lo-danger);
    background-color: var(--lo-danger);
    color: var(--lo-danger-fg);
  }
  .app-area > :global(.notification-bar[severity="info"]),
  .app-area > :global(.notification-bar[severity="logged-out"]) {
    border-color: var(--lo-selected-bg);
    background-color: var(--lo-accent-tint);
  }
  .app-area > :global(.notification-bar > hbox:first-child) {
    display: none;
  }
  .app-area > :global(.notification-bar button) {
    border-color: transparent;
    background-color: transparent;
    color: inherit;
  }
  .app-area > :global(.notification-bar button:hover) {
    background-color: var(--lo-hover-bg);
  }
  .app-area > :global(.notification-bar button.action) {
    border-color: var(--lo-input-border);
    background-color: var(--lo-pane-bg);
    color: var(--lo-fg);
  }
  .sidebar {
    box-shadow: var(--lo-shadow-card);
    z-index: 2;
  }
  .backstage-overlay {
    position: absolute;
    inset: 0;
    z-index: 50;
    display: flex;
  }
</style>
