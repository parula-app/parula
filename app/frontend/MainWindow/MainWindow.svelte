<svelte:head>
  <title>{ appName }</title>
</svelte:head>
<svelte:window
  bind:outerWidth={windowWidth}
  on:resize={saveWindowSettingsDebounced}
  on:blur={() => catchErrors(saveWindowSettings)}
  on:visibilitychange={() => catchErrors(saveWindowSettings)}
  on:beforeunload={() => catchErrors(saveWindowSettings)}
  on:click|capture={(event) => catchErrors(() => onClickTopLevel(event))} />

{#if frontend == "lookout"}
  {#await lookoutWindow then lookout}
    <svelte:component this={lookout.default} />
  {/await}
{:else}
  <vbox flex class="main-window"
    dir={rtl}
    class:mobile={$appGlobal.isMobile}
    class:desktop={!$appGlobal.isMobile}>
    {#if !appGlobal.isMobile}
      <WindowHeader selectedApp={$selectedApp} />
    {/if}
    <hbox flex>
      {#if !appGlobal.isMobile}
        <AppBar bind:selectedApp={$selectedApp} showApps={mustangApps} />
      {/if}
      <vbox flex>
        <NotificationBar notifications={$notifications} />
        {#if appGlobal.isMobile}
          <Router primary={false} {history}>
            <SplitterHorizontal name="sidebar" initialBottomRatio={0.7} hasTop={!!sidebar}>
              <vbox flex class="sidebar" slot="top">
                <svelte:component this={sidebar} />
              </vbox>
              <AppContentRoutes slot="bottom" />
            </SplitterHorizontal>
            <NavigationM />
          </Router>
        {:else if $selectedApp}
          <Router primary={false} {history}>
            <Splitter name="sidebar" initialRightRatio={0.25} hasRight={!!sidebar}>
              <AppContentRoutes slot="left"/>
              <vbox flex class="sidebar" slot="right">
                <svelte:component this={sidebar} />
              </vbox>
            </Splitter>
          </Router>
        {/if}
      </vbox>
    </hbox>
  </vbox>
{/if}
<MeetBackground />
<MailInBackground />
<CalendarInBackground />
<WebAppsInBackground />

<script lang="ts">
  import { selectedApp, sidebarApp, mustangApps, goTo, openApp, history } from "../AppsBar/selectedApp";
  import { appGlobal } from "../../logic/app";
  // #if [!WEBMAIL]
  // @ts-ignore ts2300
  import { getStartObjects, loginOnStartup } from "../../logic/startup";
  import { predefinedConfig } from "../../logic/Mail/AutoConfig/predefinedConfig";
  // #else
  // @ts-ignore ts2300
  import { getStartObjects, loginOnStartup } from "../../logic/WebMail/startup";
  // #endif
  import { notifications } from "../../logic/util/Notification";
  import { selectedAccount } from "../Mail/Selected";
  import { getLocalStorage } from "../Util/LocalStorage";
  import { loadMustangApps, disableAppsBasedOnFeaturesXML } from "../AppsBar/loadMustangApps";
  import { mailMustangApp } from "../Mail/MailMustangApp";
  import { meetMustangApp } from "../Meet/MeetMustangApp";
  import { categoriesLoaded } from "../Settings/SettingsCategories";
  import { applyColors } from "../Settings/Global/AppThemeColors";
  import AppBar from "../AppsBar/AppBar.svelte";
  import AppContentRoutes from "../AppsBar/AppContentRoutes.svelte";
  import NotificationBar from "./NotificationBar.svelte";
  import WindowHeader from "./WindowHeader.svelte";
  import NavigationM from "./NavigationM.svelte";
  import Splitter from "../Shared/Splitter.svelte";
  import SplitterHorizontal from "../Shared/SplitterHorizontal.svelte";
  import MailInBackground from "../Mail/MailInBackground.svelte";
  import CalendarInBackground from "../Calendar/CalendarInBackground.svelte";
  import MeetBackground from "../Meet/MeetBackground.svelte";
  import WebAppsInBackground from "../WebApps/Runner/WebAppsInBackground.svelte";
  import { catchErrors } from "../Util/error";
  import { assert } from "../../logic/util/util";
  import { getUILocale, t } from "../../l10n/l10n";
  import { rtlLocales } from "../../l10n/list";
  import { appName, defaultFrontend } from "../../logic/build";
  import { onMount } from "svelte";
  import debounce from "lodash/debounce";
  import { Router } from "svelte-navigator";
  // #if [MOBILE]
  import { SplashScreen } from '@capacitor/splash-screen';
  // #endif

  const frontendSetting = getLocalStorage("appearance.frontend", defaultFrontend);
  $: frontend = $frontendSetting.value;
  // For Vite, the import must be in `<script>` to pre-bundle, otherwise "504 Outdated Optimize Dep"
  $: lookoutWindow = frontend == "lookout" ? import("../../lookout/MainWindow/MainWindow.svelte") : null;

  // $: sidebarApp = $mustangApps.filter(app => app.showSidebar).first; // TODO watch `app` property changes
  $: $sidebarApp = $meetMustangApp.showSidebar ? meetMustangApp : null;
  $: sidebar = $sidebarApp?.sidebar;
  $: rtl = rtlLocales.includes(getUILocale()) ? 'rtl' : null;
  categoriesLoaded; /* make sure to import the file, so that that categories load */

  onMount(() => catchErrors(onLoad));

  async function onLoad() {
    loadMustangApps();
    openApp(mailMustangApp, {});
    // #if [MOBILE]
    SplashScreen.hide();
    // #endif
    await startup();
    changeTheme($themeSetting.value);
    await disableAppsBasedOnFeaturesXML();
  }

  async function startup() {
    await getStartObjects();
    if (appGlobal.emailAccounts.isEmpty && appGlobal.chatAccounts.isEmpty) {
      await setup();
    } else {
      await loginOnStartup(console.error);
      // Setting $selectedApp late would overwrite commandline/URL handlers
      $selectedAccount = appGlobal.emailAccounts.first;
      // `MailApp` selects the inbox, once we read the folders
    }
  }

  async function setup() {
    // #if [!WEBMAIL]
    let account = await predefinedConfig();
    if (account) {
      goTo("/setup/predefined", { account });
    } else {
      goTo("/setup/initial", {});
    }
    // #endif
  }

  let themeSetting = getLocalStorage("appearance.theme", "system");
  $: changeTheme($themeSetting.value);
  function changeTheme(theme: string) {
    if (!appGlobal?.remoteApp) {
      return;
    }
    assert(["system", "light", "dark"].includes(theme), $t`Bad theme name ` + theme);
    appGlobal.remoteApp.setTheme(theme);
  }
  let colorsSetting = getLocalStorage("appearance.colors", {});
  $: applyColors($colorsSetting.value);

  let windowWidth: number;
  $: windowWidth, setSmall()
  function setSmall() {
    appGlobal.isSmall = windowWidth < 600;
  }

  function saveWindowSettings() {
    if (appGlobal.isMobile || document.hidden) {
      return;
    }
    let windowSizeSetting = getLocalStorage("window.size", []);
    let windowPositionSetting = getLocalStorage("window.position", []);
    windowSizeSetting.value = [ window.outerWidth, window.outerHeight ];
    windowPositionSetting.value = [ window.screenX, window.screenY ];
  }
  const saveWindowSettingsDebounced = debounce(() => catchErrors(saveWindowSettings), 1000);

  async function onClickTopLevel(event: MouseEvent) {
    let targetE = event.target as HTMLElement;
    let linkE = targetE.closest && targetE.closest("a[href]");
    let url = linkE?.getAttribute("href");
    if (!url) {
      return;
    }
    // _blank should open in external browser
    if (linkE.getAttribute("target") == "_blank") {
      // Let default handler open in external browser
      return;
      /* // ... unless it's a link in an email that we can handle internally
      if (linkE.getAttribute("source") == "convert-html" &&
          appGlobal.meetAccounts.some(acc => acc.isMeetingURL(new URL(url)))) {
        // open internally, continue below
      } else {
        // Let default handler open in external browser
        return;
      }*/
    }
    // open internally
    let urlObj = new URL(url); // throws, if invalid
    let protocol = urlObj.protocol.replace(":", "");
    let urlEvent = new Event("url-" + protocol); // e.g. "url-mailto"
    (urlEvent as any).url = url;
    targetE.dispatchEvent(urlEvent);
    event.stopPropagation();
    event.preventDefault();
  }
</script>

<style>
  .main-window:not(.mobile) {
    border: 1px solid gray;
    min-width: 640px;
  }
  .sidebar {
    box-shadow: inset 1px 0px 5px 0px rgba(0, 0, 0, 10%);
    z-index: 2;
  }
</style>
