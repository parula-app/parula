<SectionTitle label={$t`Repeat`}>
  <hbox>
    <select value={frequency} class="selector"
      on:change={(ev) => catchErrors(() => onFrequencyChanged(ev.currentTarget?.value))}>
      <option value={Frequency.None}>{$t`none`}</option>
      <option value={Frequency.Daily}>{$t`daily`}</option>
      <option value={Frequency.Weekly}>{$t`weekly`}</option>
      <option value={Frequency.Monthly}>{$t`monthly`}</option>
      <option value={Frequency.Yearly}>{$t`yearly`}</option>
    </select>
  </hbox>
</SectionTitle>

{#if frequency != Frequency.None }
  <vbox class="frequency">
    {#if frequency == Frequency.Daily }
      <RadioGroup bind:value={daily} items={dailyOptions} vertical={true}
        on:change={() => catchErrors(onDailyOptionChanged)}
        disabled={$event.startTime.getDay() == 0 || $event.startTime.getDay() == 6}
        />
    {:else if frequency == Frequency.Weekly }
      <hbox class="weekdays">
        <hbox class="label">{$t`On days`}</hbox>
        <hbox class="options">
          {#each weekdayOptions as weekday}
            <RoundButton
              label={weekday.tooltip}
              selected={weekdays.includes(weekday.value)}
              onClick={() => onWeekdayChanged(weekday.value)}
              disabled={weekday.disabled}
              border={false}
              classes="plain weekday"
              >
              <hbox class="weekday-content" slot="icon">{weekday.label}</hbox>
            </RoundButton>
          {/each}
        </hbox>
      </hbox>
    {:else if frequency == Frequency.Monthly }
      <RadioGroup value={week} items={monthWeekOptions} vertical={true}
        on:change={(ev) => catchErrors(() => onWeekChanged(ev.detail))} />
    {:else if frequency == Frequency.Yearly }
      <RadioGroup value={week} items={yearWeekOptions} vertical={true}
        on:change={(ev) => catchErrors(() => onWeekChanged(ev.detail))} />
    {/if}
  </vbox>

  <hbox class="every">
    <label for="every">{$t`Every`}</label>
    <input class="auto" type="number" min={1} max={99} value={interval} id="every"
      on:change={(ev) => catchErrors(() => onIntervalChanged(ev.currentTarget.value))} />
    <select value={frequency} class="selector"
      on:change={(ev) => catchErrors(() => onFrequencyChanged(ev.currentTarget.value))}>
      <option value={Frequency.Daily}>{$plural(interval, { one: 'day', other: 'days' })}</option>
      <option value={Frequency.Weekly}>{$plural(interval, { one: 'week', other: 'weeks' })}</option>
      <option value={Frequency.Monthly}>{$plural(interval, { one: 'month', other: 'months' })}</option>
      <option value={Frequency.Yearly}>{$plural(interval, { one: 'year', other: 'years' })}</option>
    </select>
  </hbox>
{/if}

<!-- end
<hbox>
  <Radio label="{$t`Forever`}" bind:group={end} value="none" />
</hbox>
<hbox>
  <Radio class="inline" label="{$t`For `}" bind:group={end} value="count" />
  <input class="auto" type="number" min={1} max={99} bind:value={count} on:input={() => end = "count"}>
  {$plural(count, { one: 'time', other: 'times' })}
</hbox>
<hbox>
  <Radio class="inline" label="{$t`Until`}" bind:group={end} value="date" />
  <DateInput date={seriesEndTime} min={minDate} on:change={() => end = "date"} />
</hbox>
  // import DateInput from "./DateInput.svelte";
  // import { Radio } from "@svelteuidev/core";
-->

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { Frequency } from "../../../logic/Calendar/RecurrenceRule";
  import SectionTitle from './SectionTitle.svelte';
  import RadioGroup, { type RadioOption } from "./RadioGroup.svelte";
  import RoundButton from '../../Shared/RoundButton.svelte';
  import { catchErrors } from "../../Util/error";
  import { kAllWeekdays, weekdayLabel } from "../../../logic/util/date";
  import { arrayRemove, assert } from '../../../logic/util/util';
  import { getDateTimeLocale, t, plural } from "../../../l10n/l10n";

  export let event: Event;

  $: master = $event.parentEvent ?? event;
  $: frequency = $master.recurrenceRule?.frequency ?? Frequency.None;
  $: interval = $master.recurrenceRule?.interval ?? 1;
  // end // let count = Number.isFinite(event.recurrenceRule?.count) ? event.recurrenceRule.count : 1;
  $: weekdays = $master.recurrenceRule?.weekdays?.slice() ?? [$event.startTime.getDay()];
  $: week = $master.recurrenceRule?.week ?? 0;
  // end // let end = event.recurrenceRule?.seriesEndTime ? "date" : Number.isFinite(event.recurrenceRule?.count) ? "count" : "none";
  // end // let seriesEndTime = master.recurrenceRule?.seriesEndTime || event.startTime;
  let minDate = event.startTime;
  let daily = "everyday";
  let dailyOptions: RadioOption[] = [
    { label: $t`Every day`, value: "everyday" },
    { label: $t`Monday to Friday`, value: "weekday" },
  ];
  let weekdayOptions: RadioOption[];
  let monthWeekOptions: RadioOption[];
  let yearWeekOptions: RadioOption[];

  $: startTime = $event.startTime.getTime();
  $: timezone = $event.timezone;
  $: duration = $event.duration;
  $: startTime, timezone, duration, updateDateUI();
  function updateDateUI() {
    master.startEditing();
    master.startTime = event.startTime;
    master.timezone = event.timezone;
    master.duration = event.duration;
    master.newRecurrenceRule(frequency, interval, week, weekdays);
    let localStartTime = master.recurrenceRule.seriesStartTime;
    week = master.recurrenceRule.week;
    weekdays = master.recurrenceRule.weekdays?.slice() ?? [localStartTime.getUTCDay()];

    yearWeekOptions = [{ label: $t`On ${localStartTime.toLocaleDateString(getDateTimeLocale(), { day: "numeric", month: "long", timeZone: "UTC" })}`, value: 0 }];
    monthWeekOptions = [{ label: $t`On ${localStartTime.toLocaleDateString(getDateTimeLocale(), { day: "numeric", timeZone: "UTC" })}. of every month`, value: 0 }];

    let weekday = localStartTime.toLocaleDateString(getDateTimeLocale(), { weekday: "long", timeZone: "UTC" });
    let weekno = Math.ceil(localStartTime.getUTCDay() / 7);
    if (weekno < 5) {
      let weekname = [
        $t`first *=> as in: On the first Wednesday in July`,
        $t`second *=> as in: On the second Wednesday in July`,
        $t`third *=> as in: On the third Wednesday in July`,
        $t`fourth *=> as in: On the fourth Wednesday in July`,
      ][weekno - 1];
      yearWeekOptions.push({ label: $t`On the ${weekname} ${weekday} in ${localStartTime.toLocaleDateString(getDateTimeLocale(), { month: "long", timeZone: "UTC" })} *=> On the third Wednesday in September`, value: weekno });
      monthWeekOptions.push({ label: $t`On the ${weekname} ${weekday} *=> On the third Wednesday of each month`, value: weekno });
    }

    if (isLastWeekOfMonth(localStartTime)) {
      let weekname = $t`last *=> as in: On the last Wednesday in July`;
      yearWeekOptions.push({ label: $t`On the ${weekname} ${weekday} in ${localStartTime.toLocaleDateString(getDateTimeLocale(), { month: "long", timeZone: "UTC" })} *=> On the third Wednesday in September`, value: 5 });
      monthWeekOptions.push({ label: $t`On the ${weekname} ${weekday} *=> On the third Wednesday of each month`, value: 5 });
    }

    weekdayOptions = kAllWeekdays.map(weekday => ({
      value: weekday,
      disabled: weekday == localStartTime.getUTCDay(),
      label: weekdayLabel(weekday, "narrow"),
      tooltip: weekdayLabel(weekday, "long"),
    }));

    /* end
    if (seriesEndTime <= event.startTime) {
      seriesEndTime = new Date(event.startTime);
      seriesEndTime.setHours(23, 59, 59, 0);
    }*/
    minDate = event.startTime;
    event.notifyObservers();
  }

  function isLastWeekOfMonth(date: Date) {
    date = new Date(date);
    date.setUTCDate(date.getUTCDate() + 7);
    return date.getUTCDate() < 8;
  }

  function onDailyOptionChanged() {
    if (daily == "everyday") {
      return;
    }
    weekdays = [1, 2, 3, 4, 5];
    interval = 1;
    frequency = Frequency.Weekly;
    daily = "everyday";
    master.startEditing();
    master.newRecurrenceRule(frequency, interval, week, weekdays);
  }

  function onWeekChanged(item: RadioOption) {
    let newWeek = item.value;
    master.startEditing();
    master.newRecurrenceRule(frequency, interval, newWeek, weekdays);
  }

  function onWeekdayChanged(weekday: number) {
    if (weekdays.includes(weekday)) { // toggle
      arrayRemove(weekdays, weekday);
    } else {
      weekdays.push(weekday);
    }
    master.startEditing();
    master.newRecurrenceRule(frequency, interval, week, weekdays);
  }

  function onIntervalChanged(newValue: string) {
    interval = Number(newValue);
    master.startEditing();
    master.newRecurrenceRule(frequency, interval, week, weekdays);
  }

  async function onFrequencyChanged(newValue: string) {
    frequency = newValue as Frequency;
    assert(frequency, "Need frequency");
    if (frequency == Frequency.None && master.recurrenceRule) {
      master.startEditing();
      master.recurrenceRule = null;
    } else if (frequency != master.recurrenceRule?.frequency) {
      master.startEditing();
      master.newRecurrenceRule(frequency, interval, week, weekdays);
    }
  }
</script>

<style>
  .frequency {
    margin-block-start: 14px;
    margin-block-end: 14px;
  }
  label {
    margin-inline-end: 8px;
  }
  input {
    width: 100%;
    margin-inline-end: 8px;
  }
  input[type=number] {
    text-align: right;
  }
  input.auto {
    width: auto;
  }
  .weekdays {
    flex-wrap: wrap;
  }
  .weekdays .options {
    flex-wrap: wrap;
  }
  .weekdays .label {
    margin-inline-end: 12px;
  }
  .weekdays :global(.weekday) {
    width: 24px;
    height: 24px;
    background-color: var(--headerbar-bg);
    color: var(--headerbar-fg);
    margin-inline-end: 4px;
  }
  .weekdays :global(.weekday.selected:not(:hover)) {
    background-color: var(--selected-bg);
    color: var(--selected-fg);
  }
  .weekdays :global(.weekday.disabled) {
    opacity: inherit;
  }
  .every {
    flex-wrap: wrap;
  }
  :global(.inline) {
    display: inline-flex !important;
  }
</style>
