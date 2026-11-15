import { getWeekStart, k1DayMS } from "../../logic/util/date";

/** "schedule" is only in Lookout, "4weeks" only in classic */
export type CalendarViewType = "day" | "workweek" | "week" | "4weeks" | "month" | "schedule" | "dual";

export class CalendarRange {
  readonly view: CalendarViewType;
  readonly days: Date[];
  readonly month: Date;
  readonly start: Date;
  /** The day after the last shown day */
  readonly end: Date;
  /** The days in rows of 7, for the month views */
  readonly weeks: Date[][];

  constructor(view: CalendarViewType, date: Date, dayCount = 1, workDays: boolean[] | null = null) {
    this.view = view;
    this.month = new Date(date.getFullYear(), date.getMonth(), 1);
    if (view == "workweek") {
      this.days = CalendarRange.workWeek(date, workDays);
    } else {
      let first: Date;
      let count: number;
      if (view == "day" || view == "schedule") {
        first = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        count = Math.min(Math.max(Math.round(dayCount), 1), 10);
      } else if (view == "dual") {
        first = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        count = 2;
      } else if (view == "week") {
        first = getWeekStart(date);
        count = 7;
      } else if (view == "4weeks") {
        first = getWeekStart(date);
        count = 28;
      } else {
        first = getWeekStart(this.month);
        let lastOfMonth = new Date(this.month.getFullYear(), this.month.getMonth() + 1, 0);
        let afterLastWeek = getWeekStart(lastOfMonth);
        afterLastWeek.setDate(afterLastWeek.getDate() + 7);
        count = Math.round((afterLastWeek.getTime() - first.getTime()) / k1DayMS);
      }
      let year = first.getFullYear();
      let month = first.getMonth();
      let dayOfMonth = first.getDate();
      let days: Date[] = [];
      for (let i = 0; i < count; i++) {
        days.push(new Date(year, month, dayOfMonth + i));
      }
      this.days = days;
    }
    // Computed once, because the views read them for every day and event
    let days = this.days;
    this.start = days[0];
    let last = days[days.length - 1];
    this.end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    let weeks: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }
    this.weeks = weeks;
  }

  protected static workWeek(date: Date, workDays: boolean[] | null): Date[] {
    const kMondayToFriday = 5;
    let first = getWeekStart(date);
    let year = first.getFullYear();
    let month = first.getMonth();
    let dayOfMonth = first.getDate();
    let week = Array.from({ length: 7 }, (_, i) => new Date(year, month, dayOfMonth + i));
    let shown = workDays ? week.filter(day => workDays[day.getDay()]) : [];
    return shown.length ? shown : week.slice(0, kMondayToFriday);
  }

  /** The middle of the shown days, i.e. in the month that covers most of them */
  get middle(): Date {
    return this.days[this.days.length >> 1];
  }

  contains(time: Date): boolean {
    return this.start.getTime() <= time.getTime() && time.getTime() < this.end.getTime();
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

  /**
   * @param date The date of this range, e.g. a Wednesday in a week
   * @returns The date of the next or previous range, e.g. the Wednesday of the next week
   */
  step(date: Date, direction: number): Date {
    if (this.view == "month") {
      return new Date(date.getFullYear(), date.getMonth() + direction, 1);
    }
    let days = this.view == "day" || this.view == "schedule" ? this.days.length
      : this.view == "dual" ? 1
      : this.view == "4weeks" ? 28
      : 7;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + direction * days);
  }
}
