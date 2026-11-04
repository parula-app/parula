<vbox class="time-box">
  <grid class="time" class:isMultipleDays class:allDay={$event.allDay}>
    <!--{$t`When`} {$t`Start`} import ClockMainIcon from "lucide-svelte/icons/clock-8"; -->
    <hbox class="date-input start" title={$t`Start date`}>
      <DateInput date={event.startTime}
        on:change={ev => onStartTimeChanged(ev.detail)} />
    </hbox>
    <hbox class="time-input start" title={$t`Start time`}>
      {#if !$event.allDay}
        <TimeInput time={event.startTime}
          on:change={ev => onStartTimeChanged(ev.detail)} />
        {#if !showTimezone}
          <hbox class="buttons">
            <RoundButton
              label={$t`Timezone`}
              icon={GlobeIcon}
              disabled={$event.allDay}
              onClick={onTimezoneToggle}
              classes="plain smallest"
              border={false}
              iconSize="16px"
              />
          </hbox>
        {/if}
      {/if}
    </hbox>

    <hbox class="date-input end" title={$t`End date`}>
      {#if isMultipleDays}
        <DateInput bind:date={event.endTime}
          min={$event.startTime}
          deltaInDays={$event.allDay ? -1 : null} />
      <!--
      {:else if $event.allDay}
        <hbox class="buttons">
          <RoundButton
            label={$t`Multiple days`}
            icon={MultipleDaysIcon}
            onClick={onMultipleDays}
            classes="plain smallest"
            border={false}
            iconSize="16px"
            />
        </hbox>
      -->
      {/if}
    </hbox>
    <hbox class="time-input end" title={$t`End time`}>
      {#if !$event.allDay}
        <TimeInput bind:time={event.endTime} />
      {/if}
      <!--
      <hbox class="buttons">
        <RoundButton
          label={$event.allDay ? $t`Specify time` : $t`All day`}
          icon={$event.allDay ? ClockIcon : AllDayIcon}
          onClick={onAllDayToggle}
          classes="plain smallest"
          border={false}
          iconSize="16px"
          />
      </hbox>
      -->
    </hbox>

    {#if showTimezone}
      <vbox class="timezone">
        <hbox class="timezone-selector">
          <!-- <TimezonePicker bind:timezone={event.timezone} /> -->
          <hbox class="buttons">
            <RoundButton
              label={$t`Back to local timezone`}
              icon={XIcon}
              onClick={onResetTimezone}
              classes="plain smallest"
              border={false}
              iconSize="16px"
              padding="2px"
              />
          </hbox>
        </hbox>
        <hbox class="time-in-timezone">
          {$event.startTime?.toLocaleString(getDateTimeLocale(), {
              hour: "numeric", minute: "numeric",
              timeZone: event.timezone,
           })}
          -
          {$event.endTime?.toLocaleString(getDateTimeLocale(), {
            hour: "numeric", minute: "numeric",
            timeZone: event.timezone,
         })}
      </hbox>
      </vbox>
    {:else if !$event.allDay}
      <hbox class="timezone" />
    {/if}
    <hbox class="duration" title={$t`Duration`}>
      {#if customDuration}
        <input type="number"
            min={1} max={2000}
            bind:value={durationInUnit}
            on:input={durationUnit.onDurationInUnitChanged} />
        <DurationUnit
          bind:durationInSeconds={event.duration}
          bind:durationInUnit
          bind:this={durationUnit}
          allDay={event.allDay}
          on:setAllDay={ev => setAllDay(ev.detail)}
          />
      {:else}
        <vbox class="duration-selector">
          <DurationSelector
            bind:durationInSeconds={event.duration}
            allDay={event.allDay}
            on:setAllDay={ev => setAllDay(ev.detail)}
            />
        </vbox>
      {/if}
    </hbox>
  </grid>
</vbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import DateInput from "./DateInput.svelte";
  import TimeInput from "./TimeInput.svelte";
  import DurationUnit from "./DurationUnit.svelte";
  import DurationSelector, { kOptionsInS } from "./DurationSelector.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import AllDayIcon from '../../asset/icon/calendar/24h.svg?raw';
  import ClockIcon from "lucide-svelte/icons/clock";
  import GlobeIcon from "lucide-svelte/icons/globe";
  import MultipleDaysIcon from "lucide-svelte/icons/calendar-plus";
  import XIcon from "lucide-svelte/icons/x";
  // import TimezonePicker from "timezone-picker-svelte";
  import { myTimezone, isSameTimezone } from "../../../logic/util/date";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";

  export let event: Event;

  $: showTimezone = !isSameTimezone($event.timezone, $event.startTime);
  $: $event.endTime, checkEndTime();
  $: isMultipleDays = $event.startTime && $event.endTime &&
    // all day events have the non-inclusive next day as end
    new Date($event.endTime.getTime() - ($event.allDay ? 80000 : 0)).toDateString() != $event.startTime.toDateString();
  $: customDuration = customDuration || !kOptionsInS.includes($event.duration);
  let durationUnit: DurationUnit;
  let durationInUnit: number;
  let previousTimezone: string = null;
  let previousStartTime: Date = null;
  let previousEndTime: Date = null;

  function onMultipleDays() {
    if (!event.allDay) {
      setAllDay(true);
    }
    event.durationDays += 1;
  }

  function onAllDayToggle() {
    setAllDay(!event.allDay);
  }

  function setAllDay(allDay: boolean) {
    event.allDay = allDay;
    if (allDay) {
      previousTimezone = event.timezone;
      event.timezone = null;
      previousStartTime = new Date(event.startTime);
      previousEndTime = new Date(event.endTime);
      clearTime(event.startTime);
      clearTime(event.endTime);
      // Advance to next midnight if the time is not already midnight. RFC 5545 section 3.6.1
      if (event.endTime.getTime() < previousEndTime.getTime()) {
        event.endTime.setDate(event.endTime.getDate() + 1);
      }
    } else {
      if (previousStartTime && previousEndTime) {
        copyTimeOnly(event.startTime, previousStartTime);
        let endTime = event.endTime.getTime();
        copyTimeOnly(event.endTime, previousEndTime);
        // Rewind to the previous day unless the time was midnight.
        if (event.endTime.getTime() > endTime) {
          event.endTime.setDate(event.endTime.getDate() - 1);
        }
      }
      if (previousTimezone) {
        event.timezone = previousTimezone;
      }
    }
    event.notifyObservers();
  }

  // <copied to="Availability/FreeSlots.svelte, Availability/ParticipantsDayView.svelte, ../../../lookout/Calendar/EditEvent/EventTimeEditor.ts">
  function onStartTimeChanged(newTime: Date) {
    let duration = event.duration;
    event.startTime = newTime;
    event.duration = duration;
  }
  // </copied>

  function checkEndTime() {
    if (event.endTime.getTime() <= event.startTime.getTime()) {
      event.endTime.setTime(event.startTime.getTime());
      if (event.allDay) {
        event.durationDays += 1;
      } else {
        event.durationHours += 1;
      }
    }
  }

  function onTimezoneToggle() {
    showTimezone = true;
  }
  function onResetTimezone() {
    event.timezone = myTimezone();
    showTimezone = false;
  }

  // Generic Date util

  function copyTimeOnly(target: Date, source: Date) {
    target.setHours(source.getHours());
    target.setMinutes(source.getMinutes());
    target.setSeconds(source.getSeconds());
    target.setMilliseconds(source.getMilliseconds());
  }

  function clearTime(target: Date) {
    target.setHours(0);
    target.setMinutes(0);
    target.setSeconds(0);
    target.setMilliseconds(0);
  }
</script>

<style>
  .time-box {
    padding: 12px 16px;
  }
  .date-input {
    margin-inline-end: 8px;
  }
  input {
    width: 100%;
  }
  grid.time {
    grid-template-columns: max-content max-content;
    justify-items: start;
    align-items: center;
    margin-block-end: 12px;
  }
  .buttons {
    align-items: center;
  }
  .date-input .buttons {
    align-items: center;
    justify-content: flex-end;
  }
  .time :global(input) {
    padding: 4px 8px;
    margin-block-start: 2px;
  }
  .time-box :global(input:not([type="date"])) {
    max-width: 5em;
    text-align: right;
  }
  .date-input,
  .time-input {
    min-height: 34px;
  }
  .start :global(input) {
    font-weight: bold;
  }
  .date-input :global(input),
  .time-input :global(input) {
    font-size: 16px;
  }
  .duration-selector {
    margin-block: 5px;
  }
  .duration input {
    margin-inline-end: 6px;
  }
  .timezone {
    align-items: center;
    margin-inline-start: 6px;
    margin-block-start: 6px;
  }
  :global(.inline) {
    display: inline-flex !important;
  }
  @container (max-width: 370px) {
    .time-box {
      padding: 8px 12px;
    }
    grid.time {
      grid-template-columns: max-content;
    }
    .date-input.start {
      order: 1;
    }
    .date-input.end {
      order: 2;
    }
    .time-input.start {
      order: 3;
    }
    .time-input.end {
      order: 4;
    }
    .duration {
      order: 5;
    }
    .timezone {
      order: 6;
    }
  }
  @container (max-width: 200px) {
    .duration {
      flex-wrap: wrap;
    }
  }
</style>
