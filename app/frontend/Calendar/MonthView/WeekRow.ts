import type { Event } from "../../../logic/Calendar/Event";
import { layoutTimeColumn, kRowsPerHour } from "../DayView/DayColumn";

export interface EventInDayRow {
  event: Event;
  startDay: number;
  endDay: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export interface DayRowLayout {
  events: EventInDayRow[];
  lanes: number;
}

export function layoutDayRow(events: Event[], days: Date[]): DayRowLayout {
  let dayEnds = days.map(day => {
    let dayEnd = new Date(day);
    dayEnd.setDate(dayEnd.getDate() + 1);
    return dayEnd;
  });
  let isOnDay = (event: Event, i: number) => event.startTime < dayEnds[i] && event.endTime > days[i];

  let items: EventInDayRow[] = [];
  for (let event of events) {
    let startDay = days.findIndex((day, i) => isOnDay(event, i));
    if (startDay < 0) {
      continue;
    }
    let endDay = startDay + 1;
    while (endDay < days.length && isOnDay(event, endDay)) {
      endDay++;
    }
    items.push({
      event, startDay, endDay, lane: 0,
      continuesBefore: event.startTime < days[startDay],
      continuesAfter: event.endTime > dayEnds[endDay - 1],
    });
  }

  items.sort((a, b) =>
    a.startDay - b.startDay ||
    (b.endDay - b.startDay) - (a.endDay - a.startDay) ||
    a.event.startTime.getTime() - b.event.startTime.getTime());
  let occupied: boolean[][] = [];
  for (let item of items) {
    let lane = 0;
    while (occupied[lane]?.slice(item.startDay, item.endDay).some(Boolean)) {
      lane++;
    }
    occupied[lane] ??= new Array(days.length).fill(false);
    occupied[lane].fill(true, item.startDay, item.endDay);
    item.lane = lane;
  }
  return { events: items, lanes: occupied.length };
}

export interface EventInWeekRow {
  event: Event;
  startDay: number;
  endDay: number;
  startRow: number;
  endRow: number;
  lane: number;
  lanes: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export class WeekRowLayout {
  static readonly kRowsPerLine = 4;
  static readonly kStartHour = 8;
  static readonly kEndHour = 20;
  readonly events: EventInWeekRow[] = [];
  readonly hiddenEvents: Event[][];

  constructor(events: Event[], protected readonly days: Date[], protected readonly rows: number) {
    let lineRows = WeekRowLayout.kRowsPerLine;
    let bars = layoutDayRow(events.filter(event => event.allDay), days).events;
    let timedEvents = events.filter(event => !event.allDay);
    let segments = this.segmentsInWeek(timedEvents);
    let isOnDay = (item: EventInDayRow, day: number) => item.startDay <= day && day < item.endDay;
    let barsEndRows = (barItems: EventInDayRow[]) => days.map((_, day) =>
      Math.max(0, ...barItems.filter(bar => isOnDay(bar, day)).map(bar => (bar.lane + 1) * lineRows)));
    let allBarsEndRows = barsEndRows(bars);
    let ends = this.stackedEnds(segments, allBarsEndRows);
    let lastRows = days.map((_, day) =>
      allBarsEndRows[day] > rows || segments.some((segment, i) => isOnDay(segment, day) && ends[i] > rows) ? rows - lineRows : rows);
    let shownBars = bars.filter(bar => lastRows.slice(bar.startDay, bar.endDay).every(lastRow => (bar.lane + 1) * lineRows <= lastRow));
    this.events.push(...shownBars.map(({ lane, ...bar }) =>
      ({ ...bar, startRow: lane * lineRows, endRow: (lane + 1) * lineRows, lane: 0, lanes: 1 })));
    let firstRows = barsEndRows(shownBars);
    let shownEvents = timedEvents;
    let shownSegments = segments;
    ends = this.stackedEnds(shownSegments, firstRows);
    let firstOverflow = (day: number) => shownSegments.findIndex((segment, i) => isOnDay(segment, day) && ends[i] > lastRows[day]);
    for (let day of days.keys()) {
      // The first event that doesn't fit and the events after it on this day are hidden.
      // That makes the boxes of the others wider, so check again.
      let overflow = firstOverflow(day);
      while (overflow >= 0) {
        let hidden = shownSegments.slice(overflow).filter(segment => isOnDay(segment, day)).map(segment => segment.event);
        shownEvents = shownEvents.filter(event => !hidden.includes(event));
        shownSegments = this.segmentsInWeek(shownEvents);
        ends = this.stackedEnds(shownSegments, firstRows);
        overflow = firstOverflow(day);
      }
    }
    this.placeByTime(shownSegments, firstRows, lastRows);
    this.events.push(...shownSegments);
    this.hiddenEvents = days.map((_, day) => [
      ...bars.filter(bar => isOnDay(bar, day) && !shownBars.includes(bar)),
      ...segments.filter(segment => isOnDay(segment, day) && !shownEvents.includes(segment.event)),
    ].map(item => item.event));
  }

  /**
   * The timed events of all days.
   * An event over midnight is one bar over its days, 1 line high, at its start time on all its days.
   *
   * Sorted by row, which is the order from top to bottom on each day,
   * also for the bars, which are on several days.
   */
  protected segmentsInWeek(events: Event[]): EventInWeekRow[] {
    let isOverMidnight = (event: Event) => event.endTime >
      new Date(event.startTime.getFullYear(), event.startTime.getMonth(), event.startTime.getDate() + 1);
    let oneDayEvents = events.filter(event => !isOverMidnight(event));
    let bars = layoutDayRow(events.filter(isOverMidnight), this.days).events.map(bar => {
      let startRow = Math.floor(this.rowOf(bar.event.startTime.getHours() + bar.event.startTime.getMinutes() / 60));
      return { ...bar, startRow, endRow: startRow + WeekRowLayout.kRowsPerLine, lane: 0, lanes: 1 };
    });
    return [...this.days.flatMap((_, day) => this.segmentsOnDay(oneDayEvents, day)), ...bars]
      .sort((a, b) => a.startRow - b.startRow || a.event.startTime.getTime() - b.event.startTime.getTime());
  }

  protected segmentsOnDay(events: Event[], day: number): EventInWeekRow[] {
    return layoutTimeColumn(events, this.days[day]).map(item => ({
      ...item,
      startDay: day,
      endDay: day + 1,
      startRow: Math.floor(this.rowOf(item.startRow / kRowsPerHour)),
      endRow: Math.ceil(this.rowOf(item.endRow / kRowsPerHour)),
    }));
  }

  protected rowOf(hours: number): number {
    let fraction = (hours - WeekRowLayout.kStartHour) / (WeekRowLayout.kEndHour - WeekRowLayout.kStartHour);
    return Math.min(Math.max(fraction, 0), 1) * this.rows;
  }

  /** On different days, or in different lanes of the same day */
  protected isSideBySide(a: EventInWeekRow, b: EventInWeekRow): boolean {
    return a.endDay <= b.startDay || b.endDay <= a.startDay ||
      a.lane * b.lanes >= (b.lane + 1) * a.lanes || b.lane * a.lanes >= (a.lane + 1) * b.lanes;
  }

  /**
   * The row where each event ends, if each is 1 line high, one below the other.
   * A bar starts below the events above it on all its days.
   */
  protected stackedEnds(segments: EventInWeekRow[], firstRows: number[]): number[] {
    let ends: number[] = [];
    for (let [i, segment] of segments.entries()) {
      let end = Math.max(...firstRows.slice(segment.startDay, segment.endDay));
      for (let j = 0; j < i; j++) {
        if (!this.isSideBySide(segments[j], segment)) {
          end = Math.max(end, ends[j]);
        }
      }
      ends.push(end + WeekRowLayout.kRowsPerLine);
    }
    return ends;
  }

  protected placeByTime(segments: EventInWeekRow[], firstRows: number[], lastRows: number[]) {
    let lineRows = WeekRowLayout.kRowsPerLine;
    for (let [i, segment] of segments.entries()) {
      let above = segments.slice(0, i).filter(other => !this.isSideBySide(other, segment));
      segment.startRow = Math.max(segment.startRow, ...firstRows.slice(segment.startDay, segment.endDay), ...above.map(other => other.endRow));
      segment.endRow = Math.max(segment.endRow, segment.startRow + lineRows);
    }
    for (let i = segments.length - 1; i >= 0; i--) {
      let segment = segments[i];
      let below = segments.slice(i + 1).filter(other => !this.isSideBySide(other, segment));
      segment.endRow = Math.min(segment.endRow, ...lastRows.slice(segment.startDay, segment.endDay), ...below.map(other => other.startRow));
      segment.startRow = Math.min(segment.startRow, segment.endRow - lineRows);
    }
  }
}
