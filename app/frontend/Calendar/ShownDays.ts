import type { DateInterval } from "./selected";
import { getDayStart, getWeekStart } from "../../logic/util/date";

/** The days that the calendar view shows, for the mini month */
export class ShownDays {
  readonly start: Date;
  /** The day after the last shown day */
  readonly end: Date;
  /** The day that the mini month shows */
  readonly date: Date;

  /**
   * @param dateInterval The view, see `MainView`
   * @param start The start date of the view
   * @param selectedDate The Day/Month view shows this day and the next day
   */
  constructor(dateInterval: DateInterval, start: Date, selectedDate: Date) {
    let dayCount = dateInterval == 31 ? 35 : dateInterval;
    let first = dateInterval == 2 ? getDayStart(selectedDate)
      : dateInterval > 3 ? getWeekStart(start)
      : getDayStart(start);
    if (dateInterval == 31) {
      // Like `setDays()` in MonthView.svelte: The first week contains the 1st of the month
      while (new Date(first.getFullYear(), first.getMonth(), first.getDate() + 6).getDate() > 7) {
        first.setDate(first.getDate() - 7);
      }
    }
    this.start = first;
    this.end = new Date(first.getFullYear(), first.getMonth(), first.getDate() + dayCount);
    // The month view changes `start` to a day in the first week, which may be in the month before
    this.date = dateInterval == 31 ? new Date(first.getFullYear(), first.getMonth(), first.getDate() + (dayCount >> 1))
      : dateInterval == 2 ? selectedDate
      : start;
  }

  contains(day: Date): boolean {
    return this.start <= day && day < this.end;
  }
}
