import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { kAllWeekdays, weekdayLabel } from "../util/date";
import { getDateTimeLocale, gt } from "../../l10n/l10n";
import { assert } from "../util/util";

export enum Frequency {
  None = "NONE",
  Daily = "DAILY",
  Weekly = "WEEKLY",
  Monthly = "MONTHLY",
  Yearly = "YEARLY",
}

/**
 * Maps between pretty names (also used by Exchange) and
 * JavaScript day of week values (as returned by getDay)
 */
export enum Weekday {
  Sunday = 0,
  Monday = 1,
  Tuesday = 2,
  Wednesday = 3,
  Thursday = 4,
  Friday = 5,
  Saturday = 6,
}

/** Maps between iCal names and JavaScript day of week values */
export enum iCalWeekday {
  SU = 0,
  MO = 1,
  TU = 2,
  WE = 3,
  TH = 4,
  FR = 5,
  SA = 6,
}

/**
 * Used to initialise a RecurrenceRule.
 * The `Date`s in a RecurrenceInit use actual time.
 * The rule itself holds seriesStartTime in a different format,
 * so that it can easily extract the local time fields.
 */
export interface RecurrenceInit {
  masterDuration: number;
  timezone?: string;
  seriesStartTime: Date;
  seriesEndTime?: Date;
  count?: number;
  frequency: Frequency;
  interval?: number;
  weekdays?: Weekday[];
  week?: number;
  first?: Weekday;
}

interface ZonedDate {
  getTime(): number;
  getUTCDay(): number;
  getUTCFullYear(): number;
  getUTCMonth(): number;
  getUTCDate(): number;
  getUTCHours(): number;
  getUTCMinutes(): number;
  getUTCSeconds(): number;
  toLocaleDateString(locale: string, options: Intl.DateTimeFormatOptions): string;
}

/**
 * This class does not support all RFC 5545 recurrence rule parts, only
 * FREQ UNTIL COUNT INTERVAL and BYDAY.
 * It does still support more rules than Exchange Server supports;
 * Exchange Server does not support yearly intervals other than 1,
 * nor does it support multiple weekdays except for weekly intervals.
 * The Outlook Web Access UI does allow a daily recurrence on specific weekdays,
 * but this is just a weekly recurrence with an interval of 1.
 */
export class RecurrenceRule implements Readonly<Omit<RecurrenceInit, "seriesStartTime">> {
  /**
   * The duration of the master event.
   *
   * Used by `timesMatch()` to see whether the time changes.
   * Given that master.startTime ~ seriesStartTime and
   * the master.endTime == masterStartTime + masterDuration,
   * we can detect changes in the master start and end time.
   */
  readonly masterDuration: number;
  /**
   * The time zone of the master event.
   * Used to ensure that events recur on the correct day of the week.
   * Defaults to the user's time zone.
   */
  readonly timezone: string | undefined;
  /**
   * A date object whose UTC fields give the local time of
   * the first occurrence in the series. This allows callers to
   * easily determine the local date parts without needing a
   * Temporal.ZonedDateTime object.
   */
  readonly seriesStartTime!: ZonedDate;
  /**
   * The date beyond which the recurrence stops.
   * If you also provide the count, the earlier is used.
   */
  readonly seriesEndTime: Date | null = null;
  /**
   * The number of occurrences beyond which the recurrence stops.
   * If also provide the end date, the earlier is used.
   */
  readonly count: number = Infinity;
  /**
   * The base time period of the pattern.
   */
  readonly frequency!: Frequency;
  /**
   * The interval between occurrences.
   * Note that in the case of occurrences that can happen multiple times in
   * a given week, this is the interval between each set of occurrences.
   */
  readonly interval: number = 1;
  /**
   * Limits occurrences to those that happen on these days of the week.
   */
  readonly weekdays: Weekday[] | null = null;
  /**
   * The week of the month; 5 means the last week in the month.
   * Applies to monthly and yearly repeating rules.
   */
  readonly week: number = 0;
  /**
   * The first day of the week. Only affects weekly recurrences with multiple
   * days of the week and an interval. Defaults to Monday.
   */
  readonly first: Weekday = Weekday.Monday;
  /** The occurrences that have already been calculated. */
  readonly occurrences: Date[] = [];
  /**
   * The intended date fields of the last calculated occurrence.
   * The day will be different if the occurrence happened in a short month.
   */
  weekday: number;
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;

