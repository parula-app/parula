<!-- <copied to="PollCalendar.svelte"> -->
 <vbox class="calendar">
  <hbox class="range-header">
    <DateRange bind:date={dateStart} dateInterval={7} />
  </hbox>
  <DayViewGrid
    events={appGlobal.calendarEvents}
    overlayEvents={optionsAsEvents}
    start={dateStart}
    showDays={7}
    showHours={6}
    defaultFocusHour={focusHour}
    >
    <hbox class="hover" slot="event-hover" let:start let:end let:empty>
      {#if empty}
        <EventProposal {start} {end}>
          <hbox slot="buttons">
            <Button
              label={$t`Add`}
              icon={PlusIcon}
              onClick={() => addOption(start)}
              />
          </hbox>
        </EventProposal>
      {/if}
    </hbox>
    <hbox class="option" slot="event-overlay" let:start let:end>
      <EventProposal {start} {end}>
        <hbox slot="end">
          <Button
            label={$t`Time option`}
            icon={AcceptedIcon}
            iconOnly plain
            disabled={true}
            classes="accepted"
            />
        </hbox>
        <hbox slot="buttons">
          <Button
            label={$t`Remove time option`}
            icon={RemoveIcon}
            iconOnly
            onClick={() => removeOption(start)}
            classes="remove"
            />
        </hbox>
      </EventProposal>
    </hbox>
  </DayViewGrid>
</vbox>

<script lang="ts">
  import { Event } from "../../../../logic/Calendar/Event";
  import { getToday } from "../../../../logic/util/date";
  import { appGlobal } from "../../../../logic/app";
  import DayViewGrid from "../../DayView/DayViewGrid.svelte";
  import EventProposal from "./EventProposal.svelte";
  import DateRange from "../../DateRange.svelte";
  import Button from "../../../Shared/Button.svelte";
  import PlusIcon from "lucide-svelte/icons/plus";
  import AcceptedIcon from "lucide-svelte/icons/check";
  import RemoveIcon from "lucide-svelte/icons/x";
  import { t } from "../../../../l10n/l10n";
  import { Collection } from "svelte-collections";

  export let options: Collection<Date>;
  /** in minutes */
  export let duration: number;

  /** The week to show first */
  export let dateStart = getToday();
  export let focusHour = new Date().getHours() - 2;

  function addOption(time: Date) {
    options.add(time);
  }
  function removeOption(time: Date) {
    options.remove(time);
  }

  $: optionsAsEvents = $options.map(start => {
    let event = new Event();
    event.startTime = start;
    event.durationMinutes = duration;
    return event;
  });
</script>

<style>
  .calendar {
    height: 50vh;
  }
  .range-header {
    justify-content: center;
  }
  .calendar :global(.day-header) {
    max-height: 2em;
    overflow: hidden;
  }
  .calendar :global(.day-header .date-day) {
    flex-direction: row;
    align-items: center;
    padding: 4px 8px;
  }
  .calendar :global(.day-header .date-day .date) {
    font-size: 100%;
  }
  .calendar :global(.day-header .date-day .weekday) {
    font-size: 80%;
    margin-block-start: -1px;
    margin-inline-start: 6px;
  }
  .hover,
  .option {
    height: 100%;
    width: 100%;
  }
  .calendar .option :global(button.accepted) {
    opacity: 100%;
  }
  .option :global(button.accepted .icon) {
    color: green;
  }
  .option :global(button.remove .icon) {
    color: red;
  }
</style>
