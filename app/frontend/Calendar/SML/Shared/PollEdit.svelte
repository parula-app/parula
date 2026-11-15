<vbox class="time-poll-create">
  <!--<hbox class="question">
    <hbox class="label">{$t`Meeting objective`}</hbox>
    <input type="text" bind:value={timePoll.name} />
  </hbox>-->
  <hbox class="length">
    <hbox class="label">{$t`Duration`}</hbox>
    <DurationSelector bind:durationInSeconds={timePoll.duration} />
  </hbox>
  <Splitter initialRightRatio={0.3} leftMinWidth={600} rightMinWidth={300} name="meeting-time-poll-edit">
    <EditCalendar {options} duration={timePoll.duration} slot="left" />
    <vbox class="list" slot="right">
      <hbox class="label answers">{$t`Possible times`}</hbox>
      <EditList {options} duration={timePoll.duration} showEndTime={false} />
    </vbox>
  </Splitter>
</vbox>

<script lang="ts">
  import { SMLData } from "../../../../logic/Mail/SML/SMLData";
  import type { TSMLTimePoll } from "../../../../logic/Mail/SML/TSML";
  import EditCalendar from "./EditCalendar.svelte";
  import EditList from "./EditList.svelte";
  import DurationSelector from "../../EditEvent/DurationSelector.svelte";
  import Splitter from "../../../Shared/Splitter.svelte";
  import { syncArrayColl } from "../../../../logic/util/collections";
  import { t } from "../../../../l10n/l10n";

  export let sml: SMLData;
  $: timePoll = $sml.sml as any as TSMLTimePoll;
  $: options = syncArrayColl(timePoll.options, date => date.getTime());
</script>

<style>
  .label {
    white-space: nowrap;
    margin-inline-end: 12px;
    opacity: 70%;
  }
  .question {
    align-items: baseline;
  }
  .question input {
    font-weight: bold;
    margin-block: 4px;
  }
  .answers {
    margin-block-end: 12px;
  }
  .length {
    margin-block-start: 8px;
    margin-block-end: 20px;
  }
  .list {
    margin-inline: 24px
  }
</style>
