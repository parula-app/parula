<div class="schedule-view" bind:this={scrollEl} on:scroll={onScroll}
  style="--name-width: {kNameWidth}px; --px-per-hour: {pxPerHour}px; --slot-width: {pxPerHour * timeScale / 60}px; --track-width: {trackWidth}px">
  <div class="head" style="height: {kRulerHeight * rulers.length}px">
    <vbox class="corner">
      {#each rulers as ruler}
        <div class="zone-label" class:primary={ruler.isPrimary} style="height: {kRulerHeight}px"
          title={rulers.length > 1 ? ruler.shownLabel(range.days[0]) : null}>
          {rulers.length > 1 ? ruler.shownLabel(range.days[0]) : ruler.label}
        </div>
      {/each}
    </vbox>
    <div class="track">
      {#each rulers as ruler, r}
        {#each ruler.dateSegments(range.days) as segment}
          <div class="date" class:primary={ruler.isPrimary}
            class:today={ruler.isPrimary && segment.time.toDateString() == $now.toDateString()}
            style="top: {r * kRulerHeight}px; left: {segment.startMinute * pxPerHour / 60}px; width: {(segment.endMinute - segment.startMinute) * pxPerHour / 60}px">
            <span class="date-label">{ruler.dateFormat.format(segment.time)}</span>
          </div>
        {/each}
        {#each range.days as day, d}
          {#each hours as hour}
            <div class="hour" class:divided={r < rulers.length - 1} style="top: {r * kRulerHeight + kRulerHeight / 2}px; left: {d * dayWidth + hour * pxPerHour}px; width: {pxPerHour}px">
              {ruler.hourLabelOn(day, hour)}
            </div>
          {/each}
        {/each}
      {/each}
    </div>
  </div>
  {#each rows as row (row.calendar.id)}
    <ScheduleRow calendar={row.calendar} events={row.events} days={range.days} {pxPerHour} {timeScale}
      nowMinute={showsNow ? nowMinute : null}
      isSelected={$selectedCalendar == row.calendar} on:slotmenu />
  {:else}
    <div class="empty">{$t`Select a calendar in the folder pane to show it here`}</div>
  {/each}
</div>

<script lang="ts">
  import type { CalendarColumnGroup } from "../DayView/DayViewGrid.svelte";
  import type { CalendarRange } from "../CalendarRange";
  import { ScheduleLayout } from "./ScheduleLayout";
  import { now, eventPeek, timeZoneRulers } from "../selected";
  import { selectedCalendar } from "../../../frontend/Calendar/selected";
  import ScheduleRow from "./ScheduleRow.svelte";
  import { t } from "../../../l10n/l10n";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import { tick } from "svelte";

  export let range: CalendarRange;
  export let rows: CalendarColumnGroup[];

  const timeScaleSetting = getLocalStorage<number>("lookout.calendar.timeScale", 30);
  $: timeScale = $timeScaleSetting.value;

  const kNameWidth = 160;
  const kSlotWidth = 56;
  const kRulerHeight = 52;
  const hours = Array.from({ length: 24 }, (_, hour) => hour);

  let scrollEl: HTMLDivElement;

  $: rulers = $timeZoneRulers;
  $: pxPerHour = kSlotWidth * 60 / timeScale;
  $: dayWidth = pxPerHour * 24;
  $: trackWidth = dayWidth * range.days.length;
  $: timeline = new ScheduleLayout([], range.days);
  $: nowMinute = timeline.minuteOf($now);
  $: showsNow = range.contains($now);

  function onScroll() {
    $eventPeek = null;
  }

  $: range.start.getTime(), pxPerHour, scrollToFocus();
  async function scrollToFocus() {
    await tick();
    if (!scrollEl) {
      return;
    }
    let focusMinute = showsNow
      ? Math.max($now.getHours() - 1, 0) * 60
      : 8 * 60;
      // : WorkingHours.combined(rows.map(row => WorkingHours.ofCalendar(row.calendar))).firstWorkMinute(range.days);
    let dayIndex = showsNow ? Math.floor(nowMinute / ScheduleLayout.kMinutesPerDay) : 0;
    scrollEl.scrollLeft = dayIndex * dayWidth + focusMinute * pxPerHour / 60;
  }
</script>

<style>
  .schedule-view {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    overflow: auto;
  }
  .head {
    position: sticky;
    top: 0;
    z-index: 4;
    display: flex;
    width: calc(var(--name-width) + var(--track-width));
    background-color: var(--lo-pane-bg);
    border-block-end: 1px solid var(--lo-border);
  }
  .corner {
    position: sticky;
    left: 0;
    z-index: 1;
    flex: none;
    width: var(--name-width);
    background-color: var(--lo-pane-bg);
    border-inline-end: 1px solid var(--lo-border);
  }
  .zone-label {
    box-sizing: border-box;
    padding: 26px 8px 0 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: end;
    line-height: 26px;
    color: var(--lo-fg-secondary);
  }
  .zone-label.primary {
    font-weight: 600;
    color: var(--lo-fg);
  }
  .track {
    position: relative;
    flex: none;
    width: var(--track-width);
  }
  .date {
    position: absolute;
    height: 26px;
    box-sizing: border-box;
    border-inline-start: 1px solid var(--lo-border);
    border-block-end: 1px solid var(--lo-divider);
    line-height: 26px;
    white-space: nowrap;
  }
  .date.primary {
    font-weight: 600;
  }
  .date.today {
    color: var(--lo-accent-text);
  }
  .date-label {
    position: sticky;
    left: calc(var(--name-width) + 8px);
    padding-inline: 8px;
  }
  .hour {
    position: absolute;
    height: 26px;
    box-sizing: border-box;
    padding-inline-start: 6px;
    border-inline-start: 1px solid var(--lo-divider);
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
    line-height: 26px;
    white-space: nowrap;
  }
  .hour.divided {
    border-block-end: 1px solid var(--lo-divider);
  }
  .empty {
    position: sticky;
    left: 0;
    width: max-content;
    padding: 32px 16px;
    color: var(--lo-fg-secondary);
  }
</style>