  constructor(data: RecurrenceInit, additionalChecks?: boolean) {
    Object.assign(this, data);
    // Callers like to pass in null but toLocaleString wants undefined
    this.timezone ??= undefined;
    // EditEvent mutates the start time, so clone it to be safe.
    this.occurrences.push(new Date(data.seriesStartTime));
    // Convert from the given time zone to get the right date parts.
    let start = this.seriesStartTime = new Date(data.seriesStartTime.toLocaleString("lt", { timeZone: this.timezone }).replace(" ", "T") + "Z");
    this.weekday = start.getUTCDay();
    this.year = start.getUTCFullYear();
    this.month = start.getUTCMonth();
    this.day = start.getUTCDate();
    this.hours = start.getUTCHours();
    this.minutes = start.getUTCMinutes();
    this.seconds = start.getUTCSeconds();
    // this.fillOccurrences(this.count, this.seriesEndTime || new Date(Date.now() + 1e11));
    if (additionalChecks) {
      if (this.frequency == Frequency.Weekly) {
        if (!this.weekdays?.includes(this.weekday)) {
          if (!(this.weekdays?.length > 1)) {
            this.weekdays = [];
          }
          this.weekdays.push(this.weekday);
        }
      } else if (this.frequency == Frequency.Monthly || this.frequency == Frequency.Yearly) {
        if (this.week) {
          let nextWeek = new Date(start);
          nextWeek.setUTCDate(this.day + 7);
          if (nextWeek.getUTCDate() > 7 || this.week < 5) {
            this.week = Math.ceil(this.day / 7);
          }
          this.weekdays = [this.weekday]; // e.g. 3rd Wednesday of month
        }
      }
    }
  }

  static ensureFrequency(frequency: string): asserts frequency is Frequency {
    if (!Object.values(Frequency).includes(frequency as Frequency)) {
      throw new Error(`Malformed ${frequency} frequency recurrence rule string`);
    }
  }

  static fromCalString(masterDuration: number, timezone: string, seriesStartTime: Date, calString: string): RecurrenceRule {
    if (!/^RRULE:/i.test(sanitize.string(calString))) {
      throw new Error("Malformed recurrence rule string missing RRULE:");
    }
    let { FREQ: frequency, UNTIL: seriesEndTime, COUNT: count, INTERVAL: interval, BYDAY: byday, WKST: first } = Object.fromEntries(calString.slice(6).toUpperCase().split(";").map(part => part.split("="))) as Record<string, string>;
    this.ensureFrequency(frequency);
    let data: RecurrenceInit = { masterDuration, timezone, seriesStartTime, frequency };
    if (seriesEndTime) {
      data.seriesEndTime = sanitizeCalDate(seriesEndTime);
      if (data.seriesEndTime < data.seriesStartTime) {
        throw new Error("Malformed end date in recurrence rule string");
      }
    }
    if (count) {
      data.count = sanitize.integerRange(count, 1, Infinity);
    }
    if (interval) {
      data.interval = sanitize.integerRange(interval, 1, Infinity);
    }
    if (byday) {
      if (byday.startsWith("-1")) {
        data.week = 5;
        byday = byday.replace(/-1/g, "");
      } else if (/^[1-4]/.test(byday)) {
        data.week = sanitize.integer(byday[0]);
        byday = byday.split(byday[0]).join("");
      }
      data.weekdays = byday.split(",").map(day => sanitize.integer(iCalWeekday[day as keyof typeof iCalWeekday]));
    }
    if (first) {
      data.first = sanitize.integer(iCalWeekday[first as keyof typeof iCalWeekday]);
    }
    return new RecurrenceRule(data);
  }

