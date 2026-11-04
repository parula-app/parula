{#if isOnlineMeeting && !canJoin}
  <span class="icon" title={$t`Online meeting`}>
    <OnlineMeetingIcon size="12" />
  </span>
{/if}
{#if $event.recurrenceCase == RecurrenceCase.Instance}
  <span class="icon" title={$t`Recurring event`}>
    <RecurringIcon size="12" />
  </span>
{:else if $event.recurrenceCase == RecurrenceCase.Exception}
  <span class="icon exception" title={$t`Changed occurrence of a recurring event`}>
    <RecurringIcon size="12" />
  </span>
{/if}

<script lang="ts">
  import { RecurrenceCase, type Event } from "../../../logic/Calendar/Event";
  import { now } from "../selected";
  import { k1MinuteMS } from "../../../logic/util/date";
  import RecurringIcon from "lucide-svelte/icons/repeat";
  import OnlineMeetingIcon from "lucide-svelte/icons/video";
  import { t } from "../../../l10n/l10n";

  export let event: Event;

  // <copied to="../DayView/EventContainer.svelte">
  const kJoinableBeforeStartMS = 15 * k1MinuteMS;
  $: isOnlineMeeting = $event.isOnline && !!$event.onlineMeetingURL;
  $: canJoin = isOnlineMeeting && $event.startTime.getTime() - kJoinableBeforeStartMS <= $now.getTime() && $now < $event.endTime;
  // </copied>
</script>

<style>
  .icon {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
  }
  .exception::after {
    content: "";
    position: absolute;
    left: 50%;
    top: -2px;
    bottom: -2px;
    width: 1.5px;
    background-color: currentColor;
    transform: rotate(-45deg);
  }
</style>
