<select
  on:change={event => adaptAllDays(event.target.value)}
  bind:value={durationInSeconds}><!-- `on:change` must be before `bind:value` in the code, to get the value before the `Event.duration` setter adapts it -->
  {#if allDay}
    <option value={1 * k1HourS}>{$plural(1, { one: 'hour', other: 'hours' })}</option>
    {#each kDayOptions as day}
      <option value={day * k1DayS}>{day} {$plural(day, { one: 'day', other: 'days' })}</option>
    {/each}
    <option value={3 * k1DayS}>{$t`Other`}</option>
{:else}
    {#each kMinOptions as min}
      <option value={min * k1MinuteS}>{min} {$plural(min, { one: 'minute', other: 'minutes' })}</option>
    {/each}
    {#each kHourOptions as hour}
      <option value={hour * k1HourS}>{hour} {$plural(hour, { one: 'hour', other: 'hours' })}</option>
    {/each}
    <option value={1 * k1DayS}>1 {$plural(1, { one: 'day', other: 'days' })}</option>
    <option value={2 * k1DayS}>2+ {$plural(2, { one: 'day', other: 'days' })}</option>
    <option value={1 * k1MinuteS}>{$t`Other`}</option>
  {/if}
</select>

<script lang="ts">
  import { plural, t } from "../../../l10n/l10n";
  import { createEventDispatcher } from 'svelte';
  const dispatchEvent = createEventDispatcher<{ setAllDay: boolean }>();

  /** fh in/out */
  export let durationInSeconds: number;
  /** in only */
  export let allDay = false;

  function adaptAllDays(newValue: number) {
    let oldValue = durationInSeconds;
    if (newValue < k1DayS && oldValue >= k1DayS) {
      dispatchEvent("setAllDay", false);
    } else if (k1DayS <= newValue && k1DayS > oldValue) {
      dispatchEvent("setAllDay", true);
      durationInSeconds = newValue;
    }
  }
</script>

<script lang="ts" context="module">
  import { k1DayS, k1HourS, k1MinuteS } from "../../../logic/util/date";

  const kMinOptions = [10, 15, 20, 30, 45];
  const kHourOptions = [1, 1.5, 2, 4];
  const kDayOptions = [1, 2, 5];
  export const kOptionsInS = kMinOptions.map(min => min * k1MinuteS)
    .concat(kHourOptions.map(hour => hour * k1HourS))
    .concat(kDayOptions.map(day => day * k1DayS));
</script>
