import type { ICalContainer } from "./ICalParser";
import { iCalWeekday } from "../RecurrenceRule";
import { k1MinuteMS } from "../../util/date";
import { assert } from "../../util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

/**
 * A timezone that the iCal file defines itself, in a `VTIMEZONE`, RFC 5545 3.6.5.
 * We need it for a `TZID` that is not an IANA timezone name, e.g. the Windows
 * display name "(UTC+01:00) Brussels, Copenhagen, Madrid, Paris".
 *
 * Local times are in the UTC fields of a `Date`, as `Date.UTC()` makes them.
 */
export class ICalTimezone {
  /** The `STANDARD` and `DAYLIGHT` parts */
  readonly observances: ICalTimezoneObservance[] = [];

  constructor(vtimezone: ICalContainer) {
    let parts = [...vtimezone.containers.standard ?? [], ...vtimezone.containers.daylight ?? []];
    for (let part of parts) {
      try {
        this.observances.push(new ICalTimezoneObservance(part));
      } catch (ex) {
        // Skip a broken part, e.g. without `TZOFFSETTO`, and use the others
      }
    }
  }

  /** @returns null, if the `VTIMEZONE` has no usable part */
  toUTC(local: Date): Date | null {
    let offset = this.offsetAt(local);
    return offset == null ? null : new Date(local.getTime() - offset * k1MinuteMS);
  }

  /** How many minutes the local time is ahead of UTC */
  protected offsetAt(local: Date): number | null {
    let current: ICalTimezoneObservance | null = null;
    let currentStart: Date | null = null;
    let first: ICalTimezoneObservance | null = null;
    for (let observance of this.observances) {
      let start = observance.lastStartNotAfter(local);
      if (start && !(currentStart && currentStart >= start)) {
        current = observance;
        currentStart = start;
      }
      if (!first || observance.start < first.start) {
        first = observance;
      }
    }
    if (!current) {
      // Before the first change, the offset before that change applies
      return first?.offsetFrom ?? null;
    }
    return current.offsetTo;
  }
}

/** The `STANDARD` or the `DAYLIGHT` part of a `VTIMEZONE`, RFC 5545 3.6.5 */
class ICalTimezoneObservance {
  /** The first start of this part, as local time before the change */
  readonly start: Date;
  /** UTC offset in minutes, before the change */
  readonly offsetFrom: number;
  /** UTC offset in minutes, after the change */
  readonly offsetTo: number;
  /** From `RDATE` */
  readonly additionalStarts: Date[] = [];
  /** From `RRULE`. null, if the part does not repeat yearly. */
  readonly rule: ICalTimezoneRule | null = null;

  constructor(part: ICalContainer) {
    let start = parseLocalTime(part.entries.dtstart?.[0].value);
    assert(start, "VTIMEZONE part without DTSTART");
    this.start = start;
    this.offsetFrom = this.parseOffset(part.entries.tzoffsetfrom?.[0].value);
    this.offsetTo = this.parseOffset(part.entries.tzoffsetto?.[0].value);
    for (let entry of part.entries.rdate ?? []) {
      for (let value of entry.value.split(",")) {
        let additionalStart = parseLocalTime(value);
        if (additionalStart) {
          this.additionalStarts.push(additionalStart);
        }
      }
    }
    let rrule = part.entries.rrule?.[0];
    if (rrule) {
      this.rule = new ICalTimezoneRule(rrule.value, this.start, this.offsetFrom);
    }
  }

  lastStartNotAfter(local: Date): Date | null {
    let last: Date | null = null;
    for (let start of [this.start, ...this.additionalStarts, ...this.rule?.startsNear(local) ?? []]) {
      if (start <= local && !(last && last >= start)) {
        last = start;
      }
    }
    return last;
  }

  /** @param value e.g. "+0100" or "-0430" */
  protected parseOffset(value: string | undefined): number {
    let match = /^([+-])(\d\d)(\d\d)(\d\d)?$/.exec(value ?? "");
    assert(match, `Malformed UTC offset ${value} in VTIMEZONE`);
    let minutes = Number(match[2]) * 60 + Number(match[3]);
    return match[1] == "-" ? -minutes : minutes;
  }
}