  getCalString(allDay: boolean): string {
    let rule: { FREQ: string, UNTIL?: string, COUNT?: number, INTERVAL?: number, BYDAY?: string, WKST?: string } = { FREQ: this.frequency };
    if (this.seriesEndTime) {
      rule.UNTIL = this.seriesEndTime.toISOString().replace(/-|:|\..../g, "").slice(0, allDay ? 8 : 16);
    }
    if (this.count != Infinity) {
      rule.COUNT = this.count;
    }
    if (this.interval > 1) {
      rule.INTERVAL = this.interval;
    }
    if (this.weekdays) {
      let weekstr = String((this.week + 1) % 6 - 1 || "");
      rule.BYDAY = this.weekdays.map(day => weekstr + iCalWeekday[day]).join(",");
    }
    if (this.first != Weekday.Monday) {
      rule.WKST = iCalWeekday[this.first];
    }
    return 'RRULE:' + Object.entries(rule).map(entry => entry.join("=")).join(";");
  }

  /**
   * When you change the entire series, that could include changing when it
   * recurs. The UI uses this function to tell whether the recurrence was
   * edited, as this will cause all exceptions and exclusions to be reset.
   * It ignores the end of the series, which leaves the exceptions valid.
   * `matches()` also checks the end.
   *
   * Caveat: If you change from weekly to 7-day repetition,
   * this still (intentionally) returns false.
   */
  timesMatch(rule: RecurrenceRule) {
    if (!rule) {
      return false;
    }
    // Must be fast, because it's used by `event.hasChanged()`
    let thisWeekdays = this.weekdays || kAllWeekdays;
    let ruleWeekdays = rule.weekdays || kAllWeekdays;
    return rule.masterDuration == this.masterDuration &&
      rule.timezone == this.timezone &&
      rule.seriesStartTime.getTime() == this.seriesStartTime.getTime() &&
      rule.frequency == this.frequency &&
      rule.interval == this.interval &&
      rule.week == this.week &&
      rule.first == this.first &&
      kAllWeekdays.every(weekday =>
        ruleWeekdays.includes(weekday) == thisWeekdays.includes(weekday));
  }

  matches(rule: RecurrenceRule) {
    // Must be fast, because it's used by `event.hasChanged()`
    return this.timesMatch(rule) &&
      rule.seriesEndTime?.getTime() == this.seriesEndTime?.getTime() &&
      rule.count == this.count;
  }

  countIs(count: number): boolean {
    if (!this.seriesEndTime) {
      return count == this.count;
    }
    this.fillOccurrences(Math.min(count + 1, this.count));
    return this.occurrences[count - 1] != null && this.occurrences[count] == null;
  }

  getOccurrenceAfter(date: Date): Date | undefined {
    this.fillOccurrences(this.count, date);
    return this.occurrences.find(occurrence => occurrence > date);
  }

  getOccurrenceBefore(date: Date): Date | undefined {
    this.fillOccurrences(this.count, date);
    return this.occurrences.findLast(occurrence => occurrence < date);
  }

  getOccurrenceNotAfter(date: Date): Date | undefined {
    this.fillOccurrences(this.count, date);
    return this.occurrences.findLast(occurrence => occurrence <= date);
  }

  getOccurrenceNotBefore(date: Date): Date | undefined {
    this.fillOccurrences(this.count, date);
    return this.occurrences.find(occurrence => occurrence >= date);
  }

  getOccurrencesByDate(seriesEndTime: Date/*, seriesStartTime: Date = this.seriesStartTime*/): Date[] {
    this.fillOccurrences(this.count, seriesEndTime);
    return this.occurrences;
  }

