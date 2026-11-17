<hbox class="container">
  <select name="" id="" bind:value={dateIntervalSelected}>
    {#each dateIntervalOptions as opt}
      <option value={opt.value}>{opt.label}</option>
    {/each}
  </select>
  <hbox class="icon">
    <ChevronsUpDownIcon size={16} strokeWidth={2}/>
  </hbox>
</hbox>



<script lang="ts">
  import ChevronsUpDownIcon from "lucide-svelte/icons/chevrons-up-down";
  import type { DateInterval } from "./selected";
  import { t } from "../../l10n/l10n";

  export let dateInterval: DateInterval; /* in/out */

  function dateIntervalLabel(interval: DateInterval) {
    if (interval == 0) {
      return $t`List`;
    } else if (interval == 1) {
      return $t`Day`;
    } else if (interval == 5) {
      return $t`Work week`;
    } else if (interval == 7) {
      return $t`Week`;
    } else if (interval == 31) {
      return $t`Month`;
    } else if (interval == 28) {
      return $t`4 Weeks`;
    } else if (interval == 2) {
      return $t`Day/Month`;
    } else {
      return $t`${interval} days`;
    }
  }

  let dateIntervalSelected = dateInterval.toString();
  $: dateInterval = parseInt(dateIntervalSelected) as DateInterval;
  const dateIntervalOptions = [
    { value: "1", label: dateIntervalLabel(1) },
    { value: "5", label: dateIntervalLabel(5) },
    { value: "7", label: dateIntervalLabel(7) },
    { value: "2", label: dateIntervalLabel(2) },
    { value: "28", label: dateIntervalLabel(28) },
    { value: "31", label: dateIntervalLabel(31) },
    { value: "0", label: dateIntervalLabel(0) },
  ];
</script>

<style>
  .container {
    position: relative;
  }
  select {
    background-color: transparent;
    border: 1px solid var(--border);
    transition: border-color 100ms;
    height: 30px;
    -webkit-tap-highlight-color: transparent;
    text-align: left;
    padding-block: 2px;
    padding-inline-start: 12px;
    padding-inline-end: 36px;
    border-radius: 4px;
    appearance: none;
  }
  .icon {
    position: absolute;
    top: 0px;
    bottom: 0px;
    right: 0px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    color: var(--input-placeholder);
    pointer-events: none;
  }
</style>
