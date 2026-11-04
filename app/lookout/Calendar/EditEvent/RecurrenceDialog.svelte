<Dialog title={isMeeting ? $t`Meeting Recurrence` : $t`Appointment Recurrence`}
  okLabel={$t`OK`} okDisabled={okDisabled} onOK={onOK} width="640px" on:close={onClose}>
  <vbox class="groups">
    <GroupBox label={$t`Appointment time`}>
      <grid class="appointment-time">
        <span class="label">{$t`Start`}</span>
        <TimeInput time={startTime} options={startOptions} label={$t`Start`} disabled={allDay}
          on:change={ev => setStartTime(ev.detail)} />
        <span class="label">{$t`End *=> End time of the event`}</span>
        <TimeInput time={endTime} options={endOptions} label={$t`End *=> End time of the event`} disabled={allDay}
          on:change={ev => setEndTime(ev.detail)} />
        <span class="label">{$t`Duration`}</span>
        <ComboBox options={durationOptions} value={durationMinutes} label={$t`Duration`} width="132px"
          on:change={ev => setDuration(ev.detail)} />
      </grid>
    </GroupBox>

    <GroupBox label={$t`Recurrence pattern`}>
      <hbox class="pattern">
        <vbox class="frequencies">
          {#each frequencies as choice}
            <Radio label={choice.label} name="frequency" value={choice.value} bind:group={pattern.frequency} />
          {/each}
        </vbox>
        <vbox class="options">
          {#if pattern.frequency == Frequency.Daily}
            <hbox class="line">
              <Radio label={$t`Every`} name="daily" value="interval" bind:group={pattern.dailyMode} />
              <SpinBox bind:value={pattern.interval} min={1} max={999} width="64px" label={$t`Interval *=> Number of days, weeks, months or years between the repetitions`}
                on:change={() => { pattern.dailyMode = "interval"; }} />
              {$plural(pattern.interval, { one: "day", other: "days" })}
            </hbox>
            <hbox class="line">
              <Radio label={$t`Every weekday`} name="daily" value="weekdays" bind:group={pattern.dailyMode}
                disabled={!canRepeatOnWeekdays && $t`The series starts on a weekend`} />
            </hbox>
          {:else if pattern.frequency == Frequency.Weekly}
            <hbox class="line">
              {$t`Recur every *=> as in: Recur every 2 weeks`}
              <SpinBox bind:value={pattern.interval} min={1} max={999} width="64px" label={$t`Interval *=> Number of days, weeks, months or years between the repetitions`} />
              {$plural(pattern.interval, { one: "week", other: "weeks" })} {$t`on *=> as in: Every week, on Thursday`}
            </hbox>
            <grid class="weekdays">
              {#each kAllWeekdays as weekday}
                <Checkbox label={weekdayLabel(weekday, "long")}
                  checked={weekday == startWeekday || pattern.weekdays.includes(weekday)}
                  disabled={weekday == startWeekday && $t`The day of the start date`}
                  on:change={() => toggleWeekday(weekday)} />
              {/each}
            </grid>
          {:else if pattern.frequency == Frequency.Monthly}
            <hbox class="line">
              <Radio label={$t`Day ${rangeStart.getDate()} of every *=> as in: Day 15 of every 2 months`}
                name="monthly" value="day" bind:group={pattern.monthlyMode} />
              <SpinBox bind:value={pattern.interval} min={1} max={99} width="64px" label={$t`Interval *=> Number of days, weeks, months or years between the repetitions`}
                on:change={() => { pattern.monthlyMode = "day"; }} />
              {$plural(pattern.interval, { one: "month", other: "months" })}
            </hbox>
            <hbox class="line">
              <Radio label={$t`The *=> as in: The third Thursday of every 2 months`}
                name="monthly" value={weekMode} group={pattern.monthlyMode == "day" ? "day" : weekMode}
                on:change={() => { pattern.monthlyMode = weekMode; }} />
              <ComboBox options={weekOptions} value={weekMode} label={$t`Week of the month`}
                on:change={ev => setWeekMode(ev.detail)} />
              {weekdayName}
              {$t`of every *=> as in: The third Thursday of every 2 months`}
              <SpinBox bind:value={pattern.interval} min={1} max={99} width="64px" label={$t`Interval *=> Number of days, weeks, months or years between the repetitions`} />
              {$plural(pattern.interval, { one: "month", other: "months" })}
            </hbox>
          {:else if pattern.frequency == Frequency.Yearly}
            <hbox class="line">
              {$t`Recur every *=> as in: Recur every 2 weeks`}
              <SpinBox bind:value={pattern.interval} min={1} max={99} width="64px" label={$t`Interval *=> Number of days, weeks, months or years between the repetitions`} />
              {$plural(pattern.interval, { one: "year", other: "years" })}
            </hbox>
            <hbox class="line">
              <Radio label={$t`On ${dayOfYear} *=> as in: On October 15`}
                name="yearly" value="day" bind:group={pattern.monthlyMode} />
            </hbox>
            <hbox class="line">
              <Radio label={$t`On the *=> as in: On the third Thursday of October`}
                name="yearly" value={weekMode} group={pattern.monthlyMode == "day" ? "day" : weekMode}
                on:change={() => { pattern.monthlyMode = weekMode; }} />
              <ComboBox options={weekOptions} value={weekMode} label={$t`Week of the month`}
                on:change={ev => setWeekMode(ev.detail)} />
              {$t`${weekdayName} of ${monthName} *=> as in: (On the third) Thursday of October`}
            </hbox>
          {/if}
        </vbox>
      </hbox>
    </GroupBox>

    <GroupBox label={$t`Range of recurrence`}>
      <hbox class="range">
        <hbox class="range-start">
          <span class="label">{$t`Start`}</span>
          <DateField required date={rangeStart} label={$t`Start of the series`} on:change={ev => setRangeStart(ev.detail)} />
        </hbox>
        <vbox class="range-end">
          <hbox class="line">
            <Radio label={$t`End by *=> as in: End by October 15`} name="end" value="date" bind:group={pattern.end} classes="end-label" />
            <DateField required date={pattern.endDate} label={$t`End of the series`}
              on:change={ev => { pattern.endDate = ev.detail; pattern.end = "date"; }} />
          </hbox>
          <hbox class="line">
            <Radio label={$t`End after *=> as in: End after 10 occurrences`} name="end" value="count" bind:group={pattern.end} classes="end-label" />
            <SpinBox bind:value={pattern.count} min={1} max={999} width="64px" label={$t`Number of occurrences`}
              on:change={() => { pattern.end = "count"; }} />
            {$plural(pattern.count, { one: "occurrence", other: "occurrences" })}
          </hbox>
          <hbox class="line">
            <Radio label={$t`No end date`} name="end" value="none" bind:group={pattern.end} />
          </hbox>
        </vbox>
      </hbox>
    </GroupBox>
  </vbox>

  <svelte:fragment slot="buttons-start">
    <DialogButton label={$t`Remove Recurrence`} disabled={!hasRecurrence} onClick={onRemove} />
  </svelte:fragment>
</Dialog>

<script lang="ts" context="module">
  import type { Event } from "../../../logic/Calendar/Event";
  import { writable } from "svelte/store";

  export const openRecurrence = writable<Event | null>(null);
</script>

<script lang="ts">
  import type { EventEditFlow } from "./EventEditFlow";
  import { EventTimeEditor } from "./EventTimeEditor";
  import { RecurrencePattern, type MonthlyMode } from "./RecurrencePattern";
  import { startTimeOptions, endTimeOptions, durationLabel } from "./TimeOptions";
  import { Frequency } from "../../../logic/Calendar/RecurrenceRule";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import TimeInput from "./TimeInput.svelte";
  import DateField from "../../Shared/Form/DateField.svelte";
  import GroupBox from "../../Shared/Form/GroupBox.svelte";
  import Radio from "../../Shared/Form/Radio.svelte";
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import SpinBox from "../../Shared/Form/SpinBox.svelte";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import { kAllWeekdays, weekdayLabel } from "../../../logic/util/date";
  import { createEventDispatcher } from "svelte";
  import { getDateTimeLocale, plural, t } from "../../../l10n/l10n";

  export let event: Event;
  export let flow: EventEditFlow;
  export let timeEditor: EventTimeEditor;

  const dispatch = createEventDispatcher<{ close: void }>();

  const series = flow.master;
  const seriesTimes = series == event ? timeEditor : new EventTimeEditor(series);
  const isMeeting = event.participants.hasItems;
  const allDay = series.allDay;
  const hasRecurrence = !!series.recurrenceRule;
  let pattern = flow.pattern.clone();
  let rangeStart = new Date(series.startTime);
  let startTime = new Date(series.startTime);
  let durationMinutes = Math.round(series.duration / 60);
  let timesChanged = false;

  const frequencies = [
    { value: Frequency.Daily, label: $t`Daily *=> Repeats every day` },
    { value: Frequency.Weekly, label: $t`Weekly *=> Repeats every week` },
    { value: Frequency.Monthly, label: $t`Monthly *=> Repeats every month` },
    { value: Frequency.Yearly, label: $t`Yearly *=> Repeats every year` },
  ];

  $: endTime = new Date(startTime.getTime() + durationMinutes * 60000);
  $: startOptions = startTimeOptions(startTime);
  $: endOptions = endTimeOptions(startTime, endTime);
  $: durationOptions = durationList(durationMinutes, allDay).map(minutes => ({ value: minutes, label: durationLabel(minutes) }));
  $: startWeekday = rangeStart.getDay();
  $: canRepeatOnWeekdays = RecurrencePattern.canRepeatOnWeekdays(rangeStart);
  $: weekChoices = RecurrencePattern.weekChoices(rangeStart);
  $: weekOptions = weekChoices.map(choice => ({ value: choice.mode, label: choice.label }));
  $: weekMode = weekChoices.find(choice => choice.mode == pattern.monthlyMode)?.mode ?? weekChoices[0].mode;
  $: weekdayName = rangeStart.toLocaleDateString(getDateTimeLocale(), { weekday: "long" });
  $: monthName = rangeStart.toLocaleDateString(getDateTimeLocale(), { month: "long" });
  $: dayOfYear = rangeStart.toLocaleDateString(getDateTimeLocale(), { month: "long", day: "numeric" });
  $: okDisabled = invalidReason(pattern, rangeStart);

  function durationList(current: number, allDay: boolean): number[] {
    const kTimed = [0, 5, 10, 15, 30, 60, 90, 120, 150, 180, 240, 300, 360, 420, 480, 540, 600, 660, 720, 1080, 1440, 2880, 4320, 5760, 10080, 20160];
    const kAllDay = [1440, 2880, 4320, 5760, 7200, 8640, 10080, 20160];
    let list = allDay ? kAllDay : kTimed;
    return list.includes(current) ? list : [...list, current].sort((a, b) => a - b);
  }

  function invalidReason(pattern: RecurrencePattern, rangeStart: Date): string | false {
    if (!(pattern.interval >= 1)) {
      return $t`Please enter a number of 1 or more`;
    }
    if (pattern.end == "count" && !(pattern.count >= 1)) {
      return $t`Please enter a number of 1 or more`;
    }
    let firstDay = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
    if (pattern.end == "date" && pattern.endDate < firstDay) {
      return $t`The end date is before the start date`;
    }
    return false;
  }

  function setStartTime(time: Date) {
    startTime = time;
    timesChanged = true;
  }

  function setEndTime(time: Date) {
    let minutes = Math.round((time.getTime() - startTime.getTime()) / 60000);
    if (minutes < 0) {
      minutes += 24 * 60;
    }
    durationMinutes = minutes;
    timesChanged = true;
  }

  function setDuration(minutes: number) {
    durationMinutes = minutes;
    timesChanged = true;
  }

  function setRangeStart(day: Date) {
    rangeStart = day;
    startTime.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
    startTime = startTime;
    timesChanged = true;
  }

  function toggleWeekday(weekday: number) {
    if (pattern.weekdays.includes(weekday)) {
      pattern.weekdays = pattern.weekdays.filter(day => day != weekday);
    } else {
      pattern.weekdays = [...pattern.weekdays, weekday];
    }
  }

  function setWeekMode(mode: MonthlyMode) {
    pattern.monthlyMode = mode;
  }

  function onOK() {
    if (pattern.monthlyMode != "day") {
      pattern.monthlyMode = weekMode;
    }
    if (hasRecurrence && !timesChanged && pattern.hasSameRuleAs(flow.pattern)) {
      flow.pattern = pattern;
      return;
    }
    series.startEditing();
    if (!allDay) {
      let start = new Date(rangeStart);
      start.setHours(startTime.getHours(), startTime.getMinutes(), 0, 0);
      seriesTimes.setStart(start);
      seriesTimes.setEnd(new Date(start.getTime() + durationMinutes * 60000));
    } else {
      seriesTimes.setStartDate(rangeStart);
      series.durationDays = Math.max(1, Math.round(durationMinutes / 1440));
    }
    flow.applyPattern(pattern);
  }

  function onRemove() {
    flow.removeRecurrence();
    onClose();
  }

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  .groups {
    gap: 12px;
  }
  .label {
    color: var(--lo-fg);
  }
  .appointment-time {
    grid-template-columns: max-content max-content;
    align-items: center;
    column-gap: 12px;
    row-gap: 6px;
  }
  .pattern {
    gap: 16px;
    min-height: 120px;
  }
  .frequencies {
    gap: 8px;
    padding-inline-end: 16px;
    border-inline-end: 1px solid var(--lo-divider);
  }
  .options {
    flex: 1 1 0;
    gap: 6px;
  }
  .line {
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-height: 32px;
  }
  .weekdays {
    grid-template-columns: repeat(4, max-content);
    column-gap: 16px;
    row-gap: 6px;
  }
  .range {
    gap: 16px;
    align-items: start;
  }
  .range-start {
    align-items: center;
    gap: 8px;
    min-height: 32px;
  }
  .range-end {
    flex: 1 1 0;
    gap: 4px;
  }
  .range-end .line {
    flex-wrap: nowrap;
  }
  .range-end :global(.end-label) {
    min-width: 96px;
  }
</style>
