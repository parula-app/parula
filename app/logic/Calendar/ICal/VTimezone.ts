import { iCalWeekday } from "../RecurrenceRule";
import { k1MinuteMS } from "../../util/date";

/**
 * The daylight saving time rules of a timezone, as iCal `VTIMEZONE`,
 * RFC 5545 3.6.5.
 *
 * Outlook and Exchange do not understand the IANA timezone names that we
 * write in `TZID`, but take the offsets from the `VTIMEZONE` alone.
 * Without it, Outlook uses the base offset of the timezone and shows every
 * event during summer time 1 hour off, and Exchange uses the timezone of the
 * mailbox instead. They understand only one yearly change to and from daylight
 * saving time, and read only `TZID`, `DTSTART`, `RRULE`, `TZOFFSETFROM` and
 * `TZOFFSETTO`, so we write nothing else. An unparsable `VTIMEZONE` makes
 * Exchange reject the entire invitation, so stay conservative here.
 */
export class VTimezone {
  /** IANA timezone name, e.g. "Europe/Berlin" */
  readonly timezone: string;
  /** The `STANDARD` part, and the `DAYLIGHT` part,
   * if the timezone has daylight saving time */
  readonly observances: TimezoneObservance[] = [];

  /**
   * @param timezone IANA timezone name, e.g. "Europe/Berlin"
   * @param when Which rules to write. As we can express only one change per
   *   year, we use the rules of the year in which the event happens.
   */
  constructor(timezone: string, when: Date) {
    this.timezone = timezone;
    let changes = utcOffsetChanges(timezone, yearIn(when, timezone));
    let offsets = changes.map(change => utcOffset(change, timezone));
    if (changes.length != 2 || offsets[0] == offsets[1]) {
      // No daylight saving time, or changes that a yearly rule cannot express,
      // e.g. Africa/Casablanca, which changes for Ramadan.
      // The offset during the event is the best that we can do.
      let offset = utcOffset(when, timezone);
      this.observances.push(new TimezoneObservance(false, offset, offset, null));
      return;
    }
    let standardOffset = Math.min(...offsets);
    let daylightOffset = Math.max(...offsets);
    this.observances.push(
      new TimezoneObservance(false, daylightOffset, standardOffset, changes[offsets.indexOf(standardOffset)]),
      new TimezoneObservance(true, standardOffset, daylightOffset, changes[offsets.indexOf(daylightOffset)]));
  }

  toICalLines(): (string | string[])[] {
    let lines: (string | string[])[] = [
      ["BEGIN", "VTIMEZONE"],
      ["TZID", this.timezone],
    ];
    for (let observance of this.observances) {
      lines.push(...observance.toICalLines());
    }
    lines.push(["END", "VTIMEZONE"]);
    return lines;
  }
}

/** The `STANDARD` or the `DAYLIGHT` part of a `VTIMEZONE`, RFC 5545 3.6.5.1 */
class TimezoneObservance {
  /** Summer time (`DAYLIGHT`), or winter time (`STANDARD`) */
  readonly isDaylight: boolean;
  /** UTC offset in minutes, before the change */
  readonly offsetFrom: number;
  /** UTC offset in minutes, after the change */
  readonly offsetTo: number;
  /** When this part starts, as local time in the UTC fields of the `Date` */
  readonly start: Date;
  /** The yearly repetition of the change, without the `RRULE:` prefix.
   * null, if the timezone has no daylight saving time. */
  readonly recurrenceRule: string | null = null;

  /** @param change When the offset changes, or null for no daylight saving time */
  constructor(isDaylight: boolean, offsetFrom: number, offsetTo: number, change: Date | null) {
    this.isDaylight = isDaylight;
    this.offsetFrom = offsetFrom;
    this.offsetTo = offsetTo;
    if (!change) {
      this.start = new Date(Date.UTC(kStartYear, 0, 1));
      return;
    }
    // The local time at the change is still the one before it, RFC 5545 3.6.5
    let local = new Date(change.getTime() + offsetFrom * k1MinuteMS);
    let month = local.getUTCMonth() + 1;
    let weekday = local.getUTCDay();
    let nth = nthWeekdayOfMonth(local);
    this.recurrenceRule = `FREQ=YEARLY;BYMONTH=${month};BYDAY=${nth}${iCalWeekday[weekday]}`;
    // Start in the past, so that the rule also covers events before this year
    this.start = new Date(Date.UTC(kStartYear, local.getUTCMonth(),
      dayOfNthWeekday(kStartYear, month, nth, weekday),
      local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds()));
  }

