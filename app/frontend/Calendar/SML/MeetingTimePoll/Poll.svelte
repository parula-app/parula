<vbox class="meeting-time-poll" flex>
  <vbox class="view-switcher">
    <IslandSwitcher large>
      <Button
        label={$t`List`}
        icon={ListIcon}
        onClick={() => showCalendar = false}
        selected={!showCalendar}
        />
      <Button
        label={$t`Calendar`}
        icon={CalendarIcon}
        onClick={() => showCalendar = true}
        selected={showCalendar}
        />
    </IslandSwitcher>
  </vbox>

  {#if showCalendar}
    <PollCalendar {options} duration={timePoll.duration} {focusOption} showDays={7}>
      <PollTimeButtons time={start} {myVotes} slot="event-buttons" let:start />
    </PollCalendar>
  {:else}
    <Splitter>
      <Scroll slot="left">
        <vbox class="list">
          <DisplayList {options} duration={timePoll.duration} showEndTime={true}
            on:optionclick={ev => focusOption = ev.detail}>
            <!--<Button
              label={$t`Show in calendar`}
              icon={CalendarIcon}
              iconOnly plain
              onClick={() => showOptionInCalendar(option)}
              slot="center"
              let:option
              />-->
            <PollTimeButtons time={option} {myVotes} slot="right" let:option on:changed={() => focusOption = option} />
          </DisplayList>
        </vbox>
      </Scroll>
      <PollCalendar {options} duration={timePoll.duration} {focusOption} showDays={1} slot="right">
        <PollTimeButtons time={start} {myVotes} slot="event-buttons" let:start />
      </PollCalendar>
    </Splitter>
  {/if}
</vbox>

<script lang="ts">
  import { SMLData } from "../../../../logic/Mail/SML/SMLData";
  import type { TSMLTimePoll, TSMLMeetingTimeVote, TSMLAction } from "../../../../logic/Mail/SML/TSML";
  import PollCalendar from "../Shared/PollCalendar.svelte";
  import PollTimeButtons from "./PollTimeButtons.svelte";
  import DisplayList from "../Shared/DisplayList.svelte";
  import IslandSwitcher from "../../../Shared/IslandSwitcher.svelte";
  import Button from "../../../Shared/Button.svelte";
  import ListIcon from "lucide-svelte/icons/list";
  import CalendarIcon from "lucide-svelte/icons/calendar";
  import { syncArrayColl } from "../../../../logic/util/collections";
  import { t } from "../../../../l10n/l10n";
  import Splitter from "../../../Shared/Splitter.svelte";
  import Scroll from "../../../Shared/Scroll.svelte";

  export let sml: SMLData;
  export let myReaction: TSMLAction;

  $: timePoll = $sml.sml as any as TSMLTimePoll;
  $: options = syncArrayColl(timePoll.options, date => date.getTime());
  $: myVotes = syncArrayColl(myReaction.object as TSMLMeetingTimeVote[] ?? []);

  let showCalendar = false;
  $: focusOption = $options.first;
  /*function showOptionInCalendar(option: Date) {
    focusOption = option;
    showCalendar = true;
  }*/
</script>

<style>
  .meeting-time-poll {
    margin: 16px;
  }
  .view-switcher {
    align-items: center;
    margin-block-end: 8px;
  }
  .list {
    align-self: center;
    height: 100%;
    width: 300px;
    margin-inline: 32px;
  }
</style>
