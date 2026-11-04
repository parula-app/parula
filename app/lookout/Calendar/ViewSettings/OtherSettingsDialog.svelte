<Dialog title={$t`Format Day/Week/Month View`} okLabel={$t`OK`} onOK={save} width="480px" on:close>
  <vbox class="other-settings">
    <GroupBox label={$t`Day and Week`}>
      <hbox class="field-row">
        <span>{$t`Time scale *=> Minutes per row in the day and week views`}</span>
        <ComboBox options={timeScaleOptions} bind:value={chosenTimeScale} label={$t`Time scale *=> Minutes per row in the day and week views`} width="260px" />
      </hbox>
    </GroupBox>
    <GroupBox label={$t`Month and Date Navigator`}>
      <Checkbox label={$t`Show week numbers in the Month View and in the Date Navigator`} bind:checked={chosenWeekNumbers} />
    </GroupBox>
    <GroupBox label={$t`Meetings *=> Settings for meetings in the calendar`}>
      <Checkbox label={$t`Show declined meetings`} bind:checked={chosenShowDeclined} />
    </GroupBox>
  </vbox>
</Dialog>

<script lang="ts">
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import GroupBox from "../../Shared/Form/GroupBox.svelte";
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import { t } from "../../../l10n/l10n";

  export let timeScale: number;
  export let weekNumbers: boolean;
  export let showDeclined: boolean;

  let chosenTimeScale = timeScale;
  let chosenWeekNumbers = weekNumbers;
  let chosenShowDeclined = showDeclined;

  const timeScaleOptions = [60, 30, 15, 10, 6, 5].map(minutes => ({ value: minutes, label: timeScaleLabel(minutes) }));

  // <copied from="../CalendarRibbon.svelte">
  function timeScaleLabel(minutes: number): string {
    if (minutes == 60) {
      return $t`60 minutes - Least space for details`;
    }
    if (minutes == 5) {
      return $t`5 minutes - Most space for details`;
    }
    return $t`${minutes} minutes`;
  }
  // </copied>

  function save() {
    timeScale = chosenTimeScale;
    weekNumbers = chosenWeekNumbers;
    showDeclined = chosenShowDeclined;
  }
</script>

<style>
  .other-settings {
    gap: 12px;
  }
  .field-row {
    align-items: center;
    gap: 12px;
  }
</style>
