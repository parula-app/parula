import type { Event } from "../../../logic/Calendar/Event";
import { layoutDayRow, type EventInDayRow } from "../../../frontend/Calendar/MonthView/WeekRow";

export class WeekRowLayout {
  readonly shown: EventInDayRow[];
  readonly hiddenCounts: number[];

  constructor(events: Event[], days: Date[], maxLines: number) {
    maxLines = Math.max(maxLines, 1);
    let items = layoutDayRow(events, days).events;
    let isOnDay = (item: EventInDayRow, day: number) => item.startDay <= day && day < item.endDay;
    let shownLines = days.map((_, day) =>
      items.some(item => isOnDay(item, day) && item.lane >= maxLines) ? maxLines - 1 : maxLines);
    this.shown = items.filter(item =>
      shownLines.slice(item.startDay, item.endDay).every(lines => item.lane < lines));
    this.hiddenCounts = days.map((_, day) =>
      items.filter(item => isOnDay(item, day) && !this.shown.includes(item)).length);
  }
}
