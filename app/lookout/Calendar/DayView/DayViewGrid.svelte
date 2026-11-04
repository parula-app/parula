<div class="time-grid" bind:this={scrollEl} on:scroll={onScroll} bind:clientHeight={viewHeight}
  style="--head-height: {headHeight}px">
  <div class="head" bind:offsetHeight={headHeight}>
    {#if isSplit}
      <div class="row" style="grid-template-columns: {columns}">
        {#each groups as group, g}
          <CalendarTab calendar={group.calendar} firstColumn={firstColumnOf(g)} span={range.days.length}
            isFirst={g == 0} />
        {/each}
      </div>
    {/if}
    <div class="row" style="grid-template-columns: {columns}">
      {#each groups as group, g}
        {#each range.days as day, d}
          <DayHeader {day} column={firstColumnOf(g) + d} calendar={group.calendar} isToday={day.toDateString() == $now.toDateString()} on:openday />
        {/each}
      {/each}
    </div>
    <div class="row all-day-row" style="grid-template-columns: {columns}">
      {#if showsZoneLabels}
        <hbox class="zone-labels">
          {#each rulers as ruler, r}
            <span class="zone-label" class:primary={ruler.isPrimary} style="width: {rulerWidths[r]}px"
              title={ruler.shownLabel(range.days[0])}>{ruler.shownLabel(range.days[0])}</span>
          {/each}
        </hbox>
      {/if}
      {#each groupEvents as group, g (group.calendar?.id)}
        <AllDayEvents days={range.days} firstColumn={firstColumnOf(g)} events={group.allDay} calendar={group.calendar} group={g} on:slotmenu />
      {/each}
    </div>
  </div>
  <div class="body" style="grid-template-columns: {columns}; height: {TimeColumnLayout.kMinutesPerDay * pxPerMinute}px; --slot-height: {kSlotHeight}px">
    <hbox class="rulers" bind:this={rulersEl}>
      {#each rulers as ruler, r}
        <TimeRuler {pxPerMinute} labels={rulerLabels[r]} isPrimary={ruler.isPrimary} width={rulerWidths[r]} />
      {/each}
    </hbox>
    {#each groupEvents as group, g (group.calendar?.id)}
      <div class="lines" style="grid-column: {firstColumnOf(g)} / span {range.days.length}">
        {#each slotStarts as minute}
          <div class="slot" class:hour={minute % 60 == 0} />
        {/each}
      </div>
      {#each range.days as day, d}
        <!-- workingHours={$groupWorkingHours[g]} -->
        <DayColumn {day} column={firstColumnOf(g) + d} dayIndex={d} group={g} events={group.timed} calendar={group.calendar}
          {pxPerMinute} {timeScale}
          isToday={day.toDateString() == $now.toDateString()}
          showsPastTimeLine={showsToday && day.getTime() < new Date($now).setHours(0, 0, 0, 0)}
          visibleFromMinute={visibleFromMinute} visibleToMinute={visibleToMinute} on:scrolltominute={event => scrollToMinute(event.detail)} on:slotmenu />
      {/each}
    {/each}
  </div>
</div>

<script lang="ts" context="module">
  import type { Event } from "../../../logic/Calendar/Event";
  import type { Calendar } from "../../../logic/Calendar/Calendar";
  import type { Collection } from "svelte-collections";

  export interface CalendarColumnGroup {
    calendar: Calendar | null;
    events: Collection<Event>;
  }
</script>

<script lang="ts">
  import type { CalendarRange } from "../CalendarRange";
  import { TimeColumnLayout } from "./DayColumn";
  import { now, eventPeek, timeZoneRulers } from "../selected";
  import { selectedDate } from "../../../frontend/Calendar/selected";
  import DayHeader from "./DayHeader.svelte";
  import AllDayEvents from "./AllDayEvents.svelte";
  import DayColumn from "./DayColumn.svelte";
  import TimeRuler from "./TimeRuler.svelte";
  import CalendarTab from "./CalendarTab.svelte";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import { k1DayMS } from "../../../logic/util/date";
  // import { derived } from "svelte/store";
  import { onMount, tick } from "svelte";

  export let range: CalendarRange;
  export let groups: CalendarColumnGroup[];
  export let enlargeSelectedDay = false;

  const timeScaleSetting = getLocalStorage<number>("lookout.calendar.timeScale", 30);
  $: timeScale = $timeScaleSetting.value;
  const kSlotHeight = 24;
  const kRulerWidth = 56;
  // const shownWorkingHours = WorkingHours.ofAll(shownWorkHours);

  let scrollEl: HTMLDivElement;
  let rulersEl: HTMLElement;
  let viewHeight = 0;
  let headHeight = 0;

  $: isSplit = groups.length > 1;
  $: pxPerMinute = kSlotHeight / timeScale;
  $: showsToday = range.contains($now);
  $: rulers = $timeZoneRulers;
  $: showsZoneLabels = rulers.length > 1 || !!rulers[0]?.label;
  $: rulerLabels = rulers.map(ruler => ruler.hourLabels(range.days[0]));
  $: textContext = rulersEl ? textContextOf(rulersEl) : null;
  $: rulerWidths = rulers.map((ruler, r) => rulerWidth(textContext, rulerLabels[r], showsZoneLabels ? ruler.shownLabel(range.days[0]) : ""));
  $: dayColumns = range.days.map(day =>
    enlargeSelectedDay && day.toDateString() == $selectedDate?.toDateString() ? "minmax(0, 3fr)" : "minmax(0, 1fr)").join(" ");
  $: columns = `${rulerWidths.reduce((sum, width) => sum + width, 0)}px ` +
    groups.map(() => dayColumns).join(" 8px ");
  $: slotStarts = Array.from({ length: TimeColumnLayout.kMinutesPerDay / timeScale }, (_, i) => i * timeScale);

  // $: groupWorkingHours = derived(groups.map(group =>
  //   group.calendar ? WorkingHours.of(group.calendar) : shownWorkingHours), all => all);

  let groupEvents: ReturnType<typeof eventsOf>[] = [];
  $: groupEvents = groups.map(group => groupEvents.find(shown => shown.events == group.events) ?? eventsOf(group));
  function eventsOf(group: CalendarColumnGroup) {
    let inRange = group.events.filterObservable(isInRange);
    return {
      calendar: group.calendar,
      events: group.events,
      inRange,
      allDay: inRange.filterObservable(event => isInAllDayArea(event)),
      timed: inRange.filterObservable(event => !isInAllDayArea(event)),
    };
  }
  $: range, filterRange();
  function filterRange() {
    groupEvents.forEach(group => group.inRange.replaceAll(group.events.contents.filter(isInRange)));
  }

  function isInRange(event: Event): boolean {
    return event.startTime < range.end && event.endTime > range.start;
  }

  // <copied to="../DisplayEvent/EventInDayView.ts">
  function isInAllDayArea(event: Event): boolean {
    return event.allDay || event.endTime.getTime() - event.startTime.getTime() >= k1DayMS;
  }
  // </copied>

  function textContextOf(element: Element): CanvasRenderingContext2D | null {
    let context = document.createElement("canvas").getContext("2d");
    let style = getComputedStyle(element);
    if (context) {
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    }
    return context;
  }

  function rulerWidth(context: CanvasRenderingContext2D | null, hourLabels: string[], zoneLabel: string): number {
    const kRulerPadding = 14;
    if (!context) {
      return kRulerWidth;
    }
    let widthOf = (text: string) => Math.ceil(context.measureText(text).width);
    let widest = Math.max(0, ...zoneLabel.split(/\s+/).map(widthOf), ...hourLabels.map(widthOf));
    return Math.max(kRulerWidth, widest + kRulerPadding);
  }

  function firstColumnOf(group: number): number {
    return 2 + group * (range.days.length + 1);
  }

  let topMinute: number | null = null;
  function onScroll() {
    topMinute = scrollEl.scrollTop / pxPerMinute;
    $eventPeek = null;
  }

  $: visibleFromMinute = (topMinute ?? 0) + 1;
  $: visibleToMinute = (topMinute ?? 0) + Math.max(viewHeight - headHeight, 0) / pxPerMinute - 1;

  function scrollToMinute(minute: number) {
    scrollEl.scrollTo({ top: Math.max(minute - timeScale, 0) * pxPerMinute, behavior: "smooth" });
  }

  $: pxPerMinute, restoreScroll();
  async function restoreScroll() {
    await tick();
    if (scrollEl && topMinute != null) {
      scrollEl.scrollTop = topMinute * pxPerMinute;
    }
  }

  onMount(() => {
    let focusMinute = showsToday
      ? Math.max($now.getHours() - 1, 0) * 60
      : 8 * 60;
      // : WorkingHours.combined($groupWorkingHours).firstWorkMinute(range.days);
    scrollEl.scrollTop = focusMinute * pxPerMinute;
    topMinute = focusMinute;
  });
</script>

<style>
  .time-grid {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    position: relative;
  }
  .head {
    position: sticky;
    top: 0;
    z-index: 6;
    background-color: var(--lo-pane-bg);
  }
  .row {
    display: grid;
  }
  .all-day-row {
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }
  .zone-labels {
    grid-column: 1;
    grid-row: 1;
    align-self: end;
    min-width: 0;
  }
  .zone-label {
    flex: none;
    box-sizing: border-box;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    padding-inline: 2px 8px;
    padding-block-end: 2px;
    overflow: hidden;
    text-align: end;
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg-secondary);
  }
  .zone-label.primary {
    color: var(--lo-fg);
  }
  .rulers {
    grid-column: 1;
    grid-row: 1;
    min-width: 0;
    font-size: var(--lo-font-size-small);
  }
  .body {
    display: grid;
    grid-template-rows: 100%;
    position: relative;
  }
  .lines {
    grid-row: 1;
    display: flex;
    flex-direction: column;
    position: relative;
    z-index: 1;
    pointer-events: none;
  }
  .slot {
    flex: none;
    box-sizing: border-box;
    height: var(--slot-height);
    border-top: 1px dotted var(--lo-divider);
  }
  .slot.hour {
    border-top: 1px solid var(--lo-divider);
  }
  .slot:first-child {
    border-top-color: transparent;
  }
</style>
