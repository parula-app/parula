<hbox class="edit-poll-times" flex>
  <vbox class="poll-calendar" flex>
    <EditCalendar {options} duration={$event.durationMinutes}
      dateStart={new Date(event.startTime)} focusHour={Math.max(event.startTime.getHours() - 1, 0)} />
  </vbox>
  <vbox class="times">
    <hbox class="label">{$t`Possible times`}</hbox>
    {#if $options.isEmpty}
      <hbox class="empty">{$t`Add the times that you propose`}</hbox>
    {/if}
    <EditList {options} duration={$event.durationMinutes} showEndTime={false} />
  </vbox>
</hbox>

<script lang="ts">
  import type { Event } from "../../../../logic/Calendar/Event";
  import type { SMLData } from "../../../../logic/Mail/SML/SMLData";
  import type { TSMLMeetingTimePoll } from "../../../../logic/Mail/SML/TSML";
  import EditCalendar from "../../SML/Shared/EditCalendar.svelte";
  import EditList from "../../SML/Shared/EditList.svelte";
  import { syncArrayColl } from "../../../../logic/util/collections";
  import { t } from "../../../../l10n/l10n";

  /** The meeting for which the poll proposes times */
  export let event: Event;
  export let sml: SMLData;

  $: options = syncArrayColl((sml.sml as TSMLMeetingTimePoll).options, date => date);
</script>

<style>
  .edit-poll-times {
    flex: 1 0 auto;
    min-height: 250px;
  }
  .poll-calendar {
    min-width: 0;
  }
  .poll-calendar :global(.calendar) {
    flex: 1 1 0;
    height: auto;
    min-height: 0;
  }
  .times {
    width: 200px;
    margin-inline-start: 16px;
    overflow-y: auto;
  }
  .times .label {
    margin-block-end: 8px;
    opacity: 70%;
  }
  .empty {
    opacity: 50%;
  }
  @container availability-poll (max-width: 600px) {
    .edit-poll-times {
      flex-direction: column;
    }
    .poll-calendar {
      min-height: 250px;
    }
    .poll-calendar :global(.day-header .weekday) {
      display: none;
    }
    .times {
      width: auto;
      margin-inline-start: 0;
      margin-block-start: 8px;
    }
  }
</style>
