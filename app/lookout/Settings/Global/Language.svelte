<OptionsPage icon={LanguageIcon} description={$t`Set the language preferences for ${appName}`}>
  <OptionsSection title={$t`Display language`}>
    <OptionsRow icon={DisplayLanguageIcon}>
      <hbox class="field-row">
        <label for="options-display-language" class="field-label">{$t`Display language`}</label>
        <ComboBox options={[ { value: "", label: $t`Use system setting` }, ...languages.map(code => ({ value: code, label: localeNames[code] })) ]}
          bind:value={language} on:change={event => { dateTimeFormat = event.detail; }} label={$t`Display language`} width="240px" />
        {#if language != getUILocalePref()}
          <DialogButton label={$t`Save and restart`} icon={RestartIcon} onClick={onSaveLanguage} />
        {/if}
      </hbox>
    </OptionsRow>
  </OptionsSection>
  <OptionsSection title={$t`Date and time format`}>
    <OptionsRow icon={DateFormatIcon}>
      <hbox class="field-row">
        <label for="options-date-format" class="field-label">{$t`Format *=> Format of dates and times, by language and region`}</label>
        <ComboBox options={[ { value: "", label: $t`Same as the display language` }, ...languages.map(code => ({ value: code, label: localeNames[code] })) ]}
          bind:value={dateTimeFormat} on:change={onSaveDateTimeFormat} label={$t`Format *=> Format of dates and times, by language and region`} width="240px" />
      </hbox>
      <grid class="samples">
        <span class="lo-secondary">{$t`Short date *=> Example of the short date format`}</span>
        <span>{sampleDate.toLocaleDateString(dateTimeFormatDisplayed, { year: "numeric", month: "2-digit", day: "2-digit" })}</span>
        <span class="lo-secondary">{$t`Long date *=> Example of the long date format`}</span>
        <span>{sampleDate.toLocaleDateString(dateTimeFormatDisplayed, { dateStyle: "long" })}</span>
        <span class="lo-secondary">{$t`Time *=> Example of the time format`}</span>
        <span>{sampleDate.toLocaleTimeString(dateTimeFormatDisplayed, { hour: "numeric", minute: "numeric" })}</span>
      </grid>
    </OptionsRow>
  </OptionsSection>
</OptionsPage>

<script lang="ts">
  import { appGlobal } from "../../../logic/app";
  import { appName } from "../../../logic/build";
  import { localeNames } from "../../../l10n/list";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import OptionsPage from "../Shared/OptionsPage.svelte";
  import OptionsSection from "../Shared/OptionsSection.svelte";
  import OptionsRow from "../Shared/OptionsRow.svelte";
  import LanguageIcon from "lucide-svelte/icons/languages";
  import DisplayLanguageIcon from "lucide-svelte/icons/monitor";
  import DateFormatIcon from "lucide-svelte/icons/calendar-clock";
  import RestartIcon from "lucide-svelte/icons/rotate-ccw";
  import { getUILocale, getUILocalePref, getDateTimeLocale, getDateTimeLocalePref, saveDateTimeLocale, saveUILocale, setUILocale, t } from "../../../l10n/l10n";

  const languages = Object.keys(localeNames);

  // <copied from="../../../frontend/Settings/Global/Appearance.svelte">
  let language = getUILocalePref();
  let dateTimeFormat = getDateTimeLocalePref();
  let dateTimeFormatDisplayed = getDateTimeLocale();

  const sampleDate = new Date(new Date().getFullYear() + 1, 0, 20, 13, 0, 0);

  async function onSaveLanguage() {
    saveUILocale(language);
    setUILocale(getUILocale());
    onSaveDateTimeFormat();
    await appGlobal.remoteApp.restartApp(); // unfortunately needed for the strings in ts modules
  }

  function onSaveDateTimeFormat() {
    saveDateTimeLocale(dateTimeFormat);
    dateTimeFormatDisplayed = getDateTimeLocale();
  }
  // </copied>
</script>

<style>
  grid.samples {
    display: grid;
    grid-template-columns: 136px auto;
    gap: 2px 8px;
    margin-block-start: 4px;
  }
</style>
