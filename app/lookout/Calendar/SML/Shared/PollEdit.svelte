<vbox class="time-options-editor">
  {#if showDuration}
    <hbox class="row">
      <span class="row-label">{$t`Duration`}</span>
      <ComboBox options={durationOptions} value={poll.duration} label={$t`Duration`} width="132px"
        on:change={event => setDuration(event.detail)} />
    </hbox>
  {/if}
  <span class="field-label">{$t`Proposed times`}</span>
  <DisplayList {options} duration={poll.duration}
    emptyText={$t`Add the times that you propose`} let:time>
    <button type="button" class="remove" title={$t`Remove this time`} aria-label={$t`Remove this time`}
      on:click={() => removeTime(time)}>
      <RemoveIcon size={14} />
    </button>
  </DisplayList>
  <hbox class="row add-row">
    <span class="row-label">{$t`Start time`}</span>
    <DateField date={newTime} label={$t`Start date`} required on:change={event => setNewDay(event.detail)} />
    <TimeInput time={newTime} options={startTimeOptions(newTime)} label={$t`Start time`}
      on:change={event => newTime = event.detail} />
    <DialogButton label={$t`Add Time`} icon={AddIcon}
      disabled={hasPollOption(poll.options, newTime) ? $t`This time is already proposed` : false}
      onClick={addTime} />
  </hbox>
</vbox>

<script lang="ts">
  import type { SMLData } from "../../../../logic/Mail/SML/SMLData";
  import type { TSMLTimePoll } from "../../../../logic/Mail/SML/TSML";
  import { hasPollOption, addPollOption, removePollOption, nextPollOption } from "./SMLTimeOptions";
  import DisplayList from "./DisplayList.svelte";
  import { startTimeOptions, durationLabel } from "../../EditEvent/TimeOptions";
  import TimeInput from "../../EditEvent/TimeInput.svelte";
  import DateField from "../../../Shared/Form/DateField.svelte";
  import ComboBox from "../../../Shared/Form/ComboBox.svelte";
  import DialogButton from "../../../Shared/Dialog/DialogButton.svelte";
  import AddIcon from "lucide-svelte/icons/plus";
  import RemoveIcon from "lucide-svelte/icons/x";
  import { ArrayColl } from "svelte-collections";
  import { t } from "../../../../l10n/l10n";

  export let sml: SMLData;
  /** false: The poll is for a meeting, which has its duration already */
  export let showDuration = true;

  $: poll = $sml.sml as TSMLTimePoll;
  $: options = new ArrayColl(poll.options ?? []);
  let newTime = nextPollOption(($sml.sml as TSMLTimePoll).options ?? [], ($sml.sml as TSMLTimePoll).duration);

  $: durationOptions = durations(poll.duration).map(minutes => ({ value: minutes, label: durationLabel(minutes) }));

  function durations(current: number): number[] {
    let list = [15, 30, 45, 60, 90, 120, 180, 240, 480];
    if (current && !list.includes(current)) {
      list.push(current);
      list.sort((a, b) => a - b);
    }
    return list;
  }

  function setDuration(minutes: number) {
    poll.duration = minutes;
    poll = poll;
  }

  function setNewDay(day: Date) {
    let time = new Date(day);
    time.setHours(newTime.getHours(), newTime.getMinutes(), 0, 0);
    newTime = time;
  }

  function addTime() {
    addPollOption(poll.options, new Date(newTime));
    poll = poll;
    newTime = nextPollOption(poll.options, poll.duration);
  }

  function removeTime(time: Date) {
    removePollOption(poll.options, time);
    poll = poll;
  }
</script>

<style>
  .time-options-editor {
    gap: 4px;
  }
  .row {
    align-items: center;
    gap: 8px;
  }
  .row-label {
    min-width: 72px;
  }
  .add-row {
    margin-top: 8px;
  }
  .field-label {
    margin-top: 6px;
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
  /* <copied from="../../../Mail/SML/PollEdit.svelte"> */
  .remove {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
  }
  .remove:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  /* </copied> */
</style>
