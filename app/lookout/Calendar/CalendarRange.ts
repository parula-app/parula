import type { CalendarViewType } from "./selected";
import { getWeekStart, k1DayMS } from "../../logic/util/date";

export class CalendarRange {
  readonly view: CalendarViewType;
  readonly days: Date[] = [];
  readonly month: Date;

  constructor(view: CalendarViewType, date: Date, dayCount = 1, workDays: boolean[] | null = null) {
    this.view = view;
    this.month = new Date(date.getFullYear(), date.getMonth(), 1);
    let first: Date;
    let count: number;
    if (view == "workweek") {
      this.days = CalendarRange.workWeek(date, workDays);
      return;
    }
    if (view == "day" || view == "schedule") {
      first = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      count = Math.min(Math.max(Math.round(dayCount), 1), 10);
    } else if (view == "dual") {
      first = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      count = 2;
    } else if (view == "week") {
      first = getWeekStart(date);
      count = 7;
    } else {
      first = getWeekStart(this.month);
      let lastOfMonth = new Date(this.month.getFullYear(), this.month.getMonth() + 1, 0);
      let afterLastWeek = getWeekStart(lastOfMonth);
      afterLastWeek.setDate(afterLastWeek.getDate() + 7);
      count = Math.round((afterLastWeek.getTime() - first.getTime()) / k1DayMS);
    }
    for (let i = 0; i < count; i++) {
      this.days.push(new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
    }
  }

  protected static workWeek(date: Date, workDays: boolean[] | null): Date[] {
    const kMondayToFriday = 5;
    let first = getWeekStart(date);
    let week = Array.from({ length: 7 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
    let shown = workDays ? week.filter(day => workDays[day.getDay()]) : [];
    return shown.length ? shown : week.slice(0, kMondayToFriday);
  }

  get start(): Date {
    return this.days[0];
  }

  get end(): Date {
    let last = this.days[this.days.length - 1];
    return new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  }

  get weeks(): Date[][] {
    let weeks: Date[][] = [];
    for (let i = 0; i < this.days.length; i += 7) {
      weeks.push(this.days.slice(i, i + 7));
    }
    return weeks;
  }

  contains(time: Date): boolean {
    return this.start <= time && time < this.end;
  }

  isInMonth(day: Date): boolean {
    return day.getFullYear() == this.month.getFullYear() && day.getMonth() == this.month.getMonth();
  }

  title(locale: string): string {
    if (this.view == "month") {
      return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(this.month);
    }
    if (this.days.length == 1) {
      return new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(this.start);
    }
    let format = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", year: "numeric" });
    return format.formatRange(this.start, this.days[this.days.length - 1]);
  }

  static weekEdge(date: Date, isEnd: boolean): Date {
    let first = getWeekStart(date);
    return isEnd ? new Date(first.getFullYear(), first.getMonth(), first.getDate() + 6) : first;
  }

  static step(view: CalendarViewType, date: Date, dayCount: number, direction: number): Date {
    if (view == "month") {
      return new Date(date.getFullYear(), date.getMonth() + direction, 1);
    }
    let days = view == "day" || view == "schedule" ? new CalendarRange(view, date, dayCount).days.length
      : view == "dual" ? 1
      : 7;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + direction * days);
  }
}
