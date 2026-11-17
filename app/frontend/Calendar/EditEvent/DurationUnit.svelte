<select id="duration-unit" bind:value={unitInSeconds} {disabled}
  on:change={unitChanged}>
  {#if !allDay}
    <option value={k1MinuteS}>{$plural(durationInUnit, { one: 'minute', other: 'minutes' })}</option>
  {/if}
  <option value={k1HourS}>{$plural(durationInUnit, { one: 'hour', other: 'hours' })}</option>
  <option value={k1DayS}>{$plural(durationInUnit, { one: 'day', other: 'days' })}</option>
</select>

<script lang="ts">
  import { k1DayS, k1HourS, k1MinuteS } from "../../../logic/util/date";
  import { plural } from "../../../l10n/l10n";
  import { createEventDispatcher } from 'svelte';
  const dispatchEvent = createEventDispatcher<{ setAllDay: boolean }>();

  /** in/out */
  export let durationInSeconds: number;
  /** in/out */
  export let durationInUnit: number;
  /** in only */
  export let allDay = false;
  export let disabled = false;

  let unitInSeconds: number;

  /** You must call this on:input when the user changed the input field of `durationInUnit` */
  export function onDurationInUnitChanged() {
    durationInSeconds = durationInUnit * unitInSeconds;
  }

  function unitChanged() {
    adaptAllDays();
    durationInSeconds = durationInUnit * unitInSeconds;
  }

  function adaptAllDays() {
    if (unitInSeconds == k1HourS) {
      dispatchEvent("setAllDay", false);
    } else if (unitInSeconds == k1DayS) {
      dispatchEvent("setAllDay", true);
    }
  }

  $: durationInSeconds, secondsToUnit()
  function secondsToUnit() {
    durationInUnit = durationInSeconds / unitInSeconds;
  }

  $: allDay && onDaysOnly()
  function onDaysOnly() {
    durationInSeconds = Math.round(Math.ceil(Math.max(durationInSeconds, 1) / k1DayS) * k1DayS);
    newUnit(k1DayS);
  }

  $: durationInSeconds, onDurationChanged()
  function onDurationChanged() {
    // Adapt unit
    if (durationInSeconds % k1DayS == 0 && allDay) {
      newUnit(k1DayS);
    } else if (durationInSeconds % k1HourS == 0) {
      newUnit(k1HourS);
    } else if (unitInSeconds != k1MinuteS) {
      newUnit(k1MinuteS);
    }
  }

  function newUnit(aUnitInSeconds: number) {
    unitInSeconds = aUnitInSeconds;
    durationInUnit = durationInSeconds / aUnitInSeconds;
  }
</script>

<style>
</style>