/** A yearly `RRULE` of a `VTIMEZONE` part, e.g. "FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU" */
class ICalTimezoneRule {
  /** The first start of the part, which gives the time of day */
  readonly start: Date;
  /** 0 = January */
  readonly month: number;
  readonly weekday: number | null = null;
  /** e.g. 2 for the 2nd Sunday, -1 for the last Sunday, 0 for every Sunday */
  readonly week: number = 0;
  /** From `BYMONTHDAY`, e.g. 8 to 14 for the 2nd Sunday.
   * Without `BYMONTHDAY` and `BYDAY`, the day of the first start. */
  readonly monthDays: number[] | null = null;
  /** As local time before the change */
  readonly until: Date | null = null;

  constructor(rrule: string, start: Date, offsetFrom: number) {
    this.start = start;
    let parts = Object.fromEntries(rrule.toUpperCase().split(";").map(part => part.split("="))) as Record<string, string>;
    assert(parts.FREQ == "YEARLY", `VTIMEZONE RRULE ${rrule} is not yearly`);
    this.month = sanitize.integerRange(parts.BYMONTH ?? start.getUTCMonth() + 1, 1, 12) - 1;
    if (parts.BYDAY) {
      let byDay = /^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(parts.BYDAY);
      assert(byDay, `VTIMEZONE RRULE ${rrule} has an unsupported BYDAY`);
      this.week = Number(byDay[1] ?? 0);
      this.weekday = iCalWeekday[byDay[2] as keyof typeof iCalWeekday];
    }
    if (parts.BYMONTHDAY) {
      this.monthDays = parts.BYMONTHDAY.split(",").map(day => sanitize.integerRange(day, -31, 31));
    } else if (this.weekday == null) {
      this.monthDays = [start.getUTCDate()];
    }
    if (parts.UNTIL) {
      let until = parseLocalTime(parts.UNTIL.replace(/Z$/, ""));
      assert(until, `VTIMEZONE RRULE ${rrule} has a malformed UNTIL`);
      this.until = parts.UNTIL.endsWith("Z") ? new Date(until.getTime() + offsetFrom * k1MinuteMS) : until;
    }
  }

  /** The starts in the year of `local` and in the year before, which include the last start before `local` */
  startsNear(local: Date): Date[] {
    let year = Math.min(local.getUTCFullYear(), this.until?.getUTCFullYear() ?? Infinity);
    return [year - 1, year]
      .map(year => this.startIn(year))
      .filter((start): start is Date => !!start && start >= this.start && !(this.until && start > this.until));
  }

  protected startIn(year: number): Date | null {
    let lastDay = new Date(Date.UTC(year, this.month + 1, 0)).getUTCDate();
    let weekday = new Date(Date.UTC(year, this.month, 1)).getUTCDay();
    for (let day = 1; day <= lastDay; day++, weekday = (weekday + 1) % 7) {
      if (this.matches(day, weekday, lastDay)) {
        return new Date(Date.UTC(year, this.month, day,
          this.start.getUTCHours(), this.start.getUTCMinutes(), this.start.getUTCSeconds()));
      }
    }
    return null;
  }

  protected matches(day: number, weekday: number, lastDay: number): boolean {
    if (this.monthDays && !this.monthDays.includes(day) && !this.monthDays.includes(day - lastDay - 1)) {
      return false;
    }
    if (this.weekday == null) {
      return true;
    }
    if (weekday != this.weekday) {
      return false;
    }
    if (this.week < 0) {
      return Math.ceil((lastDay - day + 1) / 7) == -this.week;
    }
    return !this.week || Math.ceil(day / 7) == this.week;
  }
}

/** @param value e.g. "19701025T030000", or a date alone, e.g. "19701025" */
function parseLocalTime(value: string | undefined): Date | null {
  let match = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d))?$/.exec(value ?? "");
  if (!match) {
    return null;
  }
  let [year, month, day, hours, minutes, seconds] = match.slice(1).map(part => Number(part ?? 0));
  return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
}
