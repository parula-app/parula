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
  let isOnDay = (event: Event, i: number) => event.startTime.getTime() < dayEnds[i].getTime() && event.endTime.getTime() > days[i].getTime();

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
      continuesBefore: event.startTime.getTime() < days[startDay].getTime(),
      continuesAfter: event.endTime.getTime() > dayEnds[endDay - 1].getTime(),
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
    let segments = days.map((_, day) => this.segmentsOnDay(timedEvents, day));
    let barsOnDay = (barItems: EventInDayRow[], day: number) => barItems.filter(bar => bar.startDay <= day && day < bar.endDay);
    let barsEndRow = (barItems: EventInDayRow[]) => Math.max(0, ...barItems.map(bar => (bar.lane + 1) * lineRows));
    let lastRows = days.map((_, day) =>
      barsEndRow(barsOnDay(bars, day)) + this.linesNeeded(segments[day]) * lineRows > rows ? rows - lineRows : rows);
    let shownBars = bars.filter(bar => lastRows.slice(bar.startDay, bar.endDay).every(lastRow => (bar.lane + 1) * lineRows <= lastRow));
    this.events.push(...shownBars.map(({ lane, ...bar }) =>
      ({ ...bar, startRow: lane * lineRows, endRow: (lane + 1) * lineRows, lane: 0, lanes: 1 })));
    this.hiddenEvents = days.map((_, day) => {
      let firstRow = barsEndRow(barsOnDay(shownBars, day));
      let shownCount = segments[day].length;
      let shownSegments = segments[day];
      while (firstRow + this.linesNeeded(shownSegments) * lineRows > lastRows[day]) {
        shownCount--;
        shownSegments = this.segmentsOnDay(segments[day].slice(0, shownCount).map(segment => segment.event), day);
      }
      this.placeByTime(shownSegments, firstRow, lastRows[day]);
      this.events.push(...shownSegments);
      let hiddenBars = barsOnDay(bars, day).filter(bar => !shownBars.includes(bar));
      return [...hiddenBars, ...segments[day].slice(shownCount)].map(item => item.event);
    });
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

  protected isSideBySide(a: EventInWeekRow, b: EventInWeekRow): boolean {
    return a.lane * b.lanes >= (b.lane + 1) * a.lanes || b.lane * a.lanes >= (a.lane + 1) * b.lanes;
  }

  protected linesNeeded(segments: EventInWeekRow[]): number {
    let lines: number[] = [];
    for (let [i, segment] of segments.entries()) {
      let above = segments.slice(0, i).map((other, j) => this.isSideBySide(other, segment) ? 0 : lines[j]);
      lines.push(1 + Math.max(0, ...above));
    }
    return Math.max(0, ...lines);
  }

  protected placeByTime(segments: EventInWeekRow[], firstRow: number, lastRow: number) {
    let lineRows = WeekRowLayout.kRowsPerLine;
    for (let [i, segment] of segments.entries()) {
      let above = segments.slice(0, i).filter(other => !this.isSideBySide(other, segment));
      segment.startRow = Math.max(segment.startRow, firstRow, ...above.map(other => other.endRow));
      segment.endRow = Math.max(segment.endRow, segment.startRow + lineRows);
    }
    for (let i = segments.length - 1; i >= 0; i--) {
      let segment = segments[i];
      let below = segments.slice(i + 1).filter(other => !this.isSideBySide(other, segment));
      segment.endRow = Math.min(segment.endRow, lastRow, ...below.map(other => other.startRow));
      segment.startRow = Math.min(segment.startRow, segment.endRow - lineRows);
    }
  }
}
