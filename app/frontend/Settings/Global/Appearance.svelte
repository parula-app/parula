<vbox class="appearance">
  {#if !appGlobal.isMobile}
    <HeaderGroupBox>
      <hbox slot="header">{$t`User interface`}</hbox>
      <hbox class="frontend">
        <label>
          <input type="radio" value="classic" bind:group={frontend} />
          {appName == "Lookout" ? "Parula" : appName}
        </label>
        <label>
          <input type="radio" value="lookout" bind:group={frontend} />
          Lookout
        </label>
        {#if frontend != $frontendSetting.value}
          <Button
            label={$t`Switch`}
            icon={SwitchIcon}
            onClick={onSaveFrontend}
            classes="restart"
            />
        {/if}
      </hbox>
    </HeaderGroupBox>
  {/if}

  <HeaderGroupBox>
    <hbox slot="header">{$t`Dark mode`}</hbox>
    <ThemeSwitcher />
  </HeaderGroupBox>

  <HeaderGroupBox>
    <hbox slot="header">{$t`Colors`}</hbox>
    <AppThemeColors />
  </HeaderGroupBox>

  <HeaderGroupBox>
    <hbox slot="header">{$t`Language`}</hbox>
    <hbox class="wrap">
      <vbox class="setting language">
        <hbox class="subheader">{$t`App *=> Software application`}</hbox>
        <hbox class="dropdown">
          <LanguageDropDown bind:language on:change={() => catchErrors(onChangedLanguage)} />
        </hbox>
        {#if language != getUILocalePref()}
          <Button
            label="Save and restart"
            icon={RestartIcon}
            onClick={onSaveLanguage}
            classes="restart"
            />
        {/if}
      </vbox>
      <vbox class="setting date-format">
        <hbox class="subheader">{$t`Date and time format`}</hbox>
        <hbox class="dropdown">
          <LanguageDropDown bind:language={dateTimeFormat} on:change={() => catchErrors(onSaveDateTimeFormat)} />
        </hbox>
        <hbox class="sample">
          {sampleDate.toLocaleString(dateTimeFormatDisplayed, { year: "numeric", month: "2-digit", day: "2-digit" })}
        </hbox>
        <hbox class="sample">
          {sampleDate.toLocaleString(dateTimeFormatDisplayed, { dateStyle: "long" })}
        </hbox>
        <hbox class="sample">
          {sampleDate.toLocaleString(dateTimeFormatDisplayed, { hour: "numeric", minute: "numeric" })}
        </hbox>
      </vbox>
    </hbox>
  </HeaderGroupBox>
</vbox>

<script lang="ts">
  import { getUILocale, getUILocalePref, getDateTimeLocale, getDateTimeLocalePref, saveDateTimeLocale, saveUILocale, setUILocale, t } from "../../../l10n/l10n";
  import { appGlobal } from "../../../logic/app";
  import { appName, defaultFrontend } from "../../../logic/build";
  import { getLocalStorage } from "../../Util/LocalStorage";
  import { openApp } from "../../AppsBar/selectedApp";
  import { mailMustangApp } from "../../Mail/MailMustangApp";
  import ThemeSwitcher from "./ThemeSwitcher.svelte";
  import AppThemeColors from "./AppThemeColors.svelte";
  import LanguageDropDown from "./LanguageDropDown.svelte";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import Button from "../../Shared/Button.svelte";
  import RestartIcon from "lucide-svelte/icons/rotate-ccw";
  import SwitchIcon from "lucide-svelte/icons/arrow-left-right";
  import { catchErrors } from "../../Util/error";

  let frontendSetting = getLocalStorage("appearance.frontend", defaultFrontend);
  let frontend = frontendSetting.value;

  function onSaveFrontend() {
    openApp(mailMustangApp, {});
    frontendSetting.value = frontend;
  }

  let language = getUILocalePref();
  let dateTimeFormat = getDateTimeLocalePref();
  let dateTimeFormatDisplayed = getDateTimeLocale();
  const sampleDate = new Date(new Date().getFullYear() + 1, 0, 20, 13, 0, 0);

  async function onSaveLanguage() {
    saveUILocale(language);
    setUILocale(getUILocale());
    await onSaveDateTimeFormat();
    await appGlobal.remoteApp.restartApp(); // unfortunately needed for the strings in ts modules
  }

  async function onChangedLanguage() {
    dateTimeFormat = language;
  }

  async function onSaveDateTimeFormat() {
    saveDateTimeLocale(dateTimeFormat);
    dateTimeFormatDisplayed = getDateTimeLocale();
  }
</script>

<style>
  .wrap {
    flex-wrap: wrap;
    margin-block-end: -16px;
  }
  .setting {
    margin-inline-end: 32px;
    margin-block-end: 24px;
  }
  .subheader {
    font-weight: 500;
    margin-block-end: 6px;
  }
  .dropdown {
    margin-inline-start: -2px;
    margin-block-end: 8px;
  }
  .language .dropdown {
    margin-block-end: 24px;
  }
  .frontend {
    align-items: center;
    min-height: 40px;
  }
  .frontend label {
    margin-inline-end: 24px;
  }
  .appearance :global(.theme svg) {
    width: 32px;
    height: 32px;
  }
  .appearance :global(.restart) {
    margin-inline-start: 24px;
  }
</style>
