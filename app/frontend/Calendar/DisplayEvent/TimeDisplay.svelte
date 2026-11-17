<hbox class="time font-normal">
  <hbox class="starttime">
    {#if $event.allDay}
      {getDateString($event.startTime)}
    {:else}
      {getDateTimeString($event.startTime)}
    {/if}
  </hbox>
  {#if !$event.allDay && !isSameTimezone($event.timezone, $event.startTime)}
    <hbox class="timezone">
      {getTimezoneDisplay($event.timezone)}
      {$event.startTime?.toLocaleString(getDateTimeLocale(), {
        hour: "numeric", minute: "numeric",
        timeZone: event.timezone,
    })}
    </hbox>
  {/if}
  {#if $event.endTime}
    <hbox class="duration-prefix">
      {$t`for *=> as prefix for a time duration, e.g. 'at 5 PM for 30 minutes'`}
    </hbox>
    <hbox class="duration">
      {getDurationString($event.endTime.getTime() - $event.startTime.getTime())}
    </hbox>
  {/if}
</hbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { getDateTimeString, getDateString, getDurationString, getTimezoneDisplay, isSameTimezone } from "../../../logic/util/date";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";

  export let event: Event;
</script>

<style>
  .time {
    flex-wrap: wrap;
  }
  .starttime {
    font-weight: bold;
  }
  .timezone {
    margin-inline-start: 16px;
  }
  .duration-prefix {
    margin-inline-start: 16px;
    margin-inline-end: 0.3em;
  }
  .duration, .duration-prefix {
    opacity: 80%;
  }
</style>
