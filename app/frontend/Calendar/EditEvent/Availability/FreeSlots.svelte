<vbox class="free-slots" flex>
  <hbox class="range-header">
    <hbox class="range">
      <DateRange bind:date={day} dateInterval={7} {showDays} />
    </hbox>
    <hbox class="days-switcher">
      <IslandSwitcher faint={false}>
        <Button label="5" tooltip="{$t`Work week`}" onClick={() => showDaysSetting.value = 5} selected={showDays == 5} />
        <Button label="7" tooltip={$t`Week`} onClick={() => showDaysSetting.value = 7} selected={showDays == 7} />
      </IslandSwitcher>
    </hbox>
  </hbox>
  <AvailabilityLoader {event} from={weekStart} to={weekEnd} bind:freeBusy>
    {#if freeBusy.hasInformation}
      <vbox class="grid-container" flex
        bind:offsetHeight={visibleHeight} bind:offsetWidth={visibleWidth}>
        <Scroll bind:this={scrollE}>
          <grid class="slots-grid" style="--days: {showDays}; --hours: {rows.length}; --row-height: {rowHeight}px">
            <hbox class="corner header" />
            {#each days as shownDay, i}
              <vbox class="day-header header" style="grid-column: {i + 2}">
                <hbox class="date">{shownDay.toLocaleDateString(getDateTimeLocale(), { day: "numeric" })}</hbox>
                <hbox class="weekday">{shownDay.toLocaleDateString(getDateTimeLocale(), { weekday: "long" })}</hbox>
              </vbox>
            {/each}
            {#each rows as row, r}
              <hbox class="time-label" style="grid-row: {r + 2}">
                {#if visibleWidth > 400}
                <TimeLabel time={row.time} />
                {/if}
              </hbox>
              {#each row.slots as slot, i}
                {#if slot}
                  <Clickable onClick={() => expandedSlot = expandedSlot == slot ? null : slot}>
                    <vbox class="slot font-small availability-{slot.availability}"
                      style="grid-row: {r + 2}; grid-column: {i + 2}"
                      class:meeting={slot.startTime < $event.endTime && slot.endTime > $event.startTime}
                      class:expanded={expandedSlot == slot}
                      title={slotDetails(slot)}>
                      <hbox class="time">
                        <span class="with-ampm">{getTimeString(slot.startTime)}</span>
                        <span class="without-ampm">{getTimeStringWithoutAMPM(slot.startTime)}</span>
                      </hbox>
                      {#if expandedSlot == slot}
                        <vbox class="details">
                          {#if slot.busy.hasItems}
                            <hbox class="detail">{$t`Busy: ${names(slot.busy)}`}</hbox>
                          {/if}
                          {#if slot.free.hasItems}
                            <hbox class="detail">{$t`Free: ${names(slot.free)}`}</hbox>
                          {/if}
                          {#if slot.unknown.hasItems}
                            <hbox class="detail">{$t`Unknown: ${names(slot.unknown)}`}</hbox>
                          {/if}
                        </vbox>
                        {#if slot.startTime.getTime() != $event.startTime.getTime()}
                          <hbox class="buttons">
                            <Button label={$t`Use this time`} classes="use-time" onClick={() => moveMeetingTo(slot.startTime)} />
                          </hbox>
                        {/if}
                      {/if}
                    </vbox>
                  </Clickable>
                {/if}
              {/each}
            {/each}
          </grid>
        </Scroll>
      </vbox>
    {:else}
      <hbox class="no-info">
        {!freeBusy.rows.length
          ? $t`Nobody is invited yet`
          : freeBusy.isSupported
          ? $t`The availability of the participants is unknown`
          : $t`This calendar doesn't provide the availability of other people`}
      </hbox>
    {/if}
  </AvailabilityLoader>
</vbox>

<script lang="ts">
  import type { Event } from "../../../../logic/Calendar/Event";
  import type { Participant } from "../../../../logic/Calendar/Participant";
  import type { FreeBusy, FreeBusySlot } from "../../../../logic/Calendar/FreeBusy";
  import AvailabilityLoader from "./AvailabilityLoader.svelte";
  import TimeLabel from "../../DayView/TimeLabel.svelte";
  import DateRange from "../../DateRange.svelte";
  import Scroll from "../../../Shared/Scroll.svelte";
  import Clickable from "../../../Shared/Clickable.svelte";
  import Button from "../../../Shared/Button.svelte";
  import IslandSwitcher from "../../../Shared/IslandSwitcher.svelte";
  import { getLocalStorage } from "../../../Util/LocalStorage";
  import { getTimeString, getTimeStringWithoutAMPM, getWeekDays, getWeekStart } from "../../../../logic/util/date";
  import type { Collection } from "svelte-collections";
  import { tick } from "svelte";
  import { getDateTimeLocale, t } from "../../../../l10n/l10n";

  /** The meeting. "Use this time" moves it.
   * in/out */
  export let event: Event;
  /** How many hours fit at least into the visible height.
   * A higher view shows more hours. */
  export let showHours = 5;

  const kStartHour = 8;
  const kEndHour = 18;
  const kSlotMinutes = 60;

  /** 5 = Mon-Fri, 7 = Mon-Sun */
  const showDaysSetting = getLocalStorage("calendar.freeSlots.days", 5);
  $: showDays = $showDaysSetting.value;

  /** The meeting's week, or the week that the user went to */
  $: meetingWeekStartTime = getWeekStart($event.startTime).getTime();
  $: day = new Date(meetingWeekStartTime);
  $: weekStart = getWeekStart(day);
  $: weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + showDays);
  $: days = getWeekDays(weekStart).slice(0, showDays);

  let freeBusy: FreeBusy | null = null;
  let rows: { time: Date, slots: (FreeBusySlot | undefined)[] }[] = [];
  let expandedSlot: FreeBusySlot | null = null;
  $: freeBusy, setRows();
  function setRows() {
    let slots = freeBusy?.slots(days, kStartHour, kEndHour, kSlotMinutes);
    rows = [];
    for (let hour = kStartHour; hour < kEndHour; hour++) {
      let starts = days.map(shownDay => new Date(shownDay.getFullYear(), shownDay.getMonth(), shownDay.getDate(), hour));
      rows.push({
        time: starts[0],
        slots: starts.map(start => slots?.find(slot => slot.startTime.getTime() == start.getTime())),
      });
    }
  }

  function names(participants: Collection<Participant>): string {
    return participants.contents.map(participant => participant.name || participant.emailAddress).join(", ");
  }

  function slotDetails(slot: FreeBusySlot): string {
    return [
      `${getTimeString(slot.startTime)} – ${getTimeString(slot.endTime)}`,
      slot.busy.hasItems ? $t`Busy: ${names(slot.busy)}` : null,
      slot.free.hasItems ? $t`Free: ${names(slot.free)}` : null,
      slot.unknown.hasItems ? $t`Unknown: ${names(slot.unknown)}` : null,
    ].filter(line => line).join("\n");
  }

  // <copied from="../TimeBox.svelte" onStartTimeChanged()>
  function moveMeetingTo(start: Date) {
    let duration = event.duration;
    event.startTime = new Date(start);
    event.duration = duration;
  }
  // </copied>

  let scrollE: Scroll;
  let visibleHeight = 0;
  let visibleWidth = 0;
  const kMaxRowHeight = 50;
  $: rowHeight = Math.max(visibleHeight / (kEndHour - kStartHour), Math.min(visibleHeight / showHours, kMaxRowHeight));
  $: meetingHour = $event.startTime.getHours();
  $: weekStart, meetingHour, rowHeight, scrollToMeeting();
  async function scrollToMeeting() {
    await tick();
    scrollE?.scrollTo(Math.max(meetingHour - 1 - kStartHour, 0) * rowHeight);
  }
</script>

<style>
  .free-slots {
    min-height: 0;
  }
  .range-header {
    flex-wrap: wrap;
    align-items: center;
    justify-content: end;
  }
  .range {
    flex: 1 0 auto;
    justify-content: center;
  }
  .range :global(.date-range) {
    min-width: none;
  }
  .days-switcher {
    white-space: nowrap;
    margin-block-end: 4px;
  }
  .grid-container {
    min-height: 0;
  }
  .slots-grid {
    display: grid;
    grid-template-columns: max-content repeat(var(--days), minmax(0, 1fr));
    grid-template-rows: max-content repeat(var(--hours), minmax(var(--row-height), auto));
    gap: 2px 3px;
  }
  .header {
    position: sticky;
    top: 0;
    z-index: 1;
    background-color: var(--bg);
  }
  .day-header {
    grid-row: 1;
    min-width: 0;
    padding: 4px 8px;
    border-left: 1px dotted var(--border);
  }
  .date {
    font-size: 90%;
    white-space: nowrap;
  }
  .weekday {
    display: block;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 70%;
  }
  .time-label {
    grid-column: 1;
  }
  .slot {
    min-width: 0;
    padding: 2px 6px;
    box-sizing: border-box;
    overflow: hidden;
    line-height: 1.3;
    --slot-border: color-mix(in srgb, var(--slot-color) 65%, black);
    border: 1px solid color-mix(in srgb, var(--slot-border) 50%, transparent);
    border-radius: calc(var(--border-radius) / 2);
    background-color: var(--slot-color);
    color: black;
    cursor: pointer;
    container-type: inline-size;
  }
  .slot.availability-free {
    --slot-color: #CBF3E1;
  }
  .slot.availability-partly {
    --slot-color: #F9F791;
  }
  .slot.availability-busy {
    --slot-color: #FF7676;
  }
  @media (prefers-color-scheme: dark) {
    .slot {
      --slot-border: color-mix(in srgb, var(--slot-color) 60%, var(--bg));
      background-color: color-mix(in srgb, var(--slot-color) 30%, var(--bg));
      color: var(--fg);
    }
    .slot.availability-free {
      --slot-color: #3FBF8F;
    }
    .slot.availability-partly {
      --slot-color: #D8CF3A;
    }
    .slot.availability-busy {
      --slot-color: #E05555;
    }
  }
  .slot:hover {
    border-color: color-mix(in srgb, var(--fg) 50%, transparent);
  }
  .slot.meeting {
    border: 2px solid var(--fg);
  }
  .time {
    white-space: nowrap;
  }
  .without-ampm {
    display: none;
  }
  @container (width < 8.4ch) {
    .with-ampm {
      display: none;
    }
    .without-ampm {
      display: inline;
    }
  }
  @container (width < 5ch) {
    .time {
      font-size: 10px;
      line-height: 12px;
    }
  }
  .availability-free .time {
    font-weight: 600;
  }
  .details {
    max-height: calc(10 * 1.3em);
    overflow: hidden;
    margin-block-start: 2px;
  }
  .detail {
    display: block;
    overflow-wrap: anywhere;
  }
  .buttons {
    margin-block: 4px 2px;
  }
  .no-info {
    margin: 12px;
    opacity: 70%;
  }
</style>