  toICalLines(): (string | string[])[] {
    let part = this.isDaylight ? "DAYLIGHT" : "STANDARD";
    let lines: (string | string[])[] = [
      ["BEGIN", part],
      // Local time, never UTC: Exchange reads even a `Z` value as local time
      ["DTSTART", localtime2ical(this.start)],
      ["TZOFFSETFROM", offset2ical(this.offsetFrom)],
      ["TZOFFSETTO", offset2ical(this.offsetTo)],
    ];
    if (this.recurrenceRule) {
      // `RRULE` contains ";"s, which must not be escaped as normal text values
      lines.push("RRULE:" + this.recurrenceRule + "\r\n");
    }
    lines.push(["END", part]);
    return lines;
  }
}

/** The `DTSTART` year of the rules. Before any event that we might send,
 * and the year in which the timezone database starts. */
const kStartYear = 1970;

/**
 * When the UTC offset of `timezone` changes during `year`,
 * e.g. to and from daylight saving time.
 * We compare the months, so 2 changes within the same month go unnoticed,
 * which then leaves us with the fixed offset during the event.
 */
function utcOffsetChanges(timezone: string, year: number): Date[] {
  let changes: Date[] = [];
  let start = new Date(Date.UTC(year, 0, 1));
  let startOffset = utcOffset(start, timezone);
  for (let month = 1; month <= 12; month++) {
    let end = new Date(Date.UTC(year, month, 1));
    let endOffset = utcOffset(end, timezone);
    if (endOffset != startOffset) {
      changes.push(findUTCOffsetChange(start, end, timezone));
    }
    start = end;
    startOffset = endOffset;
  }
  return changes;
}

/** The exact moment when the UTC offset of `timezone` changes
 * @param before must have a different UTC offset than `after` */
function findUTCOffsetChange(before: Date, after: Date, timezone: string): Date {
  let offsetBefore = utcOffset(before, timezone);
  // The timezone database changes the offset only at full minutes
  while (after.getTime() - before.getTime() > k1MinuteMS) {
    let middle = new Date(Math.round((before.getTime() + after.getTime()) / 2 / k1MinuteMS) * k1MinuteMS);
    if (utcOffset(middle, timezone) == offsetBefore) {
      before = middle;
    } else {
      after = middle;
    }
  }
  return after;
}

/** How many minutes the local time in `timezone` is ahead of UTC, at `time` */
function utcOffset(time: Date, timezone: string): number {
  // "lt" locale has date format YYYY-MM-DD hh:mm:ss,
  // which we can easily read as UTC.
  let local = new Date(time.toLocaleString("lt", { timeZone: timezone }).replace(" ", "T") + "Z");
  return Math.round((local.getTime() - time.getTime()) / k1MinuteMS);
}

/** The year at `time` in `timezone`, which may differ from the year here */
function yearIn(time: Date, timezone: string): number {
  return Number(time.toLocaleDateString("lt", { timeZone: timezone, year: "numeric" }));
}

/** Which weekday of the month `local` is, e.g. 2 for the 2nd Sunday
 * and -1 for the last Sunday, as `BYDAY` counts them.
 * `local` has the local time in its UTC fields. */
function nthWeekdayOfMonth(local: Date): number {
  let day = local.getUTCDate();
  let lastDay = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
  return day + 7 > lastDay ? -1 : Math.ceil(day / 7);
}

/** The day of the month of e.g. the 2nd Sunday (`nth` 2, `weekday` 0)
 * or the last Sunday (`nth` -1), the reverse of `nthWeekdayOfMonth()`
 * @param month 1 = January */
function dayOfNthWeekday(year: number, month: number, nth: number, weekday: number): number {
  if (nth > 0) {
    let firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return 1 + (weekday - firstWeekday + 7) % 7 + (nth - 1) * 7;
  }
  let lastDay = new Date(Date.UTC(year, month, 0));
  return lastDay.getUTCDate() - (lastDay.getUTCDay() - weekday + 7) % 7;
}

/** iCal date-time in local time, e.g. "19700329T020000".
 * `date` has the local time in its UTC fields. */
function localtime2ical(date: Date): string {
  return date.toISOString().replace(/-|:|\..../g, "").slice(0, -1);
}

/** UTC offset in iCal format, e.g. "+0200" */
function offset2ical(minutes: number): string {
  let sign = minutes < 0 ? "-" : "+";
  minutes = Math.abs(minutes);
  return sign + String(Math.floor(minutes / 60)).padStart(2, "0") + String(minutes % 60).padStart(2, "0");
}
