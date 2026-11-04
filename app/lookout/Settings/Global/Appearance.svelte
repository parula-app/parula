<OptionsPage icon={GeneralIcon} description={$t`General options for working with ${appName}`}>
  <OptionsSection title={$t`Personalize your copy of ${appName}`}>
    <OptionsRow icon={UserInterfaceIcon}>
      <hbox class="field-row">
        <label for="options-frontend" class="field-label">{$t`User interface`}</label>
        <ComboBox options={[ { value: "classic", label: appName == "Lookout" ? "Parula" : appName }, { value: "lookout", label: "Lookout" } ]}
          bind:value={frontend} label={$t`User interface`} width="200px" />
        {#if frontend != $frontendSetting.value}
          <DialogButton label={$t`Switch`} icon={SwitchIcon} onClick={onSaveFrontend} />
        {/if}
      </hbox>
    </OptionsRow>
    <OptionsRow icon={ThemeIcon}>
      <hbox class="field-row">
        <label for="options-theme" class="field-label">{$t`Theme *=> Color scheme of the app`}</label>
        <ComboBox options={[ { value: "system", label: $t`Use system setting` }, { value: "light", label: $t`Light` }, { value: "dark", label: $t`Dark` } ]}
          value={$themeSetting.value} on:change={event => onSwitchTheme(event.detail)} label={$t`Theme *=> Color scheme of the app`} width="200px" />
      </hbox>
    </OptionsRow>
  </OptionsSection>

  <OptionsSection title={$t`Start up options`}>
    <OptionsRow icon={DefaultAppIcon}>
      {#if isDefaultApp}
        <hbox class="default-app">
          <DoneIcon size={16} />
          {$t`${appName} is the default program for email links on this computer`}
        </hbox>
      {:else}
        <hbox>
          <DialogButton label={$t`Make ${appName} the default program for email`} onClick={setDefaultApp} />
        </hbox>
      {/if}
    </OptionsRow>
  </OptionsSection>
</OptionsPage>

<script lang="ts">
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import { openApp } from "../../../frontend/AppsBar/selectedApp";
  import { mailMustangApp } from "../../../frontend/Mail/MailMustangApp";
  import { appGlobal } from "../../../logic/app";
  import { appName, defaultFrontend } from "../../../logic/build";
  import { catchErrors } from "../../../frontend/Util/error";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import OptionsPage from "../Shared/OptionsPage.svelte";
  import OptionsSection from "../Shared/OptionsSection.svelte";
  import OptionsRow from "../Shared/OptionsRow.svelte";
  import GeneralIcon from "lucide-svelte/icons/settings";
  import ThemeIcon from "lucide-svelte/icons/sun-moon";
  import UserInterfaceIcon from "lucide-svelte/icons/panels-top-left";
  import SwitchIcon from "lucide-svelte/icons/arrow-left-right";
  import DefaultAppIcon from "lucide-svelte/icons/mail-check";
  import DoneIcon from "lucide-svelte/icons/check";
  import { t } from "../../../l10n/l10n";

  // <copied from="../../../frontend/Settings/Global/Appearance.svelte">
  let frontendSetting = getLocalStorage("appearance.frontend", defaultFrontend);
  let frontend = frontendSetting.value;
  function onSaveFrontend() {
    openApp(mailMustangApp, {});
    frontendSetting.value = frontend;
  }
  // </copied>

  // <copied from="../../../frontend/Settings/Global/ThemeSwitcher.svelte">
  let themeSetting = getLocalStorage("appearance.theme", "system");
  let colorsSetting = getLocalStorage("appearance.colors", {});
  function onSwitchTheme(newTheme: string) {
    themeSetting.value = newTheme;
    colorsSetting.value = {};
  }
  // </copied>

  // <copied from="../../../frontend/Settings/Global/SystemIntegration.svelte">
  let isDefaultApp = false;
  $: catchErrors(checkIsDefaultApp);
  async function checkIsDefaultApp() {
    isDefaultApp = await appGlobal.remoteApp.isDefaultApp("mailto");
  }
  async function setDefaultApp() {
    isDefaultApp = await appGlobal.remoteApp.setAsDefaultApp("mailto");
  }
  // </copied>
</script>

<style>
  .default-app {
    align-items: center;
    gap: 8px;
  }
  .default-app :global(svg) {
    color: var(--lo-success);
  }
</style>