  getOccurrenceByIndex(index: number): Date | undefined {
    if (!this.occurrences[index] && index < this.count) {
      this.fillOccurrences(index + 1);
    }
    return this.occurrences[index];
  }

  getIndexOfOccurrence(date: Date): number {
    if (this.seriesEndTime && this.seriesEndTime < date) {
      return -1;
    }
    this.fillOccurrences(this.count, date);
    return this.occurrences.findIndex(d => d.getTime() == date.getTime());
  }

  fillOccurrences(count: number, date?: Date) {
    while (this.occurrences.length < count && (!date || this.occurrences.at(-1)! <= date)) {
      switch (this.frequency) {
      case Frequency.Daily:
        this.day += this.interval;
        break;
      case Frequency.Weekly:
        if (!this.weekdays) {
          // optimisation for when the event only happens once per week
          this.day += this.interval * 7;
        } else {
          this.day++;
          this.weekday = (this.weekday + 1) % 7;
          if (this.weekday == this.first) {
            this.day += (this.interval - 1) * 7;
          }
        };
        break;
      case Frequency.Monthly:
        if (!this.week) {
          this.month += this.interval;
        } else {
          this.day++;
          if (this.day > this.week * 7) {
            this.month += this.interval;
            this.day -= 7;
          }
        }
        break;
      case Frequency.Yearly:
        if (!this.week) {
          this.year += this.interval;
        } else {
          this.day++;
          if (this.day > this.week * 7) {
            this.year += this.interval;
            this.day -= 7;
          }
        }
        break;
      }
      let utc = new Date(Date.UTC(this.year, this.month, this.day, this.hours, this.minutes, this.seconds));
      if (this.week == 5 && utc.getUTCDate() != this.day) {
        // Month ran out of days. Advance to the next month/year.
        if (this.frequency == Frequency.Yearly) {
          this.year += this.interval;
        } else {
          this.month += this.interval;
        }
        utc.setUTCFullYear(this.year);
        utc.setUTCMonth(this.month);
        // Temporarily advance to the next month.
        utc.setUTCDate(32);
        // Rewind to the last week of the month.
        utc.setUTCDate(-6);
        this.day = utc.getUTCDate();
      }
      if (this.weekdays && !this.weekdays.includes(utc.getUTCDay())) {
        continue;
      }
      if ((this.frequency == Frequency.Yearly || this.frequency == Frequency.Monthly) && utc.getUTCDate() != this.day) {
        // Ran out of days in the month, so rewind to the last day in the month.
        utc.setUTCDate(0);
      }
      // Now convert the occurrence to the given time zone.
      let offset = new Date(utc.toLocaleString("lt", { timeZone: this.timezone }).replace(" ", "T") + "Z").getTime() - utc.getTime();
      let occurrence = new Date(utc.getTime() - offset);
      offset = new Date(occurrence.toLocaleString("lt", { timeZone: this.timezone }).replace(" ", "T") + "Z").getTime() - utc.getTime();
      if (offset) {
        occurrence = new Date(occurrence.getTime() - offset);
      }
      // Don't allow more occurrences than the series wants
      if (this.seriesEndTime && occurrence > this.seriesEndTime) {
        break;
      }
      this.occurrences.push(occurrence);
    }
  }
}

function sanitizeCalDate(dateStr: string) {
  if (/^\d{8}$/.test(dateStr)) {
    dateStr = dateStr.replace(/(....)(..)(..)/, "$1-$2-$3T23:59:59");
  } else if (/^\d{8}T\d{6}Z?$/.test(dateStr)) {
    dateStr = dateStr.replace(/(....)(..)(..T..)(..)(..)/, "$1-$2-$3:$4:$5");
  }
  return sanitize.date(dateStr);
}

/**
 * @returns A human-readable, translated description of the recurrence.
 * E.g. "Every month, on the third Wednesday of the month"
 */
