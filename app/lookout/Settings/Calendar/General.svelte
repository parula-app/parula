<OptionsPage icon={CalendarIcon} description={$t`Change the settings for calendars, meetings, and time zones`}>
  <!-- {#if calendar}
    {#key calendar}
      <CalendarWorkHours account={calendar}>
        <svelte:fragment slot="calendar">
          {#if $calendars.length > 1}
            <span>{$t`Calendar`}</span>
            <hbox class="calendar-chooser">
              <ComboBox options={$calendars.contents.map(entry => ({ value: entry, label: entry.name }))}
                bind:value={calendar} label={$t`Calendar`} width="280px" />
            </hbox>
          {/if}
        </svelte:fragment>
      </CalendarWorkHours>
    {/key}
  {/if} -->

  <OptionsSection title={$t`Calendar options`}>
    <OptionsRow icon={DurationIcon}>
      <hbox class="field-row">
        <label for="options-event-duration">{$t`Default duration for new appointments and meetings`}</label>
        <ComboBox options={durations.map(minutes => ({ value: minutes, label: durationLabel(minutes) }))}
          bind:value={$defaultDuration.value} label={$t`Default duration for new appointments and meetings`} width="160px" />
      </hbox>
    </OptionsRow>
  </OptionsSection>

  <OptionsSection title={$t`Display options *=> Settings for how the calendar is shown`}>
    <OptionsRow icon={DisplayIcon}>
      <Checkbox label={$t`Show week numbers in the Month View and in the Date Navigator`} bind:checked={$weekNumbers.value} />
      <Checkbox label={$t`Show declined meetings`} bind:checked={$showDeclined.value} />
    </OptionsRow>
  </OptionsSection>

  <OptionsSection title={$t`Time zones`}>
    <OptionsRow icon={TimeZoneIcon}>
      <grid class="time-zone">
        <span>{$t`Label *=> Name shown for the time zone in the calendar`}</span>
        <TextField bind:value={$timeZoneLabel.value} label={$t`Label *=> Name shown for the time zone in the calendar`} width="200px" />
        <span>{$t`Time zone`}</span>
        <ComboBox options={zoneChoices} value={systemZone} label={$t`Time zone`} width={kZoneWidth}
          disabled={$t`The calendar shows the time zone of the operating system`} />
      </grid>
      <Checkbox label={$t`Show a second time zone`} bind:checked={$secondTimeZoneShown.value} />
      <grid class="time-zone indented">
        <span class:disabled={!$secondTimeZoneShown.value}>{$t`Label *=> Name shown for the time zone in the calendar`}</span>
        <TextField bind:value={$secondTimeZoneLabel.value} label={$t`Label of the second time zone`} width="200px"
          disabled={!$secondTimeZoneShown.value} />
        <span class:disabled={!$secondTimeZoneShown.value}>{$t`Time zone`}</span>
        <ComboBox options={zoneChoices} bind:value={$secondTimeZone.value} label={$t`Second time zone`} width={kZoneWidth}
          disabled={!$secondTimeZoneShown.value} />
      </grid>
      <Checkbox label={$t`Show a third time zone`} bind:checked={$thirdTimeZoneShown.value} />
      <grid class="time-zone indented">
        <span class:disabled={!$thirdTimeZoneShown.value}>{$t`Label *=> Name shown for the time zone in the calendar`}</span>
        <TextField bind:value={$thirdTimeZoneLabel.value} label={$t`Label of the third time zone`} width="200px"
          disabled={!$thirdTimeZoneShown.value} />
        <span class:disabled={!$thirdTimeZoneShown.value}>{$t`Time zone`}</span>
        <ComboBox options={zoneChoices} bind:value={$thirdTimeZone.value} label={$t`Third time zone`} width={kZoneWidth}
          disabled={!$thirdTimeZoneShown.value} />
      </grid>
    </OptionsRow>
  </OptionsSection>

  <OptionsSection title={$t`Reminders *=> Reminders for appointments and meetings`}>
    <OptionsRow icon={RemindersIcon}>
      <Checkbox label={$t`Show reminders`} checked={$notifications.value.includes("popup")}
        on:change={event => setNotification("popup", event.detail)} />
      <Checkbox label={$t`Play reminder sound`} checked={$notifications.value.includes("sound")}
        on:change={event => setNotification("sound", event.detail)} />
    </OptionsRow>
  </OptionsSection>

  <CalendarImportExport account={calendar} />
</OptionsPage>

<script lang="ts">
  import type { Calendar } from "../../../logic/Calendar/Calendar";
  import { appGlobal } from "../../../logic/app";
  import { selectedCalendar } from "../../../frontend/Calendar/selected";
  import { TimeZoneChoice, ZoneClock } from "../../Calendar/TimeZones";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import TextField from "../../Shared/Form/TextField.svelte";
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import OptionsPage from "../Shared/OptionsPage.svelte";
  import OptionsSection from "../Shared/OptionsSection.svelte";
  import OptionsRow from "../Shared/OptionsRow.svelte";
  import CalendarImportExport from "./ImportExport.svelte";
  import CalendarIcon from "lucide-svelte/icons/calendar";
  import DurationIcon from "lucide-svelte/icons/calendar-clock";
  import DisplayIcon from "lucide-svelte/icons/calendar-days";
  import TimeZoneIcon from "lucide-svelte/icons/globe";
  import RemindersIcon from "lucide-svelte/icons/bell-ring";
  import { t } from "../../../l10n/l10n";

  const calendars = appGlobal.calendars;
  let calendar: Calendar = $selectedCalendar ?? calendars.first;

  const defaultDuration = getLocalStorage<number>("calendar.defaultEventLengthInMinutes", 60);
  const notifications = getLocalStorage<string[]>("notifications.calendar", ["popup", "sound"]);
  const weekNumbers = getLocalStorage<boolean>("lookout.calendar.weekNumbers", false);
  const showDeclined = getLocalStorage<boolean>("lookout.calendar.showDeclined", true);
  const timeZoneLabel = getLocalStorage<string>("lookout.calendar.timeZone.label", "");
  const secondTimeZoneShown = getLocalStorage<boolean>("lookout.calendar.timeZone2.shown", false);
  const secondTimeZoneLabel = getLocalStorage<string>("lookout.calendar.timeZone2.label", "");
  const secondTimeZone = getLocalStorage<string>("lookout.calendar.timeZone2.zone", "Etc/UTC");
  const thirdTimeZoneShown = getLocalStorage<boolean>("lookout.calendar.timeZone3.shown", false);
  const thirdTimeZoneLabel = getLocalStorage<string>("lookout.calendar.timeZone3.label", "");
  const thirdTimeZone = getLocalStorage<string>("lookout.calendar.timeZone3.zone", "Etc/UTC");

  const kZoneWidth = "420px";
  const systemZone = ZoneClock.systemZone;
  const zoneChoices = TimeZoneChoice.all(undefined, [ systemZone, secondTimeZone.value, thirdTimeZone.value ])
    .map(choice => ({ value: choice.zone, label: choice.label }));

  const kStandardDurations = [ 15, 30, 45, 60, 90, 120 ];
  $: durations = kStandardDurations.includes($defaultDuration.value)
    ? kStandardDurations
    : [ ...kStandardDurations, $defaultDuration.value ].sort((a, b) => a - b);

  function durationLabel(minutes: number): string {
    if (minutes < 60 || minutes % 30) {
      return $t`${minutes} minutes`;
    }
    return minutes == 60 ? $t`1 hour` : $t`${minutes / 60} hours`;
  }

  function setNotification(kind: string, isOn: boolean) {
    let kinds = (notifications.value ?? []).filter(entry => entry != kind);
    notifications.value = isOn ? [ ...kinds, kind ] : kinds;
  }
</script>

<style>
  /* .calendar-chooser {
    grid-column: 2 / -1;
  } */
  .time-zone {
    grid-template-columns: max-content max-content;
    align-items: center;
    gap: 6px 12px;
  }
  .disabled {
    color: var(--lo-fg-disabled);
  }
</style>
