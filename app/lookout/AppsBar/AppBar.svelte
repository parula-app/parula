<vbox class="nav-rail" role="navigation" aria-label={$t`Apps`}>
  {#each railApps as app (app.id)}
    <AppButton {app} selected={isSelected(app, selectedApp)}
      on:click={() => catchErrors(() => onSelectApp(app))} />
    <SubAppsList mainApp={app} bind:selectedApp />
  {/each}
  <vbox flex class="spacer" />
  <AppButton app={settingsMustangApp} selected={isSelected(settingsMustangApp, selectedApp)}
    on:click={() => openOptions()} />
</vbox>

<script lang="ts">
  import type { MustangApp } from "../../frontend/AppsBar/MustangApp";
  import { openApp } from "../../frontend/AppsBar/selectedApp";
  import { mailMustangApp } from "../../frontend/Mail/MailMustangApp";
  import { calendarMustangApp } from "../../frontend/Calendar/CalendarMustangApp";
  import { contactsMustangApp } from "../../frontend/Contacts/ContactsMustangApp";
  import { settingsMustangApp } from "../../frontend/Settings/Window/SettingsMustangApp";
  import { openOptions } from "../Settings/SettingsDialogs";
  import AppButton from "./AppButton.svelte";
  import SubAppsList from "./SubAppsList.svelte";
  import { catchErrors } from "../../frontend/Util/error";
  import type { Collection } from "svelte-collections";
  import { t } from "../../l10n/l10n";

  export let selectedApp: MustangApp;
  export let showApps: Collection<MustangApp>;

  $: railApps = sortRailApps($showApps.contents);

  function sortRailApps(apps: MustangApp[]): MustangApp[] {
    const firstApps: MustangApp[] = [ mailMustangApp, calendarMustangApp, contactsMustangApp ];
    return [
      ...firstApps.filter(app => apps.includes(app)),
      ...apps.filter(app => !firstApps.includes(app) && app != settingsMustangApp),
    ];
  }

  function onSelectApp(app: MustangApp) {
    openApp(app, app.windowParams);
  }

  function isSelected(app: MustangApp, current: MustangApp): boolean {
    return !!current && (current == app || app.subApps.includes(current));
  }
</script>

<style>
  .nav-rail {
    flex: 0 0 auto;
    width: var(--lo-nav-rail-width);
    align-items: center;
    gap: 8px;
    padding: var(--lo-ribbon-tab-row-height) 0 8px 0;
    background-color: var(--lo-window-bg);
  }
</style>
