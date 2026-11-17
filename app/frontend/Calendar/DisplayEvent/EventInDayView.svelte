<vbox class="calendar" flex>
  <hbox class="header">
    <hbox flex />
    <hbox class="date">
      {getFormattedDateString(calendarStart, { weekday: "short", day: "numeric", month: "short" })}
    </hbox>
    <hbox class="buttons" flex>
      <RoundButton
        label={$t`Open calendar`}
        icon={CalendarIcon}
        onClick={() => openEvent(event, false)}
        border={false}
        />
    </hbox>
  </hbox>
  <DayViewGrid
    events={appGlobal.calendarEvents}
    overlayEvents={isInCalendar ? null : new ArrayColl([event])}
    range={new CalendarRange("day", calendarStart)}
    {showHours}
    defaultFocusHour={calendarStart.getHours() + calendarStart.getMinutes() / 60 - 1}
    >
    <hbox class="proposal" slot="event-overlay" let:start let:end let:event>
      <EventProposal {start} {end}>
        <slot name="event-buttons" slot="buttons" {event} {start} {end} />
      </EventProposal>
    </hbox>
    <hbox slot="day-header" /><!-- Removed here. We add it above. -->
  </DayViewGrid>
</vbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { openEvent } from "../open";
  import { appGlobal } from "../../../logic/app";
  import DayViewGrid from "../DayView/DayViewGrid.svelte";
  import { CalendarRange } from "../CalendarRange";
  import EventProposal from "../SML/Shared/EventProposal.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import CalendarIcon from "lucide-svelte/icons/calendar";
  import { getFormattedDateString } from "../../../logic/util/date";
  import { t } from "../../../l10n/l10n";
  import { ArrayColl } from "svelte-collections";

  export let event: Event;
  export let showHours = 4;

  $: calendarStart = new Date($event?.startTime?.getTime());

  let calendarEvents = appGlobal.calendarEvents;
  // Avoid showing the same event twice #1405
  $: isInCalendar = $calendarEvents.some(ev => ev.isSameUID($event));
</script>

<style>
  .header {
    align-items: center;
  }
  .buttons {
    justify-content: end;
  }
  .calendar :global(.header) {
    background-color: var(--leftbar-bg);
  }
  .calendar :global(.time.label) {
    width: 1.1em;
    max-height: 1.3em;
    overflow: hidden;
    font-size: 70%;
    margin-inline-end: 6px;
  }
  .proposal {
    height: 100%;
    width: 100%;
  }
  .proposal :global(.event-proposal) {
    background-color: rgb(0, 159, 159);
    color: white;
  }
</style>