export function ruleAsLabel(r: RecurrenceRule): string {
  let label = "";
  if (r.frequency == Frequency.Daily) {
    label += r.interval == 1
      ? gt`Every day`
      : gt`Every ${r.interval} days`;
  } else if (r.frequency == Frequency.Weekly) {
    label += r.interval == 1
      ? gt`Every week`
      : gt`Every ${r.interval} weeks`;
    label += `, ` + gt`on *=> as in: Every week, on Thursday` + ` `;

    // A weekly rule without explicit weekdays recurs on the series start weekday.
    let ruleWeekdays = r.weekdays ?? [r.seriesStartTime.getUTCDay()];
    let weekdays = kAllWeekdays.filter(weekday => ruleWeekdays.includes(weekday));
    label += sortedList(weekdays, weekday => weekdayLabel(weekday, "long"));
  } else if (r.frequency == Frequency.Monthly) {
    label += r.interval == 1
      ? gt`Every month`
      : gt`Every ${r.interval} months`;
    label += `, `;
    if (r.week) {
      label += gt`on the ${weekName(r.week)} ${r.seriesStartTime.toLocaleDateString(getDateTimeLocale(), { weekday: "long", timeZone: "UTC" })} *=> as in: on the third Wednesday of the month`;
    } else {
      label += gt`on the ${r.seriesStartTime.toLocaleDateString(getDateTimeLocale(), { day: "numeric", timeZone: "UTC" })}th *=> as in: on the 5th of the month`;
    }
  } else if (r.frequency == Frequency.Yearly) {
    label += r.interval == 1
      ? gt`Every year`
      : gt`Every ${r.interval} years`;
    label += `, `;
    if (r.week) {
      label += gt`on the ${weekName(r.week)} ${r.seriesStartTime.toLocaleDateString(getDateTimeLocale(), { weekday: "long", timeZone: "UTC" })} in ${r.seriesStartTime.toLocaleDateString(getDateTimeLocale(), { month: "long", timeZone: "UTC" })} *=> as in: on the third Wednesday in September`;
    } else {
      label += gt`on ${r.seriesStartTime.toLocaleDateString(getDateTimeLocale(), { day: "numeric", month: "long", timeZone: "UTC" })} *=> as in: on the 5th July`;
    }
  }
  return label;
}

function weekName(week: number) {
  assert(1 <= week && week <= 5, "invalid week");
  let weekname = [
    gt`first *=> as in: On the first Wednesday in July`,
    gt`second *=> as in: On the second Wednesday in July`,
    gt`third *=> as in: On the third Wednesday in July`,
    gt`fourth *=> as in: On the fourth Wednesday in July`,
    gt`last *=> as in: On the last Wednesday in July`,
  ];
  return weekname[week - 1];
}

/**
 * @param entries A sorted list of numbers
 * @returns comma-separated list, whereas
 *   the last comma is replaced with "and",
 *   and consequitive ranges are collapsed with "to".
 *   E.g. "3-6, 3, 4-10, 11, 12-14 and 19" */
function sortedList(entries: number[], labelFunc: (value: number) => string): string {
  let label = "";
  let duringRange = false;
  let i = 0;
  for (let value of entries) {
    let nextValue = entries[i + 1];
    // separator
    if (i == 0) {
      // start
    } else if (duringRange) {
      if (nextValue != value + 1) {
        // ... to ...
        label += ` ` + gt`to *=> as in: Monday to Friday` + ` `;
        duringRange = false;
      }
    } else if (i + 1 == entries.length) { // last
      // ... and ...
      label += ` ` + gt`and *=> as in: Monday and Friday` + ` `;
    } else if (nextValue == value + 1) {
      duringRange = true;
    } else {
      label += `, `;
    }
    if (!duringRange) {
      label += labelFunc(value);
    }
    i++;
  }
  return label;
}
