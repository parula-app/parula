import type { Event } from "../../logic/Calendar/Event";
import { getWeekStart } from "../../logic/util/date";

export class DateNavigatorMonth {
  readonly month: Date;
  readonly weeks: Date[][] = [];

  constructor(date: Date) {
    this.month = new Date(date.getFullYear(), date.getMonth(), 1);
    let day = getWeekStart(this.month);
    for (let week = 0; week < 6; week++) {
      let days: Date[] = [];
      for (let weekday = 0; weekday < 7; weekday++) {
        days.push(new Date(day));
        day.setDate(day.getDate() + 1);
      }
      this.weeks.push(days);
    }
  }

  shownWeeks(showDaysBefore: boolean, showDaysAfter: boolean): (Date | null)[][] {
    let weeks = this.weeks.map(week => week.map(day =>
      this.isInMonth(day) || showDaysBefore && day < this.month || showDaysAfter && day > this.month ? day : null));
    return weeks.filter(week => week.some(day => day && this.isInMonth(day)) || showDaysAfter && week.some(Boolean));
  }

  isInMonth(day: Date): boolean {
    return day.getFullYear() == this.month.getFullYear() && day.getMonth() == this.month.getMonth();
  }

  title(locale: string): string {
    return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(this.month);
  }

  weekdayLabels(locale: string): string[] {
    let format = new Intl.DateTimeFormat(locale, { weekday: "short" });
    return this.weeks[0].map(day => format.format(day).replace(/\.$/, "").slice(0, 2).toLocaleUpperCase(locale));
  }

  next(direction: number): DateNavigatorMonth {
    return new DateNavigatorMonth(new Date(this.month.getFullYear(), this.month.getMonth() + direction, 1));
  }

  get start(): Date {
    return this.weeks[0][0];
  }

  get end(): Date {
    let lastDay = this.weeks[this.weeks.length - 1][6];
    return new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1);
  }

  daysWithEvents(events: Iterable<Event>): Set<string> {
    let first = this.start;
    let end = this.end;
    let keys = new Set<string>();
    for (let event of events) {
      if (!(event.startTime < end && event.endTime > first)) {
        continue;
      }
      let start = event.startTime > first ? event.startTime : first;
      let day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      do {
        keys.add(DateNavigatorMonth.dayKey(day));
        day.setDate(day.getDate() + 1);
      } while (day < event.endTime && day < end);
    }
    return keys;
  }

  static limitRange(start: Date, end: Date, maxDays: number): Date {
    let direction = end < start ? -1 : 1;
    let limit = new Date(start.getFullYear(), start.getMonth(), start.getDate() + direction * (maxDays - 1));
    return direction * (end.getTime() - limit.getTime()) > 0 ? limit : end;
  }

  static dayKey(day: Date): string {
    return `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
  }
}
